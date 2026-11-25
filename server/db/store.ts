import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Pool } from 'pg';
import type {
  AccountRecord,
  AccountType,
  HoldingRecord,
  LedgerEntryRecord,
  OrderRecord,
  QuantStrategyRecord,
  RagDocumentRecord,
  RealTradeInput,
  UpiMandateRecord,
  UpiTransactionRecord,
  UpstoxProfileSummary,
  UserProfile,
} from '../../shared/types.ts';

export interface StoredUser extends UserProfile {
  passwordHash: string;
  pinHash: string;
  upstoxAccessToken?: string;
  upstoxProfile?: UpstoxProfileSummary;
}

export interface StoredRagChunk {
  id: string;
  documentId: string;
  userId: string | null;
  docTitle: string;
  pageOrSection: string;
  content: string;
  embedding: number[];
  keywords: string[];
}

export interface StoredRefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revoked: boolean;
}

export interface StoredIdempotency {
  key: string;
  userId: string;
  route: string;
  statusCode: number;
  responseJson: unknown;
  createdAt: string;
}

interface DatabaseState {
  users: StoredUser[];
  accounts: AccountRecord[];
  ledgerEntries: LedgerEntryRecord[];
  holdings: HoldingRecord[];
  orders: OrderRecord[];
  quantStrategies: QuantStrategyRecord[];
  upiMandates: UpiMandateRecord[];
  ragDocuments: RagDocumentRecord[];
  ragChunks: StoredRagChunk[];
  upiTransactions: UpiTransactionRecord[];
  refreshTokens: StoredRefreshToken[];
  idempotencyKeys: StoredIdempotency[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'finquant-db.json');

let pgPool: Pool | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function createInitialState(): DatabaseState {
  return {
    users: [],
    accounts: [],
    ledgerEntries: [],
    holdings: [],
    orders: [],
    quantStrategies: [],
    upiMandates: [],
    ragDocuments: [],
    ragChunks: [],
    upiTransactions: [],
    refreshTokens: [],
    idempotencyKeys: [],
  };
}

let state: DatabaseState = createInitialState();

function persistJsonState(): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DB_FILE}.tmp`;
    await fs.promises.writeFile(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
    await fs.promises.rename(tmpFile, DB_FILE);
  });
  return writeQueue;
}

async function initPostgres(connectionString: string): Promise<void> {
  const isLocal =
    connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  pgPool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS finquant_kv_state (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const res = await pgPool.query<{ payload: DatabaseState }>(
    'SELECT payload FROM finquant_kv_state WHERE id = $1',
    ['primary']
  );
  if (res.rows.length > 0 && res.rows[0].payload) {
    state = res.rows[0].payload;
  }
}

async function persistState(): Promise<void> {
  if (pgPool) {
    const client = await pgPool.connect();
    try {
      await client.query(
        `INSERT INTO finquant_kv_state (id, payload, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        ['primary', JSON.stringify(state)]
      );
    } finally {
      client.release();
    }
    return;
  }
  await persistJsonState();
}

function purgeDemoRecords(): boolean {
  const demoEmails = new Set(['dhruv@finguard.in', 'aarav@finquant.in']);
  const demoIds = new Set(
    state.users
      .filter((u) => demoEmails.has(u.email.toLowerCase()) || u.id === 'usr_dhruv_demo' || u.id === 'usr_aarav_demo')
      .map((u) => u.id)
  );
  demoIds.add('usr_dhruv_demo');
  demoIds.add('usr_aarav_demo');

  const prevUsersCount = state.users.length;
  state.users = state.users.filter((u) => !demoIds.has(u.id));
  const changed = state.users.length !== prevUsersCount || state.accounts.some((a) => demoIds.has(a.userId));

  if (changed) {
    state.accounts = state.accounts.filter((a) => !demoIds.has(a.userId));
    state.ledgerEntries = state.ledgerEntries.filter((l) => !demoIds.has(l.userId));
    state.holdings = state.holdings.filter((h) => !demoIds.has(h.userId));
    state.orders = state.orders.filter((o) => !demoIds.has(o.userId));
    state.quantStrategies = state.quantStrategies.filter((s) => !demoIds.has(s.userId));
    state.upiMandates = state.upiMandates.filter((m) => !demoIds.has(m.userId));
    state.upiTransactions = state.upiTransactions.filter((t) => !demoIds.has(t.userId));
    state.ragDocuments = state.ragDocuments.filter((d) => d.userId === null || !demoIds.has(d.userId));
    state.ragChunks = state.ragChunks.filter((c) => c.userId === null || !demoIds.has(c.userId));
    state.refreshTokens = state.refreshTokens.filter((r) => !demoIds.has(r.userId));
    state.idempotencyKeys = state.idempotencyKeys.filter((k) => !demoIds.has(k.userId));
  }

  return changed;
}

