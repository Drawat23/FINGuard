import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts';
import { motion } from 'motion/react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  CandlestickChart,
  ChevronRight,
  ExternalLink,
  Newspaper,
  ReceiptIndianRupee,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type {
  CashflowAnalysis,
  MarketNewsFeedResponse,
  QuantStrategyDSL,
  QuantStrategyRecord,
  UpiMandateRecord,
  UpstoxFundsInfo,
} from '../../shared/types.ts';
import { formatCompactInr, formatInr } from '../lib/api.ts';
import { InfoHint, MATERIAL_EASE, MaterialCard, ParallaxHeroCard } from './MotionPrimitives.tsx';

export interface PortfolioSummaryData {
  netWorthInr: number;
  cashInr: number;
  sipEscrowInr: number;
  taxReserveInr: number;
  investedValueInr: number;
  currentHoldingsValueInr: number;
  totalUnrealizedPnlInr: number;
  totalDailyPnlInr: number;
  upstoxConnected?: boolean;
  upstoxFunds?: UpstoxFundsInfo | null;
  portfolioSourceMode?: 'UPSTOX_LIVE' | 'REAL_TRADES' | 'EMPTY';
}

interface HomeTabProps {
  summary: PortfolioSummaryData | null;
  cashflow: CashflowAnalysis | null;
  newsFeed?: MarketNewsFeedResponse | null;
  strategies: QuantStrategyRecord[];
  mandates: UpiMandateRecord[];
  onOpenQuantWithDsl: (dsl: QuantStrategyDSL) => void;
  onOpenCopilotMode: (mode: 'RESEARCH' | 'BS_DETECTOR' | 'PORTFOLIO_DIAGNOSTIC', prefill?: string) => void;
  onNavigateTab: (tab: 'HOME' | 'MARKETS' | 'NEWS' | 'QUANT' | 'PORTFOLIO' | 'UPI', subTab?: string) => void;
  onQuickTrade?: (symbol: string) => void;
  onOpenMarketNews?: () => void;
}

