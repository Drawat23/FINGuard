import type { CashflowAnalysis, UpiTransactionRecord } from '../../shared/types.ts';

function categorizeMerchant(merchant: string, type: 'DEBIT' | 'CREDIT'): string {
  if (type === 'CREDIT') return 'Salary & Income';
  const m = merchant.toUpperCase();
  if (/SWIGGY|ZOMATO|DOMINOS|STARBUCKS|CAFE|RESTAURANT|FOOD/.test(m)) return 'Food & Dining';
  if (/ZEPTO|BLINKIT|BIGBASKET|DMART|GROCERY|INSTAMART/.test(m)) return 'Groceries & Quick Commerce';
  if (/RENT|HOUSING|SOCIETY|NOBROKER|RESIDENCY/.test(m)) return 'Rent & Housing';
  if (/JIO|AIRTEL|BESCOM|ELECTRICITY|WIFI|BROADBAND|GAS|WATER|RECHARGE/.test(m)) return 'Utilities & Telecom';
  if (/METRO|UBER|OLA|RAPIDO|IRCTC|FUEL|PETROL/.test(m)) return 'Transport & Metro';
  if (/SIP|MUTUAL|FINGUARD|FINQUANT|ZERODHA|GROWW|COIN|ESCROW|ETF/.test(m)) return 'Investments & SIP';
  return 'Shopping & Lifestyle';
}

function normalizeDateString(raw: string): string {
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const dmy = raw.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return new Date().toISOString().slice(0, 10);
}

export function parseRawUpiInput(rawText: string): Array<Omit<UpiTransactionRecord, 'id' | 'userId'>> {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const parsed: Array<Omit<UpiTransactionRecord, 'id' | 'userId'>> = [];

  for (const line of lines) {
    if (/^(date|txn\s*date|transaction\s*date)[,\t;]/i.test(line)) continue;

    // CSV format: date,merchant,amount,type
    const csvParts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
    if (csvParts.length >= 3) {
      const amount = Number.parseFloat(csvParts[2].replace(/[₹,\s]/g, ''));
      if (Number.isFinite(amount) && amount > 0) {
        const typeRaw = (csvParts[3] || '').toUpperCase();
        const type: 'DEBIT' | 'CREDIT' =
          typeRaw.includes('CREDIT') || typeRaw === 'CR' ? 'CREDIT' : 'DEBIT';
        const date = normalizeDateString(csvParts[0]);
        const merchant = csvParts[1] || 'BANK ENTRY';
        parsed.push({
          date,
          merchant,
          category: categorizeMerchant(merchant, type),
          amountInr: Math.round(amount),
          type,
          rawText: line,
        });
        continue;
      }
    }

    // SMS log format: e.g. "Rs 1,450 debited via UPI to SWIGGY on 2026-10-14"
    const amtMatch = line.match(/(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.[0-9]+)?)/i);
    if (amtMatch) {
      const amount = Number.parseFloat(amtMatch[1].replace(/,/g, ''));
      if (Number.isFinite(amount) && amount > 0) {
        const isCredit = /credited|received|salary|refund/i.test(line);
        const type: 'DEBIT' | 'CREDIT' = isCredit ? 'CREDIT' : 'DEBIT';
        const date = normalizeDateString(line);
        const merchantMatch = line.match(/(?:to|from|at|via)\s+([A-Za-z0-9 &_-]{3,32})/i);
        const merchant = (merchantMatch?.[1] || 'UPI SMS ENTRY').trim().toUpperCase();
        parsed.push({
          date,
          merchant,
          category: categorizeMerchant(merchant, type),
          amountInr: Math.round(amount),
          type,
          rawText: line,
        });
      }
    }
  }

  return parsed;
}

export function analyzeUpiCashflow(
  transactions: UpiTransactionRecord[],
  currentLiquidReserveInr: number
): CashflowAnalysis {
  if (transactions.length === 0) {
    return {
      monthsAnalyzed: 0,
      monthlyIncomeMeanInr: 0,
      monthlySpendMeanInr: 0,
      monthlySpendStdDevInr: 0,
      spendVolatilityPct: 0,
      recommendedEmergencyBufferInr: 0,
      currentLiquidReserveInr: Math.round(currentLiquidReserveInr),
      emergencyGapInr: 0,
      safeMonthlySipInr: 0,
      categoryBreakdown: [],
      monthlySeries: [],
    };
  }

  const byMonth = new Map<string, { income: number; spend: number }>();
  const categoryTotals = new Map<string, number>();

  for (const tx of transactions) {
    const month = tx.date.slice(0, 7);
    const bucket = byMonth.get(month) || { income: 0, spend: 0 };
    if (tx.type === 'CREDIT') {
      bucket.income += tx.amountInr;
    } else {
      if (tx.category !== 'Investments & SIP') {
        bucket.spend += tx.amountInr;
        categoryTotals.set(tx.category, (categoryTotals.get(tx.category) || 0) + tx.amountInr);
      }
    }
    byMonth.set(month, bucket);
  }

  const sortedMonths = Array.from(byMonth.keys()).sort();
  const monthsAnalyzed = Math.max(1, sortedMonths.length);

  const incomes = sortedMonths.map((m) => byMonth.get(m)!.income);
  const spends = sortedMonths.map((m) => byMonth.get(m)!.spend);

  const monthlyIncomeMeanInr = Math.round(incomes.reduce((a, b) => a + b, 0) / monthsAnalyzed);
  const monthlySpendMeanInr = Math.round(spends.reduce((a, b) => a + b, 0) / monthsAnalyzed);

  const variance =
    spends.reduce((acc, s) => acc + (s - monthlySpendMeanInr) ** 2, 0) / monthsAnalyzed;
  const monthlySpendStdDevInr = Math.round(Math.sqrt(variance));
  const spendVolatilityPct =
    monthlySpendMeanInr > 0
      ? Number(((monthlySpendStdDevInr / monthlySpendMeanInr) * 100).toFixed(1))
      : 0;

  const recommendedEmergencyBufferInr = Math.round(monthlySpendMeanInr + 1.5 * monthlySpendStdDevInr);
  const emergencyGapInr = Math.max(0, recommendedEmergencyBufferInr - Math.round(currentLiquidReserveInr));

  const rawSurplus = monthlyIncomeMeanInr - (monthlySpendMeanInr + 0.5 * monthlySpendStdDevInr);
  const safeMonthlySipInr = Math.max(0, Math.round((rawSurplus * 0.75) / 500) * 500);

  const totalSpend = Array.from(categoryTotals.values()).reduce((a, b) => a + b, 0) || 1;
  const categoryBreakdown = Array.from(categoryTotals.entries())
    .map(([category, total]) => ({
      category,
      monthlyAvgInr: Math.round(total / monthsAnalyzed),
      sharePct: Number(((total / totalSpend) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.monthlyAvgInr - a.monthlyAvgInr);

  const monthlySeries = sortedMonths.map((month) => {
    const row = byMonth.get(month)!;
    return {
      month,
      incomeInr: Math.round(row.income),
      spendInr: Math.round(row.spend),
      surplusInr: Math.round(row.income - row.spend),
    };
  });

  return {
    monthsAnalyzed,
    monthlyIncomeMeanInr,
    monthlySpendMeanInr,
    monthlySpendStdDevInr,
    spendVolatilityPct,
    recommendedEmergencyBufferInr,
    currentLiquidReserveInr: Math.round(currentLiquidReserveInr),
    emergencyGapInr,
    safeMonthlySipInr,
    categoryBreakdown,
    monthlySeries,
  };
}
