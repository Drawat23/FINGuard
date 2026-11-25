import protobuf from 'protobufjs';
import WebSocket from 'ws';
import zlib from 'zlib';
import type { MarketCandle, MarketQuote, MutualFundSearchItem } from '../../shared/types.ts';
import {
  type ChartTimeframe,
  type StreamTickPayload,
  fetchUpstoxCandles,
  fetchUpstoxQuotes,
  getUpstoxInstrumentMeta,
  isNseMarketOpen,
  registerUpstoxInstruments,
  symbolToInstrumentKey,
} from './upstoxService.ts';

interface CachedSeries {
  candles: MarketCandle[];
  quote: MarketQuote;
  fetchedAt: number;
  source: 'LIVE_NSE';
}

interface CachedMfScheme {
  schemeCode: number;
  schemeName: string;
  category: string;
  navs: Array<{ date: string; nav: number }>;
  fetchedAt: number;
  source: 'LIVE_MFAPI';
}

const QUOTE_TTL_MS = 15 * 60 * 1000;
const LIVE_QUOTE_OPEN_TTL_MS = 2000;
const LIVE_QUOTE_CLOSED_TTL_MS = 60 * 1000;
const OHLCV_TTL_MS = 6 * 60 * 60 * 1000;

const seriesCache = new Map<string, CachedSeries>();
const liveQuoteCache = new Map<string, { quote: MarketQuote; fetchedAt: number }>();
const mfSchemeCache = new Map<number, CachedMfScheme>();
let mfListCache: { items: MutualFundSearchItem[]; fetchedAt: number } | null = null;

interface MasterInstrumentItem {
  symbol: string;
  ticker: string;
  name: string;
  assetType: 'STOCK_NSE' | 'ETF';
  sector: string;
  instrumentKey?: string;
}

const discoveredInstrumentNames = new Map<string, string>();
let nseMasterCache: { items: MasterInstrumentItem[]; fetchedAt: number } | null = null;
let nseMasterInflight: Promise<MasterInstrumentItem[]> | null = null;
const MASTER_TTL_MS = 12 * 60 * 60 * 1000;

export const NSE_UNIVERSE_CATALOG: Array<{
  symbol: string;
  name: string;
  assetType: 'STOCK_NSE' | 'ETF';
  sector: string;
}> = [
  { symbol: '^NSEI', name: 'Nifty 50 Index', assetType: 'ETF', sector: 'Benchmark' },
  { symbol: '^BSESN', name: 'BSE Sensex', assetType: 'ETF', sector: 'Benchmark' },
  { symbol: '^NSEBANK', name: 'Nifty Bank Index', assetType: 'ETF', sector: 'Benchmark' },
  { symbol: '^INDIAVIX', name: 'India VIX', assetType: 'ETF', sector: 'Volatility' },
  { symbol: 'JIOFIN.NS', name: 'Jio Financial Services Ltd', assetType: 'STOCK_NSE', sector: 'Financials' },
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries Ltd', assetType: 'STOCK_NSE', sector: 'Energy & Telecom' },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', assetType: 'STOCK_NSE', sector: 'IT Services' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd', assetType: 'STOCK_NSE', sector: 'Banking' },
  { symbol: 'INFY.NS', name: 'Infosys Ltd', assetType: 'STOCK_NSE', sector: 'IT Services' },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank Ltd', sector: 'Banking', assetType: 'STOCK_NSE' },
  { symbol: 'SBIN.NS', name: 'State Bank of India', assetType: 'STOCK_NSE', sector: 'Banking' },
  { symbol: 'TATAMOTORS.NS', name: 'Tata Motors Ltd', assetType: 'STOCK_NSE', sector: 'Automobiles' },
  { symbol: 'SUNPHARMA.NS', name: 'Sun Pharmaceutical Ind', assetType: 'STOCK_NSE', sector: 'Pharma' },
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel Ltd', assetType: 'STOCK_NSE', sector: 'Telecom' },
  { symbol: 'LT.NS', name: 'Larsen & Toubro Ltd', assetType: 'STOCK_NSE', sector: 'Infrastructure' },
  { symbol: 'ITC.NS', name: 'ITC Ltd', assetType: 'STOCK_NSE', sector: 'FMCG' },
  { symbol: 'ETERNAL.NS', name: 'Eternal Ltd (Zomato)', assetType: 'STOCK_NSE', sector: 'Consumer Tech' },
  { symbol: 'HAL.NS', name: 'Hindustan Aeronautics Ltd', assetType: 'STOCK_NSE', sector: 'Defence' },
  { symbol: 'BEL.NS', name: 'Bharat Electronics Ltd', assetType: 'STOCK_NSE', sector: 'Defence' },
  { symbol: 'TRENT.NS', name: 'Trent Ltd', assetType: 'STOCK_NSE', sector: 'Retail' },
  { symbol: 'SUZLON.NS', name: 'Suzlon Energy Ltd', assetType: 'STOCK_NSE', sector: 'Renewables' },
  { symbol: 'ADANIENT.NS', name: 'Adani Enterprises Ltd', assetType: 'STOCK_NSE', sector: 'Conglomerate' },
  { symbol: 'NIFTYBEES.NS', name: 'Nippon India ETF Nifty BeES', assetType: 'ETF', sector: 'Index ETF' },
  { symbol: 'GOLDBEES.NS', name: 'Nippon India ETF Gold BeES', assetType: 'ETF', sector: 'Gold ETF' },
  { symbol: 'LIQUIDBEES.NS', name: 'Nippon India ETF Liquid BeES', assetType: 'ETF', sector: 'Liquid Cash' },
];

