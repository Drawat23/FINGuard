import type {
  EnrichedHolding,
  OrderRecord,
  TaxHarvestMove,
  TaxHarvestReport,
} from '../../shared/types.ts';

const STCG_RATE = 0.20; // Indian FY 2025-26/2026-27 STCG 20% u/s 111A
const LTCG_RATE = 0.125; // Indian LTCG 12.5% u/s 112A
const LTCG_EXEMPTION_LIMIT = 125000; // ₹1,25,000 annual exemption

interface FifoLot {
  qtyRemaining: number;
  buyPrice: number;
  buyTimeMs: number;
}

function getCurrentIndianFyBounds(): { label: string; startMs: number; endMs: number } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0=Jan ... 3=Apr
  const fyStartYear = month >= 3 ? year : year - 1;
  const startMs = Date.UTC(fyStartYear, 3, 1, 0, 0, 0);
  const endMs = Date.UTC(fyStartYear + 1, 2, 31, 23, 59, 59);
  const shortEnd = String((fyStartYear + 1) % 100).padStart(2, '0');
  return {
    label: `FY ${fyStartYear}-${shortEnd}`,
    startMs,
    endMs,
  };
}

export function computeTaxHarvestReport(
  holdings: EnrichedHolding[],
  orders: OrderRecord[]
): TaxHarvestReport {
  const fy = getCurrentIndianFyBounds();
  let realizedStcgInr = 0;
  let realizedLtcgInr = 0;

  // Deterministic FIFO chronological BUY vs SELL matching across filled trades
  const chronological = orders
    .filter((o) => o.status === 'FILLED' && o.qty > 0 && o.executionPrice > 0)
    .slice()
    .sort((a, b) => {
      const da = new Date(a.tradeDate || a.createdAt).getTime();
      const db = new Date(b.tradeDate || b.createdAt).getTime();
      if (da !== db) return da - db;
      return a.createdAt.localeCompare(b.createdAt);
    });

  const buyQueues = new Map<string, FifoLot[]>();

  for (const o of chronological) {
    const tradeMs = new Date(o.tradeDate || o.createdAt).getTime();
    if (!Number.isFinite(tradeMs)) continue;

    if (o.side === 'BUY') {
      const queue = buyQueues.get(o.symbol) || [];
      queue.push({
        qtyRemaining: o.qty,
        buyPrice: o.executionPrice,
        buyTimeMs: tradeMs,
      });
      buyQueues.set(o.symbol, queue);
    } else if (o.side === 'SELL') {
      const queue = buyQueues.get(o.symbol) || [];
      let sellRemaining = o.qty;
      const inCurrentFy = tradeMs >= fy.startMs && tradeMs <= fy.endMs;

      while (sellRemaining > 0 && queue.length > 0) {
        const lot = queue[0];
        const matchedQty = Math.min(sellRemaining, lot.qtyRemaining);
        const realizedPnl = (o.executionPrice - lot.buyPrice) * matchedQty;
        const holdingDays = Math.floor((tradeMs - lot.buyTimeMs) / (1000 * 60 * 60 * 24));

        if (inCurrentFy) {
          if (holdingDays >= 365) {
            realizedLtcgInr += realizedPnl;
          } else {
            realizedStcgInr += realizedPnl;
          }
        }

        lot.qtyRemaining -= matchedQty;
        sellRemaining -= matchedQty;
        if (lot.qtyRemaining <= 1e-8) {
          queue.shift();
        }
      }
      // If a SELL exceeds recorded BUY lots (e.g. partial CSV without prior buy history),
      // we never invent a fake cost basis or profit margin.
    }
  }

  let unrealizedStcgGainInr = 0;
  let unrealizedStcgLossInr = 0;
  let unrealizedLtcgGainInr = 0;
  let unrealizedLtcgLossInr = 0;

  const moves: TaxHarvestMove[] = [];

  for (const h of holdings) {
    const pnl = h.unrealizedPnl;
    if (h.taxBucket === 'STCG') {
      if (pnl >= 0) unrealizedStcgGainInr += pnl;
      else unrealizedStcgLossInr += Math.abs(pnl);
    } else {
      if (pnl >= 0) unrealizedLtcgGainInr += pnl;
      else unrealizedLtcgLossInr += Math.abs(pnl);
    }

    // Suggest harvesting real losses > ₹1,000
    if (pnl < -1000) {
      const rate = h.taxBucket === 'STCG' ? STCG_RATE : LTCG_RATE;
      const saved = Math.round(Math.abs(pnl) * rate);
      moves.push({
        symbol: h.symbol,
        name: h.name,
        taxBucket: h.taxBucket,
        holdingDays: h.holdingDays,
        quantity: h.quantity,
        unrealizedPnlInr: Math.round(pnl),
        action: 'HARVEST_LOSS',
        estimatedTaxSavedInr: saved,
        rationale:
          h.taxBucket === 'STCG'
            ? `Book short-term loss of ₹${Math.abs(Math.round(pnl)).toLocaleString('en-IN')} to offset STCG/LTCG gains (saves 20% STCG tax).`
            : `Book long-term loss of ₹${Math.abs(Math.round(pnl)).toLocaleString('en-IN')} to offset taxable LTCG (saves 12.5% LTCG tax).`,
      });
    }
  }

  const ltcgExemptionUsedInr = Math.min(LTCG_EXEMPTION_LIMIT, Math.max(0, Math.round(realizedLtcgInr)));
  const ltcgExemptionRemainingInr = Math.max(0, LTCG_EXEMPTION_LIMIT - ltcgExemptionUsedInr);

  if (ltcgExemptionRemainingInr > 5000) {
    const ltcgWinners = holdings
      .filter((h) => h.taxBucket === 'LTCG' && h.unrealizedPnl > 2500)
      .sort((a, b) => b.unrealizedPnl - a.unrealizedPnl);

    let remainingRoom = ltcgExemptionRemainingInr;
    for (const w of ltcgWinners) {
      if (remainingRoom <= 0) break;
      const harvestGain = Math.min(w.unrealizedPnl, remainingRoom);
      const qtyToHarvest = Math.max(
        1,
        Math.min(w.quantity, Math.floor((harvestGain / w.unrealizedPnl) * w.quantity))
      );
      const actualGain = (qtyToHarvest / w.quantity) * w.unrealizedPnl;
      const taxSavedFuture = Math.round(actualGain * LTCG_RATE);
      remainingRoom -= actualGain;

      moves.push({
        symbol: w.symbol,
        name: w.name,
        taxBucket: 'LTCG',
        holdingDays: w.holdingDays,
        quantity: qtyToHarvest,
        unrealizedPnlInr: Math.round(actualGain),
        action: 'HARVEST_LTCG_EXEMPTION',
        estimatedTaxSavedInr: taxSavedFuture,
        rationale: `Sell & re-buy ${qtyToHarvest} shares to lock in ₹${Math.round(actualGain).toLocaleString('en-IN')} tax-free under ₹1.25L LTCG exemption, stepping up cost basis.`,
      });
    }
  }

  const netStcgIfRealized = Math.max(0, realizedStcgInr + unrealizedStcgGainInr - unrealizedStcgLossInr);
  const netLtcgIfRealized = Math.max(
    0,
    realizedLtcgInr + unrealizedLtcgGainInr - unrealizedLtcgLossInr - LTCG_EXEMPTION_LIMIT
  );
  const estimatedTaxLiabilityInr = Math.round(
    netStcgIfRealized * STCG_RATE + netLtcgIfRealized * LTCG_RATE
  );
  const potentialTaxSavingsInr = moves.reduce((s, m) => s + m.estimatedTaxSavedInr, 0);

  return {
    financialYear: fy.label,
    realizedStcgInr: Math.round(realizedStcgInr),
    realizedLtcgInr: Math.round(realizedLtcgInr),
    unrealizedStcgGainInr: Math.round(unrealizedStcgGainInr),
    unrealizedStcgLossInr: Math.round(unrealizedStcgLossInr),
    unrealizedLtcgGainInr: Math.round(unrealizedLtcgGainInr),
    unrealizedLtcgLossInr: Math.round(unrealizedLtcgLossInr),
    ltcgExemptionLimitInr: LTCG_EXEMPTION_LIMIT,
    ltcgExemptionUsedInr,
    ltcgExemptionRemainingInr,
    estimatedTaxLiabilityInr,
    potentialTaxSavingsInr,
    moves,
  };
}
