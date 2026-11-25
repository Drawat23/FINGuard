import React, { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AnimatePresence, motion } from 'motion/react';
import { BookmarkPlus, Play, Repeat, Sparkles } from 'lucide-react';
import type { BacktestResult, QuantStrategyDSL, QuantStrategyRecord } from '../../shared/types.ts';
import { apiFetch, formatInr } from '../lib/api.ts';
import { syncStrategyToFirestore } from '../lib/firebase.ts';
import { InfoHint, MATERIAL_EASE, MaterialCard, MaterialSegmentedTabs } from './MotionPrimitives.tsx';

interface QuantLabTabProps {
  initialDsl: QuantStrategyDSL | null;
  savedStrategies: QuantStrategyRecord[];
  onStrategySaved: () => void;
  onStartSipForStrategy: (strategyId: string, strategyName: string) => void;
}

const PRESET_PROMPTS = [
  { label: 'Nifty Momentum + VIX Gold Hedge', prompt: 'Nifty Momentum + Gold Hedge when VIX > 18' },
  { label: 'Quality IT & Pharma + LiquidBees', prompt: 'Low-Debt Quality IT & Pharma with LiquidBees safety' },
  { label: 'Banking 20/50 SMA Weekly', prompt: 'Banking & Auto 20/50 SMA crossover weekly rebalance' },
  { label: 'Bluechip Mean Reversion', prompt: 'Nifty Bluechips mean reversion when market dips' },
];

