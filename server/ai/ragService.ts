import crypto from 'crypto';
import zlib from 'zlib';
import { Type, type Content, type FunctionDeclaration } from '@google/genai';
import type { CopilotResponse, RagCitation, RagDocumentRecord } from '../../shared/types.ts';
import { db, type StoredRagChunk } from '../db/store.ts';
import { analyzeMutualFundOverlap } from '../quant/mfOverlapEngine.ts';
import { computeTaxHarvestReport } from '../quant/taxEngine.ts';
import { getHistoricalSeries, getLiveQuote, NSE_UNIVERSE_CATALOG } from '../services/marketDataService.ts';
import { GEMINI_EMBED_MODEL, GEMINI_TEXT_MODEL, getGeminiClient, withGeminiRetry } from './geminiClient.ts';

const PRE_SEEDED_DOCS: Array<{
  id: string;
  title: string;
  category: string;
  sections: Array<{ pageOrSection: string; content: string }>;
}> = [
  {
    id: 'doc_sebi_tax_fy26',
    title: 'SEBI & Indian Capital Gains Tax FY26 Rules',
    category: 'Taxation & Regulation',
    sections: [
      {
        pageOrSection: 'Section 111A (STCG)',
        content:
          'Short-Term Capital Gains (STCG) on listed Indian equities and equity-oriented mutual funds/ETFs held for less than 365 days (12 months) are taxed at a flat 20% under Section 111A of the Income Tax Act (revised upward from 15% in Union Budget FY25-26). STT must be paid on NSE/BSE delivery trades.',
      },
      {
        pageOrSection: 'Section 112A (LTCG)',
        content:
          'Long-Term Capital Gains (LTCG) on listed NSE equities and equity ETFs held for 365 days or more are taxed at 12.5% without indexation, with an annual tax-free exemption limit of ₹1,25,000 per financial year. Investors can harvest up to ₹1,25,000 of LTCG before March 31 and immediately re-buy to step up their acquisition cost basis.',
      },
      {
        pageOrSection: 'Tax-Loss Harvesting & Set-Off',
        content:
          'Short-Term Capital Losses (STCL) can be set off against both STCG (20%) and LTCG (12.5%). Long-Term Capital Losses (LTCL) can only be set off against LTCG. Unabsorbed capital losses can be carried forward for up to 8 assessment years provided the Income Tax Return is filed before the due date.',
      },
      {
        pageOrSection: 'SEBI Finfluencer Guidelines',
        content:
          'SEBI Circular on unregistered financial influencers prohibits regulated entities from associating with unregistered individuals who make guaranteed return claims, multi-bagger promises, or stock tips on social media reels. Investors should verify PE, debt-to-equity, promoter pledge, and 1-year realized volatility before acting on social media tips.',
      },
    ],
  },
  {
    id: 'doc_nifty50_risk_guide',
    title: 'NSE Top Nifty 50 Risk & Sector Guide',
    category: 'Equity Research',
    sections: [
      {
        pageOrSection: 'Page 1 · IT Services (TCS, INFY)',
        content:
          'Tata Consultancy Services (TCS.NS) and Infosys (INFY.NS) are net-cash, high-ROE Indian IT bellwethers with strong dividend yields and USD revenue sensitivity. Key risk factors include US BFSI discretionary tech spend slowdowns and INR/USD currency volatility. Historical annualized volatility typically ranges between 18% and 23%.',
      },
      {
        pageOrSection: 'Page 2 · Private Banking (HDFCBANK, ICICIBANK)',
        content:
          'HDFC Bank (HDFCBANK.NS) and ICICI Bank (ICICIBANK.NS) anchor Nifty 50 financial weight (~22%). Net Interest Margin (NIM) compression during RBI repo rate cut cycles and unsecured retail credit costs are primary drivers. Post-merger LDR normalization remains a closely tracked metric for HDFCBANK.NS.',
      },
      {
        pageOrSection: 'Page 3 · Energy, Auto & Pharma (RELIANCE, TATAMOTORS, SUNPHARMA)',
        content:
          'Reliance Industries (RELIANCE.NS) blends O2C cash flows with Jio Digital and Reliance Retail growth. Tata Motors (TATAMOTORS.NS) carries higher beta (~30% annualized volatility) driven by JLR cyclicality and domestic EV capex. Sun Pharma (SUNPHARMA.NS) offers defensive US specialty pharma margins with lower correlation to domestic credit cycles.',
      },
    ],
  },
  {
    id: 'doc_rbi_hedging_playbook',
    title: 'RBI Liquidity & Gold/LiquidBees Hedging Playbook',
    category: 'Quant Risk Management',
    sections: [
      {
        pageOrSection: 'Section 1 · India VIX Regime Switching',
        content:
          'India VIX (^INDIAVIX) measures 30-day expected Nifty 50 volatility. Readings below 15 signal calm bull markets where momentum strategies outperform. Readings above 18–20 signal heightened tail-risk regimes where rotating 50%–70% of equity capital into GOLDBEES.NS or LIQUIDBEES.NS sharply compresses maximum drawdown and improves Calmar ratio.',
      },
      {
        pageOrSection: 'Section 2 · LiquidBees & Emergency Sizing',
        content:
          'LIQUIDBEES.NS tracks overnight TREPS/call money rates anchored near India 91-day T-Bill yield (~6.7% p.a.) with near-zero price drawdown. For salaried UPI cashflow management, maintaining an emergency buffer equal to Monthly Spend Mean + 1.5 * Monthly Spend StdDev prevents forced equity liquidation during market crashes.',
      },
      {
        pageOrSection: 'Section 3 · Mutual Fund Closet Indexing',
        content:
          'Holding 3 or more large-cap or flexi-cap Indian mutual funds often creates 55%–75% portfolio overlap around top Nifty 50 stocks while paying active expense ratios of 0.6%–1.0%. Combining one low-cost Nifty 50 Index fund (UTI Nifty 50) with one non-overlapping Mid/Small Cap or Flexi-Cap fund maximizes net alpha.',
      },
    ],
  },
];

