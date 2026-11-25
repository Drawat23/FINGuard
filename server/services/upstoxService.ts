import crypto from 'crypto';
import protobuf from 'protobufjs';
import WebSocket from 'ws';
import type {
  MarketCandle,
  MarketDepthLevel,
  MarketQuote,
  UpstoxFundsInfo,
  UpstoxHoldingItem,
  UpstoxProfileSummary,
} from '../../shared/types.ts';

export type ChartTimeframe = '1D' | '1W' | '1M' | '6M' | '1Y' | '3Y';

export const UPSTOX_INSTRUMENT_MAP: Record<string, { instrumentKey: string; name: string; sector: string }> = {
  '^NSEI': { instrumentKey: 'NSE_INDEX|Nifty 50', name: 'Nifty 50 Index', sector: 'Benchmark' },
  '^BSESN': { instrumentKey: 'BSE_INDEX|SENSEX', name: 'BSE Sensex', sector: 'Benchmark' },
  '^NSEBANK': { instrumentKey: 'NSE_INDEX|Nifty Bank', name: 'Nifty Bank Index', sector: 'Benchmark' },
  '^INDIAVIX': { instrumentKey: 'NSE_INDEX|India VIX', name: 'India VIX', sector: 'Volatility' },
  'JIOFIN.NS': { instrumentKey: 'NSE_EQ|INE758E01017', name: 'Jio Financial Services Ltd', sector: 'Financials' },
  'RELIANCE.NS': { instrumentKey: 'NSE_EQ|INE002A01018', name: 'Reliance Industries Ltd', sector: 'Energy & Telecom' },
  'TCS.NS': { instrumentKey: 'NSE_EQ|INE467B01029', name: 'Tata Consultancy Services', sector: 'IT Services' },
  'HDFCBANK.NS': { instrumentKey: 'NSE_EQ|INE040A01034', name: 'HDFC Bank Ltd', sector: 'Banking' },
  'INFY.NS': { instrumentKey: 'NSE_EQ|INE009A01021', name: 'Infosys Ltd', sector: 'IT Services' },
  'ICICIBANK.NS': { instrumentKey: 'NSE_EQ|INE090A01021', name: 'ICICI Bank Ltd', sector: 'Banking' },
  'SBIN.NS': { instrumentKey: 'NSE_EQ|INE062A01020', name: 'State Bank of India', sector: 'Banking' },
  'TATAMOTORS.NS': { instrumentKey: 'NSE_EQ|INE155A01022', name: 'Tata Motors Ltd', sector: 'Automobiles' },
  'SUNPHARMA.NS': { instrumentKey: 'NSE_EQ|INE044A01036', name: 'Sun Pharmaceutical Ind', sector: 'Pharma' },
  'BHARTIARTL.NS': { instrumentKey: 'NSE_EQ|INE397D01024', name: 'Bharti Airtel Ltd', sector: 'Telecom' },
  'LT.NS': { instrumentKey: 'NSE_EQ|INE018A01030', name: 'Larsen & Toubro Ltd', sector: 'Infrastructure' },
  'ITC.NS': { instrumentKey: 'NSE_EQ|INE154A01025', name: 'ITC Ltd', sector: 'FMCG' },
  'ETERNAL.NS': { instrumentKey: 'NSE_EQ|INE758T01015', name: 'Eternal Ltd (Zomato)', sector: 'Consumer Tech' },
  'ZOMATO.NS': { instrumentKey: 'NSE_EQ|INE758T01015', name: 'Eternal Ltd (Zomato)', sector: 'Consumer Tech' },
  'HAL.NS': { instrumentKey: 'NSE_EQ|INE066F01020', name: 'Hindustan Aeronautics Ltd', sector: 'Defence' },
  'BEL.NS': { instrumentKey: 'NSE_EQ|INE263A01024', name: 'Bharat Electronics Ltd', sector: 'Defence' },
  'TRENT.NS': { instrumentKey: 'NSE_EQ|INE849A01020', name: 'Trent Ltd', sector: 'Retail' },
  'SUZLON.NS': { instrumentKey: 'NSE_EQ|INE040H01021', name: 'Suzlon Energy Ltd', sector: 'Renewables' },
  'ADANIENT.NS': { instrumentKey: 'NSE_EQ|INE423A01024', name: 'Adani Enterprises Ltd', sector: 'Conglomerate' },
  'NIFTYBEES.NS': { instrumentKey: 'NSE_EQ|INF204KB14I2', name: 'Nippon India ETF Nifty BeES', sector: 'Index ETF' },
  'GOLDBEES.NS': { instrumentKey: 'NSE_EQ|INF204KB17I5', name: 'Nippon India ETF Gold BeES', sector: 'Gold ETF' },
  'LIQUIDBEES.NS': { instrumentKey: 'NSE_EQ|INF732E01037', name: 'Nippon India ETF Liquid BeES', sector: 'Liquid Cash' },
};