export const QuantLabTab: React.FC<QuantLabTabProps> = ({
  initialDsl,
  savedStrategies,
  onStrategySaved,
  onStartSipForStrategy,
}) => {
  const [prompt, setPrompt] = useState(PRESET_PROMPTS[0].prompt);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [chartView, setChartView] = useState<'EQUITY_DD' | 'MONTE_CARLO' | 'SAVED'>('EQUITY_DD');

  const runWithDsl = async (dsl: QuantStrategyDSL) => {
    if (!dsl) return;
    setLoading(true);
    setError(null);
    setSaveMessage(null);
    try {
      const res = await apiFetch<BacktestResult>('/api/quant/run-backtest', {
        method: 'POST',
        body: JSON.stringify({ dsl }),
      });
      if (!res?.dsl || !res?.metrics) {
        throw new Error('Backtest returned incomplete strategy data.');
      }
      setResult(res);
      setPrompt(res.dsl.description || dsl.description || '');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialDsl) {
      void runWithDsl(initialDsl);
    } else if (!result && !loading && savedStrategies.length > 0 && savedStrategies[0]?.dsl) {
      void runWithDsl(savedStrategies[0].dsl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDsl, savedStrategies]);

  const handlePromptBacktest = async (customPrompt?: string) => {
    const text = (customPrompt ?? prompt).trim();
    if (!text) return;
    if (customPrompt) setPrompt(customPrompt);
    setLoading(true);
    setError(null);
    setSaveMessage(null);
    try {
      const res = await apiFetch<BacktestResult>('/api/quant/prompt-backtest', {
        method: 'POST',
        body: JSON.stringify({ prompt: text }),
      });
      if (!res?.dsl || !res?.metrics) {
        throw new Error('Strategy compilation returned incomplete data.');
      }
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!result?.dsl || !result?.metrics) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await apiFetch<{ strategy: QuantStrategyRecord }>('/api/quant/save', {
        method: 'POST',
        body: JSON.stringify({
          promptText: prompt,
          dsl: result.dsl,
          metrics: result.metrics,
        }),
      });
      if (res.strategy) {
        void syncStrategyToFirestore({
          id: res.strategy.id,
          name: res.strategy.dsl.name,
          promptText: res.strategy.promptText,
          signalType: res.strategy.dsl.signalType,
          universe: res.strategy.dsl.universe,
          rebalanceFrequency: res.strategy.dsl.rebalanceFrequency,
          vixHedgeEnabled: res.strategy.dsl.vixHedgeEnabled,
          hedgeAsset: res.strategy.dsl.hedgeAsset,
          cagrPct: res.strategy.metrics.cagrPct,
          sharpeRatio: res.strategy.metrics.sharpeRatio,
          maxDrawdownPct: res.strategy.metrics.maxDrawdownPct,
        }).catch(() => {});
      }
      onStrategySaved();
      setSaveMessage(`Saved "${res.strategy?.dsl?.name || result.dsl.name}" to your strategies.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-6 min-w-0">
      {/* Minimal Prompt-to-Quant Builder Bar */}
      <MaterialCard className="p-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="font-display text-base font-bold text-slate-900 dark:text-white truncate">
              Quant Studio
            </h1>
            <InfoHint text="Write any strategy rule in English or Hinglish to backtest 3Y market performance." />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handlePromptBacktest();
            }}
            placeholder="e.g. VIX > 18 pe GoldBeES hedge, warna Nifty momentum..."
            className="flex-1 min-w-0 min-h-[38px] px-4 rounded-2xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => void handlePromptBacktest()}
            className="min-h-[38px] px-5 py-1.5 rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all whitespace-nowrap disabled:opacity-60"
          >
            {loading ? (
              <span>Backtesting...</span>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Backtest</span>
              </>
            )}
          </button>
        </div>

        {/* Preset prompt chips */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-2">
          {PRESET_PROMPTS.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={loading}
              onClick={() => void handlePromptBacktest(p.prompt)}
              className="shrink-0 min-h-[28px] px-3 py-1 rounded-xl m3-tonal-box hover:bg-slate-200 dark:hover:bg-white/10 text-[11px] font-medium text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap"
            >
              {p.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-2 p-2.5 rounded-2xl bg-[#FF4D6D]/10 border border-[#FF4D6D]/30 text-xs text-[#E11D48] dark:text-[#FF4D6D]">
            {error}
          </div>
        )}
        {saveMessage && (
          <div className="mt-2 p-2.5 rounded-2xl bg-[#FFB020]/10 border border-[#FFB020]/30 text-xs text-[#D97706] dark:text-[#FFB020]">
            {saveMessage}
          </div>
        )}
      </MaterialCard>

      {loading && !result && (
        <div className="rounded-3xl m3-card p-8 text-center text-sm text-slate-500">
          Running strategy backtest...
        </div>
      )}

      {result?.dsl && result?.metrics && (
        <motion.div
          key={result.dsl.name + result.metrics.cagrPct}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: MATERIAL_EASE }}
          className="space-y-4 min-w-0"
        >
          {/* Compact Strategy DSL Bar + Actions */}
          <section className="rounded-3xl m3-card px-4 py-3.5 min-w-0">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
              <div className="min-w-0 flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                  {result.dsl.name || 'Custom Quant Strategy'}
                </h2>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg m3-tonal-box text-slate-600 dark:text-slate-300">
                  {result.dsl.signalType} · {result.dsl.rebalanceFrequency}
                </span>
                <InfoHint
                  text={`Universe: ${(result.dsl.universe || []).map((s) => s.replace('.NS', '')).join(', ')} · Hedge: ${
                    result.dsl.vixHedgeEnabled
                      ? `${result.dsl.hedgeAllocationPct}% ${(result.dsl.hedgeAsset || 'GOLDBEES.NS').replace('.NS', '')} (VIX>${result.dsl.vixThreshold})`
                      : 'Off'
                  }`}
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="min-h-[34px] px-3 py-1 rounded-2xl m3-tonal-box hover:bg-slate-200/80 dark:hover:bg-white/14 active:scale-[0.98] text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 transition-all whitespace-nowrap"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span>{saving ? 'Saving...' : 'Save'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onStartSipForStrategy('strat_custom', result.dsl.name || 'Custom Quant Strategy')}
                  className="min-h-[34px] px-3.5 py-1 rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap shadow-sm"
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>Start SIP</span>
                </button>
              </div>
            </div>
          </section>

          {/* 6 Deterministic Quant Metric Tiles */}
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {[
              {
                label: 'Strategy CAGR',
                value: `${result.metrics.cagrPct}%`,
                sub: `Nifty 50: ${result.metrics.benchmarkCagrPct}%`,
                hint: 'Annual growth rate',
                accent: result.metrics.cagrPct >= result.metrics.benchmarkCagrPct ? 'emerald' : 'neutral',
              },
              {
                label: 'Sharpe Ratio',
                value: `${result.metrics.sharpeRatio}`,
                sub: `Sortino: ${result.metrics.sortinoRatio}`,
                hint: 'Return per unit risk',
                accent: result.metrics.sharpeRatio >= 0.8 ? 'emerald' : 'neutral',
              },
              {
                label: 'Max Drawdown',
                value: `${result.metrics.maxDrawdownPct}%`,
                sub: `Calmar: ${result.metrics.calmarRatio}`,
                hint: 'Worst peak-to-dip',
                accent: 'crimson',
              },
              {
                label: 'Annual Volatility',
                value: `${result.metrics.annualizedVolPct}%`,
                sub: `Win Rate: ${result.metrics.winRatePct}%`,
                hint: 'Daily swing intensity',
                accent: 'neutral',
              },
              {
                label: 'Daily VaR (95%)',
                value: `${result.metrics.var95DailyPct}%`,
                sub: `${result.metrics.totalTrades} rebalances`,
                hint: '95% bad-day floor',
                accent: 'gold',
              },
              {
                label: '₹1,00,000 Grew To',
                value: formatInr(result.metrics.finalValue1L),
                sub: `Alpha: ${result.metrics.alphaPct >= 0 ? '+' : ''}${result.metrics.alphaPct}%`,
                hint: '3Y compounded value',
                accent: result.metrics.alphaPct >= 0 ? 'emerald' : 'crimson',
              },
            ].map((m, idx) => (
              <MaterialCard
                key={m.label}
                delay={idx * 0.03}
                className="p-3 m3-card-interactive min-w-0"
              >
                <div className="flex items-center justify-between gap-1">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                    {m.label}
                  </p>
                  <InfoHint text={m.hint} />
                </div>
                <p
                  className={`text-base sm:text-lg font-bold tabular-nums mt-0.5 ${
                    m.accent === 'emerald'
                      ? 'text-[#D97706] dark:text-[#FFB020]'
                      : m.accent === 'crimson'
                      ? 'text-[#E11D48] dark:text-[#FF4D6D]'
                      : m.accent === 'gold'
                      ? 'text-[#D97706] dark:text-[#F5B700]'
                      : 'text-slate-900 dark:text-white'
                  }`}
                >
                  {m.value}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
                  {m.sub}
                </p>
              </MaterialCard>
            ))}
          </section>

          {/* Material 3 Segmented Chart & Library View Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
            <MaterialSegmentedTabs
              layoutGroupId="quantChartStage"
              activeId={chartView}
              onChange={setChartView}
              items={[
                { id: 'EQUITY_DD', label: 'Equity & Drawdown' },
                { id: 'MONTE_CARLO', label: 'Monte Carlo (1K)' },
                { id: 'SAVED', label: `Saved (${savedStrategies.length})` },
              ]}
            />
          </div>

          <AnimatePresence mode="wait">
          {chartView === 'EQUITY_DD' && (
          <motion.div
            key="equity_dd"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: MATERIAL_EASE }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-w-0"
          >
            {/* Equity Curve vs Nifty 50 */}
            <section className="lg:col-span-7 min-w-0 rounded-3xl m3-card p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white truncate">
                    Equity vs Nifty 50
                  </h3>
                  <InfoHint text="₹1L base backtest including 0.10% Indian STT & brokerage slippage." />
                </div>
                <div className="flex items-center gap-3 text-[11px] font-medium shrink-0">
                  <span className="text-[#D97706] dark:text-[#FFB020] font-semibold">Strategy</span>
                  <span className="text-slate-400">Nifty 50</span>
                </div>
              </div>

              <div className="h-64 sm:h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={result.equityCurve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      tickFormatter={(v: string) => v.slice(2, 7)}
                      minTickGap={32}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}K`}
                      width={52}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B0F19',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '14px',
                        fontSize: '12px',
                        color: '#f8fafc',
                      }}
                      formatter={(val: unknown, name: unknown) => [
                        formatInr(Number(val)),
                        name === 'strategyNav' ? 'Strategy' : 'Nifty 50',
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="strategyNav"
                      stroke="#FFB020"
                      strokeWidth={2.2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="benchmarkNav"
                      stroke="#64748b"
                      strokeWidth={1.6}
                      strokeDasharray="4 4"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Drawdown Chart */}
            <section className="lg:col-span-5 min-w-0 rounded-3xl m3-card p-4 sm:p-5">
              <div className="flex items-center gap-1.5 mb-3">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Drawdown (%)
                </h3>
                <InfoHint text="Peak-to-trough decline over backtest horizon." />
              </div>
              <div className="h-64 sm:h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={result.equityCurve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      tickFormatter={(v: string) => v.slice(2, 7)}
                      minTickGap={36}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      tickFormatter={(v: number) => `${v}%`}
                      width={44}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B0F19',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '14px',
                        fontSize: '12px',
                        color: '#f8fafc',
                      }}
                      formatter={(val: unknown) => [`${val}%`, 'Drawdown']}
                    />
                    <Area
                      type="monotone"
                      dataKey="drawdownPct"
                      stroke="#FF4D6D"
                      fill="#FF4D6D"
                      fillOpacity={0.2}
                      strokeWidth={1.8}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          </motion.div>
          )}

          {/* 1,000-Path Monte Carlo GBM Fan Chart */}
          {chartView === 'MONTE_CARLO' && (
          <motion.section
            key="monte_carlo"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: MATERIAL_EASE }}
            className="rounded-3xl m3-card p-4 sm:p-5 min-w-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-1.5">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Monte Carlo 1Y Cone
                </h3>
                <InfoHint text="1,000 simulated 252-day Geometric Brownian Motion paths on ₹1L base." />
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] font-medium tabular-nums">
                <span className="text-[#D97706] dark:text-[#FFB020]">Med {formatInr(result.monteCarlo.medianFinal)}</span>
                <span className="text-slate-500">P10 {formatInr(result.monteCarlo.p10Final)}</span>
                <span className="text-sky-500">P90 {formatInr(result.monteCarlo.p90Final)}</span>
                <span className="text-[#E11D48] dark:text-[#FF4D6D]">CVaR {formatInr(result.monteCarlo.cvar95Inr)}</span>
              </div>
            </div>

            <div className="h-72 sm:h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={result.monteCarlo.fanSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    tickFormatter={(d: number) => `D${d}`}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}K`}
                    width={56}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0B0F19',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '14px',
                      fontSize: '12px',
                      color: '#f8fafc',
                    }}
                    formatter={(val: unknown, name: unknown) => [
                      formatInr(Number(val)),
                      String(name).toUpperCase(),
                    ]}
                  />
                  <Area type="monotone" dataKey="p90" stroke="#FFB020" fill="#FFB020" fillOpacity={0.08} strokeWidth={1.2} strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="p75" stroke="#FFB020" fill="#FFB020" fillOpacity={0.12} strokeWidth={1} />
                  <Area type="monotone" dataKey="p50" stroke="#FFB020" fill="transparent" strokeWidth={2.4} />
                  <Area type="monotone" dataKey="p25" stroke="#F5B700" fill="#F5B700" fillOpacity={0.08} strokeWidth={1} />
                  <Area type="monotone" dataKey="p10" stroke="#FF4D6D" fill="#FF4D6D" fillOpacity={0.08} strokeWidth={1.4} strokeDasharray="3 3" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.section>
          )}

          {/* Saved Library quick switcher */}
          {chartView === 'SAVED' && (
            <motion.section
              key="saved_lib"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: MATERIAL_EASE }}
              className="rounded-3xl m3-card p-5 min-w-0"
            >
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white mb-3">
                Your Saved Strategies ({savedStrategies.length})
              </h3>
              {savedStrategies.length === 0 ? (
                <p className="text-xs text-slate-500 py-8 text-center">
                  No saved strategies yet. Tap Save Strategy above to pin your custom rules.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {savedStrategies
                    .filter((s) => Boolean(s?.dsl && s?.metrics))
                    .map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setChartView('EQUITY_DD');
                          void runWithDsl(s.dsl);
                        }}
                        className="text-left p-4 rounded-2xl m3-tonal-box m3-card-interactive border border-slate-200/70 dark:border-white/8 flex items-center justify-between gap-2 active:scale-[0.99] min-w-0"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            {s.dsl?.name || 'Saved Strategy'}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                            CAGR {s.metrics?.cagrPct ?? 0}% · MaxDD {s.metrics?.maxDrawdownPct ?? 0}%
                          </p>
                        </div>
                        <Play className="w-4 h-4 text-[#FFB020] shrink-0" />
                      </button>
                    ))}
                </div>
              )}
            </motion.section>
          )}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
};