function extractKeywords(text: string): string[] {
  const stop = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'into', 'can', 'per']);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9.^_-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !stop.has(t));
  return Array.from(new Set(tokens));
}

function deterministicLocalVector(text: string, dims = 64): number[] {
  const vec = new Array<number>(dims).fill(0);
  const words = extractKeywords(text);
  for (const w of words) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

async function computeEmbedding(text: string): Promise<number[]> {
  try {
    const ai = getGeminiClient();
    const res = await ai.models.embedContent({
      model: GEMINI_EMBED_MODEL,
      contents: text,
    });
    const values = res.embeddings?.[0]?.values;
    if (Array.isArray(values) && values.length > 0) {
      return values;
    }
  } catch {
    // Fallback to deterministic sparse-hashed vector if key/embedding endpoint unavailable during boot
  }
  return deterministicLocalVector(text);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den > 0 ? dot / den : 0;
}

function bm25KeywordScore(queryKeywords: string[], chunkKeywords: string[], rawContent: string): number {
  if (queryKeywords.length === 0) return 0;
  const set = new Set(chunkKeywords);
  const lower = rawContent.toLowerCase();
  let hits = 0;
  for (const qk of queryKeywords) {
    if (set.has(qk)) hits += 1.2;
    else if (lower.includes(qk)) hits += 0.7;
    // Boost exact NSE ticker matches
    if (qk.endsWith('.ns') && lower.includes(qk)) hits += 1.5;
  }
  return Math.min(1, hits / Math.max(2, queryKeywords.length));
}

export async function ensureSeededRagDocuments(): Promise<void> {
  const existingDocs = db.getRagDocuments(null);
  if (existingDocs.some((d) => d.id === 'doc_sebi_tax_fy26')) {
    return;
  }

  for (const doc of PRE_SEEDED_DOCS) {
    const chunks: StoredRagChunk[] = [];
    for (let i = 0; i < doc.sections.length; i++) {
      const sec = doc.sections[i];
      const embedding = deterministicLocalVector(`${doc.title} ${sec.pageOrSection} ${sec.content}`);
      chunks.push({
        id: `chk_${doc.id}_${i + 1}`,
        documentId: doc.id,
        userId: null,
        docTitle: doc.title,
        pageOrSection: sec.pageOrSection,
        content: sec.content,
        embedding,
        keywords: extractKeywords(`${doc.title} ${sec.pageOrSection} ${sec.content}`),
      });
    }

    const docRecord: RagDocumentRecord = {
      id: doc.id,
      userId: null,
      title: doc.title,
      category: doc.category,
      sourceType: 'PRE_SEEDED',
      chunkCount: chunks.length,
      createdAt: new Date().toISOString(),
    };
    await db.saveRagDocumentWithChunks(docRecord, chunks);
  }
}

export function extractTextFromPdfBuffer(buffer: Buffer): string {
  const rawLatin = buffer.toString('latin1');
  const extractedParts: string[] = [];

  // Decompress FlateDecode PDF streams when present
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(rawLatin)) !== null) {
    const streamBytes = Buffer.from(match[1], 'latin1');
    let textStream = '';
    try {
      textStream = zlib.inflateSync(streamBytes).toString('latin1');
    } catch {
      textStream = match[1];
    }
    const tjMatches = textStream.match(/\(([^()]{2,300})\)\s*T[jJ]/g);
    if (tjMatches) {
      for (const m of tjMatches) {
        const inner = m.replace(/^\(/, '').replace(/\)\s*T[jJ]$/, '');
        const clean = inner.replace(/\\([()\\])/g, '$1').replace(/[^\x20-\x7E\n]/g, ' ').trim();
        if (clean.length > 1) extractedParts.push(clean);
      }
    }
  }

  // Also grab readable ASCII runs if PDF uses uncompressed text objects
  if (extractedParts.join(' ').trim().length < 80) {
    const asciiRuns = rawLatin.match(/[A-Za-z0-9₹.,;:%()\-/ ]{12,}/g) || [];
    const filtered = asciiRuns.filter(
      (r) => !/obj|endobj|stream|xref|FlateDecode|FontDescriptor|Type\s*\/Page/i.test(r)
    );
    extractedParts.push(...filtered.slice(0, 200));
  }

  return extractedParts.join(' ').replace(/\s+/g, ' ').trim();
}

