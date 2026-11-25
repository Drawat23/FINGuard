import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CandlestickChart,
  Check,
  Copy,
  Layers,
  Link2,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  Unlink,
  X,
} from 'lucide-react';
import type {
  MarketCandle,
  MarketQuote,
  OrderRecord,
  UpstoxConnectionStatus,
} from '../../shared/types.ts';
import { apiFetch, formatCompactInr, formatInr, getAccessToken } from '../lib/api.ts';
import { syncTradeLotToFirestore } from '../lib/firebase.ts';
import { BottomSheet } from './BottomSheet.tsx';
import { MATERIAL_EASE } from './MotionPrimitives.tsx';
import { PinLockModal } from './PinLockModal.tsx';

type ChartTimeframe = '1D' | '1W' | '1M' | '6M' | '1Y' | '3Y';
type WatchlistCategory = 'ALL' | 'STOCKS' | 'ETFS' | 'INDICES';
type DockTab = 'TRADE' | 'WATCHLIST' | 'DEPTH';

interface MarketsTabProps {
  initialQuotes: MarketQuote[];
  theme: 'dark' | 'light';
  cashInr: number;
  initialSymbol?: string | null;
  onClearInitialSymbol?: () => void;
  onOrderExecuted: () => Promise<void>;
  onLogTrade?: (symbol: string) => void;
}

const STREAM_SYMBOLS = [
  '^NSEI',
  '^BSESN',
  '^NSEBANK',
  '^INDIAVIX',
  'JIOFIN.NS',
  'RELIANCE.NS',
  'TCS.NS',
  'HDFCBANK.NS',
  'INFY.NS',
  'ICICIBANK.NS',
  'SBIN.NS',
  'TATAMOTORS.NS',
  'SUNPHARMA.NS',
  'BHARTIARTL.NS',
  'LT.NS',
  'ITC.NS',
  'ETERNAL.NS',
  'HAL.NS',
  'BEL.NS',
  'TRENT.NS',
  'SUZLON.NS',
  'ADANIENT.NS',
  'NIFTYBEES.NS',
  'GOLDBEES.NS',
  'LIQUIDBEES.NS',
];

const INDEX_STRIP_SYMBOLS = ['^NSEI', '^BSESN', '^NSEBANK'];
const QUICK_QTYS = [1, 5, 10, 25, 50];

function formatDisplayTicker(symbol: string): string {
  if (symbol === '^NSEI') return 'NIFTY 50';
  if (symbol === '^BSESN') return 'SENSEX';
  if (symbol === '^NSEBANK') return 'BANK NIFTY';
  if (symbol === '^INDIAVIX') return 'INDIA VIX';
  return symbol.replace(/\.(NS|BO)$/i, '');
}

function getSymbolMonogram(symbol: string): string {
  if (symbol === '^NSEI') return 'N50';
  if (symbol === '^BSESN') return 'BSX';
  if (symbol === '^NSEBANK') return 'BNK';
  if (symbol === '^INDIAVIX') return 'VIX';
  return symbol.replace(/\.(NS|BO)$/i, '').slice(0, 2);
}

function getSymbolCategory(symbol: string): Exclude<WatchlistCategory, 'ALL'> {
  if (symbol.startsWith('^')) return 'INDICES';
  if (symbol.includes('BEES')) return 'ETFS';
  return 'STOCKS';
}

function formatCompactVolume(vol: number | undefined): string {
  if (!vol || !Number.isFinite(vol)) return '—';
  if (vol >= 1e7) return `${(vol / 1e7).toFixed(2)}Cr`;
  if (vol >= 1e5) return `${(vol / 1e5).toFixed(2)}L`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
  return vol.toLocaleString('en-IN');
}

function computeSma(candles: MarketCandle[], period: number): Array<{ time: Time; value: number }> {
  const res: Array<{ time: Time; value: number }> = [];
  if (candles.length < period) return res;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) {
      res.push({
        time: toChartTime(candles[i].date),
        value: Number((sum / period).toFixed(2)),
      });
    }
  }
  return deduplicateTimedPoints(res);
}

function computeEma(candles: MarketCandle[], period: number): Array<{ time: Time; value: number }> {
  const res: Array<{ time: Time; value: number }> = [];
  if (candles.length < period) return res;
  const k = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  res.push({ time: toChartTime(candles[period - 1].date), value: Number(ema.toFixed(2)) });
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    res.push({ time: toChartTime(candles[i].date), value: Number(ema.toFixed(2)) });
  }
  return deduplicateTimedPoints(res);
}

function toChartTime(dateStr: string): Time {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr as Time;
  }
  const sec = Math.floor(new Date(dateStr).getTime() / 1000);
  return (sec + 19800) as UTCTimestamp;
}

function timeSortKey(t: Time): number {
  if (typeof t === 'number') return t;
  if (typeof t === 'string') return Math.floor(new Date(t).getTime() / 1000);
  return 0;
}

function deduplicateTimedPoints<T extends { time: Time }>(items: T[]): T[] {
  const map = new Map<string | number, T>();
  for (const item of items) {
    map.set(typeof item.time === 'object' ? JSON.stringify(item.time) : item.time, item);
  }
  return Array.from(map.values()).sort((a, b) => timeSortKey(a.time) - timeSortKey(b.time));
}