export async function initDatabase(): Promise<{ mode: 'postgres' | 'json' }> {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (dbUrl) {
    try {
      await initPostgres(dbUrl);
      purgeDemoRecords();
      await persistState();
      return { mode: 'postgres' };
    } catch (err) {
      console.warn('Postgres connection failed, falling back to JSON store:', (err as Error).message);
      pgPool = null;
    }
  }

  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = await fs.promises.readFile(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DatabaseState>;
      state = {
        ...createInitialState(),
        ...parsed,
      };
    } catch {
      state = createInitialState();
    }
  }

  purgeDemoRecords();
  await persistState();
  return { mode: 'json' };
}

function normalizeNseSymbol(raw: string): string {
  const clean = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!clean) return clean;
  if (clean.includes('.') || clean.startsWith('^')) return clean;
  return `${clean}.NS`;
}

function rebuildFifoHoldingsForUser(userId: string): void {
  const userOrders = state.orders
    .filter((o) => o.userId === userId && o.status === 'FILLED' && o.qty > 0 && o.executionPrice > 0)
    .slice()
    .sort((a, b) => {
      const da = new Date(a.tradeDate || a.createdAt).getTime();
      const dbTime = new Date(b.tradeDate || b.createdAt).getTime();
      if (da !== dbTime) return da - dbTime;
      return a.createdAt.localeCompare(b.createdAt);
    });

  interface Lot {
    symbol: string;
    name: string;
    assetType: HoldingRecord['assetType'];
    qty: number;
    price: number;
    buyDate: string;
    source: NonNullable<HoldingRecord['source']>;
  }

  const openLotsBySymbol = new Map<string, Lot[]>();

  for (const order of userOrders) {
    const sym = normalizeNseSymbol(order.symbol);
    const tradeIso = order.tradeDate || order.createdAt.slice(0, 10);
    const lots = openLotsBySymbol.get(sym) || [];

    if (order.side === 'BUY') {
      lots.push({
        symbol: sym,
        name: order.name || sym.replace('.NS', ''),
        assetType: order.assetType || (sym.includes('BEES') ? 'ETF' : 'STOCK_NSE'),
        qty: order.qty,
        price: order.executionPrice,
        buyDate: tradeIso,
        source: order.source || 'MANUAL',
      });
      order.stcgLtcgTag = 'NEW_LOT';
      order.realizedPnlInr = undefined;
      openLotsBySymbol.set(sym, lots);
    } else if (order.side === 'SELL') {
      let sellLeft = order.qty;
      let realized = 0;
      let longestDays = 0;
      let matchedAny = false;
      const sellMs = new Date(tradeIso).getTime();

      while (sellLeft > 0 && lots.length > 0) {
        const lot = lots[0];
        const matched = Math.min(sellLeft, lot.qty);
        realized += (order.executionPrice - lot.price) * matched;
        const heldDays = Math.floor((sellMs - new Date(lot.buyDate).getTime()) / (1000 * 60 * 60 * 24));
        if (heldDays > longestDays) longestDays = heldDays;
        matchedAny = true;
        lot.qty -= matched;
        sellLeft -= matched;
        if (lot.qty <= 1e-8) {
          lots.shift();
        }
      }

      if (matchedAny) {
        order.realizedPnlInr = Number(realized.toFixed(2));
        order.stcgLtcgTag = longestDays >= 365 ? 'LTCG' : 'STCG';
      } else {
        order.realizedPnlInr = undefined;
        order.stcgLtcgTag = 'NEW_LOT';
      }
      openLotsBySymbol.set(sym, lots);
    }
  }

  const rebuiltHoldings: HoldingRecord[] = [];
  for (const [symbol, lots] of openLotsBySymbol.entries()) {
    const totalQty = lots.reduce((s, l) => s + l.qty, 0);
    if (totalQty <= 1e-6) continue;
    const totalCost = lots.reduce((s, l) => s + l.qty * l.price, 0);
    const earliest = lots[0];
    const latestSource = lots[lots.length - 1].source;
    rebuiltHoldings.push({
      id: `hld_${userId}_${symbol.replace(/[^A-Z0-9]/gi, '_')}`,
      userId,
      symbol,
      name: earliest.name,
      assetType: earliest.assetType,
      quantity: Number(totalQty.toFixed(4)),
      avgBuyPrice: Number((totalCost / totalQty).toFixed(2)),
      buyDate: earliest.buyDate,
      source: latestSource,
    });
  }

  state.holdings = [
    ...state.holdings.filter((h) => h.userId !== userId),
    ...rebuiltHoldings,
  ];
}