function computeSipFutureValue(monthlyInr: number, annualRatePct: number, years: number): number {
  if (monthlyInr <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  return Math.round(monthlyInr * (((Math.pow(1 + r, n) - 1) / r) * (1 + r)));
}

function formatShortAgo(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export const HomeTab: React.FC<HomeTabProps> = ({
  summary,
  cashflow,
  strategies,
  mandates,
  newsFeed,
  onOpenQuantWithDsl,
  onOpenCopilotMode,
  onNavigateTab,
  onOpenMarketNews,
}) => {
  const [horizonYears, setHorizonYears] = useState<5 | 10>(10);

  const netWorth = summary?.netWorthInr ?? 0;
  const dailyPnl = summary?.totalDailyPnlInr ?? 0;
  const unrealizedPnl = summary?.totalUnrealizedPnlInr ?? 0;
  const investedVal = summary?.investedValueInr ?? 0;
  const unrealizedPct = investedVal > 0 ? (unrealizedPnl / investedVal) * 100 : 0;
  const activeMandates = mandates.filter((m) => m.status === 'ACTIVE');

  const safeTotal = Math.max(1, netWorth);
  const equityVal = summary?.currentHoldingsValueInr ?? 0;
  const cashVal = summary?.cashInr ?? 0;
  const reserveVal = (summary?.sipEscrowInr ?? 0) + (summary?.taxReserveInr ?? 0);

  const equityPct = netWorth > 0 ? Math.round((equityVal / safeTotal) * 100) : 0;
  const cashPct = netWorth > 0 ? Math.round((cashVal / safeTotal) * 100) : 0;
  const reservePct = netWorth > 0 ? Math.max(0, 100 - equityPct - cashPct) : 0;

  const allocationData =
    netWorth > 0
      ? [
          { name: 'Equity', value: Math.max(0, equityVal), pct: equityPct, color: '#FFB020' },
          { name: 'Cash', value: Math.max(0, cashVal), pct: cashPct, color: '#38BDF8' },
          { name: 'Reserve', value: Math.max(0, reserveVal), pct: reservePct, color: '#F5B700' },
        ].filter((d) => d.value > 0)
      : [{ name: 'Unallocated', value: 1, pct: 100, color: '#334155' }];

  const surplusSeries = (cashflow?.monthlySeries || []).map((m) => ({
    month: m.month.slice(0, 3),
    surplus: Math.max(0, m.incomeInr - m.spendInr),
  }));

  const safeMonthlySip = cashflow?.safeMonthlySipInr ?? 0;
  const topStrategyForProjection = useMemo(
    () => strategies.find((s) => Number.isFinite(s?.metrics?.cagrPct) && s.metrics.cagrPct > 0),
    [strategies]
  );
  const projectedCorpus = useMemo(() => {
    if (!topStrategyForProjection || safeMonthlySip <= 0) return 0;
    return computeSipFutureValue(safeMonthlySip, topStrategyForProjection.metrics.cagrPct, horizonYears);
  }, [safeMonthlySip, horizonYears, topStrategyForProjection]);

  const savedStrategies = useMemo(
    () => strategies.filter((s) => Boolean(s?.dsl && s?.metrics)).slice(0, 2),
    [strategies]
  );

  const topNews = useMemo(() => (newsFeed?.news || []).slice(0, 3), [newsFeed?.news]);
  const nextMacro = newsFeed?.calendar?.[0];

  return (
    <div className="space-y-4 pb-6 min-w-0">

      {/* Primary Hero Split: Net Worth Allocation (7 cols) + Smart UPI SIP Engine (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch min-w-0">
        {/* Left: Net Worth & Asset Allocation */}
        <ParallaxHeroCard className="lg:col-span-7 p-5 sm:p-6 flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <span>Total Net Worth</span>
                  <InfoHint text="Live NSE equity valuation + available cash + SIP & FY26 tax escrow reserves." />
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('PORTFOLIO')}
                  className="text-[11px] font-semibold text-[#D97706] dark:text-[#FFB020] hover:underline whitespace-nowrap shrink-0"
                >
                  Portfolio &amp; Tax →
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-baseline gap-3">
                <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.65rem] font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
                  {summary ? formatInr(netWorth) : '₹—'}
                </h1>
                {summary && (
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${
                      dailyPnl >= 0
                        ? 'text-[#D97706] dark:text-[#FFB020]'
                        : 'text-[#E11D48] dark:text-[#FF4D6D]'
                    }`}
                  >
                    {dailyPnl >= 0 ? (
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5" />
                    )}
                    {dailyPnl >= 0 ? '+' : ''}
                    {formatInr(dailyPnl)} today
                  </span>
                )}
              </div>

              {/* Allocation Progress Bar or Onboarding Prompt */}
              {summary && netWorth > 0 ? (
                <div className="mt-5 space-y-2">
                  <div className="h-2.5 w-full rounded-full m3-tonal-box overflow-hidden flex gap-0.5 p-0.5">
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.4, ease: MATERIAL_EASE }}
                      style={{ width: `${equityPct}%`, transformOrigin: 'left' }}
                      className="h-full bg-[#FFB020] rounded-full"
                    />
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.4, delay: 0.05, ease: MATERIAL_EASE }}
                      style={{ width: `${cashPct}%`, transformOrigin: 'left' }}
                      className="h-full bg-sky-400 rounded-full"
                    />
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.4, delay: 0.1, ease: MATERIAL_EASE }}
                      style={{ width: `${reservePct}%`, transformOrigin: 'left' }}
                      className="h-full bg-[#F5B700] rounded-full"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium tabular-nums">
                    <span className="text-[#D97706] dark:text-[#FFB020]">Equity {equityPct}%</span>
                    <span className="text-sky-600 dark:text-sky-400">Cash {cashPct}%</span>
                    <span className="text-[#D97706] dark:text-[#F5B700]">Reserve {reservePct}%</span>
                  </div>
                </div>
              ) : summary ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigateTab('MARKETS')}
                    className="min-h-[34px] px-3.5 py-1.5 rounded-xl bg-[#FFB020] hover:bg-[#F59E0B] text-[#1C1000] text-xs font-semibold transition-all"
                  >
                    Connect Upstox Demat
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('PORTFOLIO')}
                    className="min-h-[34px] px-3.5 py-1.5 rounded-xl m3-tonal-box hover:opacity-90 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all"
                  >
                    Import Broker CSV / Log Trade
                  </button>
                </div>
              ) : null}
            </div>

            {summary && (
              <div className="w-32 h-32 sm:w-36 sm:h-36 shrink-0 self-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={allocationData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={38}
                      outerRadius={56}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {allocationData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B0F19',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '12px',
                        fontSize: '11px',
                        color: '#f8fafc',
                      }}
                      formatter={(val: unknown) => formatCompactInr(Number(val))}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-slate-200/80 dark:border-white/8">
            <div className="min-w-0">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Equity Value</p>
              <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white tabular-nums mt-0.5">
                {summary ? formatCompactInr(equityVal) : '—'}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Cash + Escrow</p>
              <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white tabular-nums mt-0.5">
                {summary ? formatCompactInr(cashVal + reserveVal) : '—'}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Total Gain</p>
              <p
                className={`text-sm sm:text-base font-semibold tabular-nums mt-0.5 ${
                  unrealizedPnl >= 0
                    ? 'text-[#D97706] dark:text-[#FFB020]'
                    : 'text-[#E11D48] dark:text-[#FF4D6D]'
                }`}
              >
                {summary
                  ? `${unrealizedPnl >= 0 ? '+' : ''}${formatCompactInr(unrealizedPnl)} (${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(1)}%)`
                  : '—'}
              </p>
            </div>
          </div>
        </ParallaxHeroCard>

        {/* Right: Safe Monthly SIP & Compounding Multiplier */}
        <MaterialCard delay={0.04} className="lg:col-span-5 min-w-0 p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span>Safe Monthly SIP</span>
                <InfoHint text="Calculated from your UPI income minus spend volatility (μ + 1.5σ) emergency buffer." />
              </span>
              <div className="flex items-center gap-1 rounded-xl m3-tonal-box p-0.5 text-[11px] font-medium">
                {([5, 10] as const).map((yrs) => (
                  <button
                    key={yrs}
                    type="button"
                    onClick={() => setHorizonYears(yrs)}
                    className={`px-2 py-0.5 rounded-lg transition-colors whitespace-nowrap ${
                      horizonYears === yrs
                        ? 'bg-[#FFB020] text-[#1C1000] font-bold'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {yrs}Y
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2 flex items-baseline justify-between gap-2">
              <p className="text-2xl sm:text-[1.85rem] font-bold text-[#D97706] dark:text-[#FFB020] tabular-nums">
                {cashflow ? `${formatInr(safeMonthlySip)}/mo` : '₹—'}
              </p>
              {cashflow && (
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                  Buffer {formatCompactInr(cashflow.recommendedEmergencyBufferInr)}
                </span>
              )}
            </div>

            {cashflow && safeMonthlySip > 0 && topStrategyForProjection ? (
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 font-medium tabular-nums">
                Compounds to{' '}
                <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                  {formatCompactInr(projectedCorpus)}
                </span>{' '}
                in {horizonYears} yrs at {topStrategyForProjection.metrics.cagrPct}% backtested CAGR
              </p>
            ) : cashflow && cashflow.monthsAnalyzed === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                Import your bank CSV or UPI SMS logs to size your emergency buffer (μ + 1.5σ) and Safe Monthly SIP.
              </p>
            ) : cashflow && safeMonthlySip > 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                Save a Quant Lab strategy to project compounding at its backtested CAGR.
              </p>
            ) : null}

            {surplusSeries.length > 0 && (
              <div className="h-24 w-full mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={surplusSeries} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="homeSurplusGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#FFB020" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#FFB020" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B0F19',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '12px',
                        fontSize: '11px',
                        color: '#f8fafc',
                      }}
                      formatter={(val: unknown) => [formatInr(Number(val)), 'Surplus']}
                    />
                    <Area
                      type="monotone"
                      dataKey="surplus"
                      stroke="#FFB020"
                      strokeWidth={2}
                      fill="url(#homeSurplusGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {activeMandates.length > 0 && (
              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-white/[0.06] divide-y divide-slate-100 dark:divide-white/[0.06]">
                {activeMandates.slice(0, 2).map((m) => (
                  <div key={m.id} className="py-1.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {m.strategyName}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
                        UPI SIP · {formatInr(m.amountInr)}/mo · Next{' '}
                        {new Date(m.nextRunAt).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigateTab('UPI')}
                      className="text-[11px] font-semibold text-[#D97706] dark:text-[#FFB020] hover:underline whitespace-nowrap shrink-0"
                    >
                      Manage
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3.5 border-t border-slate-200/80 dark:border-white/8 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onNavigateTab('UPI')}
              className="min-h-[40px] px-4 py-2 rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] text-xs font-semibold transition-all whitespace-nowrap shadow-sm"
            >
              {cashflow?.monthsAnalyzed ? 'Plan UPI SIP' : 'Import Bank CSV'}
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('UPI')}
              className="min-h-[40px] px-3 py-2 rounded-2xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/6 inline-flex items-center gap-1 whitespace-nowrap transition-colors"
            >
              <span>Cashflow</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </MaterialCard>
      </div>

      {/* Minimal 4-Workspace Launchpad */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            title: 'Markets',
            sub: 'Charts & Upstox',
            icon: CandlestickChart,
            iconBg: 'bg-sky-500/14 text-sky-600 dark:text-sky-400',
            onClick: () => onNavigateTab('MARKETS'),
          },
          {
            title: 'Market Wire',
            sub: 'Equities & Macro',
            icon: Newspaper,
            iconBg: 'bg-[#FFB020]/14 text-[#D97706] dark:text-[#FFB020]',
            onClick: () => (onOpenMarketNews ? onOpenMarketNews() : onNavigateTab('NEWS')),
          },
          {
            title: 'Quant Studio',
            sub: 'Backtest & Monte Carlo',
            icon: BarChart3,
            iconBg: 'bg-indigo-500/14 text-indigo-600 dark:text-indigo-400',
            onClick: () => onNavigateTab('QUANT'),
          },
          {
            title: 'FY26 Tax Saver',
            sub: 'STCG / LTCG Harvest',
            icon: ReceiptIndianRupee,
            iconBg: 'bg-[#F5B700]/16 text-[#D97706] dark:text-[#F5B700]',
            onClick: () => onNavigateTab('PORTFOLIO', 'TAX'),
          },
        ].map((act) => (
          <button
            key={act.title}
            type="button"
            onClick={act.onClick}
            className="min-w-0 min-h-[58px] p-3.5 rounded-2xl m3-card m3-card-interactive active:scale-[0.98] text-left flex items-center gap-3"
          >
            <div className={`w-9 h-9 rounded-xl ${act.iconBg} flex items-center justify-center shrink-0`}>
              <act.icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">
                {act.title}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{act.sub}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Bottom Executive Row: Active Wealth Plan & AI Guardrails (5 cols) + Visual Live News Snapshot (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch min-w-0">
        {/* Left: AI Wealth Copilot & Active Mandates */}
        <MaterialCard delay={0.08} className="lg:col-span-5 p-5 sm:p-6 flex flex-col justify-between min-w-0">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Bot className="w-4 h-4 text-[#D97706] dark:text-[#FFB020] shrink-0" />
                <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                  AI Wealth Copilot
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('QUANT')}
                className="text-[11px] font-semibold text-[#D97706] dark:text-[#FFB020] hover:underline whitespace-nowrap shrink-0"
              >
                Quant Lab →
              </button>
            </div>

            <div className="mt-3 divide-y divide-slate-100 dark:divide-white/[0.06]">
              {savedStrategies.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onOpenQuantWithDsl(s.dsl)}
                  className="w-full py-2.5 flex items-center justify-between gap-3 text-left hover:opacity-80 transition-opacity"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                      {s.dsl.name}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {s.metrics.cagrPct}% CAGR · Sharpe {s.metrics.sharpeRatio}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              ))}

              {savedStrategies.length === 0 && (
                <p className="py-4 text-xs text-slate-500 dark:text-slate-400">
                  Run a portfolio diagnostic or verify any market headline below.
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3.5 border-t border-slate-200/80 dark:border-white/8 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() =>
                onOpenCopilotMode(
                  'PORTFOLIO_DIAGNOSTIC',
                  'Audit my portfolio, check MF overlap, and highlight my top FY26 tax-saving moves.'
                )
              }
              className="min-h-[42px] px-3 py-2 rounded-2xl bg-slate-900 dark:bg-white/10 hover:bg-slate-800 dark:hover:bg-white/16 active:scale-[0.98] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#FFB020] shrink-0" />
              <span>AI Audit</span>
            </button>

            <button
              type="button"
              onClick={() =>
                onOpenCopilotMode(
                  'BS_DETECTOR',
                  'Check if TATAMOTORS.NS or RELIANCE.NS hype headlines match fundamental return & volatility.'
                )
              }
              className="min-h-[42px] px-3 py-2 rounded-2xl m3-tonal-box hover:bg-slate-200/70 dark:hover:bg-white/10 active:scale-[0.98] text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all whitespace-nowrap"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-[#F5B700] shrink-0" />
              <span>Scan Tip</span>
            </button>
          </div>
        </MaterialCard>

        {/* Right: Market Wire & Macro Snapshot */}
        <MaterialCard delay={0.1} className="lg:col-span-7 p-5 sm:p-6 flex flex-col justify-between min-w-0">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                Market Wire
              </h2>
              <button
                type="button"
                onClick={() => (onOpenMarketNews ? onOpenMarketNews() : onNavigateTab('NEWS'))}
                className="text-[11px] font-semibold text-[#D97706] dark:text-[#FFB020] hover:underline whitespace-nowrap shrink-0"
              >
                All News →
              </button>
            </div>

            {topNews.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {topNews.map((item) => (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-3 flex items-center justify-between gap-3.5 group"
                  >
                    <img
                      src={
                        item.imageUrl ||
                        '/src/assets/images/news_india_stocks_1795410923186.jpg'
                      }
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const img = e.currentTarget;
                        const fallback = '/src/assets/images/news_india_stocks_1795410923186.jpg';
                        if (!img.src.endsWith('news_india_stocks_1795410923186.jpg')) {
                          img.src = fallback;
                        }
                      }}
                      className="w-16 sm:w-20 aspect-[16/10] rounded-xl object-cover shrink-0 bg-slate-100 dark:bg-white/5 border border-slate-200/60 dark:border-white/[0.08]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {item.source} · {formatShortAgo(item.publishedAt)}
                      </p>
                      <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white group-hover:text-[#D97706] dark:group-hover:text-[#FFB020] line-clamp-2 leading-snug mt-0.5 transition-colors">
                        {item.title}
                      </p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#FFB020] shrink-0 transition-colors" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="py-8 text-xs text-slate-500 dark:text-slate-400 text-center">
                Loading market headlines...
              </p>
            )}
          </div>

          {nextMacro && (
            <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-white/8 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              <span className="truncate">
                Next Macro:{' '}
                <span className="font-semibold text-slate-900 dark:text-white">
                  {nextMacro.country} · {nextMacro.title}
                </span>
              </span>
              <span className="shrink-0">
                Fcst {nextMacro.forecast} · Prev {nextMacro.previous}
              </span>
            </div>
          )}
        </MaterialCard>
      </div>
    </div>
  );
};
