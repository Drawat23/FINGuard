import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  EconomicCalendarEvent,
  MarketNewsFeedResponse,
  MarketNewsItem,
} from '../../shared/types.ts';

interface NewsCacheEntry {
  data: MarketNewsFeedResponse;
  expiresAt: number;
}

interface CalendarCacheEntry {
  events: EconomicCalendarEvent[];
  expiresAt: number;
}

// 10-second live cache for minute-to-minute / real-time Indian stock updates
const CACHE_TTL_MS = 10 * 1000;
const FF_CALENDAR_TTL_MS = 15 * 60 * 1000;
const FF_BACKOFF_MS = 5 * 60 * 1000;
const FF_CACHE_PATH = path.join(process.cwd(), 'data', 'ff-calendar-cache.json');

let newsCache: NewsCacheEntry | null = null;
let calendarCache: CalendarCacheEntry | null = null;
const ogImageCache = new Map<string, string | null>();

function readDiskCalendarCache(): CalendarCacheEntry | null {
  try {
    if (!fs.existsSync(FF_CACHE_PATH)) return null;
    const raw = fs.readFileSync(FF_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as CalendarCacheEntry;
    if (Array.isArray(parsed.events) && parsed.events.length > 0) {
      return parsed;
    }
  } catch {
    // ignore corrupt cache file
  }
  return null;
}

function writeDiskCalendarCache(entry: CalendarCacheEntry): void {
  try {
    fs.mkdirSync(path.dirname(FF_CACHE_PATH), { recursive: true });
    fs.writeFileSync(FF_CACHE_PATH, JSON.stringify(entry), 'utf8');
  } catch {
    // non-fatal
  }
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeRawAttr(raw: string): string {
  return raw
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1')
    .replace(/&amp;/g, '&')
    .trim();
}

function extractTag(block: string, tag: string): string {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const match = block.match(regex);
  return match ? decodeXmlEntities(match[1]) : '';
}

function isValidArticleImage(url: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const lower = url.toLowerCase();
  if (
    lower.includes('pixel') ||
    lower.includes('1x1') ||
    lower.includes('spacer') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.ico') ||
    lower.includes('googleusercontent.com') ||
    lower.includes('s.yimg.com/rz/stage')
  ) {
    return false;
  }
  return true;
}

function extractRssImage(block: string): string | undefined {
  const patterns = [
    /<media:content\b[^>]*\burl=["']([^"']+)["']/i,
    /<media:thumbnail\b[^>]*\burl=["']([^"']+)["']/i,
    /<enclosure\b[^>]*\btype=["']image\/[^"']*["'][^>]*\burl=["']([^"']+)["']/i,
    /<enclosure\b[^>]*\burl=["']([^"']+)["'][^>]*\btype=["']image\/[^"']*["']/i,
    /<enclosure\b[^>]*\burl=["']([^"']+\.(?:jpg|jpeg|png|webp|cms)[^"']*)["']/i,
    /<image>\s*<url>([^<]+)<\/url>/i,
    /<img\b[^>]*\bsrc=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = block.match(re);
    if (m && m[1]) {
      const candidate = decodeRawAttr(m[1]).replace(/^http:\/\//i, 'https://');
      if (isValidArticleImage(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

async function resolveOgImage(articleUrl: string): Promise<string | undefined> {
  if (ogImageCache.has(articleUrl)) {
    return ogImageCache.get(articleUrl) || undefined;
  }
  // Skip Google News redirect wrappers that rarely expose publisher og:image
  if (articleUrl.includes('news.google.com/rss/')) {
    ogImageCache.set(articleUrl, null);
    return undefined;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1600);
  try {
    const res = await fetch(articleUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      ogImageCache.set(articleUrl, null);
      return undefined;
    }
    const html = (await res.text()).slice(0, 32000);
    const metaPatterns = [
      /<meta\b[^>]*\bproperty=["']og:image["'][^>]*\bcontent=["']([^"']+)["']/i,
      /<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bproperty=["']og:image["']/i,
      /<meta\b[^>]*\bname=["']twitter:image["'][^>]*\bcontent=["']([^"']+)["']/i,
      /<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bname=["']twitter:image["']/i,
    ];
    for (const re of metaPatterns) {
      const match = html.match(re);
      if (match && match[1]) {
        const candidate = decodeRawAttr(match[1]).replace(/^http:\/\//i, 'https://');
        if (isValidArticleImage(candidate)) {
          if (ogImageCache.size >= 250) {
            const firstKey = ogImageCache.keys().next().value;
            if (firstKey) ogImageCache.delete(firstKey);
          }
          ogImageCache.set(articleUrl, candidate);
          return candidate;
        }
      }
    }
    ogImageCache.set(articleUrl, null);
    return undefined;
  } catch {
    ogImageCache.set(articleUrl, null);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function enrichMissingImages(items: MarketNewsItem[]): Promise<void> {
  const candidates = items.filter((item) => !item.imageUrl).slice(0, 6);
  if (candidates.length === 0) return;
  await Promise.allSettled(
    candidates.map(async (item) => {
      const resolved = await resolveOgImage(item.url);
      if (resolved) {
        item.imageUrl = resolved;
      }
    })
  );
}

function inferCategory(
  title: string,
  fallback: MarketNewsItem['category']
): MarketNewsItem['category'] {
  const t = title.toLowerCase();
  if (/\b(gold|silver|bullion|mcx|crude|brent|oil|copper|commodity|aluminium|zinc)\b/.test(t)) {
    return 'COMMODITIES';
  }
  if (/\b(forex|fed|fomc|usd\/inr|dollar index|ecb|boj|currency|treasury yield)\b/.test(t)) {
    return 'FOREX_COMMUNITY';
  }
  return fallback;
}

function parseRssItems(
  xml: string,
  defaultSource: string,
  category: MarketNewsItem['category']
): MarketNewsItem[] {
  const items: MarketNewsItem[] = [];
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const rawItem of itemMatches.slice(0, 15)) {
    let title = extractTag(rawItem, 'title');
    const link = extractTag(rawItem, 'link');
    const pubDate = extractTag(rawItem, 'pubDate');
    let source = extractTag(rawItem, 'source') || defaultSource;
    const author = extractTag(rawItem, 'dc:creator') || undefined;
    const imageUrl = extractRssImage(rawItem);

    // Google News headlines typically end with " - Publisher Name"
    if (defaultSource === 'Google News' && title.includes(' - ')) {
      const idx = title.lastIndexOf(' - ');
      const trailingSource = title.slice(idx + 3).trim();
      if (trailingSource && trailingSource.length <= 42) {
        source = trailingSource;
        title = title.slice(0, idx).trim();
      }
    }

    if (!title || !link) continue;
    const parsedTime = pubDate ? new Date(pubDate) : new Date();
    const publishedAt = Number.isNaN(parsedTime.getTime())
      ? new Date().toISOString()
      : parsedTime.toISOString();

    let summary: string | undefined;
    if (defaultSource !== 'Google News') {
      const rawDesc = extractTag(rawItem, 'description');
      if (rawDesc && rawDesc.length > 24 && rawDesc.toLowerCase() !== title.toLowerCase()) {
        summary = rawDesc.length > 180 ? `${rawDesc.slice(0, 177).trim()}...` : rawDesc;
      }
    }

    items.push({
      id: `news_${crypto.createHash('md5').update(`${title}|${link}`).digest('hex').slice(0, 10)}`,
      title,
      summary,
      imageUrl,
      author,
      source,
      url: link,
      publishedAt,
      category: inferCategory(title, category),
    });
  }
  return items;
}

async function fetchTextWithTimeout(url: string, timeoutMs = 5500): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'application/json, application/rss+xml, application/xml, text/xml',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchForexFactoryCalendar(): Promise<EconomicCalendarEvent[]> {
  if (!calendarCache) {
    calendarCache = readDiskCalendarCache();
  }
  if (calendarCache && calendarCache.expiresAt > Date.now() && calendarCache.events.length > 0) {
    return calendarCache.events;
  }

  try {
    const raw = await fetchTextWithTimeout(
      'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
      5500
    );
    const json = JSON.parse(raw) as Array<{
      title?: string;
      country?: string;
      date?: string;
      impact?: string;
      forecast?: string;
      previous?: string;
    }>;

    if (!Array.isArray(json)) return calendarCache?.events || [];

    const nowMs = Date.now();
    const normalized: EconomicCalendarEvent[] = json
      .filter((e) => Boolean(e.title && e.country && e.date))
      .map((e, idx) => {
        const impactRaw = (e.impact || 'Low').toLowerCase();
        const impact: EconomicCalendarEvent['impact'] =
          impactRaw === 'high'
            ? 'High'
            : impactRaw === 'medium'
            ? 'Medium'
            : impactRaw === 'holiday'
            ? 'Holiday'
            : 'Low';

        return {
          id: `ff_${idx}_${(e.country || 'GLB').toUpperCase()}`,
          title: String(e.title).trim(),
          country: String(e.country).toUpperCase().trim(),
          date: String(e.date),
          impact,
          forecast: String(e.forecast || '').trim() || '—',
          previous: String(e.previous || '').trim() || '—',
        };
      });

    const relevant = normalized.filter((ev) => {
      const t = new Date(ev.date).getTime();
      return Number.isFinite(t) && t >= nowMs - 18 * 60 * 60 * 1000;
    });

    const pool = relevant.length >= 6 ? relevant : normalized;
    const impactRank = (imp: EconomicCalendarEvent['impact']) =>
      imp === 'High' ? 0 : imp === 'Medium' ? 1 : imp === 'Low' ? 2 : 3;

    pool.sort((a, b) => {
      const rankDiff = impactRank(a.impact) - impactRank(b.impact);
      if (rankDiff !== 0) return rankDiff;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    const events = pool.slice(0, 18);
    if (events.length > 0) {
      calendarCache = {
        events,
        expiresAt: Date.now() + FF_CALENDAR_TTL_MS,
      };
      writeDiskCalendarCache(calendarCache);
    }
    return events;
  } catch {
    if (calendarCache) {
      calendarCache.expiresAt = Date.now() + FF_BACKOFF_MS;
      return calendarCache.events;
    }
    return [];
  }
}

async function fetchFinnhubNewsIfConfigured(): Promise<MarketNewsItem[]> {
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) return [];
  const raw = await fetchTextWithTimeout(
    `https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(key)}`,
    5000
  );
  const rows = JSON.parse(raw) as Array<{
    id?: number;
    headline?: string;
    summary?: string;
    image?: string;
    source?: string;
    url?: string;
    datetime?: number;
  }>;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => Boolean(r.headline && r.url))
    .slice(0, 10)
    .map((r) => ({
      id: `finnhub_${r.id || crypto.randomUUID().slice(0, 8)}`,
      title: String(r.headline).trim(),
      summary: r.summary ? String(r.summary).slice(0, 180).trim() : undefined,
      imageUrl: r.image && isValidArticleImage(r.image) ? r.image : undefined,
      source: String(r.source || 'Finnhub'),
      url: String(r.url),
      publishedAt: r.datetime
        ? new Date(r.datetime * 1000).toISOString()
        : new Date().toISOString(),
      category: inferCategory(String(r.headline), 'GLOBAL_MACRO'),
    }));
}

async function fetchNewsApiIfConfigured(): Promise<MarketNewsItem[]> {
  const key = process.env.NEWS_API_KEY?.trim();
  if (!key) return [];
  const raw = await fetchTextWithTimeout(
    `https://newsapi.org/v2/everything?q=Nifty+OR+NSE+OR+RBI+OR+Sensex+markets&language=en&sortBy=publishedAt&pageSize=10&apiKey=${encodeURIComponent(
      key
    )}`,
    5000
  );
  const parsed = JSON.parse(raw) as {
    articles?: Array<{
      title?: string;
      description?: string;
      urlToImage?: string;
      url?: string;
      publishedAt?: string;
      source?: { name?: string };
    }>;
  };
  if (!Array.isArray(parsed.articles)) return [];
  return parsed.articles
    .filter((a) => Boolean(a.title && a.url))
    .slice(0, 10)
    .map((a) => ({
      id: `newsapi_${crypto.createHash('md5').update(String(a.url)).digest('hex').slice(0, 10)}`,
      title: String(a.title).trim(),
      summary: a.description ? String(a.description).slice(0, 180).trim() : undefined,
      imageUrl: a.urlToImage && isValidArticleImage(a.urlToImage) ? a.urlToImage : undefined,
      source: String(a.source?.name || 'NewsAPI'),
      url: String(a.url),
      publishedAt: a.publishedAt || new Date().toISOString(),
      category: inferCategory(String(a.title), 'INDIA_MARKETS'),
    }));
}

export async function getLiveMarketNewsFeed(forceRefresh = false): Promise<MarketNewsFeedResponse> {
  if (!forceRefresh && newsCache && newsCache.expiresAt > Date.now()) {
    return newsCache.data;
  }

  const [
    ffRes,
    cnbcRes,
    bsRes,
    mintRes,
    blRes,
    etStocksRes,
    yahooNewsRes,
    fxNewsRes,
    finnhubRes,
    newsApiRes,
  ] = await Promise.allSettled([
    fetchForexFactoryCalendar(),
    fetchTextWithTimeout('https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml').then((xml) =>
      parseRssItems(xml, 'CNBC TV18', 'INDIA_MARKETS')
    ),
    fetchTextWithTimeout('https://www.business-standard.com/rss/markets-106.rss').then((xml) =>
      parseRssItems(xml, 'Business Standard', 'INDIA_MARKETS')
    ),
    fetchTextWithTimeout('https://www.livemint.com/rss/markets').then((xml) =>
      parseRssItems(xml, 'LiveMint', 'INDIA_MARKETS')
    ),
    fetchTextWithTimeout('https://www.thehindubusinessline.com/markets/feeder/default.rss').then(
      (xml) => parseRssItems(xml, 'BusinessLine', 'INDIA_MARKETS')
    ),
    fetchTextWithTimeout('https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms').then(
      (xml) => parseRssItems(xml, 'Economic Times', 'INDIA_MARKETS')
    ),
    fetchTextWithTimeout(
      'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5ENSEI,RELIANCE.NS,TCS.NS,HDFCBANK.NS,ICICIBANK.NS,GC=F&region=IN&lang=en-IN'
    ).then((xml) => parseRssItems(xml, 'Yahoo Finance', 'INDIA_MARKETS')),
    fetchTextWithTimeout(
      'https://news.google.com/rss/search?q=Forex+Factory+OR+Fed+rate+OR+USD+INR+gold+macro+when:2d&hl=en-US&gl=US&ceid=US:en'
    ).then((xml) => parseRssItems(xml, 'Google News', 'FOREX_COMMUNITY')),
    fetchFinnhubNewsIfConfigured(),
    fetchNewsApiIfConfigured(),
  ]);

  const calendar: EconomicCalendarEvent[] = ffRes.status === 'fulfilled' ? ffRes.value : [];

  const rawNews: MarketNewsItem[] = [
    ...(finnhubRes.status === 'fulfilled' ? finnhubRes.value : []),
    ...(newsApiRes.status === 'fulfilled' ? newsApiRes.value : []),
    ...(cnbcRes.status === 'fulfilled' ? cnbcRes.value : []),
    ...(bsRes.status === 'fulfilled' ? bsRes.value : []),
    ...(mintRes.status === 'fulfilled' ? mintRes.value : []),
    ...(blRes.status === 'fulfilled' ? blRes.value : []),
    ...(etStocksRes.status === 'fulfilled' ? etStocksRes.value : []),
    ...(yahooNewsRes.status === 'fulfilled' ? yahooNewsRes.value : []),
    ...(fxNewsRes.status === 'fulfilled' ? fxNewsRes.value : []),
  ];

  const dedupedMap = new Map<string, MarketNewsItem>();
  for (const item of rawNews) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48);
    const existing = dedupedMap.get(key);
    if (!existing) {
      dedupedMap.set(key, item);
      continue;
    }
    const existingScore = (existing.imageUrl ? 2 : 0) + (existing.summary ? 1 : 0);
    const candidateScore = (item.imageUrl ? 2 : 0) + (item.summary ? 1 : 0);
    if (candidateScore > existingScore) {
      dedupedMap.set(key, item);
    }
  }

  const dedupedNews = Array.from(dedupedMap.values())
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 30);

  // Resolve real og:image photographs for any top items missing an RSS media enclosure
  await enrichMissingImages(dedupedNews);

  const sources: string[] = [];
  if (cnbcRes.status === 'fulfilled' && cnbcRes.value.length > 0) sources.push('CNBC TV18');
  if (bsRes.status === 'fulfilled' && bsRes.value.length > 0) sources.push('Business Standard');
  if (mintRes.status === 'fulfilled' && mintRes.value.length > 0) sources.push('LiveMint');
  if (blRes.status === 'fulfilled' && blRes.value.length > 0) sources.push('BusinessLine');
  if (etStocksRes.status === 'fulfilled' && etStocksRes.value.length > 0) {
    sources.push('Economic Times');
  }
  if (yahooNewsRes.status === 'fulfilled' && yahooNewsRes.value.length > 0) {
    sources.push('Yahoo Finance');
  }
  if (calendar.length > 0) sources.push('Forex Factory');
  if (finnhubRes.status === 'fulfilled' && finnhubRes.value.length > 0) sources.push('Finnhub API');
  if (newsApiRes.status === 'fulfilled' && newsApiRes.value.length > 0) sources.push('NewsAPI');

  const payload: MarketNewsFeedResponse = {
    news: dedupedNews,
    calendar,
    sources: sources.length > 0 ? sources : ['Live Indian Markets Wire'],
    updatedAt: new Date().toISOString(),
    hasFinnhubKey: Boolean(process.env.FINNHUB_API_KEY?.trim() || process.env.NEWS_API_KEY?.trim()),
  };

  newsCache = {
    data: payload,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return payload;
}