function resolveInstrumentName(symbol: string, apiFallback?: string): string {
  const upper = symbol.trim().toUpperCase();
  return (
    NSE_UNIVERSE_CATALOG.find((c) => c.symbol === upper)?.name ||
    getUpstoxInstrumentMeta(upper)?.name ||
    discoveredInstrumentNames.get(upper) ||
    apiFallback ||
    upper
  );
}

async function loadUpstoxNseMaster(): Promise<MasterInstrumentItem[]> {
  const now = Date.now();
  if (nseMasterCache && now - nseMasterCache.fetchedAt < MASTER_TTL_MS) {
    return nseMasterCache.items;
  }
  if (nseMasterInflight) return nseMasterInflight;

  nseMasterInflight = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const res = await fetch('https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz', {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FINGuard/1.0)' },
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`Upstox instrument master returned ${res.status}`);

      const compressed = Buffer.from(await res.arrayBuffer());
      const rawJson = zlib.gunzipSync(compressed).toString('utf8');
      const parsed = JSON.parse(rawJson) as Array<{
        segment?: string;
        instrument_type?: string;
        trading_symbol?: string;
        name?: string;
        short_name?: string;
        instrument_key?: string;
      }>;

      const bySymbol = new Map<string, MasterInstrumentItem>();
      const dynamicEntries: Array<{ symbol: string; instrumentKey: string; name: string }> = [];

      for (const row of parsed) {
        if (!row.trading_symbol || !row.instrument_key) continue;
        if (row.segment === 'NSE_EQ' && (row.instrument_type === 'EQ' || row.instrument_type === 'BE')) {
          const ticker = row.trading_symbol.trim().toUpperCase();
          if (!/^[A-Z0-9&-]{1,20}$/.test(ticker)) continue;
          const symbol = `${ticker}.NS`;
          const displayName = (row.name || row.short_name || ticker).trim();
          if (!bySymbol.has(symbol)) {
            const isEtf = /BEES|ETF|NIFTY|GOLD|LIQUID|GILT/i.test(ticker);
            bySymbol.set(symbol, {
              symbol,
              ticker,
              name: displayName,
              assetType: isEtf ? 'ETF' : 'STOCK_NSE',
              sector: isEtf ? 'NSE ETF' : 'NSE Equity',
              instrumentKey: row.instrument_key,
            });
            discoveredInstrumentNames.set(symbol, displayName);
            dynamicEntries.push({
              symbol,
              instrumentKey: row.instrument_key,
              name: displayName,
            });
          }
        }
      }

      registerUpstoxInstruments(dynamicEntries);
      const items = Array.from(bySymbol.values());
      nseMasterCache = { items, fetchedAt: Date.now() };
      return items;
    } catch {
      return nseMasterCache?.items || [];
    } finally {
      nseMasterInflight = null;
    }
  })();

  return nseMasterInflight;
}

