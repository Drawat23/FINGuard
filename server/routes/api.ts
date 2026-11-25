import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import {
  hashToken,
  issueTokenPair,
  requireAuth,
  requireIdempotencyKey,
  signOAuthStateToken,
  verifyAccessTokenString,
  verifyFirebaseGoogleIdToken,
  verifyOAuthStateToken,
  verifyRefreshJwt,
  type AuthenticatedRequest,
} from '../auth/authMiddleware.ts';
import { promptToQuantDSL } from '../ai/geminiClient.ts';
import {
  askFinquantCopilot,
  ensureSeededRagDocuments,
  extractTextFromPdfBuffer,
  ingestUserDocument,
} from '../ai/ragService.ts';
import { db } from '../db/store.ts';
import { runQuantBacktest } from '../quant/backtestEngine.ts';
import { analyzeUpiCashflow, parseRawUpiInput } from '../quant/cashflowEngine.ts';
import { analyzeMutualFundOverlap } from '../quant/mfOverlapEngine.ts';
import { runPortfolioOptimizer } from '../quant/optimizer.ts';
import { computeTaxHarvestReport } from '../quant/taxEngine.ts';
import {
  getInteractiveChartSeries,
  getLiveQuote,
  getMultipleQuotesWithUpstox,
  NSE_UNIVERSE_CATALOG,
  openPublicNseWebSocket,
  searchIndianStocks,
  searchMutualFunds,
} from '../services/marketDataService.ts';
import {
  buildUpstoxAuthorizeUrl,
  type ChartTimeframe,
  exchangeUpstoxCodeForToken,
  fetchUpstoxOrderBook,
  fetchUpstoxPortfolio,
  getUpstoxRedirectUri,
  isNseMarketOpen,
  isUpstoxConfigured,
  openUpstoxFeedWebSocket,
  placeUpstoxOrder,
} from '../services/upstoxService.ts';
import { getLiveMarketNewsFeed } from '../services/newsService.ts';
import type {
  AssetType,
  EnrichedHolding,
  OrderSide,
  QuantStrategyDSL,
  RealTradeInput,
  UpstoxFundsInfo,
  UserProfile,
} from '../../shared/types.ts';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function toPublicUser(u: ReturnType<typeof db.findUserById>): UserProfile | null {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    riskProfile: u.riskProfile,
    hasPin: u.hasPin,
    authProvider: u.authProvider || 'LOCAL',
    avatarUrl: u.avatarUrl,
    upiId: u.upiId,
    city: u.city,
    occupation: u.occupation,
    dateOfBirth: u.dateOfBirth,
    bio: u.bio,
    taxRegime: u.taxRegime,
    investmentHorizon: u.investmentHorizon,
    incomeBracket: u.incomeBracket,
    targetMonthlySipInr: u.targetMonthlySipInr,
    createdAt: u.createdAt,
  };
}

async function buildEnrichedHoldingsWithMeta(userId: string): Promise<{
  holdings: EnrichedHolding[];
  upstoxConnected: boolean;
  upstoxFunds: UpstoxFundsInfo | null;
  portfolioSourceMode: 'UPSTOX_LIVE' | 'REAL_TRADES' | 'EMPTY';
}> {
  const user = db.findUserById(userId);
  const manualHoldings = db.getHoldings(userId);

  let upstoxHoldings: EnrichedHolding[] = [];
  let upstoxFunds: UpstoxFundsInfo | null = null;
  const upstoxConnected = Boolean(user?.upstoxAccessToken);

  if (user?.upstoxAccessToken) {
    try {
      const live = await fetchUpstoxPortfolio(user.upstoxAccessToken);
      upstoxFunds = live.funds;
      upstoxHoldings = live.holdings
        .filter((h) => h.quantity > 0)
        .map((h) => {
          const investedValue = h.quantity * h.averagePrice;
          const currentValue = h.quantity * h.lastPrice;
          const unrealizedPnl = currentValue - investedValue;
          const unrealizedPnlPct = investedValue > 0 ? (unrealizedPnl / investedValue) * 100 : 0;
          return {
            id: `upx_${h.isin || h.tradingSymbol}`,
            userId,
            symbol: h.symbol,
            name: h.companyName,
            assetType: h.symbol.includes('BEES') ? 'ETF' : 'STOCK_NSE',
            quantity: h.quantity,
            avgBuyPrice: Number(h.averagePrice.toFixed(2)),
            buyDate: new Date().toISOString().slice(0, 10),
            source: 'UPSTOX_LIVE',
            currentPrice: Number(h.lastPrice.toFixed(2)),
            dayChangePct: Number(h.dayChangePct.toFixed(2)),
            investedValue: Math.round(investedValue),
            currentValue: Math.round(currentValue),
            unrealizedPnl: Math.round(unrealizedPnl),
            unrealizedPnlPct: Number(unrealizedPnlPct.toFixed(2)),
            holdingDays: 0,
            taxBucket: 'STCG',
            estimatedTaxInr: unrealizedPnl > 0 ? Math.round(unrealizedPnl * 0.2) : 0,
            dataSource: 'UPSTOX_LIVE',
          };
        });
    } catch {
      // If Upstox token expired, fall back to logged FIFO trades cleanly
    }
  }

  const upstoxSymbolSet = new Set(upstoxHoldings.map((h) => h.symbol.toUpperCase()));
  const filteredManual = manualHoldings.filter((h) => !upstoxSymbolSet.has(h.symbol.toUpperCase()));

  const enrichedManual: EnrichedHolding[] = await Promise.all(
    filteredManual.map(async (h) => {
      let currentPrice = h.avgBuyPrice;
      let dayChangePct = 0;
      let dataSource: EnrichedHolding['dataSource'] = 'CACHED';
      try {
        const q = await getLiveQuote(h.symbol);
        currentPrice = q.price;
        dayChangePct = q.changePct;
        dataSource = q.dataSource;
      } catch {
        // Keep cost price if upstream quote temporarily unreachable
      }
      const investedValue = h.quantity * h.avgBuyPrice;
      const currentValue = h.quantity * currentPrice;
      const unrealizedPnl = currentValue - investedValue;
      const unrealizedPnlPct = investedValue > 0 ? (unrealizedPnl / investedValue) * 100 : 0;
      const holdingDays = Math.max(
        0,
        Math.floor((Date.now() - new Date(h.buyDate).getTime()) / (1000 * 60 * 60 * 24))
      );
      const taxBucket: 'STCG' | 'LTCG' = holdingDays >= 365 ? 'LTCG' : 'STCG';
      const estimatedTaxInr =
        unrealizedPnl > 0 ? Math.round(unrealizedPnl * (taxBucket === 'STCG' ? 0.2 : 0.125)) : 0;
      return {
        ...h,
        currentPrice,
        dayChangePct,
        investedValue: Math.round(investedValue),
        currentValue: Math.round(currentValue),
        unrealizedPnl: Math.round(unrealizedPnl),
        unrealizedPnlPct: Number(unrealizedPnlPct.toFixed(2)),
        holdingDays,
        taxBucket,
        estimatedTaxInr,
        dataSource,
      };
    })
  );

  const combined = [...upstoxHoldings, ...enrichedManual];
  const portfolioSourceMode =
    upstoxHoldings.length > 0
      ? 'UPSTOX_LIVE'
      : combined.length > 0
      ? 'REAL_TRADES'
      : 'EMPTY';

  return {
    holdings: combined,
    upstoxConnected,
    upstoxFunds,
    portfolioSourceMode,
  };
}