export async function ingestUserDocument(params: {
  userId: string;
  title: string;
  category: string;
  rawText: string;
}): Promise<RagDocumentRecord> {
  const cleanText = params.rawText.replace(/\r\n/g, '\n').trim();
  if (cleanText.length < 30) {
    throw new Error('Uploaded document contains too little readable text (minimum 30 characters).');
  }

  // Split into ~550 char overlapping chunks with section labels
  const words = cleanText.split(/\s+/);
  const chunkSizeWords = 95;
  const overlapWords = 15;
  const textChunks: string[] = [];

  for (let i = 0; i < words.length; i += chunkSizeWords - overlapWords) {
    const slice = words.slice(i, i + chunkSizeWords).join(' ');
    if (slice.trim().length > 15) textChunks.push(slice.trim());
    if (i + chunkSizeWords >= words.length) break;
  }

  const docId = `doc_${crypto.randomUUID().slice(0, 10)}`;
  const storedChunks: StoredRagChunk[] = [];

  for (let idx = 0; idx < textChunks.length.valueOf(); idx++) {
    const content = textChunks[idx];
    const pageOrSection = `Page ${Math.floor(idx / 2) + 1} · Chunk ${idx + 1}`;
    const embedding = await computeEmbedding(`${params.title} ${content}`);
    storedChunks.push({
      id: `chk_${docId}_${idx + 1}`,
      documentId: docId,
      userId: params.userId,
      docTitle: params.title,
      pageOrSection,
      content,
      embedding,
      keywords: extractKeywords(`${params.title} ${content}`),
    });
  }

  const doc: RagDocumentRecord = {
    id: docId,
    userId: params.userId,
    title: params.title,
    category: params.category || 'User Research',
    sourceType: 'USER_UPLOAD',
    chunkCount: storedChunks.length,
    createdAt: new Date().toISOString(),
  };

  await db.saveRagDocumentWithChunks(doc, storedChunks);
  return doc;
}

