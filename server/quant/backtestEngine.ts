import type {
  BacktestMetrics,
  BacktestResult,
  EquityPoint,
  MarketCandle,
  MonteCarloDayPoint,
  QuantStrategyDSL,
} from '../../shared/types.ts';
import { getHistoricalSeries } from '../services/marketDataService.ts';

const INDIA_RISK_FREE_RATE = 0.067; // 6.7% 91-day T-Bill / LiquidBees benchmark

function sma(series: number[], idx: number, period: number): number {
  const start = Math.max(0, idx - period + 1);
  let sum = 0;
  let count = 0;
  for (let i = start; i <= idx; i++) {
    sum += series[i];
    count++;
  }
  return count > 0 ? sum / count : series[idx];
}

function emaSeries(series: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out = new Array<number>(series.length);
  out[0] = series[0];
  for (let i = 1; i < series.length; i++) {
    out[i] = series[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export function runMonteCarloGBM(params: {
  annualMeanReturn: number;
  annualVol: number;
  initialCapital: number;
  horizonDays?: number;
  pathsCount?: number;
}): BacktestResult['monteCarlo'] {
  const horizonDays = params.horizonDays ?? 252;
  const pathsCount = params.pathsCount ?? 1000;
  const dt = 1 / 252;
  const mu = Number.isFinite(params.annualMeanReturn) ? params.annualMeanReturn : 0.14;
  const sigma = Math.max(0.04, Number.isFinite(params.annualVol) ? params.annualVol : 0.15);
  const drift = (mu - 0.5 * sigma * sigma) * dt;
  const volStep = sigma * Math.sqrt(dt);

  // Deterministic PRNG so same parameters produce reproducible, jitter-free fan charts
  let seed = 424242;
  const rand = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Store values at checkpoints every 10 trading days (26 checkpoints including day 0)
  const checkpoints: number[] = [];
  for (let d = 0; d <= horizonDays; d += 12) checkpoints.push(d);
  if (checkpoints[checkpoints.length - 1] !== horizonDays) checkpoints.push(horizonDays);

  const buckets: number[][] = checkpoints.map(() => []);
  const finals: number[] = [];

  for (let p = 0; p < pathsCount; p++) {
    let val = params.initialCapital;
    buckets[0].push(val);
    let cpIdx = 1;

    for (let day = 1; day <= horizonDays; day++) {
      const u1 = Math.max(1e-7, rand());
      const u2 = rand();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      val = val * Math.exp(drift + volStep * z);
      if (cpIdx < checkpoints.length && day === checkpoints[cpIdx]) {
        buckets[cpIdx].push(val);
        cpIdx++;
      }
    }
    finals.push(val);
  }

  const quantile = (sorted: number[], q: number) => {
    const pos = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
    return Math.round(sorted[pos]);
  };

  const fanSeries: MonteCarloDayPoint[] = checkpoints.map((day, idx) => {
    const sorted = [...buckets[idx]].sort((a, b) => a - b);
    return {
      day,
      p10: quantile(sorted, 0.1),
      p25: quantile(sorted, 0.25),
      p50: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75),
      p90: quantile(sorted, 0.9),
    };
  });

  const sortedFinals = [...finals].sort((a, b) => a - b);
  const p5Idx = Math.max(0, Math.floor(0.05 * sortedFinals.length));
  const tailSlice = sortedFinals.slice(0, Math.max(1, p5Idx));
  const cvarMean = tailSlice.reduce((a, b) => a + b, 0) / tailSlice.length;

  return {
    horizonDays,
    pathsCount,
    initialCapital: params.initialCapital,
    medianFinal: quantile(sortedFinals, 0.5),
    p10Final: quantile(sortedFinals, 0.1),
    p90Final: quantile(sortedFinals, 0.9),
    var95Inr: Math.max(0, Math.round(params.initialCapital - sortedFinals[p5Idx])),
    cvar95Inr: Math.max(0, Math.round(params.initialCapital - cvarMean)),
    fanSeries,
  };
}

export async function runQuantBacktest(dsl: QuantStrategyDSL): Promise<BacktestResult> {
  const uniqueUniverse = Array.from(
    new Set(dsl.universe.length > 0 ? dsl.universe : ['RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS'])
  );
  const symbolsToFetch = Array.from(
    new Set([...uniqueUniverse, dsl.hedgeAsset || 'GOLDBEES.NS', '^NSEI', '^INDIAVIX'])
  );

  const fetched = await Promise.all(
    symbolsToFetch.map(async (sym) => ({ sym, res: await getHistoricalSeries(sym) }))
  );

  const mapBySym = new Map<string, Map<string, number>>();
  const sourceFlags = new Set<string>();
  for (const item of fetched) {
    sourceFlags.add(item.res.quote.dataSource);
    const m = new Map<string, number>();
    for (const c of item.res.candles) {
      m.set(c.date, c.close);
    }
    mapBySym.set(item.sym, m);
  }

  // Align dates using Nifty 50 benchmark calendar
  const benchCandles: MarketCandle[] =
    fetched.find((f) => f.sym === '^NSEI')?.res.candles || fetched[0].res.candles;
  const dates = benchCandles
    .map((c) => c.date)
    .filter((d) => uniqueUniverse.every((sym) => mapBySym.get(sym)?.has(d)) && mapBySym.get('^NSEI')?.has(d));

  if (dates.length < 60) {
    throw new Error('Not enough overlapping NSE trading days to run backtest');
  }

  // Forward-fill VIX and hedge asset if a date is missing
  const priceMatrix: Record<string, number[]> = {};
  for (const sym of symbolsToFetch) {
    const symMap = mapBySym.get(sym)!;
    const arr: number[] = [];
    let lastKnown = Array.from(symMap.values())[0] || 100;
    for (const d of dates) {
      const p = symMap.get(d);
      if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
        lastKnown = p;
      }
      arr.push(lastKnown);
    }
    priceMatrix[sym] = arr;
  }

  const emaFastMap: Record<string, number[]> = {};
  const emaSlowMap: Record<string, number[]> = {};
  for (const sym of uniqueUniverse) {
    emaFastMap[sym] = emaSeries(priceMatrix[sym], Math.max(5, dsl.fastPeriod || 20));
    emaSlowMap[sym] = emaSeries(priceMatrix[sym], Math.max(15, dsl.slowPeriod || 50));
  }

  const warmup = Math.min(Math.max(25, dsl.lookbackDays || 60, dsl.slowPeriod || 50), Math.floor(dates.length / 3));
  const rebalanceStep = dsl.rebalanceFrequency === 'WEEKLY' ? 5 : 21;
  const costRate = (dsl.transactionCostBps || 10) / 10000;

  let currentWeights: Record<string, number> = {};
  for (const sym of uniqueUniverse) currentWeights[sym] = 1 / uniqueUniverse.length;
  currentWeights[dsl.hedgeAsset] = 0;

  let stratNav = 100000;
  let benchNav = 100000;
  let peakNav = 100000;
  let totalTrades = 0;

  const dailyReturns: number[] = [];
  const benchReturns: number[] = [];
  const equityCurve: EquityPoint[] = [];

  for (let i = warmup; i < dates.length; i++) {
    const prevIdx = i - 1;
    // Daily portfolio return based on weights held entering day i
    let dayRet = 0;
    for (const [sym, w] of Object.entries(currentWeights)) {
      if (w <= 0) continue;
      const p0 = priceMatrix[sym][prevIdx];
      const p1 = priceMatrix[sym][i];
      if (p0 > 0) {
        dayRet += w * ((p1 - p0) / p0);
      }
    }

    const b0 = priceMatrix['^NSEI'][prevIdx];
    const b1 = priceMatrix['^NSEI'][i];
    const bRet = b0 > 0 ? (b1 - b0) / b0 : 0;

    // Rebalance check
    const vix = priceMatrix['^INDIAVIX'][i] ?? 15;
    let inHedge = false;

    if ((i - warmup) % rebalanceStep === 0) {
      const targetWeights: Record<string, number> = {};
      for (const sym of [...uniqueUniverse, dsl.hedgeAsset]) targetWeights[sym] = 0;

      const scores: Array<{ sym: string; score: number }> = [];
      for (const sym of uniqueUniverse) {
        const prices = priceMatrix[sym];
        const cur = prices[i];
        if (dsl.signalType === 'MOMENTUM') {
          const lb = Math.max(10, Math.min(dsl.lookbackDays || 60, i - 1));
          const ret = (cur - prices[i - lb]) / prices[i - lb];
          if (ret > 0) scores.push({ sym, score: ret });
        } else if (dsl.signalType === 'SMA_CROSSOVER') {
          const f = sma(prices, i, Math.max(5, dsl.fastPeriod || 20));
          const s = sma(prices, i, Math.max(15, dsl.slowPeriod || 50));
          if (f > s) scores.push({ sym, score: (f - s) / s });
        } else if (dsl.signalType === 'EMA_CROSSOVER') {
          const f = emaFastMap[sym][i];
          const s = emaSlowMap[sym][i];
          if (f > s) scores.push({ sym, score: (f - s) / s });
        } else if (dsl.signalType === 'MEAN_REVERSION') {
          const avg = sma(prices, i, Math.max(10, dsl.lookbackDays || 20));
          const z = (avg - cur) / avg;
          if (z > -0.02) scores.push({ sym, score: z + 0.05 });
        } else {
          scores.push({ sym, score: 1 });
        }
      }

      scores.sort((a, b) => b.score - a.score);
      const topN = scores.slice(0, Math.max(1, Math.ceil(uniqueUniverse.length * 0.6)));

      let hedgeFrac = 0;
      if (dsl.vixHedgeEnabled && vix > (dsl.vixThreshold || 18)) {
        hedgeFrac = Math.min(0.9, Math.max(0.2, (dsl.hedgeAllocationPct || 60) / 100));
        inHedge = true;
      } else if (topN.length === 0) {
        hedgeFrac = 0.8;
        inHedge = true;
      }

      const equityFrac = 1 - hedgeFrac;
      if (topN.length > 0) {
        const perStock = equityFrac / topN.length;
        for (const t of topN) {
          targetWeights[t.sym] = (targetWeights[t.sym] || 0) + perStock;
        }
      } else {
        targetWeights[dsl.hedgeAsset] += equityFrac;
      }
      targetWeights[dsl.hedgeAsset] = (targetWeights[dsl.hedgeAsset] || 0) + hedgeFrac;

      // Compute turnover & Indian STT/brokerage transaction cost
      let turnover = 0;
      for (const sym of Object.keys(targetWeights)) {
        const diff = Math.abs((targetWeights[sym] || 0) - (currentWeights[sym] || 0));
        if (diff > 0.02) totalTrades++;
        turnover += diff;
      }
      dayRet -= turnover * 0.5 * costRate;
      currentWeights = targetWeights;
    } else {
      inHedge = (currentWeights[dsl.hedgeAsset] || 0) >= 0.25;
    }

    stratNav = stratNav * (1 + dayRet);
    benchNav = benchNav * (1 + bRet);
    peakNav = Math.max(peakNav, stratNav);
    const drawdownPct = Number((((stratNav - peakNav) / peakNav) * 100).toFixed(2));

    dailyReturns.push(dayRet);
    benchReturns.push(bRet);

    // Sample points cleanly (keep up to ~220 points for smooth chart rendering)
    const stride = dates.length - warmup > 240 ? Math.floor((dates.length - warmup) / 220) : 1;
    if ((i - warmup) % stride === 0 || i === dates.length - 1) {
      equityCurve.push({
        date: dates[i],
        strategyNav: Math.round(stratNav),
        benchmarkNav: Math.round(benchNav),
        drawdownPct,
        vix: Number(vix.toFixed(2)),
        inHedge,
      });
    }
  }

  const n = dailyReturns.length;
  const years = Math.max(0.25, n / 252);
  const cagr = Math.pow(stratNav / 100000, 1 / years) - 1;
  const benchCagr = Math.pow(benchNav / 100000, 1 / years) - 1;

  const meanDaily = dailyReturns.reduce((a, b) => a + b, 0) / n;
  const variance = dailyReturns.reduce((a, r) => a + (r - meanDaily) ** 2, 0) / Math.max(1, n - 1);
  const annVol = Math.sqrt(variance) * Math.sqrt(252);

  const downsideSq = dailyReturns
    .filter((r) => r < INDIA_RISK_FREE_RATE / 252)
    .reduce((a, r) => a + (r - INDIA_RISK_FREE_RATE / 252) ** 2, 0);
  const downsideDev = Math.sqrt(downsideSq / Math.max(1, n)) * Math.sqrt(252);

  const sharpeRatio = annVol > 0 ? (cagr - INDIA_RISK_FREE_RATE) / annVol : 0;
  const sortinoRatio = downsideDev > 0 ? (cagr - INDIA_RISK_FREE_RATE) / downsideDev : sharpeRatio;
  const maxDrawdownPct = Math.min(...equityCurve.map((e) => e.drawdownPct));
  const calmarRatio = maxDrawdownPct < 0 ? (cagr * 100) / Math.abs(maxDrawdownPct) : 0;
  const winRatePct = (dailyReturns.filter((r) => r > 0).length / Math.max(1, n)) * 100;

  const sortedDaily = [...dailyReturns].sort((a, b) => a - b);
  const var95DailyPct = (sortedDaily[Math.floor(0.05 * sortedDaily.length)] || -0.015) * 100;

  const metrics: BacktestMetrics = {
    cagrPct: Number((cagr * 100).toFixed(2)),
    benchmarkCagrPct: Number((benchCagr * 100).toFixed(2)),
    alphaPct: Number(((cagr - benchCagr) * 100).toFixed(2)),
    annualizedVolPct: Number((annVol * 100).toFixed(2)),
    sharpeRatio: Number(sharpeRatio.toFixed(2)),
    sortinoRatio: Number(sortinoRatio.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    calmarRatio: Number(calmarRatio.toFixed(2)),
    winRatePct: Number(winRatePct.toFixed(1)),
    var95DailyPct: Number(var95DailyPct.toFixed(2)),
    totalTrades,
    finalValue1L: Math.round(stratNav),
  };

  const monteCarlo = runMonteCarloGBM({
    annualMeanReturn: cagr,
    annualVol: annVol,
    initialCapital: 100000,
    horizonDays: 252,
    pathsCount: 1000,
  });

  const dataSourceSummary = sourceFlags.has('LIVE_NSE') ? 'LIVE_NSE' : 'CACHED';

  return {
    dsl,
    metrics,
    equityCurve,
    monteCarlo,
    dataSourceSummary,
  };
}