const INSTRUMENT_TO_SYMBOL = new Map<string, string>(
  Object.entries(UPSTOX_INSTRUMENT_MAP).map(([sym, meta]) => [meta.instrumentKey, sym])
);

const DYNAMIC_INSTRUMENT_MAP = new Map<string, { instrumentKey: string; name: string }>();
const DYNAMIC_KEY_TO_SYMBOL = new Map<string, string>();

export function registerUpstoxInstruments(
  entries: Array<{ symbol: string; instrumentKey: string; name: string }>
): void {
  for (const item of entries) {
    const sym = item.symbol.trim().toUpperCase();
    const key = item.instrumentKey.trim();
    if (!sym || !key) continue;
    if (!UPSTOX_INSTRUMENT_MAP[sym]) {
      DYNAMIC_INSTRUMENT_MAP.set(sym, { instrumentKey: key, name: item.name });
    }
    if (!INSTRUMENT_TO_SYMBOL.has(key)) {
      DYNAMIC_KEY_TO_SYMBOL.set(key, sym);
    }
  }
}

export function getUpstoxInstrumentMeta(symbol: string): { instrumentKey: string; name: string } | undefined {
  const upper = symbol.trim().toUpperCase();
  return UPSTOX_INSTRUMENT_MAP[upper] ?? DYNAMIC_INSTRUMENT_MAP.get(upper);
}

export function isUpstoxConfigured(): boolean {
  return Boolean(process.env.UPSTOX_API_KEY?.trim() && process.env.UPSTOX_API_SECRET?.trim());
}

export function getUpstoxRedirectUri(): string {
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/api/upstox/callback`;
}

export function symbolToInstrumentKey(symbol: string): string | null {
  const cleaned = symbol.trim();
  if (cleaned.startsWith('NSE_EQ|') || cleaned.startsWith('NSE_INDEX|') || cleaned.startsWith('BSE_INDEX|')) {
    return cleaned;
  }
  const upper = cleaned.toUpperCase();
  return UPSTOX_INSTRUMENT_MAP[upper]?.instrumentKey ?? DYNAMIC_INSTRUMENT_MAP.get(upper)?.instrumentKey ?? null;
}

export function instrumentKeyToSymbol(instrumentKey: string): string {
  return INSTRUMENT_TO_SYMBOL.get(instrumentKey) ?? DYNAMIC_KEY_TO_SYMBOL.get(instrumentKey) ?? instrumentKey;
}

export function isNseMarketOpen(now = new Date()): boolean {
  // Convert to IST (UTC+5:30)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffsetMs);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

export function buildUpstoxAuthorizeUrl(stateToken: string): string {
  const apiKey = process.env.UPSTOX_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('UPSTOX_API_KEY is not configured in server secrets.');
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: apiKey,
    redirect_uri: getUpstoxRedirectUri(),
    state: stateToken,
  });
  return `https://api.upstox.com/v2/login/authorization/dialog?${params.toString()}`;
}