export async function hybridSearchRag(userId: string, query: string, topK = 4): Promise<RagCitation[]> {
  await ensureSeededRagDocuments();
  const chunks = db.getRagChunks(userId);
  const queryKeywords = extractKeywords(query);
  const queryVec = await computeEmbedding(query);
  const fallbackQueryVec = deterministicLocalVector(query);

  const scored = chunks.map((chunk) => {
    const vecSim =
      chunk.embedding.length === queryVec.length
        ? cosineSimilarity(queryVec, chunk.embedding)
        : cosineSimilarity(fallbackQueryVec, deterministicLocalVector(chunk.content));
    const kwScore = bm25KeywordScore(queryKeywords, chunk.keywords, chunk.content);
    const hybridScore = 0.65 * Math.max(0, vecSim) + 0.35 * kwScore;
    return { chunk, score: Number(hybridScore.toFixed(3)) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => ({
    chunkId: s.chunk.id,
    documentId: s.chunk.documentId,
    docTitle: s.chunk.docTitle,
    pageOrSection: s.chunk.pageOrSection,
    score: s.score,
    excerpt: s.chunk.content,
  }));
}

async function computeEnrichedPortfolioForUser(userId: string) {
  const rawHoldings = db.getHoldings(userId);
  const enriched = await Promise.all(
    rawHoldings.map(async (h) => {
      const q = await getLiveQuote(h.symbol);
      const investedValue = h.quantity * h.avgBuyPrice;
      const currentValue = h.quantity * q.price;
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
        currentPrice: q.price,
        dayChangePct: q.changePct,
        investedValue: Math.round(investedValue),
        currentValue: Math.round(currentValue),
        unrealizedPnl: Math.round(unrealizedPnl),
        unrealizedPnlPct: Number(unrealizedPnlPct.toFixed(2)),
        holdingDays,
        taxBucket,
        estimatedTaxInr,
        dataSource: q.dataSource,
      };
    })
  );
  return enriched;
}

export async function askFinquantCopilot(params: {
  userId: string;
  query: string;
  mode: CopilotResponse['mode'];
}): Promise<CopilotResponse> {
  await ensureSeededRagDocuments();
  const ai = getGeminiClient();
  const citations = await hybridSearchRag(params.userId, params.query, 4);
  const toolsUsed: string[] = ['hybridRagSearch'];

  const getUserPortfolioAndTaxTool: FunctionDeclaration = {
    name: 'getUserPortfolioAndTax',
    description:
      'Fetch the authenticated user real portfolio holdings, INR cash balances, and FY26 STCG/LTCG tax harvest report from the deterministic backend.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        includeMfOverlapCheck: {
          type: Type.BOOLEAN,
          description: 'Set true to also evaluate popular Indian MF overlap benchmark',
        },
      },
    },
  };

  const getLiveMarketQuoteTool: FunctionDeclaration = {
    name: 'getLiveMarketQuote',
    description:
      'Fetch real NSE price, 1-year return, and annualized volatility for an Indian stock or ETF symbol (e.g. RELIANCE.NS, TCS.NS, TATAMOTORS.NS, GOLDBEES.NS, ^NSEI).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        symbol: {
          type: Type.STRING,
          description: 'NSE ticker symbol like RELIANCE.NS, TCS.NS, HDFCBANK.NS, TATAMOTORS.NS',
        },
      },
      required: ['symbol'],
    },
  };

  const ragContextText = citations
    .map(
      (c, i) =>
        `[Source ${i + 1}: ${c.docTitle}, ${c.pageOrSection}]\n${c.excerpt}`
    )
    .join('\n\n');

  const modeDirective =
    params.mode === 'BS_DETECTOR'
      ? `You are in FINFLUENCER BS-DETECTOR mode. Critically fact-check the pasted stock tip, reel claim, or guaranteed-return pitch using real NSE market metrics (via getLiveMarketQuote if a ticker is mentioned) and SEBI guidelines in the retrieved RAG context. Highlight valuation/volatility risks, unrealistic return math, and finish with a crisp verdict.`
      : params.mode === 'PORTFOLIO_DIAGNOSTIC'
      ? `You are in PORTFOLIO DIAGNOSTIC mode. Call getUserPortfolioAndTax immediately to inspect the user's real holdings, sector concentration, STCG/LTCG tax moves, and MF overlap, then give direct, constructive Indian wealth advice.`
      : `You are FINGuard AI Copilot, India's quantitative wealth research assistant. Ground answers strictly in retrieved RAG sources and live backend tool calls. Cite retrieved facts inline as [Doc Title, Page/Section]. NEVER invent or calculate financial numbers on your own—always cite the exact numbers returned by tools or RAG context.`;

  const contents: Content[] = [
    {
      role: 'user',
      parts: [
        {
          text: `Retrieved Knowledge Base Chunks:\n${ragContextText}\n\nUser Question (${params.mode}): ${params.query}`,
        },
      ],
    },
  ];

  const tools = [{ functionDeclarations: [getUserPortfolioAndTaxTool, getLiveMarketQuoteTool] }];

  let response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents,
      config: {
        systemInstruction: modeDirective,
        tools,
      },
    })
  );

  let detectedTicker: string | undefined;
  let detectedPrice: number | undefined;
  let detected1YRet: number | undefined;
  let detectedVol: number | undefined;

  // Handle up to 2 rounds of deterministic tool execution
  for (let round = 0; round < 2; round++) {
    const calls = response.functionCalls;
    if (!calls || calls.length === 0) break;

    const prevContent = response.candidates?.[0]?.content;
    if (prevContent) contents.push(prevContent);

    const responseParts = [];
    for (const call of calls) {
      if (call.name === 'getUserPortfolioAndTax') {
        toolsUsed.push('getUserPortfolioAndTax');
        const enriched = await computeEnrichedPortfolioForUser(params.userId);
        const orders = db.getOrders(params.userId);
        const taxReport = computeTaxHarvestReport(enriched, orders);
        const cashAcc = db.getAccountByType(params.userId, 'CASH_INR');
        const sipAcc = db.getAccountByType(params.userId, 'SIP_ESCROW');
        let mfOverlap = null;
        if ((call.args as { includeMfOverlapCheck?: boolean })?.includeMfOverlapCheck) {
          try {
            toolsUsed.push('analyzeMutualFundOverlap');
            mfOverlap = await analyzeMutualFundOverlap([122639, 120716, 119598]);
          } catch {
            mfOverlap = null;
          }
        }
        responseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name,
            response: {
              cashInr: Math.round((cashAcc?.balancePaise || 0) / 100),
              sipEscrowInr: Math.round((sipAcc?.balancePaise || 0) / 100),
              holdings: enriched.map((h) => ({
                symbol: h.symbol,
                qty: h.quantity,
                avgBuyPrice: h.avgBuyPrice,
                currentPrice: h.currentPrice,
                currentValueInr: h.currentValue,
                unrealizedPnlInr: h.unrealizedPnl,
                unrealizedPnlPct: h.unrealizedPnlPct,
                taxBucket: h.taxBucket,
                holdingDays: h.holdingDays,
              })),
              taxHarvestReport: taxReport,
              mfOverlapSample: mfOverlap,
            },
          },
        });
      } else if (call.name === 'getLiveMarketQuote') {
        toolsUsed.push('getLiveMarketQuote');
        const rawSym = String((call.args as { symbol?: string })?.symbol || '^NSEI').toUpperCase();
        const normalizedSym =
          NSE_UNIVERSE_CATALOG.find(
            (c) => c.symbol === rawSym || c.symbol === `${rawSym}.NS` || c.name.toUpperCase().includes(rawSym)
          )?.symbol || (rawSym.includes('.') || rawSym.startsWith('^') ? rawSym : `${rawSym}.NS`);

        const { candles, quote } = await getHistoricalSeries(normalizedSym);
        const slice1Y = candles.slice(-252);
        const start1Y = slice1Y[0]?.close || quote.price;
        const ret1Y = ((quote.price - start1Y) / start1Y) * 100;
        const rets: number[] = [];
        for (let i = 1; i < slice1Y.length; i++) {
          rets.push((slice1Y[i].close - slice1Y[i - 1].close) / slice1Y[i - 1].close);
        }
        const m = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
        const v = rets.reduce((a, r) => a + (r - m) ** 2, 0) / Math.max(1, rets.length - 1);
        const annVol = Math.sqrt(v) * Math.sqrt(252) * 100;

        detectedTicker = quote.symbol;
        detectedPrice = quote.price;
        detected1YRet = Number(ret1Y.toFixed(1));
        detectedVol = Number(annVol.toFixed(1));

        responseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name,
            response: {
              symbol: quote.symbol,
              name: quote.name,
              priceInr: quote.price,
              dayChangePct: quote.changePct,
              oneYearReturnPct: detected1YRet,
              annualizedVolatilityPct: detectedVol,
              dataSource: quote.dataSource,
            },
          },
        });
      }
    }

    contents.push({ role: 'user', parts: responseParts });
    response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: GEMINI_TEXT_MODEL,
        contents,
        config: {
          systemInstruction: modeDirective,
          tools,
        },
      })
    );
  }

  const answer = (response.text ?? 'Unable to generate response.').trim();

  let riskVerdict: CopilotResponse['riskVerdict'];
  if (params.mode === 'BS_DETECTOR') {
    const qLower = params.query.toLowerCase();
    const hasHypeWords = /guaranteed|3x|5x|10x|multibagger|sure shot|jackpot|double|rocket|telegram|reel|100%/i.test(
      qLower
    );
    const highVol = (detectedVol ?? 0) > 28;
    const verdict = hasHypeWords
      ? 'HIGH_RISK_HYPE'
      : highVol || /smallcap|penny|fno|options|futures/i.test(qLower)
      ? 'CAUTION_SPECULATIVE'
      : 'FUNDAMENTALLY_SOUND';

    riskVerdict = {
      verdict,
      headline:
        verdict === 'HIGH_RISK_HYPE'
          ? 'Unrealistic Return Claim Flagged (SEBI Risk Warning)'
          : verdict === 'CAUTION_SPECULATIVE'
          ? 'Elevated Volatility / Speculative Pitch'
          : 'Reasonable Thesis — Verify Allocation Sizing',
      symbolChecked: detectedTicker,
      priceInr: detectedPrice,
      oneYearReturnPct: detected1YRet,
      volatilityPct: detectedVol,
    };
  }

  return {
    answer,
    mode: params.mode,
    citations,
    toolsUsed: Array.from(new Set(toolsUsed)),
    riskVerdict,
  };
}
