export type AccountType = 'CASH_INR' | 'BROKER_SETTLED' | 'TAX_RESERVE' | 'SIP_ESCROW';

export type AssetType = 'STOCK_NSE' | 'ETF' | 'MUTUAL_FUND';

export type OrderSide = 'BUY' | 'SELL';

export type TradeSource = 'MANUAL' | 'CSV_IMPORT' | 'UPSTOX_LIVE';

export type MandateStatus = 'ACTIVE' | 'PAUSED' | 'REVOKED';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  riskProfile: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  hasPin: boolean;
  authProvider?: 'LOCAL' | 'GOOGLE';
  avatarUrl?: string;
  upiId?: string;
  city?: string;
  occupation?: string;
  dateOfBirth?: string;
  bio?: string;
  taxRegime?: 'NEW' | 'OLD';
  investmentHorizon?: 'SHORT_TERM' | 'MEDIUM_TERM' | 'LONG_TERM';
  incomeBracket?: 'BELOW_10L' | '10L_25L' | '25L_50L' | 'ABOVE_50L';
  targetMonthlySipInr?: number;
  createdAt: string;
}

export interface AccountRecord {
  id: string;
  userId: string;
  type: AccountType;
  currency: 'INR';
  balancePaise: number;
  createdAt: string;
}

export interface LedgerEntryRecord {
  id: string;
  txGroupId: string;
  userId: string;
  debitAccountId: string;
  creditAccountId: string;
  debitAccountType: AccountType;
  creditAccountType: AccountType;
  amountPaise: number;
  entryType: string;
  referenceId: string;
  description: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface HoldingRecord {
  id: string;
  userId: string;
  symbol: string;
  name: string;
  assetType: AssetType;
  quantity: number;
  avgBuyPrice: number;
  buyDate: string;
  source?: TradeSource;
}

export interface EnrichedHolding extends HoldingRecord {
  currentPrice: number;
  dayChangePct: number;
  investedValue: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  holdingDays: number;
  taxBucket: 'STCG' | 'LTCG';
  estimatedTaxInr: number;
  dataSource: 'UPSTOX_LIVE' | 'LIVE_NSE' | 'CACHED';
}

export interface RealTradeInput {
  symbol: string;
  name?: string;
  assetType?: AssetType;
  side: OrderSide;
  quantity: number;
  priceInr: number;
  tradeDate: string;
  source?: TradeSource;
  brokerOrderId?: string;
}

export interface OrderRecord {
  id: string;
  userId: string;
  symbol: string;
  name?: string;
  assetType?: AssetType;
  side: OrderSide;
  qty: number;
  executionPrice: number;
  totalValueInr: number;
  tradeDate?: string;
  source?: TradeSource;
  brokerOrderId?: string;
  realizedPnlInr?: number;
  stcgLtcgTag: 'STCG' | 'LTCG' | 'NEW_LOT';
  status: 'FILLED' | 'REJECTED';
  createdAt: string;
}

export interface MarketCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDepthLevel {
  quantity: number;
  price: number;
  orders: number;
}

export interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePct: number;
  currency: string;
  dataSource: 'UPSTOX_LIVE' | 'LIVE_NSE' | 'CACHED';
  updatedAt: string;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  averagePrice?: number;
  lowerCircuit?: number;
  upperCircuit?: number;
  totalBuyQty?: number;
  totalSellQty?: number;
  instrumentKey?: string;
  depth?: {
    buy: MarketDepthLevel[];
    sell: MarketDepthLevel[];
  };
}

export interface UpstoxProfileSummary {
  userId: string;
  userName: string;
  email: string;
  exchanges: string[];
  broker: string;
  connectedAt: string;
}

export interface UpstoxConnectionStatus {
  configured: boolean;
  connected: boolean;
  redirectUri: string;
  profile?: UpstoxProfileSummary;
}

export interface UpstoxHoldingItem {
  symbol: string;
  tradingSymbol: string;
  companyName: string;
  isin: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  pnl: number;
  dayChangePct: number;
  exchange: string;
  instrumentToken: string;
}

export interface UpstoxFundsInfo {
  availableMargin: number;
  usedMargin: number;
  payinAmount: number;
}

export type StrategySignalType = 'MOMENTUM' | 'SMA_CROSSOVER' | 'EMA_CROSSOVER' | 'MEAN_REVERSION' | 'EQUAL_WEIGHT';

export interface QuantStrategyDSL {
  name: string;
  description: string;
  universe: string[];
  signalType: StrategySignalType;
  lookbackDays: number;
  fastPeriod: number;
  slowPeriod: number;
  rebalanceFrequency: 'WEEKLY' | 'MONTHLY';
  vixHedgeEnabled: boolean;
  vixThreshold: number;
  hedgeAsset: 'GOLDBEES.NS' | 'LIQUIDBEES.NS';
  hedgeAllocationPct: number;
  transactionCostBps: number;
}

export interface EquityPoint {
  date: string;
  strategyNav: number;
  benchmarkNav: number;
  drawdownPct: number;
  vix: number;
  inHedge: boolean;
}

export interface BacktestMetrics {
  cagrPct: number;
  benchmarkCagrPct: number;
  alphaPct: number;
  annualizedVolPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  calmarRatio: number;
  winRatePct: number;
  var95DailyPct: number;
  totalTrades: number;
  finalValue1L: number;
}