export const MarketsTab: React.FC<MarketsTabProps> = ({
  initialQuotes,
  theme,
  cashInr,
  initialSymbol,
  onClearInitialSymbol,
  onOrderExecuted,
  onLogTrade,
}) => {
  const [quotesMap, setQuotesMap] = useState<Record<string, MarketQuote>>(() => {
    const m: Record<string, MarketQuote> = {};
    for (const q of initialQuotes) m[q.symbol] = q;
    return m;
  });
  const [flashMap, setFlashMap] = useState<Record<string, 'UP' | 'DOWN' | null>>({});
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>(STREAM_SYMBOLS);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('RELIANCE.NS');
  const [searchQuery, setSearchQuery] = useState('');
  const [remoteSearchResults, setRemoteSearchResults] = useState<MarketQuote[]>([]);
  const [searchingRemote, setSearchingRemote] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<WatchlistCategory>('ALL');
  const [dockTab, setDockTab] = useState<DockTab>('TRADE');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dockScrollPct, setDockScrollPct] = useState(0);
  const [dockScrollable, setDockScrollable] = useState(false);
  const dockScrollRef = useRef<HTMLDivElement>(null);

  // Interactive Popovers & Sheets
  const [brokerSheetOpen, setBrokerSheetOpen] = useState(false);
  const [symbolDrawerOpen, setSymbolDrawerOpen] = useState(false);
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const indicatorsRef = useRef<HTMLDivElement>(null);
  const chartCardRef = useRef<HTMLDivElement>(null);

  // Upstox Connection State
  const [upstoxStatus, setUpstoxStatus] = useState<UpstoxConnectionStatus | null>(null);
  const [connectingUpstox, setConnectingUpstox] = useState(false);
  const [upstoxError, setUpstoxError] = useState<string | null>(null);
  const [upstoxFallbackUrl, setUpstoxFallbackUrl] = useState<string | null>(null);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  // Market Session Status
  const [marketOpen, setMarketOpen] = useState<boolean>(false);

  // Interactive Chart State
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1M');
  const [chartType, setChartType] = useState<'CANDLES' | 'AREA'>('CANDLES');
  const [showEma20, setShowEma20] = useState(true);
  const [showSma50, setShowSma50] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [candles, setCandles] = useState<MarketCandle[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [hoverCandle, setHoverCandle] = useState<MarketCandle | null>(null);

  // Live Upstox Order Panel State
  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderQty, setOrderQty] = useState('5');
  const [pinOpen, setPinOpen] = useState(false);
  const [orderFeedback, setOrderFeedback] = useState<string | null>(null);

  // Lightweight Charts Refs
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const candlesRef = useRef<MarketCandle[]>([]);
  const selectedSymbolRef = useRef<string>(selectedSymbol);
  const chartTypeRef = useRef<'CANDLES' | 'AREA'>(chartType);

  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);

  useEffect(() => {
    chartTypeRef.current = chartType;
  }, [chartType]);

  useEffect(() => {
    if (initialSymbol) {
      setSelectedSymbol(initialSymbol);
      setWatchlistSymbols((prev) => (prev.includes(initialSymbol) ? prev : [initialSymbol, ...prev]));
      onClearInitialSymbol?.();
    }
  }, [initialSymbol, onClearInitialSymbol]);

  const handleSelectInstrument = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    setWatchlistSymbols((prev) => (prev.includes(symbol) ? prev : [symbol, ...prev]));
  }, []);

  // Debounced Full Indian Stock Search across Upstox NSE Master + Yahoo IN (BSE/NSE)
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setRemoteSearchResults([]);
      setSearchingRemote(false);
      return;
    }

    let cancelled = false;
    setSearchingRemote(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch<{ quotes: MarketQuote[] }>(
          `/api/market/search?q=${encodeURIComponent(q)}`
        );
        if (cancelled) return;
        const found = res.quotes || [];
        setRemoteSearchResults(found);
        if (found.length > 0) {
          setQuotesMap((prev) => {
            const next = { ...prev };
            for (const item of found) next[item.symbol] = item;
            return next;
          });
        }
      } catch {
        if (!cancelled) setRemoteSearchResults([]);
      } finally {
        if (!cancelled) setSearchingRemote(false);
      }
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // Close Indicators popover on outside click
  useEffect(() => {
    if (!indicatorsOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (indicatorsRef.current && !indicatorsRef.current.contains(e.target as Node)) {
        setIndicatorsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [indicatorsOpen]);

  // Cmd/Ctrl + K opens Command Symbol Switcher; Esc exits chart fullscreen
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSymbolDrawerOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(async () => {
    const next = !isFullscreen;
    setIsFullscreen(next);
    try {
      if (next && chartCardRef.current?.requestFullscreen && !document.fullscreenElement) {
        await chartCardRef.current.requestFullscreen();
      } else if (!next && document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Fixed viewport fullscreen fallback handles iframe environments cleanly
    }
  }, [isFullscreen]);

  useEffect(() => {
    const timer = setTimeout(() => {
      chartRef.current?.timeScale().fitContent();
    }, 60);
    return () => clearTimeout(timer);
  }, [isFullscreen]);

  const updateDockScroll = useCallback(() => {
    const el = dockScrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    setDockScrollable(maxScroll > 6);
    setDockScrollPct(maxScroll > 6 ? Math.min(100, Math.max(0, (el.scrollTop / maxScroll) * 100)) : 0);
  }, []);

  useEffect(() => {
    const timer = setTimeout(updateDockScroll, 40);
    window.addEventListener('resize', updateDockScroll);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateDockScroll);
    };
  }, [dockTab, searchQuery, categoryFilter, updateDockScroll]);

  const loadUpstoxStatus = useCallback(async () => {
    try {
      const res = await apiFetch<UpstoxConnectionStatus>('/api/upstox/status');
      setUpstoxStatus(res);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadUpstoxStatus();
  }, [loadUpstoxStatus]);

  useEffect(() => {
    const handleMsg = (event: MessageEvent) => {
      if (
        !event.origin.endsWith('.run.app') &&
        !event.origin.includes('localhost') &&
        !event.origin.includes('127.0.0.1')
      ) {
        return;
      }
      if (event.data?.type === 'UPSTOX_AUTH_SUCCESS') {
        setUpstoxError(null);
        setUpstoxFallbackUrl(null);
        setBrokerSheetOpen(false);
        void loadUpstoxStatus();
      }
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, [loadUpstoxStatus]);

  const handleConnectUpstox = async () => {
    setConnectingUpstox(true);
    setUpstoxError(null);
    setUpstoxFallbackUrl(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/api/upstox/auth-url');
      const popup = window.open(url, 'upstox_oauth_popup', 'width=600,height=720');
      if (!popup) {
        setUpstoxFallbackUrl(url);
        setUpstoxError('Popup blocked by browser. Use the direct authorization link below.');
        setBrokerSheetOpen(true);
      }
    } catch (err) {
      setUpstoxError((err as Error).message);
      setBrokerSheetOpen(true);
    } finally {
      setConnectingUpstox(false);
    }
  };

  const handleDisconnectUpstox = async () => {
    try {
      await apiFetch('/api/upstox/disconnect', { method: 'POST', body: JSON.stringify({}) });
      await loadUpstoxStatus();
    } catch {
      // ignore
    }
  };

  const streamSymbols = useMemo(() => {
    const merged = new Set<string>([
      ...INDEX_STRIP_SYMBOLS,
      selectedSymbol,
      ...watchlistSymbols,
    ]);
    return Array.from(merged).slice(0, 35);
  }, [selectedSymbol, watchlistSymbols]);
  const streamSymbolsKey = streamSymbols.join(',');

  // Real-Time SSE Market Stream
  useEffect(() => {
    const token = getAccessToken();
    const qs = new URLSearchParams({
      symbols: streamSymbolsKey,
      ...(token ? { token } : {}),
    });
    const es = new EventSource(`/api/market/stream?${qs.toString()}`);

    es.addEventListener('status', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          marketOpen?: boolean;
        };
        if (typeof data.marketOpen === 'boolean') setMarketOpen(data.marketOpen);
      } catch {
        // ignore
      }
    });

    es.addEventListener('snapshot', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          quotes: MarketQuote[];
          marketOpen?: boolean;
        };
        if (typeof data.marketOpen === 'boolean') setMarketOpen(data.marketOpen);
        const flashes: Record<string, 'UP' | 'DOWN'> = {};
        setQuotesMap((prev) => {
          const next = { ...prev };
          for (const q of data.quotes || []) {
            const oldPrice = prev[q.symbol]?.price;
            if (oldPrice !== undefined && q.price !== oldPrice) {
              flashes[q.symbol] = q.price > oldPrice ? 'UP' : 'DOWN';
            }
            next[q.symbol] = q;
          }
          return next;
        });

        if (Object.keys(flashes).length > 0) {
          setFlashMap((prev) => ({ ...prev, ...flashes }));
          setTimeout(() => {
            setFlashMap((prev) => {
              const cleared = { ...prev };
              for (const k of Object.keys(flashes)) cleared[k] = null;
              return cleared;
            });
          }, 420);
        }

        const activeQuoteSnap = (data.quotes || []).find(
          (q) => q.symbol === selectedSymbolRef.current
        );
        if (activeQuoteSnap && mainSeriesRef.current && candlesRef.current.length > 0) {
          const last = candlesRef.current[candlesRef.current.length - 1];
          if (last.close !== activeQuoteSnap.price) {
            const updated: MarketCandle = {
              ...last,
              close: activeQuoteSnap.price,
              high: Math.max(last.high, activeQuoteSnap.price),
              low: Math.min(last.low, activeQuoteSnap.price),
              volume: activeQuoteSnap.volume ?? last.volume,
            };
            candlesRef.current[candlesRef.current.length - 1] = updated;
            const time = toChartTime(updated.date);
            if (chartTypeRef.current === 'CANDLES') {
              (mainSeriesRef.current as ISeriesApi<'Candlestick'>).update({
                time,
                open: updated.open,
                high: updated.high,
                low: updated.low,
                close: updated.close,
              });
            } else {
              (mainSeriesRef.current as ISeriesApi<'Area'>).update({
                time,
                value: updated.close,
              });
            }
          }
        }
      } catch {
        // ignore
      }
    });

    es.addEventListener('tick', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          ticks: Array<{
            symbol: string;
            ltp: number;
            prevClose: number;
            change: number;
            changePct: number;
            volume?: number;
            open?: number;
            high?: number;
            low?: number;
            depth?: MarketQuote['depth'];
            dataSource?: MarketQuote['dataSource'];
            ts: string;
          }>;
          marketOpen?: boolean;
          source?: string;
        };
        if (typeof data.marketOpen === 'boolean') setMarketOpen(data.marketOpen);

        const flashes: Record<string, 'UP' | 'DOWN'> = {};
        setQuotesMap((prev) => {
          const next = { ...prev };
          for (const t of data.ticks || []) {
            const oldPrice = prev[t.symbol]?.price;
            if (oldPrice !== undefined && t.ltp !== oldPrice) {
              flashes[t.symbol] = t.ltp > oldPrice ? 'UP' : 'DOWN';
            }
            next[t.symbol] = {
              ...(prev[t.symbol] || {
                symbol: t.symbol,
                name: t.symbol.replace('.NS', ''),
                currency: t.symbol.startsWith('^') ? 'PTS' : 'INR',
              }),
              price: t.ltp,
              previousClose: t.prevClose,
              change: t.change,
              changePct: t.changePct,
              volume: t.volume ?? prev[t.symbol]?.volume,
              open: t.open ?? prev[t.symbol]?.open,
              high: t.high ?? prev[t.symbol]?.high,
              low: t.low ?? prev[t.symbol]?.low,
              depth: t.depth ?? prev[t.symbol]?.depth,
              dataSource: t.dataSource || 'UPSTOX_LIVE',
              updatedAt: t.ts,
            };
          }
          return next;
        });

        if (Object.keys(flashes).length > 0) {
          setFlashMap((prev) => ({ ...prev, ...flashes }));
          setTimeout(() => {
            setFlashMap((prev) => {
              const cleared = { ...prev };
              for (const k of Object.keys(flashes)) cleared[k] = null;
              return cleared;
            });
          }, 420);
        }

        const activeTick = (data.ticks || []).find((t) => t.symbol === selectedSymbolRef.current);
        if (activeTick && mainSeriesRef.current && candlesRef.current.length > 0) {
          const last = candlesRef.current[candlesRef.current.length - 1];
          const updated: MarketCandle = {
            ...last,
            close: activeTick.ltp,
            high: Math.max(last.high, activeTick.ltp),
            low: Math.min(last.low, activeTick.ltp),
            volume: activeTick.volume ?? last.volume,
          };
          candlesRef.current[candlesRef.current.length - 1] = updated;
          const time = toChartTime(updated.date);
          if (chartTypeRef.current === 'CANDLES') {
            (mainSeriesRef.current as ISeriesApi<'Candlestick'>).update({
              time,
              open: updated.open,
              high: updated.high,
              low: updated.low,
              close: updated.close,
            });
          } else {
            (mainSeriesRef.current as ISeriesApi<'Area'>).update({
              time,
              value: updated.close,
            });
          }
        }
      } catch {
        // ignore
      }
    });

    return () => {
      es.close();
    };
  }, [upstoxStatus?.connected, streamSymbolsKey]);

  // Fetch Candles
  const fetchChart = useCallback(async () => {
    setChartLoading(true);
    setChartError(null);
    try {
      const res = await apiFetch<{
        candles: MarketCandle[];
        quote: MarketQuote;
        marketOpen: boolean;
      }>(`/api/market/chart?symbol=${encodeURIComponent(selectedSymbol)}&timeframe=${timeframe}`);
      candlesRef.current = res.candles;
      setCandles(res.candles);
      setMarketOpen(res.marketOpen);
      setHoverCandle(res.candles[res.candles.length - 1] || null);
      if (res.quote) {
        setQuotesMap((prev) => ({ ...prev, [res.quote.symbol]: res.quote }));
      }
    } catch (err) {
      setChartError((err as Error).message || 'Live NSE chart feed unavailable.');
    } finally {
      setChartLoading(false);
    }
  }, [selectedSymbol, timeframe, upstoxStatus?.connected]);

  useEffect(() => {
    void fetchChart();
  }, [fetchChart]);

  const activeQuote = quotesMap[selectedSymbol];
  const isIndex = selectedSymbol.startsWith('^');
  const activeUp = (activeQuote?.changePct ?? 0) >= 0;
  const activeUpRef = useRef<boolean>(activeUp);
  activeUpRef.current = activeUp;

  // Build & Update TradingView Lightweight-Charts Instance
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const isDark = theme === 'dark';
    const isUp = activeUpRef.current;
    const accentHex = isUp ? '#FFB020' : '#FF4D6D';
    const accentTop = isUp ? 'rgba(255, 176, 32, 0.24)' : 'rgba(255, 77, 109, 0.22)';
    const accentBot = isUp ? 'rgba(255, 176, 32, 0.0)' : 'rgba(255, 77, 109, 0.0)';

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: isDark ? '#94A3B8' : '#64748B',
        fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(255,255,255,0.035)' : 'rgba(15,23,42,0.045)' },
        horzLines: { color: isDark ? 'rgba(255,255,255,0.045)' : 'rgba(15,23,42,0.055)' },
      },
      crosshair: {
        mode: 0,
        vertLine: {
          color: isDark ? 'rgba(255,255,255,0.28)' : 'rgba(15,23,42,0.28)',
          width: 1,
          style: 2,
          labelBackgroundColor: isDark ? '#1E2638' : '#0F172A',
        },
        horzLine: {
          color: isDark ? 'rgba(255,255,255,0.28)' : 'rgba(15,23,42,0.28)',
          width: 1,
          style: 2,
          labelBackgroundColor: isDark ? '#1E2638' : '#0F172A',
        },
      },
      rightPriceScale: {
        borderVisible: true,
        borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
        scaleMargins: {
          top: 0.1,
          bottom: showVolume ? 0.22 : 0.08,
        },
      },
      timeScale: {
        borderVisible: true,
        borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
        timeVisible: timeframe === '1D' || timeframe === '1W',
        secondsVisible: false,
        rightOffset: 4,
      },
      handleScroll: true,
      handleScale: true,
    });

    chartRef.current = chart;

    let mainSeries: ISeriesApi<'Candlestick'> | ISeriesApi<'Area'>;
    if (chartType === 'CANDLES') {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#26A69A',
        downColor: '#EF5350',
        borderVisible: false,
        wickUpColor: '#26A69A',
        wickDownColor: '#EF5350',
        priceLineVisible: true,
        lastValueVisible: true,
      });
    } else {
      mainSeries = chart.addSeries(AreaSeries, {
        lineColor: accentHex,
        topColor: accentTop,
        bottomColor: accentBot,
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
      });
    }
    mainSeriesRef.current = mainSeries;

    const dedupedCandles = deduplicateTimedPoints(
      candles.map((c) => ({ ...c, time: toChartTime(c.date) }))
    );

    if (chartType === 'CANDLES') {
      (mainSeries as ISeriesApi<'Candlestick'>).setData(
        dedupedCandles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
    } else {
      (mainSeries as ISeriesApi<'Area'>).setData(
        dedupedCandles.map((c) => ({
          time: c.time,
          value: c.close,
        }))
      );
    }

    if (showVolume) {
      const volSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volSeries.setData(
        dedupedCandles.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(38, 166, 154, 0.34)' : 'rgba(239, 83, 80, 0.34)',
        }))
      );
      volumeSeriesRef.current = volSeries;
    }

    if (showEma20 && candles.length >= 20) {
      const emaSeries = chart.addSeries(LineSeries, {
        color: '#FFB020',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      emaSeries.setData(computeEma(candles, 20));
    }

    if (showSma50 && candles.length >= 50) {
      const smaSeries = chart.addSeries(LineSeries, {
        color: '#38BDF8',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      smaSeries.setData(computeSma(candles, 50));
    }

    chart.timeScale().fitContent();

    const byTime = new Map<string | number, MarketCandle>();
    for (const c of dedupedCandles) {
      byTime.set(typeof c.time === 'object' ? JSON.stringify(c.time) : c.time, c);
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHoverCandle(candles[candles.length - 1] || null);
        return;
      }
      const key = typeof param.time === 'object' ? JSON.stringify(param.time) : param.time;
      const found = byTime.get(key);
      if (found) setHoverCandle(found);
    });

    const observer = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [candles, chartType, showEma20, showSma50, showVolume, theme, timeframe]);

  const allQuotes = useMemo(
    () =>
      watchlistSymbols
        .map((sym) => quotesMap[sym])
        .filter((item): item is MarketQuote => Boolean(item)),
    [quotesMap, watchlistSymbols]
  );

  const filteredQuotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const localMatches = allQuotes.filter((item) => {
      const catMatch =
        categoryFilter === 'ALL' || getSymbolCategory(item.symbol) === categoryFilter;
      const textMatch =
        !q ||
        item.symbol.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        formatDisplayTicker(item.symbol).toLowerCase().includes(q);
      return catMatch && textMatch;
    });

    if (q.length < 2 || remoteSearchResults.length === 0) {
      return localMatches;
    }

    const mergedMap = new Map<string, MarketQuote>();
    for (const item of remoteSearchResults) {
      if (categoryFilter === 'ALL' || getSymbolCategory(item.symbol) === categoryFilter) {
        mergedMap.set(item.symbol, item);
      }
    }
    for (const item of localMatches) {
      if (!mergedMap.has(item.symbol)) {
        mergedMap.set(item.symbol, item);
      }
    }
    return Array.from(mergedMap.values());
  }, [allQuotes, categoryFilter, remoteSearchResults, searchQuery]);

  // Session Range Calculation
  const latestCandle = candles[candles.length - 1];
  const dayOpen = activeQuote?.open ?? latestCandle?.open;
  const dayHigh = activeQuote?.high ?? latestCandle?.high;
  const dayLow = activeQuote?.low ?? latestCandle?.low;
  const dayVolume = activeQuote?.volume ?? latestCandle?.volume;
  const prevClose = activeQuote?.previousClose;
  const ltp = activeQuote?.price ?? latestCandle?.close ?? 0;

  const rangePositionPct = useMemo(() => {
    if (dayLow === undefined || dayHigh === undefined || dayHigh <= dayLow || !ltp) return 50;
    return Math.min(100, Math.max(0, ((ltp - dayLow) / (dayHigh - dayLow)) * 100));
  }, [dayHigh, dayLow, ltp]);

  // Order Calculations
  const parsedQty = Math.max(0, Math.floor(Number(orderQty) || 0));
  const estOrderValue = activeQuote && !isIndex ? parsedQty * activeQuote.price : 0;
  const maxBuyShares =
    activeQuote && !isIndex && activeQuote.price > 0
      ? Math.max(0, Math.floor(cashInr / activeQuote.price))
      : 0;
  const insufficientFunds = orderSide === 'BUY' && !isIndex && estOrderValue > cashInr;
  const cashUsagePct =
    cashInr > 0 ? Math.min(100, Math.round((estOrderValue / cashInr) * 100)) : 0;

  // Depth Ladder Calculations
  const hasDepth = Boolean(
    activeQuote?.depth &&
      (activeQuote.depth.buy.length > 0 || activeQuote.depth.sell.length > 0)
  );
  const maxDepthQty = useMemo(() => {
    if (!activeQuote?.depth) return 1;
    const all = [...activeQuote.depth.buy, ...activeQuote.depth.sell].map((l) => l.quantity || 0);
    return Math.max(1, ...all);
  }, [activeQuote?.depth]);

  const totalBuy = activeQuote?.totalBuyQty || 0;
  const totalSell = activeQuote?.totalSellQty || 0;
  const buyPressurePct =
    totalBuy + totalSell > 0 ? Math.round((totalBuy / (totalBuy + totalSell)) * 100) : 50;

  const activeIndicatorsCount = Number(showEma20) + Number(showSma50) + Number(showVolume);

  const handleConfirmQuickOrder = async (pin: string) => {
    const res = await apiFetch<{ order: OrderRecord; brokerOrderId?: string }>('/api/orders', {
      method: 'POST',
      idempotent: true,
      body: JSON.stringify({
        symbol: selectedSymbol,
        side: orderSide,
        qty: parsedQty,
        pin,
      }),
    });
    setPinOpen(false);
    setOrderFeedback(
      `Upstox ${res.order.side} ${res.order.qty} ${res.order.symbol.replace('.NS', '')} routed @ ${formatInr(
        res.order.executionPrice,
        true
      )}${res.brokerOrderId ? ` (Order #${res.brokerOrderId})` : ''}`
    );
    void syncTradeLotToFirestore({
      id: res.order.id,
      symbol: res.order.symbol,
      name: res.order.name || res.order.symbol.replace('.NS', ''),
      assetType: res.order.assetType || 'STOCK_NSE',
      side: res.order.side,
      quantity: res.order.qty,
      priceInr: res.order.executionPrice,
      tradeDate: res.order.tradeDate || new Date().toISOString().slice(0, 10),
      source: 'UPSTOX_LIVE',
      brokerOrderId: res.brokerOrderId,
    }).catch(() => {});
    await onOrderExecuted();
  };

  const handleCopyRedirect = () => {
    if (!upstoxStatus?.redirectUri) return;
    void navigator.clipboard.writeText(upstoxStatus.redirectUri);
    setCopiedRedirect(true);
    setTimeout(() => setCopiedRedirect(false), 1800);
  };

  const renderSymbolPickerList = (onSelectClose?: () => void, compact = false) => (
    <div className="space-y-3 min-w-0">
      <div className={`flex flex-col gap-2 ${compact ? '' : 'sm:flex-row sm:items-center'}`}>
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search any NSE/BSE stock (Jio, Tata, Zomato...)"
            className="w-full min-h-[38px] pl-9 pr-8 rounded-2xl bg-slate-100/90 dark:bg-white/[0.04] border border-slate-200/70 dark:border-white/[0.08] text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#FFB020] transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div
          className={`p-1 rounded-2xl bg-slate-100 dark:bg-white/[0.04] shrink-0 ${
            compact ? 'grid grid-cols-4 gap-1 w-full' : 'flex items-center gap-1'
          }`}
        >
          {(
            [
              { id: 'ALL', label: 'All' },
              { id: 'STOCKS', label: 'Stocks' },
              { id: 'ETFS', label: 'ETFs' },
              { id: 'INDICES', label: 'Indices' },
            ] as const
          ).map((tab) => {
            const active = categoryFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategoryFilter(tab.id)}
                className={`px-2 py-1.5 rounded-xl text-[11px] font-medium transition-colors whitespace-nowrap text-center ${
                  active
                    ? 'bg-white dark:bg-[#171D2C] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {searchingRemote && (
        <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-slate-500 dark:text-slate-400">
          <RefreshCw className="w-3 h-3 animate-spin text-[#FFB020]" />
          <span>Searching all NSE &amp; BSE listings...</span>
        </div>
      )}

      {filteredQuotes.length === 0 && !searchingRemote ? (
        <div className="py-10 text-center space-y-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No NSE/BSE stocks matched &ldquo;{searchQuery}&rdquo;
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setCategoryFilter('ALL');
            }}
            className="text-xs font-semibold text-[#D97706] dark:text-[#FFB020] hover:underline"
          >
            Reset search &amp; filters
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-white/[0.05]">
          {filteredQuotes.map((q) => {
            const active = q.symbol === selectedSymbol;
            const up = q.changePct >= 0;
            const flash = flashMap[q.symbol];
            return (
              <button
                key={q.symbol}
                type="button"
                onClick={() => {
                  handleSelectInstrument(q.symbol);
                  onSelectClose?.();
                }}
                className={`w-full min-w-0 ${
                  compact ? 'py-2.5 px-2 gap-2.5' : 'py-3 px-3 gap-4'
                } rounded-xl text-left flex items-center justify-between transition-all duration-150 ${
                  active
                    ? 'bg-[#FFB020]/[0.09] dark:bg-[#FFB020]/[0.12]'
                    : flash === 'UP'
                    ? 'bg-emerald-500/10'
                    : flash === 'DOWN'
                    ? 'bg-[#FF4D6D]/10'
                    : 'hover:bg-slate-100/80 dark:hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span
                    className={`${
                      compact ? 'w-8 h-8 rounded-xl text-[11px]' : 'w-9 h-9 rounded-2xl text-xs'
                    } font-display font-bold flex items-center justify-center shrink-0 transition-colors ${
                      active
                        ? 'bg-[#FFB020] text-[#1C1000]'
                        : 'bg-slate-100 dark:bg-white/[0.06] text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {getSymbolMonogram(q.symbol)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {formatDisplayTicker(q.symbol)}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {q.name}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 tabular-nums">
                  {!compact && q.volume ? (
                    <span className="hidden sm:inline text-xs text-slate-400">
                      Vol {formatCompactVolume(q.volume)}
                    </span>
                  ) : null}
                  <div className="text-right">
                    <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white">
                      {q.symbol.startsWith('^')
                        ? q.price.toLocaleString('en-IN')
                        : formatInr(q.price, true)}
                    </p>
                    <p
                      className={`text-[11px] font-medium ${
                        up
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-[#E11D48] dark:text-[#FF4D6D]'
                      }`}
                    >
                      {up ? '+' : ''}
                      {q.changePct.toFixed(2)}%
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const displayCandle = hoverCandle || latestCandle || null;
  const candleUp = displayCandle ? displayCandle.close >= displayCandle.open : activeUp;
  const candleDelta = displayCandle ? displayCandle.close - displayCandle.open : 0;
  const candleDeltaPct =
    displayCandle && displayCandle.open > 0 ? (candleDelta / displayCandle.open) * 100 : 0;

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-5.25rem)] min-w-0">
      {/* 1. Compact Top Ticker Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setSymbolDrawerOpen(true)}
            className="min-h-[38px] px-3.5 py-1.5 rounded-2xl m3-card hover:border-[#FFB020]/40 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 transition-all active:scale-[0.99] shrink-0"
          >
            <Search className="w-3.5 h-3.5 text-[#FFB020]" />
            <span className="font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
              Search any NSE/BSE stock
            </span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.06] text-[10px] font-mono text-slate-500 dark:text-slate-400">
              ⌘K
            </kbd>
          </button>

          {/* 3 Important Indian Benchmark Indexes Right Beside Search */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 min-w-0">
            {INDEX_STRIP_SYMBOLS.map((sym) => {
              const q = quotesMap[sym];
              if (!q) return null;
              const up = q.changePct >= 0;
              const active = sym === selectedSymbol;
              const flash = flashMap[sym];
              return (
                <button
                  key={sym}
                  type="button"
                  onClick={() => handleSelectInstrument(sym)}
                  className={`shrink-0 min-h-[36px] px-2.5 py-1 rounded-2xl border flex items-center gap-1.5 text-xs transition-all active:scale-[0.98] ${
                    active
                      ? 'bg-[#FFB020]/12 border-[#FFB020]/45 text-slate-900 dark:text-white'
                      : flash === 'UP'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-900 dark:text-white'
                      : flash === 'DOWN'
                      ? 'bg-[#FF4D6D]/10 border-[#FF4D6D]/30 text-slate-900 dark:text-white'
                      : 'm3-card border-slate-200/80 dark:border-white/[0.07] text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/20'
                  }`}
                >
                  <span className="font-semibold whitespace-nowrap">
                    {formatDisplayTicker(sym)}
                  </span>
                  <span className="text-[11px] font-medium tabular-nums text-slate-800 dark:text-slate-200 whitespace-nowrap">
                    {q.price.toLocaleString('en-IN')}
                  </span>
                  <span
                    className={`text-[11px] font-semibold tabular-nums whitespace-nowrap ${
                      up
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-[#E11D48] dark:text-[#FF4D6D]'
                    }`}
                  >
                    {up ? '+' : ''}
                    {q.changePct.toFixed(2)}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {marketOpen ? 'NSE Open' : 'NSE Closed'}
          </span>

          {upstoxStatus?.connected ? (
            <button
              type="button"
              onClick={() => setBrokerSheetOpen(true)}
              className="min-h-[36px] px-3 py-1.5 rounded-2xl bg-[#FFB020]/12 border border-[#FFB020]/35 text-xs font-semibold text-[#D97706] dark:text-[#FFB020] flex items-center gap-1.5 hover:bg-[#FFB020]/18 transition-all active:scale-[0.98] whitespace-nowrap"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>Upstox · {upstoxStatus.profile?.userName.split(' ')[0] || 'Connected'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setBrokerSheetOpen(true)}
              className="min-h-[36px] px-3 py-1.5 rounded-2xl m3-card hover:border-[#FFB020]/40 text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 transition-all active:scale-[0.98] whitespace-nowrap"
            >
              <Link2 className="w-3.5 h-3.5 text-[#FFB020]" />
              <span>Connect Upstox</span>
            </button>
          )}
        </div>
      </div>

      {/* Order Confirmation Toast */}
      <AnimatePresence>
        {orderFeedback && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: MATERIAL_EASE }}
            className="shrink-0 px-4 py-2.5 rounded-2xl bg-[#FFB020]/12 border border-[#FFB020]/30 text-xs font-medium text-[#D97706] dark:text-[#FFB020] flex items-center justify-between gap-3"
          >
            <span>{orderFeedback}</span>
            <button
              type="button"
              onClick={() => setOrderFeedback(null)}
              className="font-semibold hover:underline shrink-0"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Single-Viewport Trading Terminal Split */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch">
        {/* Left: Interactive Candlestick Terminal (Supports Fullscreen) */}
        <div
          ref={chartCardRef}
          className={
            isFullscreen
              ? 'fixed inset-0 z-50 bg-white dark:bg-[#090C12] p-3 sm:p-5 flex flex-col gap-3 min-w-0'
              : 'lg:col-span-7 xl:col-span-8 min-h-0 rounded-[24px] m3-card p-3.5 sm:p-4 flex flex-col gap-2.5 min-w-0'
          }
        >
          {/* Instrument Quote + Pro Chart Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 shrink-0 pb-2 border-b border-slate-200/70 dark:border-white/[0.07]">
            {/* Symbol + Live LTP */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-white/[0.06] text-slate-900 dark:text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
                {getSymbolMonogram(selectedSymbol)}
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2.5 flex-wrap">
                  <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
                    {formatDisplayTicker(selectedSymbol)}
                  </h1>
                  <span
                    className={`text-base sm:text-lg font-bold tabular-nums transition-colors ${
                      flashMap[selectedSymbol] === 'UP'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : flashMap[selectedSymbol] === 'DOWN'
                        ? 'text-[#E11D48] dark:text-[#FF4D6D]'
                        : 'text-slate-900 dark:text-white'
                    }`}
                  >
                    {activeQuote
                      ? isIndex
                        ? activeQuote.price.toLocaleString('en-IN')
                        : formatInr(activeQuote.price, true)
                      : '—'}
                  </span>
                  {activeQuote && (
                    <span
                      className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums whitespace-nowrap ${
                        activeUp
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-[#E11D48] dark:text-[#FF4D6D]'
                      }`}
                    >
                      {activeUp ? (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDownRight className="w-3.5 h-3.5" />
                      )}
                      {activeUp ? '+' : ''}
                      {activeQuote.change.toFixed(2)} ({activeUp ? '+' : ''}
                      {activeQuote.changePct.toFixed(2)}%)
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {activeQuote?.name || selectedSymbol} ·{' '}
                  {isIndex ? 'Index' : selectedSymbol.endsWith('.BO') ? 'BSE Equity' : 'NSE Equity'}
                </p>
              </div>
            </div>

            {/* Timeframes + Candles/Line + Indicators + Fit + Fullscreen */}
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <div className="flex items-center gap-0.5 p-0.5 rounded-xl m3-tonal-box">
                {(['1D', '1W', '1M', '6M', '1Y', '3Y'] as const).map((tf) => {
                  const active = timeframe === tf;
                  return (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setTimeframe(tf)}
                      className={`relative px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
                        active
                          ? 'text-[#1C1000]'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="marketTimeframePill"
                          transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                          className="absolute inset-0 rounded-lg bg-[#FFB020]"
                          aria-hidden="true"
                        />
                      )}
                      <span className="relative z-10">{tf}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-0.5 p-0.5 rounded-xl m3-tonal-box">
                {(
                  [
                    { id: 'CANDLES', label: 'Candles', icon: CandlestickChart },
                    { id: 'AREA', label: 'Line', icon: TrendingUp },
                  ] as const
                ).map((m) => {
                  const Icon = m.icon;
                  const active = chartType === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setChartType(m.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all whitespace-nowrap ${
                        active
                          ? 'bg-white dark:bg-[#1E2638] text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{m.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Indicators Dropdown */}
              <div ref={indicatorsRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIndicatorsOpen((o) => !o)}
                  title="Chart Indicators"
                  className={`min-h-[30px] px-2.5 py-1 rounded-xl text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap m3-tonal-box ${
                    indicatorsOpen || activeIndicatorsCount > 0
                      ? 'text-slate-900 dark:text-white'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#FFB020]" />
                  <span className="hidden sm:inline">Indicators</span>
                  {activeIndicatorsCount > 0 && (
                    <span className="text-[10px] font-bold tabular-nums text-[#D97706] dark:text-[#FFB020]">
                      {activeIndicatorsCount}
                    </span>
                  )}
                </button>

                <AnimatePresence>
                  {indicatorsOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.97 }}
                      transition={{ duration: 0.14, ease: MATERIAL_EASE }}
                      className="absolute right-0 top-full mt-1.5 w-52 p-2 rounded-2xl bg-white dark:bg-[#171D2C] border border-slate-200 dark:border-white/10 shadow-xl z-30 space-y-1"
                    >
                      {[
                        {
                          label: 'EMA 20',
                          sub: 'Exponential Moving Avg',
                          active: showEma20,
                          color: 'bg-[#FFB020]',
                          toggle: () => setShowEma20((v) => !v),
                        },
                        {
                          label: 'SMA 50',
                          sub: 'Simple Moving Avg',
                          active: showSma50,
                          color: 'bg-sky-400',
                          toggle: () => setShowSma50((v) => !v),
                        },
                        {
                          label: 'Volume Bars',
                          sub: 'Session Volume Overlay',
                          active: showVolume,
                          color: 'bg-emerald-500',
                          toggle: () => setShowVolume((v) => !v),
                        },
                      ].map((ind) => (
                        <button
                          key={ind.label}
                          type="button"
                          onClick={ind.toggle}
                          className="w-full px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.05] flex items-center justify-between gap-2 text-left transition-colors"
                        >
                          <div>
                            <p className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${ind.color}`} />
                              {ind.label}
                            </p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                              {ind.sub}
                            </p>
                          </div>
                          <span
                            className={`w-4 h-4 rounded-md border flex items-center justify-center transition-colors ${
                              ind.active
                                ? 'bg-[#FFB020] border-[#FFB020] text-[#1C1000]'
                                : 'border-slate-300 dark:border-white/20'
                            }`}
                          >
                            {ind.active && <Check className="w-3 h-3" />}
                          </span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button
                type="button"
                onClick={() => chartRef.current?.timeScale().fitContent()}
                title="Reset chart zoom"
                className="min-h-[30px] px-2.5 rounded-xl m3-tonal-box text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap"
              >
                Fit
              </button>

              <button
                type="button"
                onClick={() => void fetchChart()}
                aria-label="Refresh chart"
                title="Refresh chart"
                className="min-h-[30px] min-w-[30px] rounded-xl m3-tonal-box text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${chartLoading ? 'animate-spin' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                aria-label={isFullscreen ? 'Exit fullscreen chart' : 'Fullscreen chart'}
                title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen Chart'}
                className={`min-h-[30px] min-w-[30px] px-2 rounded-xl flex items-center gap-1 text-[11px] font-semibold transition-colors ${
                  isFullscreen
                    ? 'bg-[#FFB020] text-[#1C1000]'
                    : 'm3-tonal-box text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Exit</span>
                  </>
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Trading Chart Canvas (Fills All Remaining Vertical Viewport Space) */}
          <div className="relative flex-1 min-h-[300px] lg:min-h-0 w-full">
            {/* Permanent TradingView-style Top-Left OHLCV & Moving Average Legend */}
            {displayCandle && (
              <div className="absolute top-1.5 left-1.5 z-10 pointer-events-none px-2.5 py-1 rounded-lg bg-white/80 dark:bg-[#0D111A]/80 backdrop-blur-sm border border-slate-200/60 dark:border-white/[0.06] flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                <span className="text-slate-700 dark:text-slate-300 font-medium">
                  {displayCandle.date.slice(0, 16).replace('T', ' ')}
                </span>
                <span>
                  O{' '}
                  <strong className={candleUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#E11D48] dark:text-[#FF4D6D]'}>
                    {displayCandle.open.toLocaleString('en-IN')}
                  </strong>
                </span>
                <span>
                  H{' '}
                  <strong className={candleUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#E11D48] dark:text-[#FF4D6D]'}>
                    {displayCandle.high.toLocaleString('en-IN')}
                  </strong>
                </span>
                <span>
                  L{' '}
                  <strong className={candleUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#E11D48] dark:text-[#FF4D6D]'}>
                    {displayCandle.low.toLocaleString('en-IN')}
                  </strong>
                </span>
                <span>
                  C{' '}
                  <strong className={candleUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#E11D48] dark:text-[#FF4D6D]'}>
                    {displayCandle.close.toLocaleString('en-IN')}
                  </strong>
                </span>
                <span className={candleUp ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-[#E11D48] dark:text-[#FF4D6D] font-semibold'}>
                  {candleDelta >= 0 ? '+' : ''}
                  {candleDelta.toFixed(2)} ({candleDeltaPct >= 0 ? '+' : ''}
                  {candleDeltaPct.toFixed(2)}%)
                </span>
                <span>
                  Vol <strong className="text-slate-800 dark:text-slate-200">{formatCompactVolume(displayCandle.volume)}</strong>
                </span>
                {showEma20 && (
                  <span className="hidden sm:inline text-[#D97706] dark:text-[#FFB020] font-medium">
                    EMA20
                  </span>
                )}
                {showSma50 && (
                  <span className="hidden sm:inline text-sky-500 font-medium">SMA50</span>
                )}
              </div>
            )}

            <div ref={chartContainerRef} className="w-full h-full" />

            {chartLoading && candles.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                Loading chart...
              </div>
            )}

            {!chartLoading && chartError && candles.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
                <p className="text-xs font-medium text-[#E11D48] dark:text-[#FF4D6D]">{chartError}</p>
                <button
                  type="button"
                  onClick={() => void fetchChart()}
                  className="min-h-[32px] px-3 rounded-xl m3-tonal-box text-xs font-semibold text-slate-800 dark:text-slate-200"
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* Compact Single-Line Session Stats & Day Range Footer */}
          <div className="shrink-0 pt-2.5 border-t border-slate-200/70 dark:border-white/[0.07] flex flex-wrap items-center justify-between gap-4 text-xs tabular-nums">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span>
                <span className="text-slate-500 dark:text-slate-400 mr-1.5">Open</span>
                <strong className="text-slate-900 dark:text-white">
                  {dayOpen !== undefined ? dayOpen.toLocaleString('en-IN') : '—'}
                </strong>
              </span>
              <span>
                <span className="text-slate-500 dark:text-slate-400 mr-1.5">Prev Close</span>
                <strong className="text-slate-900 dark:text-white">
                  {prevClose !== undefined ? prevClose.toLocaleString('en-IN') : '—'}
                </strong>
              </span>
              <span>
                <span className="text-slate-500 dark:text-slate-400 mr-1.5">Vol</span>
                <strong className="text-slate-900 dark:text-white">
                  {formatCompactVolume(dayVolume)}
                </strong>
              </span>
            </div>

            {/* Inline Intraday Low—High Range Meter */}
            <div className="flex items-center gap-2.5 flex-1 max-w-xs min-w-[190px]">
              <span className="text-[11px] text-[#E11D48] dark:text-[#FF4D6D] font-semibold whitespace-nowrap">
                L {dayLow !== undefined ? dayLow.toLocaleString('en-IN') : '—'}
              </span>
              <div className="relative flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-white/[0.08]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500 opacity-75"
                  style={{ width: `${rangePositionPct}%` }}
                />
                <span
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-slate-900 dark:bg-white ring-2 ring-white dark:ring-[#111622] shadow"
                  style={{ left: `${rangePositionPct}%` }}
                />
              </div>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold whitespace-nowrap">
                H {dayHigh !== undefined ? dayHigh.toLocaleString('en-IN') : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Unified Single-Screen Trade / Watchlist / Order Book Dock */}
        <aside className="lg:col-span-5 xl:col-span-4 min-h-0 flex flex-col min-w-0">
          <div className="h-full rounded-[24px] m3-card p-4 flex flex-col gap-3 min-h-0 overflow-hidden">
            {/* Segmented Switch: Order | Watch | Depth */}
            <div className="shrink-0 space-y-2">
              <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl m3-tonal-box">
                {(
                  [
                    { id: 'TRADE', label: 'Order' },
                    { id: 'WATCHLIST', label: `Watch (${allQuotes.length})` },
                    { id: 'DEPTH', label: 'Depth' },
                  ] as const
                ).map((tab) => {
                  const active = dockTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setDockTab(tab.id)}
                      className={`relative py-1.5 px-1 rounded-xl text-[11px] font-semibold transition-colors whitespace-nowrap truncate ${
                        active
                          ? 'text-[#1C1000]'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="marketDockTabPill"
                          transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                          className="absolute inset-0 rounded-xl bg-[#FFB020]"
                          aria-hidden="true"
                        />
                      )}
                      <span className="relative z-10">{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Sleek Ambient 2px Scroll Progress Rail (Replaces clunky side scrollbars) */}
              {dockScrollable && (
                <div className="h-[2px] w-full rounded-full bg-slate-200/70 dark:bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#FFB020] to-[#F5B700] transition-[width] duration-150 ease-out"
                    style={{ width: `${Math.max(12, dockScrollPct)}%` }}
                  />
                </div>
              )}
            </div>

            {dockTab === 'TRADE' && (
              <div
                ref={dockScrollRef}
                onScroll={updateDockScroll}
                className="flex-1 min-h-0 flex flex-col justify-between gap-3.5 overflow-y-auto overflow-x-hidden scroll-fade-y py-0.5"
              >
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white truncate">
                      {orderSide === 'BUY' ? 'Buy' : 'Sell'} {formatDisplayTicker(selectedSymbol)}
                    </h2>
                    <span className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      NSE CNC
                    </span>
                  </div>

                  {/* Buy / Sell Segmented Control */}
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl m3-tonal-box">
                    {(['BUY', 'SELL'] as const).map((s) => {
                      const active = orderSide === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setOrderSide(s)}
                          className={`relative min-h-[36px] rounded-xl text-xs font-semibold transition-colors ${
                            active
                              ? s === 'BUY'
                                ? 'text-[#1C1000]'
                                : 'text-white'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="marketOrderSidePill"
                              transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                              className={`absolute inset-0 rounded-xl ${
                                s === 'BUY' ? 'bg-[#FFB020]' : 'bg-[#FF4D6D]'
                              }`}
                              aria-hidden="true"
                            />
                          )}
                          <span className="relative z-10">{s === 'BUY' ? 'Buy' : 'Sell'}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Quantity Control */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <label htmlFor="market-order-qty" className="text-slate-500 dark:text-slate-400">
                        Shares
                      </label>
                      {!isIndex && orderSide === 'BUY' && maxBuyShares > 0 && (
                        <button
                          type="button"
                          onClick={() => setOrderQty(String(maxBuyShares))}
                          className="text-xs font-semibold tabular-nums text-[#D97706] dark:text-[#FFB020] hover:underline"
                        >
                          Max {maxBuyShares}
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isIndex || parsedQty <= 1}
                        onClick={() => setOrderQty(String(Math.max(1, parsedQty - 1)))}
                        aria-label="Decrease quantity"
                        className="min-h-[40px] min-w-[40px] rounded-xl m3-tonal-box text-slate-700 dark:text-slate-200 flex items-center justify-center hover:opacity-85 active:scale-95 disabled:opacity-40 transition-all"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        id="market-order-qty"
                        type="number"
                        min={1}
                        step={1}
                        disabled={isIndex}
                        value={orderQty}
                        onChange={(e) => setOrderQty(e.target.value)}
                        className="min-w-0 flex-1 min-h-[40px] px-3 rounded-xl m3-tonal-box border border-slate-200/70 dark:border-white/[0.08] text-center text-sm font-bold tabular-nums text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020] disabled:opacity-50"
                      />
                      <button
                        type="button"
                        disabled={isIndex}
                        onClick={() => setOrderQty(String(parsedQty + 1))}
                        aria-label="Increase quantity"
                        className="min-h-[40px] min-w-[40px] rounded-xl m3-tonal-box text-slate-700 dark:text-slate-200 flex items-center justify-center hover:opacity-85 active:scale-95 disabled:opacity-40 transition-all"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-5 gap-1">
                      {QUICK_QTYS.map((q) => (
                        <button
                          key={q}
                          type="button"
                          disabled={isIndex}
                          onClick={() => setOrderQty(String(q))}
                          className={`min-h-[30px] rounded-lg text-[11px] font-semibold tabular-nums transition-all active:scale-95 disabled:opacity-40 ${
                            parsedQty === q
                              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                              : 'm3-tonal-box text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Financial Summary */}
                  <div className="pt-3 border-t border-slate-200/70 dark:border-white/[0.07] space-y-2 text-xs tabular-nums">
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                      <span>Market Price</span>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {activeQuote && !isIndex ? formatInr(activeQuote.price, true) : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                      <span>{upstoxStatus?.connected ? 'Upstox Margin' : 'Available Cash'}</span>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {formatCompactInr(cashInr)}
                      </span>
                    </div>

                    {!isIndex && orderSide === 'BUY' && cashInr > 0 && (
                      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/[0.08] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            insufficientFunds ? 'bg-[#FF4D6D]' : 'bg-[#FFB020]'
                          }`}
                          style={{ width: `${cashUsagePct}%` }}
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200/70 dark:border-white/[0.07]">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Estimated Total
                      </span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white">
                        {activeQuote && !isIndex ? formatInr(estOrderValue, true) : 'Index Only'}
                      </span>
                    </div>

                    {upstoxStatus?.connected && cashInr > 0 && insufficientFunds && (
                      <p className="text-xs text-[#E11D48] dark:text-[#FF4D6D] font-medium">
                        Insufficient Upstox margin ({formatInr(cashInr)} available)
                      </p>
                    )}
                  </div>
                </div>

                {/* Primary Trade CTA */}
                <div className="pt-2 space-y-2 shrink-0">
                  {isIndex ? (
                    selectedSymbol === '^NSEI' ? (
                      <button
                        type="button"
                        onClick={() => setSelectedSymbol('NIFTYBEES.NS')}
                        className="w-full min-h-[42px] px-4 rounded-2xl m3-tonal-box hover:opacity-90 text-xs font-semibold text-slate-900 dark:text-white transition-all active:scale-[0.98]"
                      >
                        Trade NIFTYBEES ETF Instead
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="w-full min-h-[42px] px-4 rounded-2xl m3-tonal-box text-xs font-medium text-slate-400 cursor-not-allowed"
                      >
                        Indices Are Non-Tradable
                      </button>
                    )
                  ) : upstoxStatus?.connected ? (
                    <button
                      type="button"
                      disabled={!activeQuote || parsedQty <= 0 || (cashInr > 0 && insufficientFunds)}
                      onClick={() => setPinOpen(true)}
                      className={`w-full min-h-[42px] px-4 rounded-2xl text-xs sm:text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed shadow-sm ${
                        orderSide === 'BUY'
                          ? 'bg-[#FFB020] hover:bg-[#F59E0B] text-[#1C1000]'
                          : 'bg-[#FF4D6D] hover:bg-[#e11d48] text-white'
                      }`}
                    >
                      {`Place ${orderSide} ${parsedQty} ${formatDisplayTicker(selectedSymbol)}`}
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setBrokerSheetOpen(true)}
                        className="w-full min-h-[42px] px-4 rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] text-[#1C1000] text-xs font-semibold transition-all active:scale-[0.98] shadow-sm"
                      >
                        Connect Upstox to Trade
                      </button>
                      {onLogTrade && (
                        <button
                          type="button"
                          onClick={() => onLogTrade(selectedSymbol)}
                          className="w-full min-h-[38px] px-4 rounded-2xl m3-tonal-box hover:opacity-90 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all"
                        >
                          Log Trade in Portfolio
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {dockTab === 'WATCHLIST' && (
              <div
                ref={dockScrollRef}
                onScroll={updateDockScroll}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-y py-0.5"
              >
                {renderSymbolPickerList(undefined, true)}
              </div>
            )}

            {dockTab === 'DEPTH' && (
              <div
                ref={dockScrollRef}
                onScroll={updateDockScroll}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-y py-0.5"
              >
                {hasDepth && activeQuote?.depth ? (
                  <div className="space-y-3 text-xs tabular-nums">
                    {(totalBuy > 0 || totalSell > 0) && (
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>
                            Bid{' '}
                            <strong className="text-emerald-600 dark:text-emerald-400">
                              {totalBuy.toLocaleString('en-IN')} ({buyPressurePct}%)
                            </strong>
                          </span>
                          <span>
                            Ask{' '}
                            <strong className="text-[#E11D48] dark:text-[#FF4D6D]">
                              {totalSell.toLocaleString('en-IN')} ({100 - buyPressurePct}%)
                            </strong>
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full overflow-hidden flex bg-slate-200 dark:bg-white/[0.08]">
                          <div
                            className="h-full bg-emerald-500 transition-all duration-300"
                            style={{ width: `${buyPressurePct}%` }}
                          />
                          <div
                            className="h-full bg-[#FF4D6D] transition-all duration-300"
                            style={{ width: `${100 - buyPressurePct}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-400 pb-1.5 border-b border-slate-200/70 dark:border-white/[0.06]">
                      <div className="flex justify-between">
                        <span>Bid</span>
                        <span>Qty</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Ask</span>
                        <span>Qty</span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {Array.from({ length: 5 }).map((_, idx) => {
                        const bid = activeQuote.depth?.buy[idx];
                        const ask = activeQuote.depth?.sell[idx];
                        const bidPct = bid?.quantity
                          ? Math.min(100, Math.round((bid.quantity / maxDepthQty) * 100))
                          : 0;
                        const askPct = ask?.quantity
                          ? Math.min(100, Math.round((ask.quantity / maxDepthQty) * 100))
                          : 0;
                        return (
                          <div key={idx} className="grid grid-cols-2 gap-3">
                            <div className="relative flex justify-between px-2 py-1.5 rounded-lg overflow-hidden text-emerald-600 dark:text-emerald-400">
                              <span
                                className="absolute inset-y-0 right-0 bg-emerald-500/12 pointer-events-none transition-all duration-300"
                                style={{ width: `${bidPct}%` }}
                              />
                              <span className="relative z-10">
                                {bid?.price ? bid.price.toFixed(2) : '—'}
                              </span>
                              <span className="relative z-10">{bid?.quantity || '—'}</span>
                            </div>
                            <div className="relative flex justify-between px-2 py-1.5 rounded-lg overflow-hidden text-[#E11D48] dark:text-[#FF4D6D]">
                              <span
                                className="absolute inset-y-0 left-0 bg-[#FF4D6D]/12 pointer-events-none transition-all duration-300"
                                style={{ width: `${askPct}%` }}
                              />
                              <span className="relative z-10">
                                {ask?.price ? ask.price.toFixed(2) : '—'}
                              </span>
                              <span className="relative z-10">{ask?.quantity || '—'}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="py-8 space-y-3 text-center">
                    <div className="w-10 h-10 rounded-2xl m3-tonal-box mx-auto flex items-center justify-center">
                      <Layers className="w-4 h-4 text-[#FFB020]" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-900 dark:text-white">
                        5-Level Order Depth
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Connect Upstox Demat to view live Bid/Ask depth.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBrokerSheetOpen(true)}
                      className="min-h-[36px] px-4 py-1.5 rounded-xl bg-[#FFB020] hover:bg-[#F59E0B] text-[#1C1000] text-xs font-semibold transition-all active:scale-[0.98]"
                    >
                      Connect Upstox
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Smooth Command Symbol Switcher Sheet (Cmd+K or Markets button) */}
      <BottomSheet
        open={symbolDrawerOpen}
        onClose={() => setSymbolDrawerOpen(false)}
        title="Search Any Indian Stock"
        subtitle="All NSE & BSE stocks, ETFs, and market indices"
        maxWidthClass="lg:max-w-xl"
      >
        <div className="max-h-[60dvh] overflow-y-auto pr-1">
          {renderSymbolPickerList(() => setSymbolDrawerOpen(false))}
        </div>
      </BottomSheet>

      {/* Upstox Broker Setup Sheet */}
      <BottomSheet
        open={brokerSheetOpen}
        onClose={() => setBrokerSheetOpen(false)}
        title="Upstox Broker Connection"
        subtitle={
          upstoxStatus?.connected
            ? 'Your Upstox Demat session is active'
            : 'Authorize Upstox to place equity CNC orders & view order depth'
        }
        maxWidthClass="lg:max-w-lg"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2 border-b border-slate-200/80 dark:border-white/[0.07] text-xs">
            <span className="text-slate-500 dark:text-slate-400">Account Status</span>
            <span
              className={`font-semibold ${
                upstoxStatus?.connected
                  ? 'text-[#D97706] dark:text-[#FFB020]'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {upstoxStatus?.connected
                ? `Connected (${upstoxStatus.profile?.userName} · ${upstoxStatus.profile?.userId})`
                : 'Not Connected'}
            </span>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-slate-200/80 dark:border-white/[0.07] text-xs">
            <span className="text-slate-500 dark:text-slate-400">Exchange Session</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {marketOpen ? 'NSE Open' : 'NSE Closed'}
            </span>
          </div>

          {upstoxStatus?.redirectUri && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Upstox Redirect URI
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/[0.08] text-[11px] font-mono text-slate-700 dark:text-slate-300 truncate">
                  {upstoxStatus.redirectUri}
                </code>
                <button
                  type="button"
                  onClick={handleCopyRedirect}
                  className="min-h-[36px] px-3 rounded-xl bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/10 text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  {copiedRedirect ? (
                    <Check className="w-3.5 h-3.5 text-[#FFB020]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedRedirect ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          )}

          {(upstoxError || upstoxFallbackUrl) && (
            <div className="p-3 rounded-xl bg-[#F5B700]/10 border border-[#F5B700]/30 text-xs text-slate-800 dark:text-slate-200 space-y-1.5">
              {upstoxError && <p>{upstoxError}</p>}
              {upstoxFallbackUrl && (
                <a
                  href={upstoxFallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block font-semibold text-[#D97706] dark:text-[#FFB020] underline"
                >
                  Open Upstox Authorization Page
                </a>
              )}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            {upstoxStatus?.connected ? (
              <button
                type="button"
                onClick={handleDisconnectUpstox}
                className="min-h-[40px] px-4 rounded-xl bg-[#FF4D6D]/12 hover:bg-[#FF4D6D]/20 text-xs font-semibold text-[#E11D48] dark:text-[#FF4D6D] flex items-center gap-1.5 transition-colors"
              >
                <Unlink className="w-3.5 h-3.5" />
                <span>Disconnect Upstox</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={connectingUpstox}
                onClick={handleConnectUpstox}
                className="min-h-[40px] px-5 rounded-xl bg-[#FFB020] hover:bg-[#F59E0B] text-[#1C1000] text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-60"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>{connectingUpstox ? 'Opening OAuth...' : 'Connect Upstox Account'}</span>
              </button>
            )}
          </div>
        </div>
      </BottomSheet>

      <PinLockModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        title={`Confirm ${orderSide} ${parsedQty} ${formatDisplayTicker(selectedSymbol)}`}
        onVerify={handleConfirmQuickOrder}
      />
    </div>
  );
};
