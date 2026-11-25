import type {
  EfficientFrontierPoint,
  EfficientFrontierResult,
  EnrichedHolding,
  RebalanceDelta,
} from '../../shared/types.ts';
import { getHistoricalSeries } from '../services/marketDataService.ts';
import { runMonteCarloGBM } from './backtestEngine.ts';

const INDIA_RF = 0.067;

export async function runPortfolioOptimizer(
  holdings: EnrichedHolding[]
): Promise<EfficientFrontierResult> {
  const active = holdings.filter((h) => h.currentValue > 0);
  if (active.length < 2) {
    throw new Error('Add at least 2 NSE holdings to run Markowitz Efficient Frontier optimization');
  }

  const symbols = active.map((h) => h.symbol);
  const totalValue = active.reduce((s, h) => s + h.currentValue, 0);
  const currentWeightsVec = active.map((h) => h.currentValue / totalValue);

  const seriesList = await Promise.all(symbols.map((s) => getHistoricalSeries(s)));
  const dateMaps = seriesList.map((s) => {
    const m = new Map<string, number>();
    for (const c of s.candles) m.set(c.date, c.close);
    return m;
  });

  // Align common dates (last 252+ trading days)
  const commonDates = seriesList[0].candles
    .map((c) => c.date)
    .filter((d) => dateMaps.every((m) => m.has(d)))
    .slice(-260);

  const nAssets = symbols.length;
  const logReturns: number[][] = Array.from({ length: nAssets }, () => []);

  for (let a = 0; a < nAssets; a++) {
    const m = dateMaps[a];
    for (let t = 1; t < commonDates.length; t++) {
      const p0 = m.get(commonDates[t - 1])!;
      const p1 = m.get(commonDates[t])!;
      logReturns[a].push(p0 > 0 && p1 > 0 ? Math.log(p1 / p0) : 0);
    }
  }

  const nObs = Math.max(20, logReturns[0].length);
  const annMean = logReturns.map(
    (arr) => (arr.reduce((sum, r) => sum + r, 0) / nObs) * 252
  );

  // Sample Covariance Matrix (annualized)
  const cov: number[][] = Array.from({ length: nAssets }, () => new Array(nAssets).fill(0));
  const dailyMeans = logReturns.map((arr) => arr.reduce((s, r) => s + r, 0) / nObs);
  for (let i = 0; i < nAssets; i++) {
    for (let j = i; j < nAssets; j++) {
      let sum = 0;
      for (let t = 0; t < nObs; t++) {
        sum += (logReturns[i][t] - dailyMeans[i]) * (logReturns[j][t] - dailyMeans[j]);
      }
      const val = (sum / Math.max(1, nObs - 1)) * 252;
      cov[i][j] = val;
      cov[j][i] = val;
    }
  }

  const evalPortfolio = (w: number[]): EfficientFrontierPoint => {
    let expRet = 0;
    for (let i = 0; i < nAssets; i++) expRet += w[i] * annMean[i];
    let varP = 0;
    for (let i = 0; i < nAssets; i++) {
      for (let j = 0; j < nAssets; j++) {
        varP += w[i] * w[j] * cov[i][j];
      }
    }
    const vol = Math.sqrt(Math.max(1e-6, varP));
    const sharpe = (expRet - INDIA_RF) / vol;
    const weightMap: Record<string, number> = {};
    symbols.forEach((s, idx) => {
      weightMap[s] = Number((w[idx] * 100).toFixed(1));
    });
    return {
      volatilityPct: Number((vol * 100).toFixed(2)),
      expectedReturnPct: Number((expRet * 100).toFixed(2)),
      sharpe: Number(sharpe.toFixed(2)),
      weights: weightMap,
    };
  };

  const currentPortfolio = evalPortfolio(currentWeightsVec);

  // Deterministic PRNG for reproducible 3,500-portfolio cloud
  let seed = 88421;
  const rand = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const allSimPoints: EfficientFrontierPoint[] = [];
  let maxSharpePortfolio = currentPortfolio;
  let minVariancePortfolio = currentPortfolio;

  for (let p = 0; p < 3500; p++) {
    const raw = new Array<number>(nAssets);
    let sum = 0;
    for (let i = 0; i < nAssets; i++) {
      // Exponential draw ~ Dirichlet(1,...,1) with slight concentration on half the runs
      const u = Math.max(1e-6, rand());
      const val = p % 2 === 0 ? -Math.log(u) : Math.pow(-Math.log(u), 1.6);
      raw[i] = val;
      sum += val;
    }
    const w = raw.map((v) => v / sum);
    const pt = evalPortfolio(w);
    allSimPoints.push(pt);
    if (pt.sharpe > maxSharpePortfolio.sharpe) maxSharpePortfolio = pt;
    if (pt.volatilityPct < minVariancePortfolio.volatilityPct) minVariancePortfolio = pt;
  }

  // Extract Pareto efficient frontier line (upper envelope sorted by volatility)
  const sortedByRet = [...allSimPoints].sort((a, b) => a.volatilityPct - b.volatilityPct);
  const frontierLine: EfficientFrontierPoint[] = [];
  let bestRetSoFar = -Infinity;
  for (const pt of sortedByRet) {
    if (pt.volatilityPct >= minVariancePortfolio.volatilityPct && pt.expectedReturnPct > bestRetSoFar) {
      bestRetSoFar = pt.expectedReturnPct;
      frontierLine.push(pt);
    }
  }

  // Downsample cloud to 180 points for clean rendering
  const stride = Math.max(1, Math.floor(allSimPoints.length / 180));
  const frontierCloud = allSimPoints.filter((_, idx) => idx % stride === 0);

  const rebalanceDeltas: RebalanceDelta[] = symbols.map((sym, idx) => {
    const curW = Number((currentWeightsVec[idx] * 100).toFixed(1));
    const optW = maxSharpePortfolio.weights[sym] ?? curW;
    const diffPct = optW - curW;
    const amountInr = Math.round((Math.abs(diffPct) / 100) * totalValue);
    const action: RebalanceDelta['action'] =
      diffPct > 1.5 ? 'BUY' : diffPct < -1.5 ? 'SELL' : 'HOLD';
    return {
      symbol: sym,
      currentWeightPct: curW,
      optimalWeightPct: optW,
      action,
      amountInr,
    };
  });

  const gbmProjection = runMonteCarloGBM({
    annualMeanReturn: currentPortfolio.expectedReturnPct / 100,
    annualVol: currentPortfolio.volatilityPct / 100,
    initialCapital: Math.round(totalValue),
    horizonDays: 252,
    pathsCount: 1000,
  });

  return {
    frontierCloud,
    frontierLine,
    currentPortfolio,
    maxSharpePortfolio,
    minVariancePortfolio,
    rebalanceDeltas,
    gbmProjection,
    totalInvestedInr: Math.round(totalValue),
  };
}