export async function exchangeUpstoxCodeForToken(code: string): Promise<{
  accessToken: string;
  profile: UpstoxProfileSummary;
}> {
  const apiKey = process.env.UPSTOX_API_KEY?.trim();
  const apiSecret = process.env.UPSTOX_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    throw new Error('UPSTOX_API_KEY or UPSTOX_API_SECRET missing on server.');
  }

  const body = new URLSearchParams({
    code,
    client_id: apiKey,
    client_secret: apiSecret,
    redirect_uri: getUpstoxRedirectUri(),
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch('https://api.upstox.com/v2/login/authorization/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    user_id?: string;
    user_name?: string;
    email?: string;
    exchanges?: string[];
    broker?: string;
    errors?: Array<{ message?: string }>;
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    const errMsg = tokenJson.errors?.[0]?.message || `Upstox token exchange failed (${tokenRes.status})`;
    throw new Error(errMsg);
  }

  let profile: UpstoxProfileSummary = {
    userId: tokenJson.user_id || 'UPSTOX',
    userName: tokenJson.user_name || 'Upstox Trader',
    email: tokenJson.email || '',
    exchanges: tokenJson.exchanges || ['NSE'],
    broker: tokenJson.broker || 'UPSTOX',
    connectedAt: new Date().toISOString(),
  };

  try {
    const profRes = await fetch('https://api.upstox.com/v2/user/profile', {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tokenJson.access_token}`,
      },
    });
    if (profRes.ok) {
      const profJson = (await profRes.json()) as {
        data?: {
          user_id?: string;
          user_name?: string;
          email?: string;
          exchanges?: string[];
          broker?: string;
        };
      };
      if (profJson.data) {
        profile = {
          userId: profJson.data.user_id || profile.userId,
          userName: profJson.data.user_name || profile.userName,
          email: profJson.data.email || profile.email,
          exchanges: profJson.data.exchanges || profile.exchanges,
          broker: profJson.data.broker || profile.broker,
          connectedAt: new Date().toISOString(),
        };
      }
    }
  } catch {
    // Non-fatal: token response already carries basic user info
  }

  return { accessToken: tokenJson.access_token, profile };
}

interface UpstoxRawQuoteEntry {
  instrument_token?: string;
  symbol?: string;
  last_price?: number;
  volume?: number;
  average_price?: number;
  net_change?: number;
  lower_circuit_limit?: number;
  upper_circuit_limit?: number;
  total_buy_quantity?: number;
  total_sell_quantity?: number;
  ohlc?: {
    open?: number;
    high?: number;
    low?: number;
    close?: number;
  };
  depth?: {
    buy?: Array<{ quantity?: number; price?: number; orders?: number }>;
    sell?: Array<{ quantity?: number; price?: number; orders?: number }>;
  };
}

export async function fetchUpstoxQuotes(
  accessToken: string,
  symbols: string[]
): Promise<MarketQuote[]> {
  const resolved = symbols
    .map((s) => ({ symbol: s, key: symbolToInstrumentKey(s) }))
    .filter((item): item is { symbol: string; key: string } => Boolean(item.key));

  if (resolved.length === 0) return [];

  const queryKeys = resolved.map((r) => r.key).join(',');
  const url = `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(queryKeys)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Upstox quotes failed (${res.status})`);
  }

  const json = (await res.json()) as {
    status?: string;
    data?: Record<string, UpstoxRawQuoteEntry>;
  };

  const entries = Object.values(json.data || {});
  const byToken = new Map<string, UpstoxRawQuoteEntry>();
  for (const entry of entries) {
    if (entry.instrument_token) {
      byToken.set(entry.instrument_token, entry);
    }
  }

  const mapDepth = (rows?: Array<{ quantity?: number; price?: number; orders?: number }>): MarketDepthLevel[] =>
    (rows || []).slice(0, 5).map((r) => ({
      quantity: Number(r.quantity || 0),
      price: Number(r.price || 0),
      orders: Number(r.orders || 0),
    }));

  const quotes: MarketQuote[] = [];
  for (const { symbol, key } of resolved) {
    const raw = byToken.get(key);
    if (!raw || typeof raw.last_price !== 'number') continue;

    const ltp = Number(raw.last_price.toFixed(2));
    const prevClose =
      typeof raw.ohlc?.close === 'number' && raw.ohlc.close > 0
        ? Number(raw.ohlc.close.toFixed(2))
        : Number((ltp - (raw.net_change || 0)).toFixed(2));
    const change =
      typeof raw.net_change === 'number'
        ? Number(raw.net_change.toFixed(2))
        : Number((ltp - prevClose).toFixed(2));
    const changePct = prevClose > 0 ? Number(((change / prevClose) * 100).toFixed(2)) : 0;
    const meta = getUpstoxInstrumentMeta(symbol);

    quotes.push({
      symbol,
      name: meta?.name || raw.symbol || symbol,
      price: ltp,
      previousClose: prevClose,
      change,
      changePct,
      currency: symbol.startsWith('^') ? 'PTS' : 'INR',
      dataSource: 'UPSTOX_LIVE',
      updatedAt: new Date().toISOString(),
      open: raw.ohlc?.open,
      high: raw.ohlc?.high,
      low: raw.ohlc?.low,
      volume: raw.volume,
      averagePrice: raw.average_price,
      lowerCircuit: raw.lower_circuit_limit,
      upperCircuit: raw.upper_circuit_limit,
      totalBuyQty: raw.total_buy_quantity,
      totalSellQty: raw.total_sell_quantity,
      instrumentKey: key,
      depth: raw.depth
        ? {
            buy: mapDepth(raw.depth.buy),
            sell: mapDepth(raw.depth.sell),
          }
        : undefined,
    });
  }

  return quotes;
}

function parseUpstoxCandleRows(rawCandles?: Array<Array<string | number>>): MarketCandle[] {
  if (!Array.isArray(rawCandles)) return [];
  const parsed: Array<{ ts: number; candle: MarketCandle }> = [];

  for (const row of rawCandles) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const dateStr = String(row[0]);
    const ts = new Date(dateStr).getTime();
    const o = Number(row[1]);
    const h = Number(row[2]);
    const l = Number(row[3]);
    const c = Number(row[4]);
    const v = Number(row[5] || 0);
    if (!Number.isFinite(ts) || !Number.isFinite(c) || c <= 0) continue;
    parsed.push({
      ts,
      candle: {
        date: dateStr,
        open: Number(o.toFixed(2)),
        high: Number(h.toFixed(2)),
        low: Number(l.toFixed(2)),
        close: Number(c.toFixed(2)),
        volume: Math.round(v),
      },
    });
  }

  parsed.sort((a, b) => a.ts - b.ts);
  return parsed.map((p) => p.candle);
}

export async function fetchUpstoxCandles(
  accessToken: string,
  symbol: string,
  timeframe: ChartTimeframe
): Promise<MarketCandle[]> {
  const key = symbolToInstrumentKey(symbol);
  if (!key) throw new Error(`No Upstox instrument mapping for ${symbol}`);

  const encodedKey = encodeURIComponent(key);
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };

  const today = new Date().toISOString().slice(0, 10);
  const daysAgoDate = (days: number) =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  if (timeframe === '1D') {
    // Try v3 intraday 5-minute candles first
    const intradayUrl = `https://api.upstox.com/v3/historical-candle/intraday/${encodedKey}/minutes/5`;
    const res = await fetch(intradayUrl, { headers });
    if (res.ok) {
      const json = (await res.json()) as { data?: { candles?: Array<Array<string | number>> } };
      const parsed = parseUpstoxCandleRows(json.data?.candles);
      if (parsed.length > 0) return parsed;
    }

    // Outside market hours / weekends: pull last 5 trading days of 30m candles
    const fallbackUrl = `https://api.upstox.com/v2/historical-candle/${encodedKey}/30minute/${today}/${daysAgoDate(5)}`;
    const fbRes = await fetch(fallbackUrl, { headers });
    if (fbRes.ok) {
      const fbJson = (await fbRes.json()) as { data?: { candles?: Array<Array<string | number>> } };
      const parsed = parseUpstoxCandleRows(fbJson.data?.candles);
      if (parsed.length > 0) return parsed;
    }
    throw new Error('No Upstox intraday candles available');
  }

  const spec: Record<Exclude<ChartTimeframe, '1D'>, { interval: string; days: number }> = {
    '1W': { interval: '30minute', days: 10 },
    '1M': { interval: 'day', days: 35 },
    '6M': { interval: 'day', days: 190 },
    '1Y': { interval: 'day', days: 370 },
    '3Y': { interval: 'day', days: 1100 },
  };
  const cfg = spec[timeframe];
  const url = `https://api.upstox.com/v2/historical-candle/${encodedKey}/${cfg.interval}/${today}/${daysAgoDate(cfg.days)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Upstox historical candles failed (${res.status})`);
  }
  const json = (await res.json()) as { data?: { candles?: Array<Array<string | number>> } };
  const parsed = parseUpstoxCandleRows(json.data?.candles);
  if (parsed.length === 0) {
    throw new Error('Upstox returned empty candle series');
  }
  return parsed;
}