export const db = {
  findUserByEmailOrPhone(identifier: string): StoredUser | undefined {
    const norm = identifier.trim().toLowerCase();
    return state.users.find(
      (u) => u.email.toLowerCase() === norm || u.phone.replace(/\s+/g, '') === norm.replace(/\s+/g, '')
    );
  },

  findUserById(userId: string): StoredUser | undefined {
    return state.users.find((u) => u.id === userId);
  },

  async createUserWithAccounts(params: {
    name: string;
    email: string;
    phone: string;
    passwordHash: string;
    pinHash: string;
    riskProfile?: UserProfile['riskProfile'];
    hasPin?: boolean;
    authProvider?: 'LOCAL' | 'GOOGLE';
    avatarUrl?: string;
  }): Promise<StoredUser> {
    const userId = `usr_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const user: StoredUser = {
      id: userId,
      name: params.name.trim(),
      email: params.email.trim().toLowerCase(),
      phone: params.phone.trim(),
      passwordHash: params.passwordHash,
      pinHash: params.pinHash,
      riskProfile: params.riskProfile || 'BALANCED',
      hasPin: params.hasPin ?? true,
      authProvider: params.authProvider || 'LOCAL',
      avatarUrl: params.avatarUrl,
      createdAt: now,
    };
    state.users.push(user);

    // Real account buckets initialized strictly at ₹0 (no synthetic welcome paper capital)
    const types: AccountType[] = ['CASH_INR', 'BROKER_SETTLED', 'SIP_ESCROW', 'TAX_RESERVE'];
    for (const type of types) {
      state.accounts.push({
        id: `acc_${userId}_${type.toLowerCase()}`,
        userId,
        type,
        currency: 'INR',
        balancePaise: 0,
        createdAt: now,
      });
    }

    await persistState();
    return user;
  },

  async linkGoogleProfile(
    userId: string,
    params: { avatarUrl?: string; name?: string }
  ): Promise<StoredUser> {
    const user = state.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found');
    if (params.avatarUrl) user.avatarUrl = params.avatarUrl;
    if (params.name && !user.name) user.name = params.name;
    if (!user.authProvider) user.authProvider = 'GOOGLE';
    await persistState();
    return user;
  },

  async updateUserPin(userId: string, pinHash: string): Promise<void> {
    const user = state.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found');
    user.pinHash = pinHash;
    user.hasPin = true;
    await persistState();
  },

  async updateUserProfile(
    userId: string,
    updates: Partial<
      Pick<
        UserProfile,
        | 'name'
        | 'phone'
        | 'riskProfile'
        | 'upiId'
        | 'city'
        | 'occupation'
        | 'dateOfBirth'
        | 'bio'
        | 'taxRegime'
        | 'investmentHorizon'
        | 'incomeBracket'
        | 'targetMonthlySipInr'
      >
    >
  ): Promise<StoredUser> {
    const user = state.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found');

    if (typeof updates.name === 'string' && updates.name.trim()) {
      user.name = updates.name.trim().slice(0, 100);
    }
    if (typeof updates.phone === 'string') {
      user.phone = updates.phone.trim().slice(0, 24);
    }
    if (updates.riskProfile) {
      user.riskProfile = updates.riskProfile;
    }
    if (typeof updates.upiId === 'string') {
      user.upiId = updates.upiId.trim().slice(0, 100) || undefined;
    }
    if (typeof updates.city === 'string') {
      user.city = updates.city.trim().slice(0, 80) || undefined;
    }
    if (typeof updates.occupation === 'string') {
      user.occupation = updates.occupation.trim().slice(0, 80) || undefined;
    }
    if (typeof updates.dateOfBirth === 'string') {
      user.dateOfBirth = updates.dateOfBirth.trim().slice(0, 16) || undefined;
    }
    if (typeof updates.bio === 'string') {
      user.bio = updates.bio.trim().slice(0, 240) || undefined;
    }
    if (updates.taxRegime) {
      user.taxRegime = updates.taxRegime;
    }
    if (updates.investmentHorizon) {
      user.investmentHorizon = updates.investmentHorizon;
    }
    if (updates.incomeBracket) {
      user.incomeBracket = updates.incomeBracket;
    }
    if (typeof updates.targetMonthlySipInr === 'number' && Number.isFinite(updates.targetMonthlySipInr)) {
      user.targetMonthlySipInr = Math.max(0, Math.min(10000000, Math.round(updates.targetMonthlySipInr)));
    }

    await persistState();
    return user;
  },

  async saveUserUpstoxAuth(
    userId: string,
    accessToken: string,
    profile: UpstoxProfileSummary
  ): Promise<void> {
    const user = state.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found');
    user.upstoxAccessToken = accessToken;
    user.upstoxProfile = profile;
    await persistState();
  },

  async clearUserUpstoxAuth(userId: string): Promise<void> {
    const user = state.users.find((u) => u.id === userId);
    if (!user) return;
    delete user.upstoxAccessToken;
    delete user.upstoxProfile;
    await persistState();
  },

  async saveRefreshToken(record: StoredRefreshToken): Promise<void> {
    state.refreshTokens.push(record);
    if (state.refreshTokens.length > 500) {
      state.refreshTokens = state.refreshTokens.slice(-300);
    }
    await persistState();
  },

  findRefreshToken(tokenHash: string): StoredRefreshToken | undefined {
    return state.refreshTokens.find((t) => t.tokenHash === tokenHash && !t.revoked);
  },

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    const t = state.refreshTokens.find((r) => r.tokenHash === tokenHash);
    if (t) {
      t.revoked = true;
      await persistState();
    }
  },

  findIdempotency(key: string, userId: string, route: string): StoredIdempotency | undefined {
    return state.idempotencyKeys.find((k) => k.key === key && k.userId === userId && k.route === route);
  },

  async saveIdempotency(entry: StoredIdempotency): Promise<void> {
    state.idempotencyKeys.push(entry);
    if (state.idempotencyKeys.length > 500) {
      state.idempotencyKeys = state.idempotencyKeys.slice(-300);
    }
    await persistState();
  },

  getAccountsByUser(userId: string): AccountRecord[] {
    return state.accounts.filter((a) => a.userId === userId);
  },

  getAccountByType(userId: string, type: AccountType): AccountRecord | undefined {
    return state.accounts.find((a) => a.userId === userId && a.type === type);
  },

  getLedgerEntries(userId: string): LedgerEntryRecord[] {
    return state.ledgerEntries
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async setLiquidReserve(userId: string, amountInr: number): Promise<AccountRecord> {
    const cashAcc = this.getAccountByType(userId, 'CASH_INR');
    if (!cashAcc) throw new Error('Cash reserve account missing');
    const cleanPaise = Math.max(0, Math.round(amountInr * 100));
    cashAcc.balancePaise = cleanPaise;

    state.ledgerEntries.push({
      id: `led_${crypto.randomUUID().slice(0, 12)}`,
      txGroupId: `txg_${crypto.randomUUID().slice(0, 10)}`,
      userId,
      debitAccountId: cashAcc.id,
      creditAccountId: cashAcc.id,
      debitAccountType: 'CASH_INR',
      creditAccountType: 'CASH_INR',
      amountPaise: cleanPaise,
      entryType: 'CASH_RESERVE_UPDATED',
      referenceId: `CASH-${Date.now().toString().slice(-6)}`,
      description: `User recorded liquid bank reserve: ₹${Math.round(amountInr).toLocaleString('en-IN')}`,
      idempotencyKey: `cash_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
      createdAt: new Date().toISOString(),
    });
    await persistState();
    return cashAcc;
  },

  async postDoubleEntry(params: {
    userId: string;
    debitType: AccountType;
    creditType: AccountType;
    amountInr: number;
    entryType: string;
    referenceId: string;
    description: string;
    idempotencyKey: string;
  }): Promise<LedgerEntryRecord> {
    const amountPaise = Math.round(params.amountInr * 100);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      throw new Error('Transfer amount must be strictly positive');
    }

    const debitAcc = this.getAccountByType(params.userId, params.debitType);
    const creditAcc = this.getAccountByType(params.userId, params.creditType);
    if (!debitAcc || !creditAcc) {
      throw new Error('Accounts missing for user');
    }
    if (debitAcc.id === creditAcc.id) {
      throw new Error('Source and destination accounts must be distinct');
    }
    if (debitAcc.balancePaise < amountPaise) {
      throw new Error(
        `Insufficient ${params.debitType} balance. Available: ₹${(debitAcc.balancePaise / 100).toLocaleString('en-IN')}`
      );
    }

    debitAcc.balancePaise -= amountPaise;
    creditAcc.balancePaise += amountPaise;

    const entry: LedgerEntryRecord = {
      id: `led_${crypto.randomUUID().slice(0, 12)}`,
      txGroupId: `txg_${crypto.randomUUID().slice(0, 10)}`,
      userId: params.userId,
      debitAccountId: debitAcc.id,
      creditAccountId: creditAcc.id,
      debitAccountType: debitAcc.type,
      creditAccountType: creditAcc.type,
      amountPaise,
      entryType: params.entryType,
      referenceId: params.referenceId,
      description: params.description,
      idempotencyKey: params.idempotencyKey,
      createdAt: new Date().toISOString(),
    };
    state.ledgerEntries.push(entry);
    await persistState();
    return entry;
  },

  // Real Holdings & Executed Trades (FIFO Reconstructed)
  getHoldings(userId: string): HoldingRecord[] {
    return state.holdings.filter((h) => h.userId === userId && h.quantity > 0);
  },

  getOrders(userId: string): OrderRecord[] {
    return state.orders
      .filter((o) => o.userId === userId)
      .sort((a, b) => (b.tradeDate || b.createdAt).localeCompare(a.tradeDate || a.createdAt));
  },

  async addRealTrades(userId: string, trades: RealTradeInput[]): Promise<OrderRecord[]> {
    const inserted: OrderRecord[] = [];
    for (const t of trades) {
      const symbol = normalizeNseSymbol(t.symbol);
      const qty = Number(t.quantity);
      const price = Number(t.priceInr);
      if (!symbol || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
        continue;
      }
      const order: OrderRecord = {
        id: `trd_${crypto.randomUUID().slice(0, 10)}`,
        userId,
        symbol,
        name: t.name?.trim() || symbol.replace('.NS', ''),
        assetType: t.assetType || (symbol.includes('BEES') ? 'ETF' : 'STOCK_NSE'),
        side: t.side === 'SELL' ? 'SELL' : 'BUY',
        qty: Number(qty.toFixed(4)),
        executionPrice: Number(price.toFixed(2)),
        totalValueInr: Number((qty * price).toFixed(2)),
        tradeDate: t.tradeDate.slice(0, 10),
        source: t.source || 'MANUAL',
        brokerOrderId: t.brokerOrderId,
        stcgLtcgTag: 'NEW_LOT',
        status: 'FILLED',
        createdAt: new Date().toISOString(),
      };
      state.orders.push(order);
      inserted.push(order);
    }

    if (inserted.length === 0) {
      throw new Error('No valid real trades supplied.');
    }

    rebuildFifoHoldingsForUser(userId);
    await persistState();
    return inserted;
  },

  async deleteRealTrade(userId: string, tradeId: string): Promise<void> {
    const idx = state.orders.findIndex((o) => o.id === tradeId && o.userId === userId);
    if (idx === -1) {
      throw new Error('Trade record not found');
    }
    state.orders.splice(idx, 1);
    rebuildFifoHoldingsForUser(userId);
    await persistState();
  },

  // Quant Strategies
  getStrategies(userId: string): QuantStrategyRecord[] {
    return state.quantStrategies
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async saveStrategy(record: Omit<QuantStrategyRecord, 'id' | 'createdAt'>): Promise<QuantStrategyRecord> {
    const created: QuantStrategyRecord = {
      ...record,
      id: `strat_${crypto.randomUUID().slice(0, 10)}`,
      createdAt: new Date().toISOString(),
    };
    state.quantStrategies.push(created);
    await persistState();
    return created;
  },

  // Tracked Smart SIP Schedules (Zero fake escrow debits)
  getMandates(userId: string): UpiMandateRecord[] {
    return state.upiMandates
      .filter((m) => m.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createMandate(params: {
    userId: string;
    strategyId: string;
    strategyName: string;
    amountInr: number;
    frequency: 'WEEKLY' | 'MONTHLY';
    vpa: string;
  }): Promise<UpiMandateRecord> {
    const days = params.frequency === 'WEEKLY' ? 7 : 30;
    const nextRunAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const mandate: UpiMandateRecord = {
      id: `mnd_${crypto.randomUUID().slice(0, 10)}`,
      userId: params.userId,
      strategyId: params.strategyId,
      strategyName: params.strategyName,
      amountInr: params.amountInr,
      frequency: params.frequency,
      vpa: params.vpa,
      status: 'ACTIVE',
      nextRunAt,
      totalExecutedInr: 0,
      createdAt: new Date().toISOString(),
    };
    state.upiMandates.push(mandate);
    await persistState();
    return mandate;
  },

  async updateMandateStatus(
    userId: string,
    mandateId: string,
    status: UpiMandateRecord['status']
  ): Promise<UpiMandateRecord> {
    const m = state.upiMandates.find((item) => item.id === mandateId && item.userId === userId);
    if (!m) throw new Error('SIP schedule not found');
    m.status = status;
    await persistState();
    return m;
  },

  async executeMandateInstallment(
    userId: string,
    mandateId: string
  ): Promise<UpiMandateRecord> {
    const m = state.upiMandates.find((item) => item.id === mandateId && item.userId === userId);
    if (!m) throw new Error('SIP schedule not found');
    if (m.status !== 'ACTIVE') throw new Error('SIP schedule must be ACTIVE to log a paid installment');

    m.totalExecutedInr += m.amountInr;
    const days = m.frequency === 'WEEKLY' ? 7 : 30;
    m.nextRunAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await persistState();
    return m;
  },

  // UPI Transactions
  getUpiTransactions(userId: string): UpiTransactionRecord[] {
    return state.upiTransactions
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.date.localeCompare(a.date));
  },

  async replaceOrAppendUpiTransactions(
    userId: string,
    records: Array<Omit<UpiTransactionRecord, 'id' | 'userId'>>,
    replace: boolean
  ): Promise<UpiTransactionRecord[]> {
    if (replace) {
      state.upiTransactions = state.upiTransactions.filter((t) => t.userId !== userId);
    }
    const inserted: UpiTransactionRecord[] = records.map((r) => ({
      id: `upi_${crypto.randomUUID().slice(0, 10)}`,
      userId,
      ...r,
    }));
    state.upiTransactions.push(...inserted);
    await persistState();
    return this.getUpiTransactions(userId);
  },

  // RAG Documents & Chunks
  getRagDocuments(userId: string | null): RagDocumentRecord[] {
    return state.ragDocuments
      .filter((d) => d.userId === null || (userId !== null && d.userId === userId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  getRagChunks(userId: string | null): StoredRagChunk[] {
    return state.ragChunks.filter((c) => c.userId === null || (userId !== null && c.userId === userId));
  },

  async saveRagDocumentWithChunks(
    doc: RagDocumentRecord,
    chunks: StoredRagChunk[]
  ): Promise<void> {
    state.ragDocuments = state.ragDocuments.filter((d) => d.id !== doc.id);
    state.ragChunks = state.ragChunks.filter((c) => c.documentId !== doc.id);
    state.ragDocuments.push(doc);
    state.ragChunks.push(...chunks);
    await persistState();
  },
};