async function buildEnrichedHoldings(userId: string): Promise<EnrichedHolding[]> {
  const { holdings } = await buildEnrichedHoldingsWithMeta(userId);
  return holdings;
}

async function sendIdempotent(
  req: AuthenticatedRequest,
  res: Response,
  statusCode: number,
  body: unknown
): Promise<void> {
  const key = req.header('Idempotency-Key')?.trim();
  if (key && req.userId) {
    await db.saveIdempotency({
      key,
      userId: req.userId,
      route: req.originalUrl,
      statusCode,
      responseJson: body,
      createdAt: new Date().toISOString(),
    });
  }
  res.status(statusCode).json(body);
}

// ==========================================
// AUTHENTICATION & PIN ROUTES
// ==========================================
router.post('/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password, pin, riskProfile } = req.body as {
      name?: string;
      email?: string;
      phone?: string;
      password?: string;
      pin?: string;
      riskProfile?: UserProfile['riskProfile'];
    };

    if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
      res.status(400).json({ error: 'Name, valid email, and password (min 6 chars) are required.' });
      return;
    }
    if (!pin || !/^\d{4}$/.test(pin)) {
      res.status(400).json({ error: 'A 4-digit numeric transaction PIN is required.' });
      return;
    }
    if (db.findUserByEmailOrPhone(email)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const pinHash = await bcrypt.hash(pin, 10);
    const user = await db.createUserWithAccounts({
      name,
      email,
      phone: phone || '+91 98000 00000',
      passwordHash,
      pinHash,
      riskProfile,
    });
    const tokens = await issueTokenPair(user.id, user.email);
    res.status(201).json({ user: toPublicUser(user), ...tokens });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body as { identifier?: string; password?: string };
    if (!identifier?.trim() || !password) {
      res.status(400).json({ error: 'Email/phone and password are required.' });
      return;
    }
    const user = db.findUserByEmailOrPhone(identifier);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }
    if (!user.passwordHash) {
      res.status(400).json({ error: 'This account uses Google Sign-In. Click Continue with Google.' });
      return;
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }
    const tokens = await issueTokenPair(user.id, user.email);
    res.json({ user: toPublicUser(user), ...tokens });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/auth/google', async (req, res) => {
  try {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken || typeof idToken !== 'string') {
      res.status(400).json({ error: 'Google ID token is required.' });
      return;
    }

    const googleProfile = await verifyFirebaseGoogleIdToken(idToken);
    let user = db.findUserByEmailOrPhone(googleProfile.email);

    if (user) {
      user = await db.linkGoogleProfile(user.id, {
        avatarUrl: googleProfile.picture,
        name: googleProfile.name,
      });
    } else {
      user = await db.createUserWithAccounts({
        name: googleProfile.name,
        email: googleProfile.email,
        phone: '',
        passwordHash: '',
        pinHash: '',
        riskProfile: 'BALANCED',
        hasPin: false,
        authProvider: 'GOOGLE',
        avatarUrl: googleProfile.picture,
      });
    }

    const tokens = await issueTokenPair(user.id, user.email);
    res.json({
      user: toPublicUser(user),
      needsPinSetup: !user.hasPin,
      ...tokens,
    });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message || 'Google authentication failed.' });
  }
});


router.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token missing.' });
      return;
    }
    const { userId, email } = await verifyRefreshJwt(refreshToken);
    await db.revokeRefreshToken(hashToken(refreshToken));
    const tokens = await issueTokenPair(userId, email);
    const user = db.findUserById(userId);
    res.json({ user: toPublicUser(user), ...tokens });
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token.' });
  }
});

router.post('/auth/logout', async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (refreshToken) {
    await db.revokeRefreshToken(hashToken(refreshToken));
  }
  res.json({ ok: true });
});

router.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = db.findUserById(req.userId!);
  res.json({ user: toPublicUser(user) });
});