export async function fetchUpstoxPortfolio(accessToken: string): Promise<{
  holdings: UpstoxHoldingItem[];
  funds: UpstoxFundsInfo;
}> {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };

  const [holdRes, fundRes] = await Promise.all([
    fetch('https://api.upstox.com/v2/portfolio/long-term-holdings', { headers }),
    fetch('https://api.upstox.com/v2/user/get-funds-and-margin', { headers }),
  ]);

  if (!holdRes.ok) {
    throw new Error(`Upstox holdings fetch failed (${holdRes.status})`);
  }

  const holdJson = (await holdRes.json()) as {
    data?: Array<{
      isin?: string;
      company_name?: string;
      trading_symbol?: string;
      exchange?: string;
      instrument_token?: string;
      quantity?: number;
      average_price?: number;
      last_price?: number;
      pnl?: number;
      day_change_percentage?: number;
    }>;
  };

  const holdings: UpstoxHoldingItem[] = (holdJson.data || []).map((h) => ({
    symbol: h.trading_symbol ? `${h.trading_symbol}.NS` : h.isin || 'UNKNOWN',
    tradingSymbol: h.trading_symbol || '',
    companyName: h.company_name || h.trading_symbol || 'NSE Equity',
    isin: h.isin || '',
    quantity: Number(h.quantity || 0),
    averagePrice: Number(h.average_price || 0),
    lastPrice: Number(h.last_price || 0),
    pnl: Number(h.pnl || 0),
    dayChangePct: Number(h.day_change_percentage || 0),
    exchange: h.exchange || 'NSE',
    instrumentToken: h.instrument_token || '',
  }));

  let funds: UpstoxFundsInfo = { availableMargin: 0, usedMargin: 0, payinAmount: 0 };
  if (fundRes.ok) {
    const fundJson = (await fundRes.json()) as {
      data?: {
        equity?: {
          available_margin?: number;
          used_margin?: number;
          payin_amount?: number;
        };
      };
    };
    const eq = fundJson.data?.equity;
    if (eq) {
      funds = {
        availableMargin: Number(eq.available_margin || 0),
        usedMargin: Number(eq.used_margin || 0),
        payinAmount: Number(eq.payin_amount || 0),
      };
    }
  }

  return { holdings, funds };
}

