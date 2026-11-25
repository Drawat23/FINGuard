import { GoogleGenAI, Type } from '@google/genai';
import type { QuantStrategyDSL } from '../../shared/types.ts';
import { NSE_UNIVERSE_CATALOG } from '../services/marketDataService.ts';

export const GEMINI_TEXT_MODEL = 'gemini-4-hydrogen';
export const GEMINI_EMBED_MODEL = 'gemini-embedding-2';

let cachedClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets.'
    );
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

export function formatGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; status?: string; code?: number } };
    if (parsed?.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // Not raw JSON
  }
  return raw || 'Gemini AI request failed. Please retry in a moment.';
}

export async function withGeminiRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') ||
        msg.includes('429') ||
        msg.includes('ECONNRESET');
      if (!isTransient || attempt === maxAttempts) {
        throw new Error(formatGeminiError(err));
      }
      const delayMs = 600 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(formatGeminiError(lastErr));
}

const VALID_TICKERS = NSE_UNIVERSE_CATALOG.filter((c) => !c.symbol.startsWith('^')).map(
  (c) => c.symbol
);

export async function promptToQuantDSL(userPrompt: string): Promise<QuantStrategyDSL> {
  const ai = getGeminiClient();

  const systemInstruction = `You are a quantitative Indian NSE equity strategist translating English or Hinglish investing ideas into a strict QuantStrategyDSL JSON object.
Valid NSE tickers you MUST choose from: ${VALID_TICKERS.join(', ')}.
Rules:
- Choose 3 to 7 relevant NSE tickers from the valid list.
- For IT queries include TCS.NS, INFY.NS. For Pharma include SUNPHARMA.NS. For Banking include HDFCBANK.NS, ICICIBANK.NS. For Broad/Nifty/Momentum include RELIANCE.NS, TCS.NS, HDFCBANK.NS, ICICIBANK.NS, BHARTIARTL.NS, LT.NS.
- If the user mentions Gold or VIX or crash hedge, set vixHedgeEnabled: true, hedgeAsset: "GOLDBEES.NS" (or "LIQUIDBEES.NS" if they mention cash/liquid/safe), and reasonable vixThreshold (16-24).
- Never invent non-NSE tickers.`;

  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: `Convert this Indian quant strategy prompt into a structured strategy DSL: "${userPrompt}"`,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'Concise 3-6 word strategy name' },
            description: { type: Type.STRING, description: '1-2 sentence explanation of the strategy rules' },
            universe: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Array of valid NSE ticker symbols ending in .NS',
            },
            signalType: {
              type: Type.STRING,
              description: 'One of: MOMENTUM, SMA_CROSSOVER, EMA_CROSSOVER, MEAN_REVERSION, EQUAL_WEIGHT',
            },
            lookbackDays: { type: Type.INTEGER, description: 'Lookback window in trading days (15 to 180)' },
            fastPeriod: { type: Type.INTEGER, description: 'Fast MA period (5 to 30)' },
            slowPeriod: { type: Type.INTEGER, description: 'Slow MA period (20 to 120)' },
            rebalanceFrequency: { type: Type.STRING, description: 'WEEKLY or MONTHLY' },
            vixHedgeEnabled: { type: Type.BOOLEAN },
            vixThreshold: { type: Type.NUMBER, description: 'India VIX threshold (14 to 28)' },
            hedgeAsset: { type: Type.STRING, description: 'GOLDBEES.NS or LIQUIDBEES.NS' },
            hedgeAllocationPct: { type: Type.INTEGER, description: 'Hedge allocation % when triggered (20 to 90)' },
          },
          required: [
            'name',
            'description',
            'universe',
            'signalType',
            'lookbackDays',
            'fastPeriod',
            'slowPeriod',
            'rebalanceFrequency',
            'vixHedgeEnabled',
            'vixThreshold',
            'hedgeAsset',
            'hedgeAllocationPct',
          ],
        },
      },
    })
  );

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Gemini returned an empty strategy DSL response');
  }

  const parsed = JSON.parse(rawText) as Partial<QuantStrategyDSL>;
  const filteredUniverse = (parsed.universe || []).filter((s) => VALID_TICKERS.includes(s));
  const validSignals = ['MOMENTUM', 'SMA_CROSSOVER', 'EMA_CROSSOVER', 'MEAN_REVERSION', 'EQUAL_WEIGHT'];

  return {
    name: parsed.name || 'Custom NSE Quant Strategy',
    description: parsed.description || userPrompt,
    universe:
      filteredUniverse.length >= 2
        ? filteredUniverse
        : ['RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'NIFTYBEES.NS'],
    signalType: validSignals.includes(String(parsed.signalType))
      ? (parsed.signalType as QuantStrategyDSL['signalType'])
      : 'MOMENTUM',
    lookbackDays: Math.min(180, Math.max(15, Number(parsed.lookbackDays) || 60)),
    fastPeriod: Math.min(35, Math.max(5, Number(parsed.fastPeriod) || 20)),
    slowPeriod: Math.min(150, Math.max(20, Number(parsed.slowPeriod) || 50)),
    rebalanceFrequency: parsed.rebalanceFrequency === 'WEEKLY' ? 'WEEKLY' : 'MONTHLY',
    vixHedgeEnabled: Boolean(parsed.vixHedgeEnabled),
    vixThreshold: Math.min(30, Math.max(13, Number(parsed.vixThreshold) || 18)),
    hedgeAsset: parsed.hedgeAsset === 'LIQUIDBEES.NS' ? 'LIQUIDBEES.NS' : 'GOLDBEES.NS',
    hedgeAllocationPct: Math.min(90, Math.max(20, Number(parsed.hedgeAllocationPct) || 60)),
    transactionCostBps: 10,
  };
}
