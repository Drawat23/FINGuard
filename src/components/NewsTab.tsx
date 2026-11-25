import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowUpRight,
  CalendarClock,
  ExternalLink,
  Globe,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  EconomicCalendarEvent,
  MarketNewsFeedResponse,
  MarketNewsItem,
  MarketQuote,
} from '../../shared/types.ts';
import { apiFetch, getAccessToken } from '../lib/api.ts';
import { MATERIAL_EASE, MaterialCard, MaterialSegmentedTabs } from './MotionPrimitives.tsx';

interface NewsTabProps {
  initialFeed: MarketNewsFeedResponse | null;
  quotes: MarketQuote[];
  onFeedUpdated: (feed: MarketNewsFeedResponse) => void;
  onFactCheckHeadline: (headline: string) => void;
  onOpenMarketChart: (symbol: string) => void;
}

type WireFilter = 'ALL' | 'INDIA_MARKETS' | 'COMMODITIES' | 'FOREX_COMMUNITY';
type CurrencyFilter = 'ALL' | 'HIGH' | 'USD' | 'EUR' | 'GBP' | 'JPY';

const FALLBACK_IMAGES: Record<MarketNewsItem['category'], string> = {
  INDIA_MARKETS: '/src/assets/images/news_india_stocks_1795410923186.jpg',
  COMMODITIES: '/src/assets/images/news_global_macro_1795410923555.jpg',
  FOREX_COMMUNITY: '/src/assets/images/news_market_wire_1795410924259.jpg',
  GLOBAL_MACRO: '/src/assets/images/news_market_wire_1795410924259.jpg',
};

function formatRelativeAgo(iso: string, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function getCategoryLabel(cat: MarketNewsItem['category']): string {
  if (cat === 'INDIA_MARKETS') return 'India Stocks';
  if (cat === 'COMMODITIES') return 'Commodities';
  if (cat === 'FOREX_COMMUNITY') return 'Forex & Rates';
  return 'Global Macro';
}

const NewsThumbnail: React.FC<{
  item: MarketNewsItem;
  className?: string;
}> = ({ item, className = '' }) => {
  const localFallback = FALLBACK_IMAGES[item.category] || FALLBACK_IMAGES.INDIA_MARKETS;
  const [src, setSrc] = useState<string>(item.imageUrl || localFallback);
  const [failedCompletely, setFailedCompletely] = useState(false);

  useEffect(() => {
    setSrc(item.imageUrl || localFallback);
    setFailedCompletely(false);
  }, [item.imageUrl, localFallback]);

  if (failedCompletely) {
    return (
      <div
        className={`bg-gradient-to-br from-slate-200 via-slate-100 to-amber-50 dark:from-[#121927] dark:via-[#0E141F] dark:to-[#221808] flex items-center justify-center ${className}`}
      >
        <TrendingUp className="w-6 h-6 text-[#D97706] dark:text-[#FFB020] opacity-70" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={item.title}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        if (src !== localFallback) {
          setSrc(localFallback);
        } else {
          setFailedCompletely(true);
        }
      }}
      className={`object-cover bg-slate-100 dark:bg-[#0D131F] ${className}`}
    />
  );
};