export async function placeUpstoxOrder(params: {
  accessToken: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  orderType?: 'MARKET' | 'LIMIT';
  limitPrice?: number;
}): Promise<{ orderId: string; instrumentKey: string }> {
  const instrumentKey = symbolToInstrumentKey(params.symbol);
  if (
    !instrumentKey ||
    instrumentKey.startsWith('NSE_INDEX|') ||
    instrumentKey.startsWith('BSE_INDEX|')
  ) {
    throw new Error(`Order routing is only supported for tradeable NSE equities/ETFs, not ${params.symbol}.`);
  }

  const qty = Math.floor(params.quantity);
  if (qty <= 0) throw new Error('Order quantity must be a positive integer.');
  const orderType = params.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET';
  const price = orderType === 'LIMIT' ? Number((params.limitPrice || 0).toFixed(2)) : 0;
  if (orderType === 'LIMIT' && price <= 0) {
    throw new Error('Valid limit price required for LIMIT orders.');
  }

  const res = await fetch('https://api.upstox.com/v2/order/place', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({
      quantity: qty,
      product: 'D',
      validity: 'DAY',
      price,
      tag: 'FINGUARD',
      instrument_token: instrumentKey,
      order_type: orderType,
      transaction_type: params.side,
      disclosed_quantity: 0,
      trigger_price: 0,
      is_amo: false,
    }),
  });

  const json = (await res.json()) as {
    status?: string;
    data?: { order_id?: string };
    errors?: Array<{ message?: string }>;
  };

  if (!res.ok || !json.data?.order_id) {
    const msg = json.errors?.[0]?.message || `Upstox order placement failed (${res.status})`;
    throw new Error(msg);
  }

  return {
    orderId: json.data.order_id,
    instrumentKey,
  };
}

