import type { MutualFundOverlapResult } from '../../shared/types.ts';
import { getMutualFundNavHistory } from '../services/marketDataService.ts';

export async function analyzeMutualFundOverlap(
  schemeCodes: number[]
): Promise<MutualFundOverlapResult> {
  const uniqueCodes = Array.from(new Set(schemeCodes)).slice(0, 4);
  if (uniqueCodes.length < 2) {
    throw new Error('Select at least 2 Mutual Fund schemes to analyze return co-movement.');
  }

  const schemesData = await Promise.all(uniqueCodes.map((c) => getMutualFundNavHistory(c)));

  const schemes = schemesData.map((s) => {
    const navs = s.navs;
    const latestNav = navs[navs.length - 1]?.nav || 0;
    const lookbackIdx = Math.max(0, navs.length - 252);
    const startNav = navs[lookbackIdx]?.nav || latestNav;
    const years = Math.max(0.1, (navs.length - lookbackIdx) / 252);
    const cagr1Y = startNav > 0 && latestNav > 0 ? (Math.pow(latestNav / startNav, 1 / years) - 1) * 100 : 0;

    const rets: number[] = [];
    for (let i = 1; i < navs.length; i++) {
      const r = (navs[i].nav - navs[i - 1].nav) / navs[i - 1].nav;
      if (Number.isFinite(r)) rets.push(r);
    }
    const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
    const varR = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
    const vol = Math.sqrt(varR) * Math.sqrt(252) * 100;

    return {
      schemeCode: s.schemeCode,
      schemeName: s.schemeName,
      category: s.category,
      latestNav: Number(latestNav.toFixed(2)),
      cagr1Y: Number(cagr1Y.toFixed(2)),
      volatilityPct: Number(vol.toFixed(2)),
      dataSource: s.source,
    };
  });

  // Build exact date-aligned daily return maps
  const returnMaps = schemesData.map((s) => {
    const m = new Map<string, number>();
    for (let i = 1; i < s.navs.length; i++) {
      const prevNav = s.navs[i - 1].nav;
      const curNav = s.navs[i].nav;
      if (prevNav <= 0 || curNav <= 0) continue;
      const r = (curNav - prevNav) / prevNav;
      if (Number.isFinite(r)) m.set(s.navs[i].date, r);
    }
    return m;
  });

  const pairwiseMatrix: MutualFundOverlapResult['pairwiseMatrix'] = [];
  for (let i = 0; i < schemesData.length; i++) {
    for (let j = i + 1; j < schemesData.length; j++) {
      const mapA = returnMaps[i];
      const mapB = returnMaps[j];
      const commonDates = Array.from(mapA.keys()).filter((d) => mapB.has(d));

      if (commonDates.length < 20) {
        throw new Error(
          `Insufficient aligned common trading dates (${commonDates.length}/20 required) between ${schemesData[i].schemeName} and ${schemesData[j].schemeName}.`
        );
      }

      const vecA = commonDates.map((d) => mapA.get(d)!);
      const vecB = commonDates.map((d) => mapB.get(d)!);
      const meanA = vecA.reduce((a, b) => a + b, 0) / vecA.length;
      const meanB = vecB.reduce((a, b) => a + b, 0) / vecB.length;
      let num = 0;
      let denA = 0;
      let denB = 0;
      for (let k = 0; k < vecA.length; k++) {
        const da = vecA[k] - meanA;
        const db = vecB[k] - meanB;
        num += da * db;
        denA += da * da;
        denB += db * db;
      }
      const denom = Math.sqrt(denA * denB);
      if (denom <= 0) {
        throw new Error(
          `Zero return variance across aligned dates for ${schemesData[i].schemeName} vs ${schemesData[j].schemeName}.`
        );
      }

      const corr = Math.max(-1, Math.min(1, num / denom));
      // Honest coefficient of determination (R^2): shared daily return variance %
      const rSquaredPct = Math.round(corr * corr * 100);

      pairwiseMatrix.push({
        schemeA: schemesData[i].schemeName.split(' - ')[0],
        schemeB: schemesData[j].schemeName.split(' - ')[0],
        correlation: Number(corr.toFixed(2)),
        estimatedOverlapPct: rSquaredPct,
        rSquaredPct,
        commonDays: commonDates.length,
      });
    }
  }

  const avgRSquared =
    pairwiseMatrix.reduce((s, p) => s + p.rSquaredPct, 0) / Math.max(1, pairwiseMatrix.length);
  const portfolioOverlapScorePct = Math.round(avgRSquared);

  let verdict = `Low NAV return co-movement (avg R² ${portfolioOverlapScorePct}%): these schemes exhibit distinct historical return drivers.`;
  if (portfolioOverlapScorePct >= 75) {
    verdict = `High NAV Return Co-movement (avg R² ${portfolioOverlapScorePct}%): daily AMFI NAV returns move closely together (${pairwiseMatrix[0]?.commonDays || 0} aligned trading days). Review AMC factsheets if trying to avoid duplicate large-cap exposure.`;
  } else if (portfolioOverlapScorePct >= 45) {
    verdict = `Moderate NAV Return Co-movement (avg R² ${portfolioOverlapScorePct}%): shared factor exposure observed from real AMFI NAV history.`;
  }

  return {
    schemes,
    pairwiseMatrix,
    portfolioOverlapScorePct,
    verdict,
  };
}