// Warm up full NSE instrument directory silently in background
void loadUpstoxNseMaster();

export const POPULAR_INDIAN_MFS: Array<{
  schemeCode: number;
  schemeName: string;
  category: string;
}> = [
  { schemeCode: 122639, schemeName: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth', category: 'Flexi Cap' },
  { schemeCode: 120716, schemeName: 'UTI Nifty 50 Index Fund - Direct Plan - Growth', category: 'Large Cap Index' },
  { schemeCode: 118989, schemeName: 'HDFC Mid-Cap Opportunities Fund - Direct Plan - Growth', category: 'Mid Cap' },
  { schemeCode: 120828, schemeName: 'Quant Small Cap Fund - Direct Plan - Growth', category: 'Small Cap' },
  { schemeCode: 118778, schemeName: 'Nippon India Small Cap Fund - Direct Plan - Growth', category: 'Small Cap' },
  { schemeCode: 119598, schemeName: 'SBI Bluechip Fund - Direct Plan - Growth', category: 'Large Cap' },
  { schemeCode: 120503, schemeName: 'Axis Bluechip Fund - Direct Plan - Growth', category: 'Large Cap' },
  { schemeCode: 118834, schemeName: 'Mirae Asset Large Cap Fund - Direct Plan - Growth', category: 'Large Cap' },
];

function sanitizeSymbol(raw: string): string {
  const cleaned = raw.trim().toUpperCase();
  if (!/^[A-Z0-9^._-]{1,24}$/.test(cleaned)) {
    throw new Error(`Invalid market symbol: ${raw}`);
  }
  return cleaned;
}



async function fetchYahooChart(
  symbol: string,
  timeframe: ChartTimeframe = '3Y'
): Promise<{ candles: MarketCandle[]; name: string }> {
  const safeSymbol = sanitizeSymbol(symbol);
  const spec: Record<ChartTimeframe, { range: string; interval: string }> = {
    '1D': { range: '5d', interval: '5m' },
    '1W': { range: '1mo', interval: '30m' },
    '1M': { range: '1mo', interval: '1d' },
    '6M': { range: '6mo', interval: '1d' },
    '1Y': { range: '1y', interval: '1d' },
    '3Y': { range: '3y', interval: '1d' },
  };
  const cfg = spec[timeframe] || spec['3Y'];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    safeSymbol
  )}?range=${cfg.range}&interval=${cfg.interval}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FINGuard/1.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`Yahoo Finance returned ${res.status}`);
    }
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: { shortName?: string; longName?: string; regularMarketPrice?: number };
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
          };
        }>;
      };
    };

    const result = json.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const quote = result?.indicators?.quote?.[0];
    if (!result || timestamps.length < 15 || !quote?.close) {
      throw new Error('Insufficient Yahoo chart candles');
    }

    const isIntraday = timeframe === '1D' || timeframe === '1W';
    const candles: MarketCandle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = quote.close[i];
      if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) continue;
      const o = typeof quote.open?.[i] === 'number' && Number.isFinite(quote.open[i]) ? quote.open[i]! : c;
      const h = typeof quote.high?.[i] === 'number' && Number.isFinite(quote.high[i]) ? quote.high[i]! : c;
      const l = typeof quote.low?.[i] === 'number' && Number.isFinite(quote.low[i]) ? quote.low[i]! : c;
      const v = typeof quote.volume?.[i] === 'number' && Number.isFinite(quote.volume[i]) ? quote.volume[i]! : 0;
      const iso = new Date(timestamps[i] * 1000).toISOString();
      candles.push({
        date: isIntraday ? iso : iso.slice(0, 10),
        open: Number(o.toFixed(2)),
        high: Number(h.toFixed(2)),
        low: Number(l.toFixed(2)),
        close: Number(c.toFixed(2)),
        volume: Math.round(v),
      });
    }

    if (candles.length < 15) {
      throw new Error('Parsed candles too short');
    }

    const name = resolveInstrumentName(safeSymbol, result.meta?.shortName || result.meta?.longName);
    return { candles, name };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getHistoricalSeries(symbol: string): Promise<{
  candles: MarketCandle[];
  quote: MarketQuote;
}> {
  const safeSymbol = sanitizeSymbol(symbol);
  const cached = seriesCache.get(safeSymbol);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < OHLCV_TTL_MS) {
    return {
      candles: cached.candles,
      quote: {
        ...cached.quote,
        dataSource: 'CACHED',
      },
    };
  }

  try {
    const { candles, name } = await fetchYahooChart(safeSymbol);
    const latest = candles[candles.length - 1];
    const prev = candles[candles.length - 2] || latest;
    const change = Number((latest.close - prev.close).toFixed(2));
    const changePct = prev.close > 0 ? Number(((change / prev.close) * 100).toFixed(2)) : 0;

    const quote: MarketQuote = {
      symbol: safeSymbol,
      name,
      price: latest.close,
      previousClose: prev.close,
      change,
      changePct,
      currency: safeSymbol.startsWith('^') ? 'PTS' : 'INR',
      dataSource: 'LIVE_NSE',
      updatedAt: new Date().toISOString(),
    };

    seriesCache.set(safeSymbol, {
      candles,
      quote,
      fetchedAt: now,
      source: 'LIVE_NSE',
    });
    return { candles, quote };
  } catch (err) {
    if (cached && now - cached.fetchedAt < OHLCV_TTL_MS * 4) {
      return {
        candles: cached.candles,
        quote: { ...cached.quote, dataSource: 'CACHED' },
      };
    }
    throw new Error(
      `Live NSE market data unavailable for ${safeSymbol} (${(err as Error).message}).`
    );
  }
}