export async function fetchUpstoxOrderBook(accessToken: string): Promise<unknown[]> {
  const res = await fetch('https://api.upstox.com/v2/order/retrieve-all', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Upstox order book fetch failed (${res.status})`);
  }
  const json = (await res.json()) as { data?: unknown[] };
  return Array.isArray(json.data) ? json.data : [];
}

// Inline Protobuf descriptor matching Upstox MarketDataFeedV3.proto
const UPSTOX_FEED_V3_JSON = {
  nested: {
    com: {
      nested: {
        upstox: {
          nested: {
            marketdatafeederv3udapi: {
              nested: {
                rpc: {
                  nested: {
                    proto: {
                      nested: {
                        LTPC: {
                          fields: {
                            ltp: { type: 'double', id: 1 },
                            ltt: { type: 'int64', id: 2 },
                            ltq: { type: 'int64', id: 3 },
                            cp: { type: 'double', id: 4 },
                          },
                        },
                        MarketLevel: {
                          fields: {
                            bidAskQuote: { rule: 'repeated', type: 'Quote', id: 1 },
                          },
                        },
                        Quote: {
                          fields: {
                            bidQ: { type: 'int64', id: 1 },
                            bidP: { type: 'double', id: 2 },
                            askQ: { type: 'int64', id: 3 },
                            askP: { type: 'double', id: 4 },
                          },
                        },
                        OHLC: {
                          fields: {
                            interval: { type: 'string', id: 1 },
                            open: { type: 'double', id: 2 },
                            high: { type: 'double', id: 3 },
                            low: { type: 'double', id: 4 },
                            close: { type: 'double', id: 5 },
                            vol: { type: 'int64', id: 6 },
                            ts: { type: 'int64', id: 7 },
                          },
                        },
                        MarketOHLC: {
                          fields: {
                            ohlc: { rule: 'repeated', type: 'OHLC', id: 1 },
                          },
                        },
                        MarketFullFeed: {
                          fields: {
                            ltpc: { type: 'LTPC', id: 1 },
                            marketLevel: { type: 'MarketLevel', id: 2 },
                            marketOHLC: { type: 'MarketOHLC', id: 4 },
                            vtt: { type: 'int64', id: 7 },
                            atp: { type: 'double', id: 6 },
                          },
                        },
                        IndexFullFeed: {
                          fields: {
                            ltpc: { type: 'LTPC', id: 1 },
                            marketOHLC: { type: 'MarketOHLC', id: 2 },
                          },
                        },
                        FullFeed: {
                          oneofs: {
                            FullFeedUnion: { oneof: ['marketFF', 'indexFF'] },
                          },
                          fields: {
                            marketFF: { type: 'MarketFullFeed', id: 1 },
                            indexFF: { type: 'IndexFullFeed', id: 2 },
                          },
                        },
                        Feed: {
                          oneofs: {
                            FeedUnion: { oneof: ['ltpc', 'fullFeed'] },
                          },
                          fields: {
                            ltpc: { type: 'LTPC', id: 1 },
                            fullFeed: { type: 'FullFeed', id: 2 },
                          },
                        },
                        FeedResponse: {
                          fields: {
                            type: { type: 'int32', id: 1 },
                            feeds: { keyType: 'string', type: 'Feed', id: 2 },
                            currentTs: { type: 'int64', id: 3 },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const protoRoot = protobuf.Root.fromJSON(UPSTOX_FEED_V3_JSON);
const FeedResponseType = protoRoot.lookupType(
  'com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse'
);

export interface StreamTickPayload {
  symbol: string;
  instrumentKey: string;
  ltp: number;
  prevClose: number;
  change: number;
  changePct: number;
  volume?: number;
  open?: number;
  high?: number;
  low?: number;
  depth?: { buy: MarketDepthLevel[]; sell: MarketDepthLevel[] };
  ts: string;
}

export async function openUpstoxFeedWebSocket(
  accessToken: string,
  symbols: string[],
  onTicks: (ticks: StreamTickPayload[]) => void,
  onStatus: (status: string, detail?: string) => void
): Promise<() => void> {
  const keys = symbols
    .map((s) => symbolToInstrumentKey(s))
    .filter((k): k is string => Boolean(k));

  if (keys.length === 0) {
    onStatus('IDLE', 'No valid Upstox instrument keys');
    return () => {};
  }

  let closedByCaller = false;
  let ws: WebSocket | null = null;

  try {
    const authRes = await fetch('https://api.upstox.com/v3/feed/market-data-feed/authorize', {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const authJson = (await authRes.json()) as {
      data?: { authorizedRedirectUri?: string; authorized_redirect_uri?: string };
    };
    const wsUrl = authJson.data?.authorizedRedirectUri || authJson.data?.authorized_redirect_uri;
    if (!authRes.ok || !wsUrl) {
      throw new Error(`Feed authorize failed (${authRes.status})`);
    }

    if (closedByCaller) return () => {};

    ws = new WebSocket(wsUrl, { followRedirects: true });
    ws.on('open', () => {
      onStatus('UPSTOX_WS_CONNECTED');
      ws?.send(
        Buffer.from(
          JSON.stringify({
            guid: crypto.randomUUID(),
            method: 'sub',
            data: {
              mode: 'full',
              instrumentKeys: keys,
            },
          })
        )
      );
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const buf = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.from(raw as ArrayBuffer);
        const decoded = FeedResponseType.decode(buf) as unknown as {
          feeds?: Record<
            string,
            {
              ltpc?: { ltp?: number; cp?: number };
              fullFeed?: {
                marketFF?: {
                  ltpc?: { ltp?: number; cp?: number };
                  vtt?: number;
                  marketOHLC?: { ohlc?: Array<{ interval?: string; open?: number; high?: number; low?: number; close?: number; vol?: number }> };
                  marketLevel?: {
                    bidAskQuote?: Array<{ bidQ?: number; bidP?: number; askQ?: number; askP?: number }>;
                  };
                };
                indexFF?: {
                  ltpc?: { ltp?: number; cp?: number };
                  marketOHLC?: { ohlc?: Array<{ interval?: string; open?: number; high?: number; low?: number; close?: number }> };
                };
              };
            }
          >;
        };

        const feeds = decoded.feeds || {};
        const ticks: StreamTickPayload[] = [];
        const nowIso = new Date().toISOString();

        for (const [instrumentKey, feed] of Object.entries(feeds)) {
          const mff = feed.fullFeed?.marketFF;
          const iff = feed.fullFeed?.indexFF;
          const ltpc = feed.ltpc || mff?.ltpc || iff?.ltpc;
          const ltp = Number(ltpc?.ltp || 0);
          if (!ltp || !Number.isFinite(ltp)) continue;
          const prevClose = Number(ltpc?.cp || ltp);
          const change = Number((ltp - prevClose).toFixed(2));
          const changePct = prevClose > 0 ? Number(((change / prevClose) * 100).toFixed(2)) : 0;

          const dayOhlc = (mff?.marketOHLC?.ohlc || iff?.marketOHLC?.ohlc || []).find(
            (o) => o.interval === '1d'
          );

          const depthRows = mff?.marketLevel?.bidAskQuote || [];
          const depth =
            depthRows.length > 0
              ? {
                  buy: depthRows.slice(0, 5).map((q) => ({
                    price: Number(q.bidP || 0),
                    quantity: Number(q.bidQ || 0),
                    orders: 1,
                  })),
                  sell: depthRows.slice(0, 5).map((q) => ({
                    price: Number(q.askP || 0),
                    quantity: Number(q.askQ || 0),
                    orders: 1,
                  })),
                }
              : undefined;

          ticks.push({
            symbol: instrumentKeyToSymbol(instrumentKey),
            instrumentKey,
            ltp: Number(ltp.toFixed(2)),
            prevClose: Number(prevClose.toFixed(2)),
            change,
            changePct,
            volume: mff?.vtt ? Number(mff.vtt) : undefined,
            open: dayOhlc?.open,
            high: dayOhlc?.high,
            low: dayOhlc?.low,
            depth,
            ts: nowIso,
          });
        }

        if (ticks.length > 0) {
          onTicks(ticks);
        }
      } catch {
        // Ignore malformed binary heartbeat frames
      }
    });

    ws.on('error', (err) => {
      onStatus('UPSTOX_WS_ERROR', err.message);
    });

    ws.on('close', () => {
      if (!closedByCaller) {
        onStatus('UPSTOX_WS_CLOSED');
      }
    });
  } catch (err) {
    onStatus('UPSTOX_WS_FALLBACK', (err as Error).message);
  }

  return () => {
    closedByCaller = true;
    try {
      ws?.close();
    } catch {
      // ignore
    }
  };
}