export interface MonteCarloDayPoint {
  day: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface BacktestResult {
  dsl: QuantStrategyDSL;
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  monteCarlo: {
    horizonDays: number;
    pathsCount: number;
    initialCapital: number;
    medianFinal: number;
    p10Final: number;
    p90Final: number;
    var95Inr: number;
    cvar95Inr: number;
    fanSeries: MonteCarloDayPoint[];
  };
  dataSourceSummary: string;
}

export interface QuantStrategyRecord {
  id: string;
  userId: string;
  promptText: string;
  dsl: QuantStrategyDSL;
  metrics: BacktestMetrics;
  createdAt: string;
}

export interface UpiMandateRecord {
  id: string;
  userId: string;
  strategyId: string;
  strategyName: string;
  amountInr: number;
  frequency: 'WEEKLY' | 'MONTHLY';
  vpa: string;
  status: MandateStatus;
  nextRunAt: string;
  totalExecutedInr: number;
  createdAt: string;
}

export interface EfficientFrontierPoint {
  volatilityPct: number;
  expectedReturnPct: number;
  sharpe: number;
  weights: Record<string, number>;
}

export interface RebalanceDelta {
  symbol: string;
  currentWeightPct: number;
  optimalWeightPct: number;
  action: 'BUY' | 'SELL' | 'HOLD';
  amountInr: number;
}

export interface EfficientFrontierResult {
  frontierCloud: EfficientFrontierPoint[];
  frontierLine: EfficientFrontierPoint[];
  currentPortfolio: EfficientFrontierPoint;
  maxSharpePortfolio: EfficientFrontierPoint;
  minVariancePortfolio: EfficientFrontierPoint;
  rebalanceDeltas: RebalanceDelta[];
  gbmProjection: BacktestResult['monteCarlo'];
  totalInvestedInr: number;
}

export interface TaxHarvestMove {
  symbol: string;
  name: string;
  taxBucket: 'STCG' | 'LTCG';
  holdingDays: number;
  quantity: number;
  unrealizedPnlInr: number;
  action: 'HARVEST_LOSS' | 'HARVEST_LTCG_EXEMPTION';
  estimatedTaxSavedInr: number;
  rationale: string;
}

export interface TaxHarvestReport {
  financialYear: string;
  realizedStcgInr: number;
  realizedLtcgInr: number;
  unrealizedStcgGainInr: number;
  unrealizedStcgLossInr: number;
  unrealizedLtcgGainInr: number;
  unrealizedLtcgLossInr: number;
  ltcgExemptionLimitInr: number;
  ltcgExemptionUsedInr: number;
  ltcgExemptionRemainingInr: number;
  estimatedTaxLiabilityInr: number;
  potentialTaxSavingsInr: number;
  moves: TaxHarvestMove[];
}

export interface UpiTransactionRecord {
  id: string;
  userId: string;
  date: string;
  merchant: string;
  category: string;
  amountInr: number;
  type: 'DEBIT' | 'CREDIT';
  rawText?: string;
}

export interface CashflowAnalysis {
  monthsAnalyzed: number;
  monthlyIncomeMeanInr: number;
  monthlySpendMeanInr: number;
  monthlySpendStdDevInr: number;
  spendVolatilityPct: number;
  recommendedEmergencyBufferInr: number;
  currentLiquidReserveInr: number;
  emergencyGapInr: number;
  safeMonthlySipInr: number;
  categoryBreakdown: Array<{ category: string; monthlyAvgInr: number; sharePct: number }>;
  monthlySeries: Array<{ month: string; incomeInr: number; spendInr: number; surplusInr: number }>;
}

export interface MutualFundSearchItem {
  schemeCode: number;
  schemeName: string;
}

export interface MutualFundOverlapResult {
  schemes: Array<{
    schemeCode: number;
    schemeName: string;
    category: string;
    latestNav: number;
    cagr1Y: number;
    volatilityPct: number;
    dataSource: 'LIVE_MFAPI' | 'CACHED';
  }>;
  pairwiseMatrix: Array<{
    schemeA: string;
    schemeB: string;
    correlation: number;
    estimatedOverlapPct: number;
    rSquaredPct: number;
    commonDays: number;
  }>;
  portfolioOverlapScorePct: number;
  verdict: string;
}

export interface RagDocumentRecord {
  id: string;
  userId: string | null;
  title: string;
  category: string;
  sourceType: 'PRE_SEEDED' | 'USER_UPLOAD';
  chunkCount: number;
  createdAt: string;
}

export interface RagCitation {
  chunkId: string;
  documentId: string;
  docTitle: string;
  pageOrSection: string;
  score: number;
  excerpt: string;
}

export interface CopilotResponse {
  answer: string;
  mode: 'RESEARCH' | 'BS_DETECTOR' | 'PORTFOLIO_DIAGNOSTIC';
  citations: RagCitation[];
  toolsUsed: string[];
  riskVerdict?: {
    verdict: 'HIGH_RISK_HYPE' | 'CAUTION_SPECULATIVE' | 'FUNDAMENTALLY_SOUND';
    headline: string;
    symbolChecked?: string;
    priceInr?: number;
    oneYearReturnPct?: number;
    volatilityPct?: number;
  };
}

export interface MarketNewsItem {
  id: string;
  title: string;
  summary?: string;
  imageUrl?: string;
  author?: string;
  source: string;
  url: string;
  publishedAt: string;
  category: 'INDIA_MARKETS' | 'GLOBAL_MACRO' | 'COMMODITIES' | 'FOREX_COMMUNITY';
}

export interface EconomicCalendarEvent {
  id: string;
  title: string;
  country: string;
  date: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  forecast: string;
  previous: string;
}

export interface MarketNewsFeedResponse {
  news: MarketNewsItem[];
  calendar: EconomicCalendarEvent[];
  sources: string[];
  updatedAt: string;
  hasFinnhubKey: boolean;
}