router.patch('/auth/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body as {
      name?: unknown;
      phone?: unknown;
      riskProfile?: unknown;
      upiId?: unknown;
      city?: unknown;
      occupation?: unknown;
      dateOfBirth?: unknown;
      bio?: unknown;
      taxRegime?: unknown;
      investmentHorizon?: unknown;
      incomeBracket?: unknown;
      targetMonthlySipInr?: unknown;
    };

    const updates: Parameters<typeof db.updateUserProfile>[1] = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) {
        res.status(400).json({ error: 'Display name must be between 1 and 100 characters.' });
        return;
      }
      updates.name = body.name.trim();
    }

    if (body.phone !== undefined) {
      if (typeof body.phone !== 'string' || body.phone.trim().length > 24) {
        res.status(400).json({ error: 'Phone number must be 24 characters or fewer.' });
        return;
      }
      updates.phone = body.phone.trim();
    }

    if (body.upiId !== undefined) {
      if (typeof body.upiId !== 'string' || body.upiId.trim().length > 100) {
        res.status(400).json({ error: 'UPI ID must be 100 characters or fewer.' });
        return;
      }
      const cleanVpa = body.upiId.trim();
      if (cleanVpa && !/^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$/.test(cleanVpa)) {
        res.status(400).json({ error: 'Enter a valid UPI ID (e.g., name@okhdfcbank).' });
        return;
      }
      updates.upiId = cleanVpa;
    }

    if (body.city !== undefined) {
      if (typeof body.city !== 'string' || body.city.trim().length > 80) {
        res.status(400).json({ error: 'City must be 80 characters or fewer.' });
        return;
      }
      updates.city = body.city.trim();
    }

    if (body.occupation !== undefined) {
      if (typeof body.occupation !== 'string' || body.occupation.trim().length > 80) {
        res.status(400).json({ error: 'Occupation must be 80 characters or fewer.' });
        return;
      }
      updates.occupation = body.occupation.trim();
    }

    if (body.dateOfBirth !== undefined) {
      if (typeof body.dateOfBirth !== 'string' || body.dateOfBirth.trim().length > 16) {
        res.status(400).json({ error: 'Invalid date of birth format.' });
        return;
      }
      const dob = body.dateOfBirth.trim();
      if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        res.status(400).json({ error: 'Date of birth must use YYYY-MM-DD format.' });
        return;
      }
      updates.dateOfBirth = dob;
    }

    if (body.bio !== undefined) {
      if (typeof body.bio !== 'string' || body.bio.trim().length > 240) {
        res.status(400).json({ error: 'Investor goal/bio must be 240 characters or fewer.' });
        return;
      }
      updates.bio = body.bio.trim();
    }

    if (body.riskProfile !== undefined) {
      if (
        body.riskProfile !== 'CONSERVATIVE' &&
        body.riskProfile !== 'BALANCED' &&
        body.riskProfile !== 'AGGRESSIVE'
      ) {
        res.status(400).json({ error: 'Invalid risk profile selection.' });
        return;
      }
      updates.riskProfile = body.riskProfile;
    }

    if (body.taxRegime !== undefined) {
      if (body.taxRegime !== 'NEW' && body.taxRegime !== 'OLD') {
        res.status(400).json({ error: 'Tax regime must be NEW or OLD.' });
        return;
      }
      updates.taxRegime = body.taxRegime;
    }

    if (body.investmentHorizon !== undefined) {
      if (
        body.investmentHorizon !== 'SHORT_TERM' &&
        body.investmentHorizon !== 'MEDIUM_TERM' &&
        body.investmentHorizon !== 'LONG_TERM'
      ) {
        res.status(400).json({ error: 'Invalid investment horizon.' });
        return;
      }
      updates.investmentHorizon = body.investmentHorizon;
    }

    if (body.incomeBracket !== undefined) {
      if (
        body.incomeBracket !== 'BELOW_10L' &&
        body.incomeBracket !== '10L_25L' &&
        body.incomeBracket !== '25L_50L' &&
        body.incomeBracket !== 'ABOVE_50L'
      ) {
        res.status(400).json({ error: 'Invalid income bracket.' });
        return;
      }
      updates.incomeBracket = body.incomeBracket;
    }

    if (body.targetMonthlySipInr !== undefined) {
      const sipVal = Number(body.targetMonthlySipInr);
      if (!Number.isFinite(sipVal) || sipVal < 0 || sipVal > 10000000) {
        res.status(400).json({ error: 'Target monthly SIP must be between ₹0 and ₹1,00,00,000.' });
        return;
      }
      updates.targetMonthlySipInr = sipVal;
    }

    const updated = await db.updateUserProfile(req.userId!, updates);
    res.json({ user: toPublicUser(updated) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/auth/verify-pin', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { pin } = req.body as { pin?: string };
  const user = db.findUserById(req.userId!);
  if (!user || !pin || !(await bcrypt.compare(pin, user.pinHash))) {
    res.status(403).json({ error: 'Incorrect 4-digit PIN.' });
    return;
  }
  res.json({ verified: true });
});

router.post('/auth/set-pin', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { pin } = req.body as { pin?: string };
  const user = db.findUserById(req.userId!);
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  if (user.hasPin) {
    res.status(400).json({ error: 'Transaction PIN is already configured.' });
    return;
  }
  if (!pin || !/^\d{4}$/.test(pin)) {
    res.status(400).json({ error: 'Enter a valid 4-digit numeric PIN.' });
    return;
  }
  const pinHash = await bcrypt.hash(pin, 10);
  await db.updateUserPin(user.id, pinHash);
  res.json({ user: toPublicUser(db.findUserById(user.id)) });
});

router.post('/auth/update-pin', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { currentPin, newPin } = req.body as { currentPin?: string; newPin?: string };
  const user = db.findUserById(req.userId!);
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  if (!currentPin || !(await bcrypt.compare(currentPin, user.pinHash))) {
    res.status(403).json({ error: 'Current 4-digit PIN is incorrect.' });
    return;
  }
  if (!newPin || !/^\d{4}$/.test(newPin)) {
    res.status(400).json({ error: 'New PIN must be exactly 4 digits.' });
    return;
  }
  const newHash = await bcrypt.hash(newPin, 10);
  await db.updateUserPin(user.id, newHash);
  res.json({ ok: true });
});