async function fetchYahooLiveQuote(symbol: string): Promise<MarketQuote> {
  const safeSymbol = sanitizeSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    safeSymbol
  )}?range=1d&interval=1m`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FINGuard/1.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`Yahoo live quote returned ${res.status}`);
    }
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            shortName?: string;
            longName?: string;
            regularMarketPrice?: number;
            previousClose?: number;
            chartPreviousClose?: number;
            regularMarketDayHigh?: number;
            regularMarketDayLow?: number;
            regularMarketVolume?: number;
          };
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
            }>;
          };
        }>;
      };
    };

    const result = json.chart?.result?.[0];
    const meta = result?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!meta || !Number.isFinite(price) || price <= 0) {
      throw new Error('Missing live regularMarketPrice');
    }

    const prevClose = Number(meta.previousClose ?? meta.chartPreviousClose ?? price);
    const change = Number((price - prevClose).toFixed(2));
    const changePct = prevClose > 0 ? Number(((change / prevClose) * 100).toFixed(2)) : 0;
    const opens = result?.indicators?.quote?.[0]?.open || [];
    const firstOpen = opens.find((o): o is number => typeof o === 'number' && Number.isFinite(o) && o > 0);
    const resolvedName = resolveInstrumentName(safeSymbol, meta.shortName || meta.longName);

    return {
      symbol: safeSymbol,
      name: resolvedName,
      price: Number(price.toFixed(2)),
      previousClose: Number(prevClose.toFixed(2)),
      change,
      changePct,
      currency: safeSymbol.startsWith('^') ? 'PTS' : 'INR',
      dataSource: 'LIVE_NSE',
      updatedAt: new Date().toISOString(),
      open: firstOpen ? Number(firstOpen.toFixed(2)) : undefined,
      high:
        typeof meta.regularMarketDayHigh === 'number' && Number.isFinite(meta.regularMarketDayHigh)
          ? Number(meta.regularMarketDayHigh.toFixed(2))
          : undefined,
      low:
        typeof meta.regularMarketDayLow === 'number' && Number.isFinite(meta.regularMarketDayLow)
          ? Number(meta.regularMarketDayLow.toFixed(2))
          : undefined,
      volume:
        typeof meta.regularMarketVolume === 'number' && Number.isFinite(meta.regularMarketVolume)
          ? Math.round(meta.regularMarketVolume)
          : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLiveQuote(symbol: string): Promise<MarketQuote> {
  const safeSymbol = sanitizeSymbol(symbol);
  const now = Date.now();
  const ttl = isNseMarketOpen() ? LIVE_QUOTE_OPEN_TTL_MS : LIVE_QUOTE_CLOSED_TTL_MS;
  const liveCached = liveQuoteCache.get(safeSymbol);
  if (liveCached && now - liveCached.fetchedAt < ttl) {
    return liveCached.quote;
  }

  try {
    const quote = await fetchYahooLiveQuote(safeSymbol);
    liveQuoteCache.set(safeSymbol, { quote, fetchedAt: now });
    return quote;
  } catch {
    if (liveCached && now - liveCached.fetchedAt < QUOTE_TTL_MS) {
      return { ...liveCached.quote, dataSource: 'CACHED' };
    }
    const cached = seriesCache.get(safeSymbol);
    if (cached && now - cached.fetchedAt < QUOTE_TTL_MS) {
      return {
        ...cached.quote,
        dataSource: 'CACHED',
      };
    }
    const { quote } = await getHistoricalSeries(safeSymbol);
    return quote;
  }
}

export async function getMultipleQuotes(symbols: string[]): Promise<MarketQuote[]> {
  const settled = await Promise.allSettled(symbols.map((s) => getLiveQuote(s)));
  return settled
    .filter((r): r is PromiseFulfilledResult<MarketQuote> => r.status === 'fulfilled')
    .map((r) => r.value);
}

const YAHOO_PRICING_ROOT = protobuf.Root.fromJSON({
  nested: {
    PricingData: {
      fields: {
        id: { type: 'string', id: 1 },
        price: { type: 'float', id: 2 },
        time: { type: 'sint64', id: 3 },
        currency: { type: 'string', id: 4 },
        exchange: { type: 'string', id: 5 },
        quoteType: { type: 'int32', id: 6 },
        marketHours: { type: 'int32', id: 7 },
        changePercent: { type: 'float', id: 8 },
        dayVolume: { type: 'sint64', id: 9 },
        dayHigh: { type: 'float', id: 10 },
        dayLow: { type: 'float', id: 11 },
        change: { type: 'float', id: 12 },
        shortName: { type: 'string', id: 13 },
        openPrice: { type: 'float', id: 15 },
        previousClose: { type: 'float', id: 16 },
        lastSize: { type: 'sint64', id: 22 },
      },
    },
  },
});

const YahooPricingType = YAHOO_PRICING_ROOT.lookupType('PricingData');

export function openPublicNseWebSocket(
  symbols: string[],
  onTick: (tick: StreamTickPayload & { dataSource: 'LIVE_NSE' }) => void,
  onStatus: (status: string, detail?: string) => void
): () => void {
  const cleanSymbols = symbols.map((s) => s.trim()).filter(Boolean);
  if (cleanSymbols.length === 0) {
    return () => {};
  }

  let closedByCaller = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const connect = () => {
    if (closedByCaller) return;
    try {
      ws = new WebSocket('wss://streamer.finance.yahoo.com/?version=2');

      ws.on('open', () => {
        if (closedByCaller) {
          ws?.close();
          return;
        }
        onStatus('NSE_LIVE_WS');
        ws?.send(JSON.stringify({ subscribe: cleanSymbols }));

        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ subscribe: cleanSymbols }));
          }
        }, 15000);
      });

      ws.on('message', (raw: WebSocket.RawData) => {
        try {
          const text = raw.toString();
          const parsed = JSON.parse(text) as { type?: string; message?: string };
          if (parsed.type !== 'pricing' || !parsed.message) return;

          const buf = Buffer.from(parsed.message, 'base64');
          const decoded = YahooPricingType.decode(buf);
          const obj = YahooPricingType.toObject(decoded, { longs: Number }) as {
            id?: string;
            price?: number;
            changePercent?: number;
            change?: number;
            dayVolume?: number;
            dayHigh?: number;
            dayLow?: number;
            openPrice?: number;
            previousClose?: number;
          };

          const symbol = obj.id;
          const rawPrice = Number(obj.price);
          if (!symbol || !Number.isFinite(rawPrice) || rawPrice <= 0) return;

          const ltp = Number(rawPrice.toFixed(2));
          const baseline = liveQuoteCache.get(symbol)?.quote;
          const rawChange =
            typeof obj.change === 'number' && Number.isFinite(obj.change)
              ? Number(obj.change.toFixed(2))
              : undefined;
          const prevClose =
            baseline?.previousClose && baseline.previousClose > 0
              ? baseline.previousClose
              : typeof obj.previousClose === 'number' && obj.previousClose > 0
              ? Number(obj.previousClose.toFixed(2))
              : rawChange !== undefined
              ? Number((ltp - rawChange).toFixed(2))
              : ltp;

          const change = rawChange ?? Number((ltp - prevClose).toFixed(2));
          const changePct =
            typeof obj.changePercent === 'number' && Number.isFinite(obj.changePercent)
              ? Number(obj.changePercent.toFixed(2))
              : prevClose > 0
              ? Number(((change / prevClose) * 100).toFixed(2))
              : 0;

          const volume =
            typeof obj.dayVolume === 'number' && Number.isFinite(obj.dayVolume) && obj.dayVolume > 0
              ? Math.round(obj.dayVolume)
              : baseline?.volume;

          const open =
            baseline?.open ??
            (typeof obj.openPrice === 'number' && obj.openPrice > 0
              ? Number(obj.openPrice.toFixed(2))
              : undefined);
          const high =
            typeof obj.dayHigh === 'number' && obj.dayHigh > 0
              ? Math.max(baseline?.high ?? 0, Number(obj.dayHigh.toFixed(2)), ltp)
              : baseline?.high !== undefined
              ? Math.max(baseline.high, ltp)
              : undefined;
          const low =
            typeof obj.dayLow === 'number' && obj.dayLow > 0
              ? Math.min(baseline?.low ?? Number.MAX_SAFE_INTEGER, Number(obj.dayLow.toFixed(2)), ltp)
              : baseline?.low !== undefined
              ? Math.min(baseline.low, ltp)
              : undefined;

          const nowIso = new Date().toISOString();
          liveQuoteCache.set(symbol, {
            fetchedAt: Date.now(),
            quote: {
              symbol,
              name: resolveInstrumentName(symbol, baseline?.name),
              price: ltp,
              previousClose: prevClose,
              change,
              changePct,
              currency: symbol.startsWith('^') ? 'PTS' : 'INR',
              dataSource: 'LIVE_NSE',
              updatedAt: nowIso,
              open,
              high,
              low,
              volume,
            },
          });

          onTick({
            symbol,
            instrumentKey: symbolToInstrumentKey(symbol) || symbol,
            ltp,
            prevClose,
            change,
            changePct,
            volume,
            open,
            high,
            low,
            dataSource: 'LIVE_NSE',
            ts: nowIso,
          });
        } catch {
          // Ignore non-pricing / malformed frames
        }
      });

      ws.on('error', (err) => {
        if (!closedByCaller) {
          onStatus('NSE_LIVE_POLL', err.message);
        }
      });

      ws.on('close', () => {
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (!closedByCaller) {
          reconnectTimer = setTimeout(connect, 2500);
        }
      });
    } catch (err) {
      if (!closedByCaller) {
        onStatus('NSE_LIVE_POLL', (err as Error).message);
        reconnectTimer = setTimeout(connect, 4000);
      }
    }
  };

  connect();

  return () => {
    closedByCaller = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    try {
      ws?.close();
    } catch {
      // ignore
    }
  };
}

export async function getMultipleQuotesWithUpstox(
  symbols: string[],
  upstoxAccessToken?: string
): Promise<MarketQuote[]> {
  if (!upstoxAccessToken) {
    return getMultipleQuotes(symbols);
  }
  try {
    const upstoxQuotes = await fetchUpstoxQuotes(upstoxAccessToken, symbols);
    const bySymbol = new Map(upstoxQuotes.map((q) => [q.symbol, q]));
    const fallbackSymbols = symbols.filter((s) => !bySymbol.has(s));
    const fallbackQuotes = fallbackSymbols.length > 0 ? await getMultipleQuotes(fallbackSymbols) : [];
    const merged = new Map<string, MarketQuote>([
      ...upstoxQuotes.map((q) => [q.symbol, q] as const),
      ...fallbackQuotes.map((q) => [q.symbol, q] as const),
    ]);
    return symbols.map((s) => merged.get(s)).filter((q): q is MarketQuote => Boolean(q));
  } catch {
    return getMultipleQuotes(symbols);
  }
}

export async function getInteractiveChartSeries(
  symbol: string,
  timeframe: ChartTimeframe,
  upstoxAccessToken?: string
): Promise<{ candles: MarketCandle[]; quote: MarketQuote }> {
  const safeSymbol = sanitizeSymbol(symbol);

  if (upstoxAccessToken) {
    try {
      const [candles, quotes] = await Promise.all([
        fetchUpstoxCandles(upstoxAccessToken, safeSymbol, timeframe),
        fetchUpstoxQuotes(upstoxAccessToken, [safeSymbol]),
      ]);
      if (candles.length > 0 && quotes[0]) {
        return { candles, quote: quotes[0] };
      }
    } catch {
      // Fall through to NSE public chart feed if Upstox token expired or symbol unsupported
    }
  }

  if (timeframe !== '3Y') {
    try {
      const { candles, name } = await fetchYahooChart(safeSymbol, timeframe);
      const daily = await getLiveQuote(safeSymbol);
      const latest = candles[candles.length - 1];
      const quote: MarketQuote = {
        ...daily,
        name: daily.name || name,
        open: latest?.open ?? daily.open,
        high: Math.max(...candles.slice(-24).map((c) => c.high)),
        low: Math.min(...candles.slice(-24).map((c) => c.low)),
        volume: latest?.volume ?? daily.volume,
      };
      return { candles, quote };
    } catch {
      // Fall back to 3Y slice below
    }
  }

  const base = await getHistoricalSeries(safeSymbol);
  const sliceCount =
    timeframe === '1D'
      ? 45
      : timeframe === '1W'
      ? 60
      : timeframe === '1M'
      ? 30
      : timeframe === '6M'
      ? 130
      : timeframe === '1Y'
      ? 252
      : base.candles.length;
  return {
    candles: base.candles.slice(-sliceCount),
    quote: base.quote,
  };
}

async function fetchYahooIndianSearch(query: string): Promise<MasterInstrumentItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      query
    )}&quotesCount=20&newsCount=0&region=IN&lang=en-IN`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FINGuard/1.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      quotes?: Array<{
        symbol?: string;
        shortname?: string;
        longname?: string;
        exchange?: string;
        quoteType?: string;
      }>;
    };
    const rows: MasterInstrumentItem[] = [];
    for (const q of json.quotes || []) {
      const sym = (q.symbol || '').trim().toUpperCase();
      if (!sym) continue;
      const isIndian =
        sym.endsWith('.NS') ||
        sym.endsWith('.BO') ||
        sym === '^NSEI' ||
        sym === '^BSESN' ||
        sym === '^NSEBANK' ||
        sym === '^INDIAVIX' ||
        sym.startsWith('^CNX');
      if (!isIndian) continue;
      const name = (q.longname || q.shortname || sym).trim();
      discoveredInstrumentNames.set(sym, name);
      rows.push({
        symbol: sym,
        ticker: sym.replace(/\.(NS|BO)$/, '').replace(/^\^/, ''),
        name,
        assetType: q.quoteType === 'ETF' || sym.includes('BEES') || sym.startsWith('^') ? 'ETF' : 'STOCK_NSE',
        sector: sym.endsWith('.BO') ? 'BSE Equity' : sym.startsWith('^') ? 'Benchmark' : 'NSE Equity',
      });
    }
    return rows;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchIndianStocks(
  query: string,
  upstoxAccessToken?: string
): Promise<MarketQuote[]> {
  const clean = query.trim();
  if (!clean) {
    return getMultipleQuotesWithUpstox(
      NSE_UNIVERSE_CATALOG.map((c) => c.symbol),
      upstoxAccessToken
    );
  }

  const lower = clean.toLowerCase();
  const [masterItems, yahooItems] = await Promise.all([
    loadUpstoxNseMaster(),
    fetchYahooIndianSearch(clean),
  ]);

  const combinedMap = new Map<string, MasterInstrumentItem>();

  for (const c of NSE_UNIVERSE_CATALOG) {
    combinedMap.set(c.symbol, {
      symbol: c.symbol,
      ticker: c.symbol.replace(/\.(NS|BO)$/, '').replace(/^\^/, ''),
      name: c.name,
      assetType: c.assetType,
      sector: c.sector,
    });
  }

  for (const item of yahooItems) {
    combinedMap.set(item.symbol, item);
  }

  for (const item of masterItems) {
    if (!combinedMap.has(item.symbol)) {
      combinedMap.set(item.symbol, item);
    }
  }

  const scored: Array<{ item: MasterInstrumentItem; score: number }> = [];
  for (const item of combinedMap.values()) {
    const tickerLower = item.ticker.toLowerCase();
    const symLower = item.symbol.toLowerCase();
    const nameLower = item.name.toLowerCase();
    let score = 0;

    if (tickerLower === lower || symLower === lower) score = 100;
    else if (tickerLower.startsWith(lower)) score = 80;
    else if (nameLower.startsWith(lower)) score = 65;
    else if (tickerLower.includes(lower)) score = 50;
    else if (nameLower.includes(lower)) score = 35;

    if (score > 0) {
      if (item.symbol.endsWith('.NS')) score += 5;
      else if (item.symbol.startsWith('^')) score += 4;
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.item.ticker.localeCompare(b.item.ticker));
  const topSymbols = scored.slice(0, 12).map((s) => s.item.symbol);
  if (topSymbols.length === 0) return [];

  return getMultipleQuotesWithUpstox(topSymbols, upstoxAccessToken);
}

export async function searchMutualFunds(query: string): Promise<MutualFundSearchItem[]> {
  const q = query.trim().toLowerCase();
  if (!q) {
    return POPULAR_INDIAN_MFS.map((m) => ({
      schemeCode: m.schemeCode,
      schemeName: m.schemeName,
    }));
  }

  const now = Date.now();
  if (!mfListCache || now - mfListCache.fetchedAt > OHLCV_TTL_MS) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('https://api.mfapi.in/mf', { signal: controller.signal });
      clearTimeout(t);
      if (res.ok) {
        const all = (await res.json()) as MutualFundSearchItem[];
        if (Array.isArray(all) && all.length > 0) {
          mfListCache = { items: all, fetchedAt: now };
        }
      }
    } catch {
      // Fall back to curated popular Indian MF list below
    }
  }

  const sourceList =
    mfListCache?.items ||
    POPULAR_INDIAN_MFS.map((m) => ({ schemeCode: m.schemeCode, schemeName: m.schemeName }));

  const matches = sourceList.filter((m) => m.schemeName.toLowerCase().includes(q));
  return matches.slice(0, 20);
}