export const NewsTab: React.FC<NewsTabProps> = ({
  initialFeed,
  quotes,
  onFeedUpdated,
  onFactCheckHeadline,
  onOpenMarketChart,
}) => {
  const [feed, setFeed] = useState<MarketNewsFeedResponse | null>(initialFeed);
  const [loading, setLoading] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [newStoryIds, setNewStoryIds] = useState<Set<string>>(() => new Set());
  const [wireFilter, setWireFilter] = useState<WireFilter>('ALL');
  const [macroFilter, setMacroFilter] = useState<CurrencyFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [streamNonce, setStreamNonce] = useState(0);
  const onFeedUpdatedRef = useRef(onFeedUpdated);

  useEffect(() => {
    onFeedUpdatedRef.current = onFeedUpdated;
  }, [onFeedUpdated]);

  useEffect(() => {
    if (initialFeed) {
      setFeed(initialFeed);
    }
  }, [initialFeed]);

  // Live relative-time clock tick (5s) so "12s ago" -> "17s ago" stays fresh
  useEffect(() => {
    const clockTimer = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(clockTimer);
  }, []);

  const fetchNews = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const res = await apiFetch<MarketNewsFeedResponse>(
        `/api/market/news${force ? '?refresh=1' : ''}`
      );
      setFeed((prev) => {
        if (prev) {
          const prevIds = new Set(prev.news.map((n) => n.id));
          const fresh = res.news.filter((n) => !prevIds.has(n.id)).map((n) => n.id);
          if (fresh.length > 0) {
            setNewStoryIds(new Set(fresh));
          }
        }
        return res;
      });
      onFeedUpdatedRef.current(res);
    } catch {
      // retain existing feed on transient error
    } finally {
      setLoading(false);
    }
  }, []);

  // Real-time Server-Sent Events stream pushing breaking headlines & images every 10s
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const token = getAccessToken();
      if (!token) {
        void fetchNews(false);
        return;
      }

      const qs = new URLSearchParams({ token });
      es = new EventSource(`/api/market/news/stream?${qs.toString()}`);

      es.onopen = () => {
        if (!cancelled) setStreamConnected(true);
      };

      es.addEventListener('news_snapshot', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as MarketNewsFeedResponse;
          setFeed(data);
          onFeedUpdatedRef.current(data);
          setStreamConnected(true);
          setNowMs(Date.now());
        } catch {
          // ignore malformed snapshot
        }
      });

      es.addEventListener('news_update', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as MarketNewsFeedResponse & {
            newIds?: string[];
          };
          const { newIds, ...cleanFeed } = data;
          setFeed(cleanFeed);
          onFeedUpdatedRef.current(cleanFeed);
          setStreamConnected(true);
          setNowMs(Date.now());
          if (Array.isArray(newIds) && newIds.length > 0) {
            setNewStoryIds(new Set(newIds));
          }
        } catch {
          // ignore malformed update
        }
      });

      es.onerror = () => {
        setStreamConnected(false);
        es?.close();
        es = null;
        if (!cancelled) {
          // Refresh via apiFetch (auto-renews access token if needed) and reconnect stream
          void fetchNews(false).finally(() => {
            reconnectTimer = setTimeout(() => {
              if (!cancelled) setStreamNonce((n) => n + 1);
            }, 6000);
          });
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      setStreamConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [fetchNews, streamNonce]);

  const filteredNews = useMemo(() => {
    const list = feed?.news || [];
    const q = searchQuery.trim().toLowerCase();
    return list.filter((item) => {
      const catOk =
        wireFilter === 'ALL'
          ? true
          : wireFilter === 'FOREX_COMMUNITY'
          ? item.category === 'FOREX_COMMUNITY' || item.category === 'GLOBAL_MACRO'
          : item.category === wireFilter;
      const searchOk =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.source.toLowerCase().includes(q) ||
        (item.summary || '').toLowerCase().includes(q);
      return catOk && searchOk;
    });
  }, [feed?.news, wireFilter, searchQuery]);

  const filteredCalendar = useMemo(() => {
    const list = feed?.calendar || [];
    const q = searchQuery.trim().toLowerCase();
    return list.filter((ev) => {
      const filterOk =
        macroFilter === 'ALL'
          ? true
          : macroFilter === 'HIGH'
          ? ev.impact === 'High'
          : ev.country === macroFilter;
      const searchOk =
        !q || ev.title.toLowerCase().includes(q) || ev.country.toLowerCase().includes(q);
      return filterOk && searchOk;
    });
  }, [feed?.calendar, macroFilter, searchQuery]);

  const leadStory = useMemo(() => {
    if (filteredNews.length === 0) return null;
    return filteredNews.find((n) => Boolean(n.imageUrl)) || filteredNews[0];
  }, [filteredNews]);

  const remainingNews = useMemo(
    () => (leadStory ? filteredNews.filter((item) => item.id !== leadStory.id) : filteredNews),
    [filteredNews, leadStory]
  );

  const secondaryFeatures = remainingNews.slice(0, 2);
  const wireStories = remainingNews.slice(2);

  const topMacroCatalyst: EconomicCalendarEvent | null = useMemo(() => {
    const all = feed?.calendar || [];
    return all.find((e) => e.impact === 'High') || all[0] || null;
  }, [feed?.calendar]);

  const marketBenchmarks = useMemo(
    () =>
      ['^NSEI', '^INDIAVIX', 'GOLDBEES.NS']
        .map((sym) => quotes.find((q) => q.symbol === sym))
        .filter((q): q is MarketQuote => Boolean(q)),
    [quotes]
  );

  return (
    <div className="space-y-5 pb-8 min-w-0">
      {/* Clean Single-Row Editorial Toolbar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <MaterialSegmentedTabs
          layoutGroupId="newsCategoryTabs"
          activeId={wireFilter}
          onChange={setWireFilter}
          items={[
            { id: 'ALL', label: 'All Wire' },
            { id: 'INDIA_MARKETS', label: 'India Stocks' },
            { id: 'COMMODITIES', label: 'Gold & Crude' },
            { id: 'FOREX_COMMUNITY', label: 'Forex & Macro' },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="hidden xl:flex items-center gap-1.5">
            {marketBenchmarks.map((bm) => {
              const up = bm.changePct >= 0;
              return (
                <button
                  key={bm.symbol}
                  type="button"
                  onClick={() => onOpenMarketChart(bm.symbol)}
                  className="px-2.5 py-1.5 rounded-xl m3-tonal-box hover:border-[#FFB020]/35 border border-transparent text-[11px] tabular-nums flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <span className="text-slate-700 dark:text-slate-300 font-semibold">
                    {bm.symbol === '^NSEI'
                      ? 'NIFTY'
                      : bm.symbol === '^INDIAVIX'
                      ? 'VIX'
                      : bm.symbol.replace('.NS', '')}
                  </span>
                  <span className={up ? 'text-[#D97706] dark:text-[#FFB020]' : 'text-[#E11D48] dark:text-[#FF4D6D]'}>
                    {up ? '+' : ''}
                    {bm.changePct.toFixed(2)}%
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-52">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Tata, Nifty, RBI..."
              className="w-full min-h-[38px] pl-8 pr-8 rounded-2xl m3-card text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#FFB020]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-800 dark:hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => void fetchNews(true)}
            disabled={loading}
            aria-label={streamConnected ? 'Refresh news wire' : 'Refresh news'}
            className="min-h-[38px] px-3.5 py-1.5 rounded-2xl m3-card hover:border-[#FFB020]/40 text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-55 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#FFB020] ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Main Editorial Workspace (8 cols Visual Newsroom + 4 cols Sticky Forex Factory Macro) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Cols: 3-Tier Image-Led Editorial Newsroom */}
        <div className="lg:col-span-8 space-y-6 min-w-0">
          {/* Tier 1: Lead Hero Story with Crisp Photography */}
          {leadStory ? (
            <MaterialCard className="overflow-hidden min-w-0">
              <a
                href={leadStory.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block relative aspect-[16/9] sm:aspect-[21/10] w-full overflow-hidden group"
              >
                <NewsThumbnail
                  item={leadStory}
                  className="w-full h-full transition-transform duration-500 ease-out group-hover:scale-[1.02]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
                <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between gap-2 text-[11px] font-medium text-white/95">
                  <span>
                    {leadStory.source} · {getCategoryLabel(leadStory.category)}
                    {newStoryIds.has(leadStory.id) ? ' · Just arrived' : ''}
                  </span>
                  <span className="tabular-nums">{formatRelativeAgo(leadStory.publishedAt, nowMs)}</span>
                </div>
              </a>

              <div className="p-5 sm:p-6">
                <a
                  href={leadStory.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block group"
                >
                  <h1 className="font-display text-xl sm:text-2xl lg:text-[1.7rem] font-bold tracking-tight text-slate-900 dark:text-white group-hover:text-[#D97706] dark:group-hover:text-[#FFB020] leading-snug text-balance transition-colors">
                    {leadStory.title}
                  </h1>
                </a>

                {leadStory.summary && (
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-2.5 leading-relaxed max-w-3xl">
                    {leadStory.summary}
                  </p>
                )}

                <div className="mt-5 pt-4 border-t border-slate-200/70 dark:border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <a
                      href={leadStory.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[40px] px-4 py-2 rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] text-xs font-semibold inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0"
                    >
                      <span>Read Full Story</span>
                      <ArrowUpRight className="w-4 h-4 shrink-0" />
                    </a>
                    <button
                      type="button"
                      onClick={() =>
                        onFactCheckHeadline(
                          `Analyze NSE & portfolio impact for headline: "${leadStory.title}" (Source: ${leadStory.source})`
                        )
                      }
                      className="min-h-[40px] px-3.5 py-2 rounded-2xl m3-tonal-box hover:bg-slate-200/70 dark:hover:bg-white/10 text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      <ShieldAlert className="w-3.5 h-3.5 text-[#F5B700]" />
                      <span>AI Impact Check</span>
                    </button>
                  </div>

                  {leadStory.author && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      By {leadStory.author}
                    </span>
                  )}
                </div>
              </div>
            </MaterialCard>
          ) : (
            <MaterialCard className="p-10 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {loading ? 'Loading market stories...' : 'No matching stories right now.'}
              </p>
            </MaterialCard>
          )}

          {/* Tier 2: 2-Column Featured Visual Cards */}
          {secondaryFeatures.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {secondaryFeatures.map((item, idx) => (
                <MaterialCard
                  key={item.id}
                  delay={0.03 * (idx + 1)}
                  className="overflow-hidden flex flex-col justify-between min-w-0"
                >
                  <div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block aspect-[16/9] w-full overflow-hidden group"
                    >
                      <NewsThumbnail
                        item={item}
                        className="w-full h-full transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                      />
                    </a>
                    <div className="p-4 sm:p-5">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {item.source} · {formatRelativeAgo(item.publishedAt, nowMs)}
                        {newStoryIds.has(item.id) && (
                          <span className="text-[#D97706] dark:text-[#FFB020] font-semibold">
                            {' '}
                            · New
                          </span>
                        )}
                      </p>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block mt-1.5 group"
                      >
                        <h2 className="font-display text-sm sm:text-[15px] font-bold text-slate-900 dark:text-white group-hover:text-[#D97706] dark:group-hover:text-[#FFB020] leading-snug line-clamp-2 transition-colors">
                          {item.title}
                        </h2>
                      </a>
                      {item.summary && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                          {item.summary}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="px-4 sm:px-5 pb-4 pt-2 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-white/[0.05]">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-semibold text-[#D97706] dark:text-[#FFB020] hover:underline inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      <span>Read</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <button
                      type="button"
                      onClick={() =>
                        onFactCheckHeadline(
                          `Fact-check market impact for NSE investor: "${item.title}" (${item.source})`
                        )
                      }
                      className="text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white whitespace-nowrap"
                    >
                      AI Verify
                    </button>
                  </div>
                </MaterialCard>
              ))}
            </div>
          )}

          {/* Tier 3: Minimalist Image-Led Minute-by-Minute Wire */}
          {wireStories.length > 0 && (
            <MaterialCard delay={0.08} className="p-5 sm:p-6 min-w-0">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200/70 dark:border-white/[0.07]">
                <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Minute-by-Minute Wire
                </h2>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  Newest First
                </span>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {wireStories.map((item, idx) => (
                  <motion.article
                    key={item.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.16,
                      delay: Math.min(0.16, idx * 0.015),
                      ease: MATERIAL_EASE,
                    }}
                    className="py-4 flex items-start justify-between gap-4 sm:gap-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {item.source}
                        </span>{' '}
                        · {getCategoryLabel(item.category)} ·{' '}
                        {formatRelativeAgo(item.publishedAt, nowMs)}
                        {newStoryIds.has(item.id) && (
                          <span className="text-[#D97706] dark:text-[#FFB020] font-semibold">
                            {' '}
                            · New
                          </span>
                        )}
                      </p>

                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block mt-1 group"
                      >
                        <h3 className="text-sm sm:text-[15px] font-semibold text-slate-900 dark:text-white group-hover:text-[#D97706] dark:group-hover:text-[#FFB020] transition-colors leading-snug">
                          {item.title}
                        </h3>
                      </a>

                      {item.summary && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 line-clamp-2 leading-relaxed">
                          {item.summary}
                        </p>
                      )}

                      <div className="mt-2.5 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            onFactCheckHeadline(
                              `Fact-check market impact for NSE investor: "${item.title}" (${item.source})`
                            )
                          }
                          className="text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-[#D97706] dark:hover:text-[#FFB020] transition-colors whitespace-nowrap"
                        >
                          AI Impact Check
                        </button>
                        <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                          ·
                        </span>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                        >
                          <span>Read Full</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-24 sm:w-36 aspect-[16/10] rounded-xl overflow-hidden shrink-0 group border border-slate-200/70 dark:border-white/[0.08]"
                    >
                      <NewsThumbnail
                        item={item}
                        className="w-full h-full transition-transform duration-300 ease-out group-hover:scale-105"
                      />
                    </a>
                  </motion.article>
                ))}
              </div>
            </MaterialCard>
          )}
        </div>

        {/* Right 4 Cols: Sticky Forex Factory Macro Radar & Weekly Calendar */}
        <aside className="lg:col-span-4 lg:sticky lg:top-16 space-y-5 min-w-0">
          {/* Macro Catalyst Radar */}
          <MaterialCard delay={0.04} className="p-5 sm:p-6 flex flex-col justify-between min-w-0">
            <div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-[#FFB020]" />
                  <span className="text-slate-600 dark:text-slate-300 font-semibold">
                    Macro Radar
                  </span>
                </div>
                {topMacroCatalyst && (
                  <span
                    className={`text-[11px] font-semibold ${
                      topMacroCatalyst.impact === 'High'
                        ? 'text-[#E11D48] dark:text-[#FF4D6D]'
                        : 'text-[#D97706] dark:text-[#F5B700]'
                    }`}
                  >
                    {topMacroCatalyst.impact} Impact
                  </span>
                )}
              </div>

              {topMacroCatalyst ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      <span className="font-bold text-slate-900 dark:text-white">
                        {topMacroCatalyst.country}
                      </span>{' '}
                      ·{' '}
                      {new Date(topMacroCatalyst.date).toLocaleString('en-IN', {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      IST
                    </p>
                    <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-white mt-1.5">
                      {topMacroCatalyst.title}
                    </h2>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-200/70 dark:border-white/[0.07] tabular-nums">
                    <div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Forecast</p>
                      <p className="text-base font-bold text-[#D97706] dark:text-[#FFB020] mt-0.5">
                        {topMacroCatalyst.forecast}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Previous</p>
                      <p className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                        {topMacroCatalyst.previous}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-6">
                  {loading
                    ? 'Loading macro radar...'
                    : 'Upcoming macro events will appear here.'}
                </p>
              )}
            </div>

            <div className="mt-4 pt-3.5 border-t border-slate-200/70 dark:border-white/[0.07] flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                {feed?.calendar.length || 0} events tracked
              </span>
              <button
                type="button"
                onClick={() => onOpenMarketChart('^INDIAVIX')}
                className="text-[11px] font-semibold text-[#D97706] dark:text-[#FFB020] hover:underline inline-flex items-center gap-1 whitespace-nowrap"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Track India VIX</span>
              </button>
            </div>
          </MaterialCard>

          {/* Weekly Macro Calendar */}
          <MaterialCard delay={0.08} className="p-5 sm:p-6 space-y-4 min-w-0">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#FFB020]" />
              <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                Economic Calendar
              </h2>
            </div>

            <div className="flex items-center gap-1 p-1 rounded-2xl m3-tonal-box overflow-x-auto">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'HIGH', label: 'High' },
                  { id: 'USD', label: 'USD' },
                  { id: 'EUR', label: 'EUR' },
                  { id: 'GBP', label: 'GBP' },
                  { id: 'JPY', label: 'JPY' },
                ] as const
              ).map((f) => {
                const active = macroFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setMacroFilter(f.id)}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-[#FFB020] text-[#1C1000]'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            {filteredCalendar.length === 0 ? (
              <p className="text-xs text-slate-500 py-8 text-center">
                {loading
                  ? 'Loading economic calendar...'
                  : macroFilter === 'ALL' && !searchQuery
                  ? 'Upcoming macro releases will appear here.'
                  : 'No macro releases match this filter.'}
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/[0.06] lg:max-h-[48dvh] lg:overflow-y-auto overflow-x-hidden scroll-fade-y py-1">
                {filteredCalendar.map((ev) => (
                  <div key={ev.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                        <span className="font-bold text-slate-900 dark:text-white">{ev.country}</span>{' '}
                        ·{' '}
                        <span
                          className={`font-semibold ${
                            ev.impact === 'High'
                              ? 'text-[#E11D48] dark:text-[#FF4D6D]'
                              : ev.impact === 'Medium'
                              ? 'text-[#D97706] dark:text-[#F5B700]'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {ev.impact}
                        </span>{' '}
                        ·{' '}
                        {new Date(ev.date).toLocaleString('en-IN', {
                          weekday: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      <p className="text-xs font-semibold text-slate-900 dark:text-white mt-1 leading-snug">
                        {ev.title}
                      </p>
                    </div>

                    <div className="text-right text-[11px] tabular-nums shrink-0">
                      <p className="text-slate-900 dark:text-white font-semibold">{ev.forecast}</p>
                      <p className="text-slate-500 dark:text-slate-400 text-[10px]">
                        Prev {ev.previous}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </MaterialCard>
        </aside>
      </div>
    </div>
  );
};