async function resolveOptionalUpstoxToken(req: AuthenticatedRequest): Promise<string | undefined> {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : queryToken;
  const userId = await verifyAccessTokenString(rawToken);
  if (!userId) return undefined;
  return db.findUserById(userId)?.upstoxAccessToken;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==========================================
// MARKET DATA & UPSTOX LIVE STREAM ROUTES
// ==========================================
router.get('/market/catalog', (_req, res) => {
  res.json({ catalog: NSE_UNIVERSE_CATALOG });
});

router.get('/market/search', async (req: AuthenticatedRequest, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const upstoxToken = await resolveOptionalUpstoxToken(req);
    const quotes = await searchIndianStocks(q, upstoxToken);
    res.json({ quotes, marketOpen: isNseMarketOpen() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/market/quotes', async (req: AuthenticatedRequest, res) => {
  try {
    const raw = String(req.query.symbols || '^NSEI,^BSESN,^NSEBANK,JIOFIN.NS,RELIANCE.NS,TCS.NS,HDFCBANK.NS');
    const symbols = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 35);
    const upstoxToken = await resolveOptionalUpstoxToken(req);
    const quotes = await getMultipleQuotesWithUpstox(symbols, upstoxToken);
    res.json({ quotes, marketOpen: isNseMarketOpen() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/market/chart', async (req: AuthenticatedRequest, res) => {
  try {
    const symbol = String(req.query.symbol || 'RELIANCE.NS').trim();
    const rawTf = String(req.query.timeframe || '1M').toUpperCase();
    const validTfs: ChartTimeframe[] = ['1D', '1W', '1M', '6M', '1Y', '3Y'];
    const timeframe: ChartTimeframe = validTfs.includes(rawTf as ChartTimeframe)
      ? (rawTf as ChartTimeframe)
      : '1M';

    const upstoxToken = await resolveOptionalUpstoxToken(req);
    const data = await getInteractiveChartSeries(symbol, timeframe, upstoxToken);
    res.json({
      symbol,
      timeframe,
      candles: data.candles,
      quote: data.quote,
      marketOpen: isNseMarketOpen(),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/market/stream', async (req: AuthenticatedRequest, res) => {
  const raw = String(
    req.query.symbols ||
      '^NSEI,^BSESN,^NSEBANK,^INDIAVIX,JIOFIN.NS,RELIANCE.NS,TCS.NS,HDFCBANK.NS,INFY.NS,ICICIBANK.NS,TATAMOTORS.NS,NIFTYBEES.NS,GOLDBEES.NS'
  );
  const symbols = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 35);

  const upstoxToken = await resolveOptionalUpstoxToken(req);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  const writeEvent = (event: string, data: unknown) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const marketOpenNow = isNseMarketOpen();
  writeEvent('status', {
    mode: upstoxToken
      ? 'UPSTOX_CONNECTING'
      : marketOpenNow
      ? 'NSE_LIVE_POLL'
      : 'NSE_PUBLIC',
    marketOpen: marketOpenNow,
    upstoxConnected: Boolean(upstoxToken),
  });

  const lastSnapshotState = new Map<string, { price: number; volume?: number }>();

  try {
    const initialQuotes = await getMultipleQuotesWithUpstox(symbols, upstoxToken);
    for (const q of initialQuotes) {
      lastSnapshotState.set(q.symbol, { price: q.price, volume: q.volume });
    }
    writeEvent('snapshot', { quotes: initialQuotes, marketOpen: isNseMarketOpen() });
  } catch {
    // ignore snapshot transient error
  }

  let stopUpstoxWs: (() => void) | null = null;
  let stopPublicWs: (() => void) | null = null;

  if (upstoxToken) {
    stopUpstoxWs = await openUpstoxFeedWebSocket(
      upstoxToken,
      symbols,
      (ticks) => {
        writeEvent('tick', {
          ticks: ticks.map((t) => ({ ...t, dataSource: 'UPSTOX_LIVE' })),
          marketOpen: isNseMarketOpen(),
          source: 'UPSTOX_WS_CONNECTED',
        });
      },
      (wsStatus, detail) => {
        writeEvent('status', {
          mode: wsStatus,
          detail,
          marketOpen: isNseMarketOpen(),
          upstoxConnected: true,
        });
      }
    );
  } else {
    stopPublicWs = openPublicNseWebSocket(
      symbols,
      (tick) => {
        lastSnapshotState.set(tick.symbol, { price: tick.ltp, volume: tick.volume });
        writeEvent('tick', {
          ticks: [tick],
          marketOpen: isNseMarketOpen(),
          source: 'NSE_LIVE_WS',
        });
      },
      (wsStatus, detail) => {
        writeEvent('status', {
          mode: wsStatus,
          detail,
          marketOpen: isNseMarketOpen(),
          upstoxConnected: false,
        });
      }
    );
  }

  const pollIntervalMs = 15000;
  let pollingBusy = false;
  const refreshTimer = setInterval(async () => {
    if (closed || pollingBusy) return;
    pollingBusy = true;
    try {
      const latestQuotes = await getMultipleQuotesWithUpstox(symbols, upstoxToken);
      const changedTicks: Array<{
        symbol: string;
        ltp: number;
        prevClose: number;
        change: number;
        changePct: number;
        volume?: number;
        open?: number;
        high?: number;
        low?: number;
        depth?: unknown;
        dataSource: string;
        ts: string;
      }> = [];

      for (const q of latestQuotes) {
        const prev = lastSnapshotState.get(q.symbol);
        if (!prev || prev.price !== q.price || prev.volume !== q.volume) {
          lastSnapshotState.set(q.symbol, { price: q.price, volume: q.volume });
          changedTicks.push({
            symbol: q.symbol,
            ltp: q.price,
            prevClose: q.previousClose,
            change: q.change,
            changePct: q.changePct,
            volume: q.volume,
            open: q.open,
            high: q.high,
            low: q.low,
            depth: q.depth,
            dataSource: q.dataSource,
            ts: q.updatedAt,
          });
        }
      }

      if (changedTicks.length > 0 && !upstoxToken) {
        writeEvent('tick', {
          ticks: changedTicks,
          marketOpen: isNseMarketOpen(),
          source: 'NSE_LIVE_WS',
        });
      } else {
        writeEvent('snapshot', { quotes: latestQuotes, marketOpen: isNseMarketOpen() });
      }
    } catch {
      // ignore poll failure
    } finally {
      pollingBusy = false;
    }
  }, pollIntervalMs);

  req.on('close', () => {
    closed = true;
    clearInterval(refreshTimer);
    stopUpstoxWs?.();
    stopPublicWs?.();
    res.end();
  });
});

// ==========================================
// UPSTOX OAUTH & BROKER PORTFOLIO ROUTES
// ==========================================
router.get('/upstox/status', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = db.findUserById(req.userId!);
  res.json({
    configured: isUpstoxConfigured(),
    connected: Boolean(user?.upstoxAccessToken),
    redirectUri: getUpstoxRedirectUri(),
    profile: user?.upstoxProfile,
  });
});

router.get('/upstox/auth-url', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (!isUpstoxConfigured()) {
      res.status(400).json({
        error: 'Set UPSTOX_API_KEY and UPSTOX_API_SECRET in AI Studio Secrets first.',
      });
      return;
    }
    const state = await signOAuthStateToken(req.userId!, 'upstox');
    const url = buildUpstoxAuthorizeUrl(state);
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get(['/upstox/callback', '/upstox/callback/'], async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';

  if (oauthError) {
    res.status(400).send(`
      <html><body style="font-family:sans-serif;background:#07090F;color:#fff;padding:24px;">
        <h3>Upstox Authorization Declined</h3>
        <p>${escapeHtml(oauthError)}</p>
      </body></html>
    `);
    return;
  }

  if (!code || !state) {
    res.status(400).send('Missing Upstox authorization code or state.');
    return;
  }

  try {
    const { userId } = await verifyOAuthStateToken(state, 'upstox');
    const { accessToken, profile } = await exchangeUpstoxCodeForToken(code);
    await db.saveUserUpstoxAuth(userId, accessToken, profile);

    res.send(`
      <html>
        <body style="font-family:system-ui,sans-serif;background:#07090F;color:#F8FAFC;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;padding:24px;">
            <p style="color:#FFB020;font-weight:700;font-size:18px;">Upstox Connected</p>
            <p style="font-size:13px;color:#94A3B8;">Returning to FINGuard terminal...</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'UPSTOX_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(400).send(`
      <html><body style="font-family:sans-serif;background:#07090F;color:#fff;padding:24px;">
        <h3>Upstox Connection Failed</h3>
        <p>${escapeHtml((err as Error).message)}</p>
      </body></html>
    `);
  }
});

router.post('/upstox/disconnect', requireAuth, async (req: AuthenticatedRequest, res) => {
  await db.clearUserUpstoxAuth(req.userId!);
  res.json({ ok: true });
});

router.get('/upstox/holdings', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = db.findUserById(req.userId!);
    if (!user?.upstoxAccessToken) {
      res.status(400).json({ error: 'Connect your Upstox account first.' });
      return;
    }
    const data = await fetchUpstoxPortfolio(user.upstoxAccessToken);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.get('/upstox/orders', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = db.findUserById(req.userId!);
    if (!user?.upstoxAccessToken) {
      res.status(400).json({ error: 'Connect your Upstox account first.' });
      return;
    }
    const orders = await fetchUpstoxOrderBook(user.upstoxAccessToken);
    res.json({ orders });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.get('/market/mf/search', async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const items = await searchMutualFunds(q);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/market/news', requireAuth, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const feed = await getLiveMarketNewsFeed(forceRefresh);
    res.json(feed);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.get('/market/news/stream', async (req, res) => {
  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  const headerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : '';
  const userId = await verifyAccessTokenString(queryToken || headerToken);
  if (!userId) {
    res.status(401).json({ error: 'Authentication required for live news stream.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  const knownIds = new Set<string>();

  const writeEvent = (event: string, data: unknown) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const initial = await getLiveMarketNewsFeed(false);
    for (const item of initial.news) knownIds.add(item.id);
    writeEvent('news_snapshot', initial);
  } catch {
    // ignore initial transient error
  }

  let busy = false;
  const pollTimer = setInterval(async () => {
    if (closed || busy) return;
    busy = true;
    try {
      const latest = await getLiveMarketNewsFeed(true);
      const newIds: string[] = [];
      for (const item of latest.news) {
        if (!knownIds.has(item.id)) {
          newIds.push(item.id);
          knownIds.add(item.id);
        }
      }
      writeEvent('news_update', { ...latest, newIds });
    } catch {
      writeEvent('ping', { ts: new Date().toISOString() });
    } finally {
      busy = false;
    }
  }, 10000);

  const heartbeatTimer = setInterval(() => {
    if (!closed) {
      res.write(`: keepalive ${Date.now()}\n\n`);
    }
  }, 25000);

  req.on('close', () => {
    closed = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    res.end();
  });
});

// ==========================================
// PORTFOLIO, LEDGER, OPTIMIZER & TAX ROUTES
// ==========================================
router.get('/portfolio/summary', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const accounts = db.getAccountsByUser(userId);
    const { holdings, upstoxConnected, upstoxFunds, portfolioSourceMode } =
      await buildEnrichedHoldingsWithMeta(userId);
    const orders = db.getOrders(userId);
    const ledgerEntries = db.getLedgerEntries(userId);

    const manualCashInr = Math.round((accounts.find((a) => a.type === 'CASH_INR')?.balancePaise || 0) / 100);
    const cashInr =
      upstoxFunds && upstoxFunds.availableMargin > 0
        ? Math.round(upstoxFunds.availableMargin)
        : manualCashInr;
    const sipEscrowInr = Math.round((accounts.find((a) => a.type === 'SIP_ESCROW')?.balancePaise || 0) / 100);
    const taxReserveInr = Math.round((accounts.find((a) => a.type === 'TAX_RESERVE')?.balancePaise || 0) / 100);

    const investedValueInr = holdings.reduce((s, h) => s + h.investedValue, 0);
    const currentHoldingsValueInr = holdings.reduce((s, h) => s + h.currentValue, 0);
    const totalUnrealizedPnlInr = currentHoldingsValueInr - investedValueInr;
    const totalDailyPnlInr = Math.round(
      holdings.reduce((s, h) => s + (h.currentValue * h.dayChangePct) / 100, 0)
    );
    const netWorthInr = cashInr + sipEscrowInr + taxReserveInr + currentHoldingsValueInr;

    res.json({
      netWorthInr,
      cashInr,
      sipEscrowInr,
      taxReserveInr,
      investedValueInr,
      currentHoldingsValueInr,
      totalUnrealizedPnlInr,
      totalDailyPnlInr,
      upstoxConnected,
      upstoxFunds,
      portfolioSourceMode,
      accounts,
      holdings,
      orders,
      ledgerEntries,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/portfolio/optimize', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const holdings = await buildEnrichedHoldings(req.userId!);
    const result = await runPortfolioOptimizer(holdings);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/portfolio/tax-harvest', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const holdings = await buildEnrichedHoldings(req.userId!);
    const orders = db.getOrders(req.userId!);
    const report = computeTaxHarvestReport(holdings, orders);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/portfolio/mf-overlap', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { schemeCodes } = req.body as { schemeCodes?: number[] };
    if (!Array.isArray(schemeCodes) || schemeCodes.length < 2) {
      res.status(400).json({ error: 'Provide 2 to 4 mutual fund scheme codes.' });
      return;
    }
    const result = await analyzeMutualFundOverlap(schemeCodes.map(Number));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

function parseTradeDateString(raw: string): string {
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const dmy = raw.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return new Date().toISOString().slice(0, 10);
}

function splitCsvRow(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result.map((cell) => cell.replace(/^"|"$/g, '').trim());
}

function parseBrokerCsvText(csvText: string): RealTradeInput[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least one executed trade row.');
  }

  const headers = splitCsvRow(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  const findCol = (candidates: string[]) =>
    headers.findIndex((h) => candidates.some((c) => h === c || h.includes(c)));

  const symIdx = findCol(['tradingsymbol', 'symbol', 'stock_symbol', 'scrip', 'instrument']);
  const sideIdx = findCol(['trade_type', 'transaction_type', 'side', 'buy_sell', 'type']);
  const qtyIdx = findCol(['quantity', 'qty', 'filled_qty']);
  const priceIdx = findCol(['price', 'trade_price', 'avg_price', 'execution_price', 'rate']);
  const dateIdx = findCol(['trade_date', 'order_execution_time', 'execution_date', 'date']);
  const orderIdIdx = findCol(['order_id', 'trade_id']);

  if (symIdx === -1 || qtyIdx === -1 || priceIdx === -1) {
    throw new Error(
      'CSV columns not recognized. Include headers for symbol, quantity, price, and optional type (BUY/SELL) & date.'
    );
  }

  const trades: RealTradeInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvRow(lines[i]);
    if (cols.length <= Math.max(symIdx, qtyIdx, priceIdx)) continue;

    const rawSym = (cols[symIdx] || '').toUpperCase().replace(/[^A-Z0-9^._-]/g, '');
    const qty = Number.parseFloat((cols[qtyIdx] || '').replace(/,/g, ''));
    const price = Number.parseFloat((cols[priceIdx] || '').replace(/[₹,]/g, ''));
    if (!rawSym || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      continue;
    }

    const rawSide = sideIdx >= 0 ? (cols[sideIdx] || '').toUpperCase() : 'BUY';
    const side: OrderSide = rawSide.includes('SELL') || rawSide === 'S' ? 'SELL' : 'BUY';
    const tradeDate = dateIdx >= 0 && cols[dateIdx] ? parseTradeDateString(cols[dateIdx]) : new Date().toISOString().slice(0, 10);
    const symbol = rawSym.includes('.') || rawSym.startsWith('^') ? rawSym : `${rawSym}.NS`;

    trades.push({
      symbol,
      name: symbol.replace('.NS', ''),
      assetType: symbol.includes('BEES') ? 'ETF' : 'STOCK_NSE',
      side,
      quantity: qty,
      priceInr: price,
      tradeDate,
      source: 'CSV_IMPORT',
      brokerOrderId: orderIdIdx >= 0 && cols[orderIdIdx] ? cols[orderIdIdx] : undefined,
    });
  }

  return trades;
}

router.post('/portfolio/trades', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { symbol, name, assetType, side, quantity, priceInr, tradeDate } = req.body as {
      symbol?: string;
      name?: string;
      assetType?: AssetType;
      side?: OrderSide;
      quantity?: number;
      priceInr?: number;
      tradeDate?: string;
    };

    const qty = Number(quantity);
    const price = Number(priceInr);
    if (!symbol?.trim() || (side !== 'BUY' && side !== 'SELL') || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      res.status(400).json({ error: 'Provide valid NSE symbol, BUY/SELL side, positive quantity, and execution price (₹).' });
      return;
    }

    const cleanSym = symbol.trim().toUpperCase();
    const normalizedSym = cleanSym.includes('.') || cleanSym.startsWith('^') ? cleanSym : `${cleanSym}.NS`;
    const catalogItem = NSE_UNIVERSE_CATALOG.find((c) => c.symbol === normalizedSym);

    const trades = await db.addRealTrades(req.userId!, [
      {
        symbol: normalizedSym,
        name: name?.trim() || catalogItem?.name || normalizedSym.replace('.NS', ''),
        assetType: assetType || catalogItem?.assetType || 'STOCK_NSE',
        side,
        quantity: qty,
        priceInr: price,
        tradeDate: tradeDate ? parseTradeDateString(tradeDate) : new Date().toISOString().slice(0, 10),
        source: 'MANUAL',
      },
    ]);

    res.status(201).json({ trade: trades[0] });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/portfolio/import-csv', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { csvText } = req.body as { csvText?: string };
    if (!csvText || csvText.trim().length < 10) {
      res.status(400).json({ error: 'Paste or upload your Zerodha, Groww, or Upstox tradebook CSV.' });
      return;
    }
    const parsed = parseBrokerCsvText(csvText);
    if (parsed.length === 0) {
      res.status(400).json({ error: 'No valid BUY/SELL trades found in CSV.' });
      return;
    }
    const inserted = await db.addRealTrades(req.userId!, parsed);
    res.status(201).json({ importedCount: inserted.length, trades: inserted });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/portfolio/trades/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await db.deleteRealTrade(req.userId!, String(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

router.post('/portfolio/cash-reserve', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { amountInr } = req.body as { amountInr?: number };
    const amt = Number(amountInr);
    if (!Number.isFinite(amt) || amt < 0) {
      res.status(400).json({ error: 'Provide a non-negative INR liquid cash balance.' });
      return;
    }
    const account = await db.setLiquidReserve(req.userId!, amt);
    res.json({ account });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/orders', requireAuth, requireIdempotencyKey, async (req: AuthenticatedRequest, res) => {
  try {
    const { symbol, side, qty, pin, orderType, limitPrice } = req.body as {
      symbol?: string;
      side?: 'BUY' | 'SELL';
      qty?: number;
      pin?: string;
      orderType?: 'MARKET' | 'LIMIT';
      limitPrice?: number;
    };

    const user = db.findUserById(req.userId!);
    if (!user || !pin || !(await bcrypt.compare(pin, user.pinHash))) {
      res.status(403).json({ error: 'Valid 4-digit transaction PIN required for live order routing.' });
      return;
    }

    if (!user.upstoxAccessToken) {
      res.status(400).json({
        error: 'Connect your Upstox Demat account in Markets for live NSE order routing, or use Log Trade / Import Broker CSV in Portfolio.',
      });
      return;
    }

    if (!symbol || (side !== 'BUY' && side !== 'SELL') || !qty || qty <= 0) {
      res.status(400).json({ error: 'Valid symbol, side (BUY/SELL), and positive quantity required.' });
      return;
    }

    const placed = await placeUpstoxOrder({
      accessToken: user.upstoxAccessToken,
      symbol,
      side,
      quantity: Math.floor(qty),
      orderType,
      limitPrice,
    });

    const quote = await getLiveQuote(symbol);
    const execPrice = orderType === 'LIMIT' && limitPrice && limitPrice > 0 ? limitPrice : quote.price;
    const catalogItem = NSE_UNIVERSE_CATALOG.find((c) => c.symbol === quote.symbol);

    const [recorded] = await db.addRealTrades(req.userId!, [
      {
        symbol: quote.symbol,
        name: catalogItem?.name || quote.name,
        assetType: catalogItem?.assetType || 'STOCK_NSE',
        side,
        quantity: Math.floor(qty),
        priceInr: execPrice,
        tradeDate: new Date().toISOString().slice(0, 10),
        source: 'UPSTOX_LIVE',
        brokerOrderId: placed.orderId,
      },
    ]);

    await sendIdempotent(req, res, 201, { order: recorded, brokerOrderId: placed.orderId });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/ledger/transfer', requireAuth, requireIdempotencyKey, async (req: AuthenticatedRequest, res) => {
  try {
    const { action, amountInr, pin, note } = req.body as {
      action?: 'RESERVE_TAX' | 'RELEASE_TAX' | 'FUND_SIP';
      amountInr?: number;
      pin?: string;
      note?: string;
    };

    const user = db.findUserById(req.userId!);
    if (!user || !pin || !(await bcrypt.compare(pin, user.pinHash))) {
      res.status(403).json({ error: 'Valid 4-digit transaction PIN required for ledger entry.' });
      return;
    }

    const amt = Number(amountInr);
    if (!Number.isFinite(amt) || amt <= 0) {
      res.status(400).json({ error: 'Amount must be positive.' });
      return;
    }

    const idempotencyKey = req.header('Idempotency-Key')!.trim();
    const mapping: Record<
      NonNullable<typeof action>,
      { debitType: 'CASH_INR' | 'TAX_RESERVE'; creditType: 'CASH_INR' | 'TAX_RESERVE' | 'SIP_ESCROW'; label: string }
    > = {
      RESERVE_TAX: { debitType: 'CASH_INR', creditType: 'TAX_RESERVE', label: 'Capital Gains Tax Reserve' },
      RELEASE_TAX: { debitType: 'TAX_RESERVE', creditType: 'CASH_INR', label: 'Release Tax Reserve to Cash' },
      FUND_SIP: { debitType: 'CASH_INR', creditType: 'SIP_ESCROW', label: 'Allocate Cash to SIP Bucket' },
    };

    const spec = action ? mapping[action] : undefined;
    if (!spec) {
      res.status(400).json({ error: 'Invalid ledger transfer action.' });
      return;
    }

    const entry = await db.postDoubleEntry({
      userId: req.userId!,
      debitType: spec.debitType,
      creditType: spec.creditType,
      amountInr: amt,
      entryType: action!,
      referenceId: `LED-${Date.now().toString().slice(-6)}`,
      description: note?.trim() || spec.label,
      idempotencyKey,
    });

    await sendIdempotent(req, res, 201, { entry });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ==========================================
// QUANT LAB ROUTES
// ==========================================
router.get('/quant/strategies', requireAuth, (req: AuthenticatedRequest, res) => {
  const strategies = db.getStrategies(req.userId!);
  res.json({ strategies });
});

router.post('/quant/prompt-backtest', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt || prompt.trim().length < 5) {
      res.status(400).json({ error: 'Enter a strategy idea in English or Hinglish.' });
      return;
    }
    const dsl = await promptToQuantDSL(prompt.trim());
    const result = await runQuantBacktest(dsl);
    res.json(result);
  } catch (err) {
    const msg = (err as Error).message || 'Strategy generation failed';
    const status = msg.includes('GEMINI_API_KEY') ? 400 : 502;
    res.status(status).json({ error: msg });
  }
});

router.post('/quant/run-backtest', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { dsl } = req.body as { dsl?: QuantStrategyDSL };
    if (!dsl || !Array.isArray(dsl.universe)) {
      res.status(400).json({ error: 'Valid QuantStrategyDSL payload is required.' });
      return;
    }
    const result = await runQuantBacktest(dsl);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/quant/save', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { promptText, dsl, metrics } = req.body as {
      promptText?: string;
      dsl?: QuantStrategyDSL;
      metrics?: Awaited<ReturnType<typeof runQuantBacktest>>['metrics'];
    };
    if (!dsl || !metrics) {
      res.status(400).json({ error: 'Strategy DSL and metrics required.' });
      return;
    }
    const saved = await db.saveStrategy({
      userId: req.userId!,
      promptText: promptText || dsl.description,
      dsl,
      metrics,
    });
    res.status(201).json({ strategy: saved });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ==========================================
// UPI CASHFLOW & MANDATES ROUTES
// ==========================================
router.get('/upi/cashflow', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const txs = db.getUpiTransactions(userId);
  const cashAcc = db.getAccountByType(userId, 'CASH_INR');
  const liquidInr = Math.round((cashAcc?.balancePaise || 0) / 100);
  const analysis = analyzeUpiCashflow(txs, liquidInr);
  res.json({ transactions: txs, analysis });
});

router.post('/upi/cashflow/analyze', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { rawText, replace } = req.body as { rawText?: string; replace?: boolean };
    if (!rawText || rawText.trim().length < 8) {
      res.status(400).json({ error: 'Paste UPI SMS logs or CSV lines to analyze.' });
      return;
    }
    const parsed = parseRawUpiInput(rawText);
    if (parsed.length === 0) {
      res.status(400).json({
        error: 'No valid transactions detected. Use CSV (date,merchant,amount,DEBIT/CREDIT) or UPI SMS format.',
      });
      return;
    }
    const txs = await db.replaceOrAppendUpiTransactions(req.userId!, parsed, Boolean(replace));
    const cashAcc = db.getAccountByType(req.userId!, 'CASH_INR');
    const liquidInr = Math.round((cashAcc?.balancePaise || 0) / 100);
    const analysis = analyzeUpiCashflow(txs, liquidInr);
    res.json({ importedCount: parsed.length, transactions: txs, analysis });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/upi/mandates', requireAuth, (req: AuthenticatedRequest, res) => {
  const mandates = db.getMandates(req.userId!);
  res.json({ mandates });
});

router.post('/upi/mandates', requireAuth, requireIdempotencyKey, async (req: AuthenticatedRequest, res) => {
  try {
    const { strategyId, strategyName, amountInr, frequency, vpa, pin } = req.body as {
      strategyId?: string;
      strategyName?: string;
      amountInr?: number;
      frequency?: 'WEEKLY' | 'MONTHLY';
      vpa?: string;
      pin?: string;
    };

    const user = db.findUserById(req.userId!);
    if (!user || !pin || !(await bcrypt.compare(pin, user.pinHash))) {
      res.status(403).json({ error: 'Valid 4-digit PIN required to authorize UPI SIP mandate.' });
      return;
    }

    const amt = Number(amountInr);
    if (!Number.isFinite(amt) || amt < 500) {
      res.status(400).json({ error: 'Minimum UPI SIP amount is ₹500.' });
      return;
    }
    if (!vpa || !/^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/.test(vpa.trim())) {
      res.status(400).json({ error: 'Enter a valid UPI ID (e.g., name@okhdfcbank).' });
      return;
    }

    const mandate = await db.createMandate({
      userId: req.userId!,
      strategyId: strategyId || 'strat_custom',
      strategyName: strategyName || 'FINGuard Smart SIP',
      amountInr: Math.round(amt),
      frequency: frequency === 'WEEKLY' ? 'WEEKLY' : 'MONTHLY',
      vpa: vpa.trim(),
    });

    const upiIntentUrl = `upi://pay?pa=${encodeURIComponent(mandate.vpa)}&pn=${encodeURIComponent(
      mandate.strategyName.slice(0, 32)
    )}&am=${mandate.amountInr}&cu=INR&tn=${encodeURIComponent(`SIP-${mandate.strategyName.slice(0, 24)}`)}`;

    await sendIdempotent(req, res, 201, { mandate, upiIntentUrl });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/upi/mandates/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { status } = req.body as { status?: 'ACTIVE' | 'PAUSED' | 'REVOKED' };
    if (status !== 'ACTIVE' && status !== 'PAUSED' && status !== 'REVOKED') {
      res.status(400).json({ error: 'Invalid mandate status.' });
      return;
    }
    const mandate = await db.updateMandateStatus(req.userId!, String(req.params.id), status);
    res.json({ mandate });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

router.post(
  '/upi/mandates/:id/run',
  requireAuth,
  requireIdempotencyKey,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { pin } = req.body as { pin?: string };
      const user = db.findUserById(req.userId!);
      if (!user || !pin || !(await bcrypt.compare(pin, user.pinHash))) {
        res.status(403).json({ error: 'Valid 4-digit PIN required to record paid SIP installment.' });
        return;
      }
      const mandate = await db.executeMandateInstallment(req.userId!, String(req.params.id));
      await sendIdempotent(req, res, 200, { mandate });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

// ==========================================
// RAG & AI COPILOT ROUTES
// ==========================================
router.get('/rag/documents', requireAuth, async (req: AuthenticatedRequest, res) => {
  await ensureSeededRagDocuments();
  const documents = db.getRagDocuments(req.userId!);
  res.json({ documents });
});

router.post('/rag/upload', requireAuth, upload.single('file'), async (req: AuthenticatedRequest, res) => {
  try {
    const file = req.file;
    const title = String(req.body?.title || file?.originalname || 'Uploaded Research Note').slice(0, 100);
    const category = String(req.body?.category || 'Uploaded Report').slice(0, 50);

    let rawText = '';
    if (file) {
      const ext = file.originalname.toLowerCase().split('.').pop() || '';
      if (ext === 'pdf' || file.mimetype === 'application/pdf') {
        rawText = extractTextFromPdfBuffer(file.buffer);
      } else if (['txt', 'md', 'csv', 'json'].includes(ext) || file.mimetype.startsWith('text/')) {
        rawText = file.buffer.toString('utf-8');
      } else {
        res.status(400).json({ error: 'Only .txt, .md, .csv, or .pdf files are supported.' });
        return;
      }
    } else if (typeof req.body?.text === 'string') {
      rawText = req.body.text;
    } else {
      res.status(400).json({ error: 'Upload a .txt/.pdf file or provide text content.' });
      return;
    }

    const document = await ingestUserDocument({
      userId: req.userId!,
      title,
      category,
      rawText,
    });
    res.status(201).json({ document });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/copilot/ask', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { query, mode } = req.body as {
      query?: string;
      mode?: 'RESEARCH' | 'BS_DETECTOR' | 'PORTFOLIO_DIAGNOSTIC';
    };
    if (!query || query.trim().length < 2) {
      res.status(400).json({ error: 'Please enter a question or claim to analyze.' });
      return;
    }
    const validMode =
      mode === 'BS_DETECTOR' || mode === 'PORTFOLIO_DIAGNOSTIC' ? mode : 'RESEARCH';
    const result = await askFinquantCopilot({
      userId: req.userId!,
      query: query.trim(),
      mode: validMode,
    });
    res.json(result);
  } catch (err) {
    const msg = (err as Error).message || 'Copilot request failed';
    const status = msg.includes('GEMINI_API_KEY') ? 400 : 502;
    res.status(status).json({ error: msg });
  }
});

export default router;