export async function getMutualFundNavHistory(schemeCode: number): Promise<CachedMfScheme> {
  if (!Number.isInteger(schemeCode) || schemeCode <= 0) {
    throw new Error('Invalid Mutual Fund scheme code');
  }
  const cached = mfSchemeCache.get(schemeCode);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < OHLCV_TTL_MS) {
    return cached;
  }

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6500);
    const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}`, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`mfapi returned ${res.status}`);
    const payload = (await res.json()) as {
      meta?: { scheme_name?: string; scheme_category?: string };
      data?: Array<{ date: string; nav: string }>;
    };
    const rawData = payload.data || [];
    if (rawData.length < 30) throw new Error('Insufficient MF NAV points');

    // mfapi returns newest first; reverse and take last 300 points
    const parsed = rawData
      .slice(0, 300)
      .reverse()
      .map((d) => ({
        date: d.date,
        nav: Number.parseFloat(d.nav),
      }))
      .filter((d) => Number.isFinite(d.nav) && d.nav > 0);

    const result: CachedMfScheme = {
      schemeCode,
      schemeName: payload.meta?.scheme_name || `MF Scheme ${schemeCode}`,
      category: payload.meta?.scheme_category || 'Equity',
      navs: parsed,
      fetchedAt: now,
      source: 'LIVE_MFAPI',
    };
    mfSchemeCache.set(schemeCode, result);
    return result;
  } catch (err) {
    if (cached) {
      return cached;
    }
    throw new Error(
      `Live AMFI mfapi.in NAV feed unavailable for scheme ${schemeCode} (${(err as Error).message}).`
    );
  }
}
