import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDownUp,
  ArrowUpRight,
  Layers,
  Plus,
  ReceiptIndianRupee,
  Search,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
import type {
  EfficientFrontierResult,
  EnrichedHolding,
  LedgerEntryRecord,
  MutualFundOverlapResult,
  MutualFundSearchItem,
  OrderRecord,
  TaxHarvestReport,
  UpstoxFundsInfo,
  UpstoxHoldingItem,
} from '../../shared/types.ts';
import { apiFetch, formatInr } from '../lib/api.ts';
import { deleteTradeLotFromFirestore, syncTradeLotToFirestore } from '../lib/firebase.ts';
import { BottomSheet } from './BottomSheet.tsx';
import { InfoHint, MATERIAL_EASE, MaterialCard, MaterialSegmentedTabs } from './MotionPrimitives.tsx';
import { PinLockModal } from './PinLockModal.tsx';

interface PortfolioTabProps {
  initialSubTab?: string;
  holdings: EnrichedHolding[];
  orders: OrderRecord[];
  ledgerEntries: LedgerEntryRecord[];
  cashInr: number;
  sipEscrowInr: number;
  taxReserveInr: number;
  upstoxConnected?: boolean;
  portfolioSourceMode?: 'UPSTOX_LIVE' | 'REAL_TRADES' | 'EMPTY';
  preselectedTradeSymbol: string | null;
  onClearPreselectedSymbol: () => void;
  onRefreshPortfolio: () => Promise<void>;
}

const NSE_TRADE_SYMBOLS = [
  'RELIANCE.NS',
  'TCS.NS',
  'HDFCBANK.NS',
  'INFY.NS',
  'ICICIBANK.NS',
  'TATAMOTORS.NS',
  'SUNPHARMA.NS',
  'BHARTIARTL.NS',
  'LT.NS',
  'ITC.NS',
  'NIFTYBEES.NS',
  'GOLDBEES.NS',
  'LIQUIDBEES.NS',
];

export const PortfolioTab: React.FC<PortfolioTabProps> = ({
  initialSubTab,
  holdings,
  orders,
  ledgerEntries,
  cashInr,
  sipEscrowInr,
  taxReserveInr,
  upstoxConnected = false,
  preselectedTradeSymbol,
  onClearPreselectedSymbol,
  onRefreshPortfolio,
}) => {
  const [subTab, setSubTab] = useState<'HOLDINGS' | 'MARKOWITZ' | 'MF_OVERLAP' | 'TAX' | 'LEDGER' | 'UPSTOX'>(
    'HOLDINGS'
  );

  // Real Trade Logger & Live Upstox Order Sheet
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeMode, setTradeMode] = useState<'LOG' | 'UPSTOX'>('LOG');
  const [tradeSymbol, setTradeSymbol] = useState('RELIANCE.NS');
  const [customSymbol, setCustomSymbol] = useState('');
  const [tradeSide, setTradeSide] = useState<'BUY' | 'SELL'>('BUY');
  const [tradeQty, setTradeQty] = useState('1');
  const [tradePriceInr, setTradePriceInr] = useState('');
  const [tradeDate, setTradeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tradeSaving, setTradeSaving] = useState(false);
  const [tradePinOpen, setTradePinOpen] = useState(false);
  const [tradeStatus, setTradeStatus] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);

  // Broker CSV Import Sheet
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);

  // Liquid Cash Reserve Update Sheet
  const [cashOpen, setCashOpen] = useState(false);
  const [cashReserveInput, setCashReserveInput] = useState(() => String(cashInr || ''));
  const [cashSaving, setCashSaving] = useState(false);
  const [cashError, setCashError] = useState<string | null>(null);

  // Ledger Transfer Sheet (Real Account Allocation Only)
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAction, setTransferAction] = useState<
    'RESERVE_TAX' | 'RELEASE_TAX' | 'FUND_SIP'
  >('FUND_SIP');
  const [transferAmt, setTransferAmt] = useState('10000');
  const [transferPinOpen, setTransferPinOpen] = useState(false);

  // Markowitz State
  const [frontier, setFrontier] = useState<EfficientFrontierResult | null>(null);
  const [frontierLoading, setFrontierLoading] = useState(false);
  const [frontierError, setFrontierError] = useState<string | null>(null);

  // Tax Harvest State
  const [taxReport, setTaxReport] = useState<TaxHarvestReport | null>(null);
  const [taxLoading, setTaxLoading] = useState(false);

  // MF Overlap / Return Co-movement State
  const [mfQuery, setMfQuery] = useState('');
  const [mfSearchResults, setMfSearchResults] = useState<MutualFundSearchItem[]>([]);
  const [selectedMfCodes, setSelectedMfCodes] = useState<number[]>([122639, 120716, 119598]);
  const [mfOverlap, setMfOverlap] = useState<MutualFundOverlapResult | null>(null);
  const [mfLoading, setMfLoading] = useState(false);
  const [mfError, setMfError] = useState<string | null>(null);

  // Upstox Demat Holdings State
  const [upstoxHoldings, setUpstoxHoldings] = useState<UpstoxHoldingItem[]>([]);
  const [upstoxFunds, setUpstoxFunds] = useState<UpstoxFundsInfo | null>(null);
  const [upstoxLoading, setUpstoxLoading] = useState(false);
  const [upstoxErr, setUpstoxErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialSubTab === 'TAX') setSubTab('TAX');
  }, [initialSubTab]);

  useEffect(() => {
    if (preselectedTradeSymbol) {
      setTradeSymbol(preselectedTradeSymbol);
      setTradeSide('BUY');
      setTradeOpen(true);
      onClearPreselectedSymbol();
    }
  }, [preselectedTradeSymbol, onClearPreselectedSymbol]);

  const loadMarkowitz = async () => {
    setFrontierLoading(true);
    setFrontierError(null);
    try {
      const res = await apiFetch<EfficientFrontierResult>('/api/portfolio/optimize');
      setFrontier(res);
    } catch (err) {
      setFrontierError((err as Error).message);
    } finally {
      setFrontierLoading(false);
    }
  };

  const loadTaxReport = async () => {
    setTaxLoading(true);
    try {
      const res = await apiFetch<TaxHarvestReport>('/api/portfolio/tax-harvest');
      setTaxReport(res);
    } finally {
      setTaxLoading(false);
    }
  };

  const runMfOverlap = async (codes = selectedMfCodes) => {
    if (codes.length < 2) return;
    setMfLoading(true);
    setMfError(null);
    try {
      const res = await apiFetch<MutualFundOverlapResult>('/api/portfolio/mf-overlap', {
        method: 'POST',
        body: JSON.stringify({ schemeCodes: codes }),
      });
      setMfOverlap(res);
    } catch (err) {
      setMfError((err as Error).message || 'Unable to compute mutual fund return co-movement.');
    } finally {
      setMfLoading(false);
    }
  };

  const searchMf = async (q: string) => {
    setMfQuery(q);
    try {
      const res = await apiFetch<{ items: MutualFundSearchItem[] }>(
        `/api/market/mf/search?q=${encodeURIComponent(q)}`
      );
      setMfSearchResults(res.items);
    } catch {
      // ignore
    }
  };

  const loadUpstoxHoldings = async () => {
    setUpstoxLoading(true);
    setUpstoxErr(null);
    try {
      const res = await apiFetch<{ holdings: UpstoxHoldingItem[]; funds: UpstoxFundsInfo }>(
        '/api/upstox/holdings'
      );
      setUpstoxHoldings(res.holdings);
      setUpstoxFunds(res.funds);
    } catch (err) {
      setUpstoxErr((err as Error).message);
    } finally {
      setUpstoxLoading(false);
    }
  };

  useEffect(() => {
    if (subTab === 'MARKOWITZ' && !frontier && !frontierLoading) {
      void loadMarkowitz();
    }
    if (subTab === 'TAX' && !taxReport && !taxLoading) {
      void loadTaxReport();
    }
    if (subTab === 'MF_OVERLAP') {
      if (mfSearchResults.length === 0) void searchMf('');
      if (!mfOverlap && !mfLoading) void runMfOverlap();
    }
    if (subTab === 'UPSTOX' && upstoxHoldings.length === 0 && !upstoxLoading) {
      void loadUpstoxHoldings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  const resolvedTradeSymbol =
    tradeSymbol === '__CUSTOM__' ? customSymbol.trim().toUpperCase() : tradeSymbol;

  const handleLogExecutedTrade = async () => {
    const qty = Number(tradeQty);
    const price = Number(tradePriceInr);
    if (!resolvedTradeSymbol || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      setTradeError('Enter symbol, positive quantity, and exact execution price (₹).');
      return;
    }
    setTradeSaving(true);
    setTradeError(null);
    try {
      const res = await apiFetch<{ trade: OrderRecord }>('/api/portfolio/trades', {
        method: 'POST',
        body: JSON.stringify({
          symbol: resolvedTradeSymbol,
          side: tradeSide,
          quantity: qty,
          priceInr: price,
          tradeDate,
        }),
      });
      void syncTradeLotToFirestore({
        id: res.trade.id,
        symbol: res.trade.symbol,
        name: res.trade.name || res.trade.symbol.replace('.NS', ''),
        assetType: res.trade.assetType || 'STOCK_NSE',
        side: res.trade.side,
        quantity: res.trade.qty,
        priceInr: res.trade.executionPrice,
        tradeDate: res.trade.tradeDate || tradeDate,
        source: 'MANUAL',
      }).catch(() => {});
      setTradeOpen(false);
      setTradeStatus(
        `Logged ${res.trade.side} ${res.trade.qty} ${res.trade.symbol.replace('.NS', '')} @ ${formatInr(
          res.trade.executionPrice,
          true
        )}`
      );
      await onRefreshPortfolio();
      if (subTab === 'TAX') void loadTaxReport();
    } catch (err) {
      setTradeError((err as Error).message);
    } finally {
      setTradeSaving(false);
    }
  };

  const handleImportCsv = async () => {
    if (!csvText.trim()) return;
    setCsvImporting(true);
    setCsvError(null);
    try {
      const res = await apiFetch<{ importedCount: number; trades: OrderRecord[] }>(
        '/api/portfolio/import-csv',
        {
          method: 'POST',
          body: JSON.stringify({ csvText }),
        }
      );
      for (const tr of res.trades || []) {
        void syncTradeLotToFirestore({
          id: tr.id,
          symbol: tr.symbol,
          name: tr.name || tr.symbol.replace('.NS', ''),
          assetType: tr.assetType || 'STOCK_NSE',
          side: tr.side,
          quantity: tr.qty,
          priceInr: tr.executionPrice,
          tradeDate: tr.tradeDate || new Date().toISOString().slice(0, 10),
          source: 'CSV_IMPORT',
          brokerOrderId: tr.brokerOrderId,
        }).catch(() => {});
      }
      setCsvOpen(false);
      setCsvText('');
      setTradeStatus(`Imported ${res.importedCount} executed broker trades into FIFO holdings & FY26 tax engine.`);
      await onRefreshPortfolio();
      if (subTab === 'TAX') void loadTaxReport();
    } catch (err) {
      setCsvError((err as Error).message);
    } finally {
      setCsvImporting(false);
    }
  };

  const handleDeleteTrade = async (id: string) => {
    try {
      await apiFetch(`/api/portfolio/trades/${encodeURIComponent(id)}`, { method: 'DELETE' });
      void deleteTradeLotFromFirestore(id).catch(() => {});
      setTradeStatus('Removed trade lot and recomputed FIFO holdings.');
      await onRefreshPortfolio();
      if (subTab === 'TAX') void loadTaxReport();
    } catch (err) {
      setTradeStatus((err as Error).message);
    }
  };

  const handleSaveCashReserve = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(cashReserveInput);
    if (!Number.isFinite(amt) || amt < 0) {
      setCashError('Enter a valid non-negative INR liquid cash balance.');
      return;
    }
    setCashSaving(true);
    setCashError(null);
    try {
      await apiFetch('/api/portfolio/cash-reserve', {
        method: 'POST',
        body: JSON.stringify({ amountInr: amt }),
      });
      setCashOpen(false);
      setTradeStatus(`Updated liquid cash reserve to ${formatInr(amt)}.`);
      await onRefreshPortfolio();
    } catch (err) {
      setCashError((err as Error).message);
    } finally {
      setCashSaving(false);
    }
  };

  const handleConfirmOrderPin = async (pin: string) => {
    const res = await apiFetch<{ order: OrderRecord; brokerOrderId?: string }>('/api/orders', {
      method: 'POST',
      idempotent: true,
      body: JSON.stringify({
        symbol: resolvedTradeSymbol,
        side: tradeSide,
        qty: Number(tradeQty),
        pin,
      }),
    });
    setTradePinOpen(false);
    setTradeOpen(false);
    setTradeStatus(
      `Upstox ${res.order.side} ${res.order.qty} ${res.order.symbol.replace('.NS', '')} routed @ ${formatInr(
        res.order.executionPrice,
        true
      )}${res.brokerOrderId ? ` (#${res.brokerOrderId})` : ''}`
    );
    void syncTradeLotToFirestore({
      id: res.order.id,
      symbol: res.order.symbol,
      name: res.order.name || res.order.symbol.replace('.NS', ''),
      assetType: res.order.assetType || 'STOCK_NSE',
      side: res.order.side,
      quantity: res.order.qty,
      priceInr: res.order.executionPrice,
      tradeDate: res.order.tradeDate || new Date().toISOString().slice(0, 10),
      source: 'UPSTOX_LIVE',
      brokerOrderId: res.brokerOrderId,
    }).catch(() => {});
    await onRefreshPortfolio();
    if (subTab === 'TAX') void loadTaxReport();
  };

  const handleConfirmTransferPin = async (pin: string) => {
    await apiFetch('/api/ledger/transfer', {
      method: 'POST',
      idempotent: true,
      body: JSON.stringify({
        action: transferAction,
        amountInr: Number(transferAmt),
        pin,
      }),
    });
    setTransferPinOpen(false);
    setTransferOpen(false);
    setTradeStatus(`Ledger allocation (${transferAction}) updated.`);
    await onRefreshPortfolio();
  };

  const scatterData = frontier
    ? [
        ...frontier.frontierCloud.map((p) => ({
          x: p.volatilityPct,
          y: p.expectedReturnPct,
          kind: 'Feasible Weights',
        })),
      ]
    : [];

  return (
    <div className="space-y-4 pb-6 lg:min-h-[calc(100dvh-4.75rem)] lg:flex lg:flex-col min-w-0">
      {/* Material 3 Sliding Sub-navigation bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap min-w-0 shrink-0">
        <MaterialSegmentedTabs
          layoutGroupId="portfolioSubTab"
          activeId={subTab}
          onChange={setSubTab}
          items={[
            { id: 'HOLDINGS', label: 'Holdings' },
            { id: 'MARKOWITZ', label: 'Markowitz' },
            { id: 'MF_OVERLAP', label: 'MF Co-movement' },
            { id: 'TAX', label: 'Tax Harvester' },
            { id: 'LEDGER', label: 'Ledger' },
            { id: 'UPSTOX', label: 'Upstox Demat' },
          ]}
        />

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setCsvError(null);
              setCsvOpen(true);
            }}
            className="min-h-[40px] px-3.5 py-2 rounded-2xl m3-tonal-box hover:opacity-90 active:scale-[0.98] text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5 text-[#FFB020]" />
            <span>Import CSV</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTradeError(null);
              setTradeMode(upstoxConnected ? 'UPSTOX' : 'LOG');
              setTradeOpen(true);
            }}
            className="min-h-[40px] px-4 py-2 rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>{upstoxConnected ? 'Log / Order' : 'Log Trade'}</span>
          </button>
        </div>
      </div>

      {tradeStatus && (
        <div className="p-3.5 rounded-2xl bg-[#FFB020]/10 border border-[#FFB020]/30 text-xs font-medium text-[#D97706] dark:text-[#FFB020] flex items-center justify-between">
          <span>{tradeStatus}</span>
          <button
            type="button"
            onClick={() => setTradeStatus(null)}
            className="text-xs underline ml-3"
          >
            Dismiss
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
      {/* 1. HOLDINGS & ORDERS */}
      {subTab === 'HOLDINGS' && (
        <motion.div
          key="holdings"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: MATERIAL_EASE }}
          className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-w-0 lg:flex-1 lg:min-h-0"
        >
          <MaterialCard className="lg:col-span-8 min-w-0 min-h-0 p-4 sm:p-5 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Holdings ({holdings.length})
                </h2>
                <InfoHint text="Live NSE valuation, portfolio weights & FY26 STCG/LTCG lot classification." />
              </div>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                Cash: {formatInr(cashInr)}
              </span>
            </div>

            {holdings.length === 0 ? (
              <div className="py-10 text-center space-y-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No holdings recorded yet. Import your broker tradebook CSV, log a trade, or connect Upstox.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCsvOpen(true)}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-[#FFB020] text-[#1C1000] text-xs font-semibold"
                  >
                    Import Broker CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTradeMode('LOG');
                      setTradeOpen(true);
                    }}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-xl m3-tonal-box text-xs font-semibold text-slate-800 dark:text-slate-200"
                  >
                    Log Executed Trade
                  </button>
                </div>
              </div>
            ) : (
              (() => {
                const totalHoldingsValue = holdings.reduce((s, x) => s + Math.max(0, x.currentValue), 0) || 1;
                return (
                  <div className="divide-y divide-slate-100 dark:divide-white/6 lg:max-h-[58dvh] lg:overflow-y-auto overflow-x-hidden scroll-fade-y py-1">
                    {holdings.map((h) => {
                      const up = h.unrealizedPnl >= 0;
                      const weightPct = Math.round((h.currentValue / totalHoldingsValue) * 1000) / 10;
                      return (
                        <div
                          key={h.id}
                          className="py-3 flex items-center justify-between gap-3 min-w-0"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                {h.symbol.replace('.NS', '')}
                              </p>
                              <span className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                                {h.taxBucket} · {h.holdingDays}d · {weightPct}% wt
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5 truncate">
                              {h.quantity} qty · Avg {formatInr(h.avgBuyPrice, true)} · LTP{' '}
                              {formatInr(h.currentPrice, true)}
                            </p>
                            <div className="mt-1.5 h-1.5 w-full max-w-[200px] rounded-full bg-slate-200/80 dark:bg-white/8 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[#FFB020]"
                                style={{ width: `${Math.min(100, Math.max(4, weightPct))}%` }}
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <p className="text-sm font-semibold text-slate-900 dark:text-white tabular-nums">
                                {formatInr(h.currentValue)}
                              </p>
                              <p
                                className={`text-xs font-medium tabular-nums ${
                                  up
                                    ? 'text-[#D97706] dark:text-[#FFB020]'
                                    : 'text-[#E11D48] dark:text-[#FF4D6D]'
                                }`}
                              >
                                {up ? '+' : ''}
                                {formatInr(h.unrealizedPnl)} ({up ? '+' : ''}
                                {h.unrealizedPnlPct}%)
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setTradeSymbol(h.symbol);
                                setTradeSide('SELL');
                                setTradeQty(String(Math.max(1, Math.floor(h.quantity / 2))));
                                setTradePriceInr(String(h.currentPrice || ''));
                                setTradeMode(upstoxConnected ? 'UPSTOX' : 'LOG');
                                setTradeOpen(true);
                              }}
                              className="min-h-[36px] px-3 py-1.5 rounded-xl m3-tonal-box hover:bg-slate-200 dark:hover:bg-white/12 active:scale-[0.97] text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all"
                            >
                              Log Exit
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </MaterialCard>

          <MaterialCard delay={0.05} className="lg:col-span-4 min-w-0 min-h-0 p-4 sm:p-5 flex flex-col">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white mb-3 shrink-0">
              Trade Book ({orders.length})
            </h3>
            {orders.length === 0 ? (
              <p className="text-xs text-slate-500 py-8 text-center">
                No executed trades logged yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/6 lg:flex-1 lg:min-h-0 lg:overflow-y-auto overflow-x-hidden scroll-fade-y py-1">
                {orders.slice(0, 15).map((o) => (
                  <div key={o.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">
                        <span
                          className={
                            o.side === 'BUY'
                              ? 'text-[#D97706] dark:text-[#FFB020]'
                              : 'text-[#E11D48] dark:text-[#FF4D6D]'
                          }
                        >
                          {o.side}
                        </span>{' '}
                        {o.qty} {o.symbol.replace('.NS', '')}
                      </p>
                      <p className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400 truncate">
                        {o.tradeDate || o.createdAt.slice(0, 10)} · {o.stcgLtcgTag}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right tabular-nums">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {formatInr(o.totalValueInr)}
                        </p>
                        <p className="text-[11px] text-slate-500">@ {formatInr(o.executionPrice)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteTrade(o.id)}
                        aria-label={`Delete ${o.symbol} trade`}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-[#FF4D6D] hover:bg-[#FF4D6D]/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </MaterialCard>
        </motion.div>
      )}

      {/* 2. MARKOWITZ EFFICIENT FRONTIER & GBM */}
      {subTab === 'MARKOWITZ' && (
        <motion.div
          key="markowitz"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: MATERIAL_EASE }}
          className="space-y-5"
        >
          {frontierLoading && (
            <div className="p-8 rounded-3xl m3-card text-center text-sm text-slate-500">
              Computing NSE efficient frontier...
            </div>
          )}
          {frontierError && (
            <div className="p-4 rounded-2xl bg-[#FF4D6D]/10 border border-[#FF4D6D]/30 text-xs text-[#E11D48] dark:text-[#FF4D6D]">
              {frontierError}
            </div>
          )}
          {frontier && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-w-0">
              <section className="lg:col-span-7 min-w-0 rounded-3xl m3-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-1.5">
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                      Efficient Frontier
                    </h2>
                    <InfoHint text={`Current Sharpe ${frontier.currentPortfolio.sharpe} vs Max-Sharpe ${frontier.maxSharpePortfolio.sharpe} across 3,500 Dirichlet weight samples on 3Y NSE returns.`} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[#D97706] dark:text-[#FFB020] tabular-nums">
                      Sharpe {frontier.currentPortfolio.sharpe} → {frontier.maxSharpePortfolio.sharpe}
                    </span>
                    <button
                      type="button"
                      onClick={loadMarkowitz}
                      className="min-h-[32px] px-3 rounded-xl m3-tonal-box hover:bg-slate-200 dark:hover:bg-white/12 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
                    >
                      Recompute
                    </button>
                  </div>
                </div>

                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name="Volatility"
                        unit="%"
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        domain={['auto', 'auto']}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name="Expected Return"
                        unit="%"
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        domain={['auto', 'auto']}
                        width={46}
                      />
                      <ZAxis range={[25, 160]} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0B0F19',
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: '#f8fafc',
                        }}
                        formatter={(val: unknown, name: unknown) => [`${val}%`, String(name)]}
                      />
                      <Scatter name="Feasible Portfolios" data={scatterData} fill="#475569" fillOpacity={0.45} />
                      <Scatter
                        name="Current Portfolio"
                        data={[
                          {
                            x: frontier.currentPortfolio.volatilityPct,
                            y: frontier.currentPortfolio.expectedReturnPct,
                          },
                        ]}
                        fill="#F5B700"
                      />
                      <Scatter
                        name="Max-Sharpe Optimal"
                        data={[
                          {
                            x: frontier.maxSharpePortfolio.volatilityPct,
                            y: frontier.maxSharpePortfolio.expectedReturnPct,
                          },
                        ]}
                        fill="#FFB020"
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                  <span className="font-medium text-[#D97706] dark:text-[#F5B700]">
                    Current: Ret {frontier.currentPortfolio.expectedReturnPct}% · Vol{' '}
                    {frontier.currentPortfolio.volatilityPct}%
                  </span>
                  <span className="font-medium text-[#D97706] dark:text-[#FFB020]">
                    Optimal Max-Sharpe: Ret {frontier.maxSharpePortfolio.expectedReturnPct}% · Vol{' '}
                    {frontier.maxSharpePortfolio.volatilityPct}%
                  </span>
                </div>
              </section>

              <section className="lg:col-span-5 min-w-0 rounded-3xl m3-card p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                      Rebalance Targets
                    </h3>
                    <InfoHint text={`Exact BUY/SELL shifts on ${formatInr(frontier.totalInvestedInr)} equity to reach the Max-Sharpe frontier.`} />
                  </div>
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                    {formatInr(frontier.totalInvestedInr)}
                  </span>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-white/6 lg:max-h-[40dvh] lg:overflow-y-auto pr-1">
                  {frontier.rebalanceDeltas.map((d) => (
                    <div key={d.symbol} className="py-2 flex items-center justify-between gap-2 text-xs">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {d.symbol.replace('.NS', '')}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          {d.currentWeightPct}% → {d.optimalWeightPct}%
                        </p>
                      </div>
                      <span
                        className={`font-semibold tabular-nums ${
                          d.action === 'BUY'
                            ? 'text-[#D97706] dark:text-[#FFB020]'
                            : d.action === 'SELL'
                            ? 'text-[#E11D48] dark:text-[#FF4D6D]'
                            : 'text-slate-400'
                        }`}
                      >
                        {d.action === 'HOLD' ? 'HOLD' : `${d.action} ${formatInr(d.amountInr)}`}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-2.5 border-t border-slate-200 dark:border-white/8">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">
                      1Y GBM Risk
                    </p>
                    <InfoHint text="1,000 Geometric Brownian Motion paths estimating 1-year median value and 95% tail risk." />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-1">
                    Med {formatInr(frontier.gbmProjection.medianFinal)} · VaR{' '}
                    {formatInr(frontier.gbmProjection.var95Inr)} · CVaR{' '}
                    {formatInr(frontier.gbmProjection.cvar95Inr)}
                  </p>
                </div>
              </section>
            </div>
          )}
        </motion.div>
      )}

      {/* 3. MUTUAL FUND OVERLAP ANALYZER */}
      {subTab === 'MF_OVERLAP' && (
        <motion.div
          key="mf_overlap"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: MATERIAL_EASE }}
          className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-w-0"
        >
          <section className="lg:col-span-5 min-w-0 rounded-3xl m3-card p-4 sm:p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#FFB020]" />
                <span>Select 2–4 Funds</span>
              </h2>
              <InfoHint text="Live scheme search & historical NAV correlation via mfapi.in." />
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={mfQuery}
                onChange={(e) => void searchMf(e.target.value)}
                placeholder="Search Parag Parikh, Quant, HDFC, UTI..."
                className="w-full min-h-[42px] pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-white/6">
              {mfSearchResults.map((item) => {
                const selected = selectedMfCodes.includes(item.schemeCode);
                return (
                  <button
                    key={item.schemeCode}
                    type="button"
                    onClick={() => {
                      setSelectedMfCodes((prev) => {
                        if (prev.includes(item.schemeCode)) {
                          return prev.length > 2 ? prev.filter((c) => c !== item.schemeCode) : prev;
                        }
                        if (prev.length >= 4) return [...prev.slice(1), item.schemeCode];
                        return [...prev, item.schemeCode];
                      });
                    }}
                    className={`w-full text-left py-2.5 px-2 rounded-lg flex items-center justify-between gap-2 text-xs transition-colors ${
                      selected
                        ? 'bg-[#FFB020]/10 text-[#D97706] dark:text-[#FFB020] font-semibold'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/4'
                    }`}
                  >
                    <span className="truncate">{item.schemeName}</span>
                    <span className="text-[11px] tabular-nums shrink-0">
                      {selected ? 'Selected' : `#${item.schemeCode}`}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={mfLoading || selectedMfCodes.length < 2}
              onClick={() => void runMfOverlap(selectedMfCodes)}
              className="w-full min-h-[44px] rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] text-xs font-semibold transition-all disabled:opacity-50"
            >
              {mfLoading ? 'Analyzing AMFI NAVs...' : `Analyze Return R² (${selectedMfCodes.length} Funds)`}
            </button>
            {mfError && <p className="text-xs text-[#E11D48] dark:text-[#FF4D6D]">{mfError}</p>}
          </section>

          <section className="lg:col-span-7 min-w-0 rounded-3xl m3-card p-4 sm:p-5 flex flex-col justify-between space-y-3">
            {mfOverlap ? (
              <>
                <div className="flex items-center justify-between gap-4 shrink-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                      Avg Return R²
                    </h3>
                    <InfoHint text={mfOverlap.verdict} />
                  </div>
                  <p className="text-2xl font-bold text-[#D97706] dark:text-[#F5B700] tabular-nums shrink-0">
                    {mfOverlap.portfolioOverlapScorePct}%
                  </p>
                </div>

                {/* Visual Return vs Risk Bar Chart */}
                <div className="h-44 w-full shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={mfOverlap.schemes.map((s) => ({
                        name: s.schemeName.split(' ').slice(0, 2).join(' '),
                        cagr: s.cagr1Y,
                        vol: s.volatilityPct,
                      }))}
                      margin={{ top: 6, right: 8, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0B0F19',
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: '12px',
                          fontSize: '11px',
                          color: '#f8fafc',
                        }}
                        formatter={(val: unknown, name: unknown) => [`${val}%`, name === 'cagr' ? '1Y CAGR' : 'Volatility']}
                      />
                      <Bar dataKey="cagr" name="cagr" fill="#FFB020" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="vol" name="vol" fill="#38BDF8" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-white/6">
                  {mfOverlap.schemes.map((s) => (
                    <div key={s.schemeCode} className="py-1.5 flex items-center justify-between gap-3 text-xs">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">
                        {s.schemeName}
                      </p>
                      <span className="text-[11px] font-medium text-[#D97706] dark:text-[#FFB020] tabular-nums shrink-0">
                        NAV ₹{s.latestNav} · {s.cagr1Y}%
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-white/8 space-y-1.5 lg:max-h-[18dvh] lg:overflow-y-auto pr-1">
                  {mfOverlap.pairwiseMatrix.map((pair) => (
                    <div
                      key={`${pair.schemeA}-${pair.schemeB}`}
                      className="p-2 rounded-xl m3-tonal-box flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="text-slate-800 dark:text-slate-200 truncate">
                        {pair.schemeA} × {pair.schemeB}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white tabular-nums shrink-0">
                        r={pair.correlation} · R² {pair.rSquaredPct}% ({pair.commonDays}d)
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500 py-10 text-center">
                {mfError || 'Select 2–4 schemes to measure live AMFI NAV return correlation & R².'}
              </p>
            )}
          </section>
        </motion.div>
      )}

      {/* 4. INDIAN TAX-LOSS HARVESTER */}
      {subTab === 'TAX' && (
        <motion.div
          key="tax"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: MATERIAL_EASE }}
          className="space-y-3.5 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col"
        >
          {taxLoading && !taxReport && (
            <div className="p-8 rounded-3xl m3-card text-center text-sm text-slate-500">
              Auditing STCG &amp; LTCG lots...
            </div>
          )}
          {taxReport && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
                <MaterialCard className="p-3.5 m3-card-interactive">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Tax Savings</p>
                    <InfoHint text={`Estimated ${taxReport.financialYear} tax reduction from harvesting eligible lots.`} />
                  </div>
                  <p className="text-xl font-bold text-[#D97706] dark:text-[#FFB020] tabular-nums mt-0.5">
                    {formatInr(taxReport.potentialTaxSavingsInr)}
                  </p>
                </MaterialCard>
                <MaterialCard delay={0.04} className="p-3.5 m3-card-interactive">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">LTCG Exemption</p>
                    <InfoHint text="₹1.25L annual LTCG exemption left; 12.5% applies above limit." />
                  </div>
                  <p className="text-xl font-bold text-[#D97706] dark:text-[#F5B700] tabular-nums mt-0.5">
                    {formatInr(taxReport.ltcgExemptionRemainingInr)}
                  </p>
                </MaterialCard>
                <MaterialCard delay={0.08} className="p-3.5 m3-card-interactive">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">STCG / Loss</p>
                    <InfoHint text="Unrealized short-term gains & losses (<365d), taxed at 20% u/s 111A." />
                  </div>
                  <p className="text-base font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                    +{formatInr(taxReport.unrealizedStcgGainInr)} / -{formatInr(taxReport.unrealizedStcgLossInr)}
                  </p>
                </MaterialCard>
                <MaterialCard delay={0.12} className="p-3.5 m3-card-interactive">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Est. Tax Liability</p>
                    <InfoHint text="Estimated capital gains tax if all current lots are liquidated." />
                  </div>
                  <p className="text-xl font-bold text-[#E11D48] dark:text-[#FF4D6D] tabular-nums mt-0.5">
                    {formatInr(taxReport.estimatedTaxLiabilityInr)}
                  </p>
                </MaterialCard>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:flex-1 lg:min-h-0">
                <section className="lg:col-span-5 rounded-3xl m3-card p-4 flex flex-col">
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white mb-2 shrink-0">
                    STCG vs Tax Shield
                  </h3>
                  <div className="h-48 lg:h-auto lg:flex-1 min-h-[180px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={[
                          { label: 'STCG Gain', value: taxReport.unrealizedStcgGainInr },
                          { label: 'STCG Loss', value: taxReport.unrealizedStcgLossInr },
                          { label: 'Tax Liability', value: taxReport.estimatedTaxLiabilityInr },
                          { label: 'Tax Saved', value: taxReport.potentialTaxSavingsInr },
                        ]}
                        margin={{ top: 6, right: 8, left: -4, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}K`} width={48} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0B0F19',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '12px',
                            fontSize: '11px',
                            color: '#f8fafc',
                          }}
                          formatter={(val: unknown) => formatInr(Number(val))}
                        />
                        <Bar dataKey="value" fill="#FFB020" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="lg:col-span-7 rounded-3xl m3-card p-4 flex flex-col min-h-0">
                  <div className="flex items-center gap-2 mb-3 shrink-0">
                    <ReceiptIndianRupee className="w-4 h-4 text-[#F5B700]" />
                    <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                      Harvest Moves
                    </h3>
                    <InfoHint text="Recommended sells before March 31 to offset STCG/LTCG or utilize ₹1.25L exemption." />
                  </div>

                  {taxReport.moves.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No harvest moves needed right now.
                    </p>
                  ) : (
                    <div className="space-y-2.5 lg:flex-1 lg:overflow-y-auto pr-1">
                      {taxReport.moves.map((m) => (
                        <div
                          key={`${m.symbol}-${m.action}`}
                          className="p-3 rounded-2xl m3-tonal-box border border-slate-200/70 dark:border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2 text-xs min-w-0">
                            <span className="font-semibold text-slate-900 dark:text-white">
                              {m.symbol.replace('.NS', '')}
                            </span>
                            <span className="tabular-nums text-slate-500 dark:text-slate-400">
                              {m.taxBucket} · {m.holdingDays}d · {m.quantity} qty
                            </span>
                            <InfoHint text={m.rationale} />
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs font-semibold text-[#D97706] dark:text-[#FFB020] tabular-nums">
                              Save {formatInr(m.estimatedTaxSavedInr)}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setTradeSymbol(m.symbol);
                                setTradeSide('SELL');
                                setTradeQty(String(m.quantity));
                                setTradeOpen(true);
                              }}
                              className="min-h-[34px] px-3 py-1 rounded-xl bg-slate-900 dark:bg-white/10 hover:bg-slate-800 dark:hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
                            >
                              <span>Sell</span>
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </motion.div>
      )}

      {/* 5. IMMUTABLE DOUBLE-ENTRY LEDGER */}
      {subTab === 'LEDGER' && (
        <motion.div
          key="ledger"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: MATERIAL_EASE }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MaterialCard className="p-4 flex items-center justify-between gap-2 m3-card-interactive">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">CASH_INR Balance</p>
                <p className="text-xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                  {formatInr(cashInr)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCashReserveInput(String(cashInr || 0));
                  setCashError(null);
                  setCashOpen(true);
                }}
                className="min-h-[36px] px-3 py-1.5 rounded-xl m3-tonal-box text-xs font-semibold text-slate-800 dark:text-slate-200 hover:opacity-90 shrink-0"
              >
                Set Cash
              </button>
            </MaterialCard>
            <MaterialCard delay={0.04} className="p-4 m3-card-interactive">
              <p className="text-xs text-slate-500 dark:text-slate-400">SIP_ESCROW Balance</p>
              <p className="text-xl font-bold text-[#D97706] dark:text-[#FFB020] tabular-nums mt-1">
                {formatInr(sipEscrowInr)}
              </p>
            </MaterialCard>
            <MaterialCard delay={0.08} className="p-4 flex items-center justify-between gap-2 m3-card-interactive">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">TAX_RESERVE Balance</p>
                <p className="text-xl font-bold text-[#D97706] dark:text-[#F5B700] tabular-nums mt-1">
                  {formatInr(taxReserveInr)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTransferOpen(true)}
                className="min-h-[40px] px-3.5 py-2 rounded-2xl bg-slate-900 dark:bg-white/10 hover:bg-slate-800 dark:hover:bg-white/16 active:scale-[0.98] text-white text-xs font-semibold flex items-center gap-1.5 transition-all"
              >
                <ArrowDownUp className="w-3.5 h-3.5" />
                <span>Allocate</span>
              </button>
            </MaterialCard>
          </div>

          <section className="rounded-3xl m3-card p-4 sm:p-5 min-w-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-[#FFB020]" />
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                  Accounting Journal
                </h3>
                <InfoHint text="Immutable double-entry credit/debit ledger in paise precision." />
              </div>
              <span className="text-xs tabular-nums text-slate-500">{ledgerEntries.length} entries</span>
            </div>

            <div className="overflow-x-auto lg:max-h-[48dvh] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Description</th>
                    <th className="py-2 pr-3 font-medium">Debit → Credit</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/6">
                  {ledgerEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="py-2.5 pr-3 text-[11px] tabular-nums text-slate-500 whitespace-nowrap">
                        {entry.createdAt.slice(0, 10)}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-800 dark:text-slate-200">
                        {entry.description}
                      </td>
                      <td className="py-2.5 pr-3 text-[11px] font-medium text-slate-500 whitespace-nowrap">
                        {entry.debitAccountType} → {entry.creditAccountType}
                      </td>
                      <td className="py-2.5 text-right font-semibold text-slate-900 dark:text-white tabular-nums whitespace-nowrap">
                        {formatInr(entry.amountPaise / 100, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </motion.div>
      )}
      {/* 6. LIVE UPSTOX DEMAT HOLDINGS */}
      {subTab === 'UPSTOX' && (
        <motion.div
          key="upstox_demat"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: MATERIAL_EASE }}
          className="space-y-4 min-w-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Upstox Demat Sync
              </h2>
              <InfoHint text="Syncs Demat holdings and equity cash margin from Upstox." />
            </div>
            <button
              type="button"
              disabled={upstoxLoading}
              onClick={loadUpstoxHoldings}
              className="min-h-[36px] px-3.5 rounded-xl m3-tonal-box text-xs font-semibold text-slate-800 dark:text-slate-200 disabled:opacity-50"
            >
              {upstoxLoading ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>

          {upstoxErr ? (
            <MaterialCard className="p-6 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{upstoxErr}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Open Live Markets → Connect Upstox to authorize Demat sync.
              </p>
            </MaterialCard>
          ) : (
            <>
              {upstoxFunds && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <MaterialCard className="p-4">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Available Margin</p>
                    <p className="text-xl font-bold text-[#D97706] dark:text-[#FFB020] tabular-nums mt-1">
                      {formatInr(upstoxFunds.availableMargin, true)}
                    </p>
                  </MaterialCard>
                  <MaterialCard className="p-4">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Used Margin</p>
                    <p className="text-xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                      {formatInr(upstoxFunds.usedMargin, true)}
                    </p>
                  </MaterialCard>
                  <MaterialCard className="p-4">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Holdings Count</p>
                    <p className="text-xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                      {upstoxHoldings.length}
                    </p>
                  </MaterialCard>
                </div>
              )}

              <MaterialCard className="p-4 sm:p-5">
                {upstoxHoldings.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8 text-center">
                    {upstoxLoading ? 'Loading Upstox Demat holdings...' : 'No Upstox Demat holdings found.'}
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-white/6 lg:max-h-[46dvh] lg:overflow-y-auto pr-1">
                    {upstoxHoldings.map((h) => {
                      const up = h.pnl >= 0;
                      return (
                        <div key={h.isin || h.tradingSymbol} className="py-2.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                              {h.tradingSymbol}
                            </p>
                            <p className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400 truncate">
                              {h.quantity} qty · Avg {formatInr(h.averagePrice, true)} · LTP {formatInr(h.lastPrice, true)}
                            </p>
                          </div>
                          <div className="text-right tabular-nums shrink-0">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">
                              {formatInr(h.quantity * h.lastPrice)}
                            </p>
                            <p className={`text-xs ${up ? 'text-[#D97706] dark:text-[#FFB020]' : 'text-[#E11D48] dark:text-[#FF4D6D]'}`}>
                              {up ? '+' : ''}
                              {formatInr(h.pnl)} ({h.dayChangePct}%)
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </MaterialCard>
            </>
          )}
        </motion.div>
      )}
      </AnimatePresence>

      {/* Real Executed Trade Logger & Upstox Live Order Sheet */}
      <BottomSheet
        open={tradeOpen}
        onClose={() => setTradeOpen(false)}
        title={tradeMode === 'UPSTOX' ? 'Upstox NSE Order' : 'Log Trade'}
        subtitle={
          tradeMode === 'UPSTOX'
            ? 'Routes live CNC delivery order via your connected Upstox Demat account'
            : 'Records your actual executed trade into FIFO lots & FY26 tax calculations'
        }
        maxWidthClass="lg:max-w-md"
      >
        <div className="space-y-4">
          {upstoxConnected && (
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-white/5">
              {(
                [
                  { id: 'LOG', label: 'Log Past Trade' },
                  { id: 'UPSTOX', label: 'Live Upstox Order' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setTradeMode(m.id)}
                  className={`min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                    tradeMode === m.id
                      ? 'bg-[#FFB020] text-[#1C1000]'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-white/5">
            {(['BUY', 'SELL'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setTradeSide(s)}
                className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                  tradeSide === s
                    ? s === 'BUY'
                      ? 'bg-[#FFB020] text-[#1C1000]'
                      : 'bg-[#FF4D6D] text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              NSE Stock / ETF Symbol
            </label>
            <select
              value={tradeSymbol}
              onChange={(e) => setTradeSymbol(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white"
            >
              {NSE_TRADE_SYMBOLS.map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
              <option value="__CUSTOM__">Custom NSE Symbol...</option>
            </select>
            {tradeSymbol === '__CUSTOM__' && (
              <input
                type="text"
                value={customSymbol}
                onChange={(e) => setCustomSymbol(e.target.value)}
                placeholder="e.g. ZOMATO.NS or BAJFINANCE.NS"
                className="mt-2 w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Quantity
              </label>
              <input
                type="number"
                min={0.001}
                step="any"
                value={tradeQty}
                onChange={(e) => setTradeQty(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm tabular-nums text-slate-900 dark:text-white"
              />
            </div>

            {tradeMode === 'LOG' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Execution Price (₹)
                </label>
                <input
                  type="number"
                  min={0.01}
                  step="any"
                  placeholder="e.g. 2950"
                  value={tradePriceInr}
                  onChange={(e) => setTradePriceInr(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm tabular-nums text-slate-900 dark:text-white"
                />
              </div>
            )}
          </div>

          {tradeMode === 'LOG' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Execution Date
              </label>
              <input
                type="date"
                value={tradeDate}
                onChange={(e) => setTradeDate(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm tabular-nums text-slate-900 dark:text-white"
              />
            </div>
          )}

          {tradeError && <p className="text-xs text-[#FF4D6D]">{tradeError}</p>}

          {tradeMode === 'UPSTOX' ? (
            <button
              type="button"
              onClick={() => {
                if (!resolvedTradeSymbol || !Number(tradeQty) || Number(tradeQty) <= 0) {
                  setTradeError('Enter a valid NSE symbol and positive quantity.');
                  return;
                }
                setTradeError(null);
                setTradePinOpen(true);
              }}
              className="w-full min-h-[46px] rounded-xl bg-[#FFB020] hover:bg-[#F59E0B] text-[#1C1000] font-semibold text-sm transition-colors"
            >
              Route Live Upstox {tradeSide} with PIN
            </button>
          ) : (
            <button
              type="button"
              disabled={tradeSaving}
              onClick={() => void handleLogExecutedTrade()}
              className="w-full min-h-[46px] rounded-xl bg-[#FFB020] hover:bg-[#F59E0B] text-[#1C1000] font-semibold text-sm transition-colors disabled:opacity-60"
            >
              {tradeSaving ? 'Saving Trade...' : `Save ${tradeSide} Trade Lot`}
            </button>
          )}
        </div>
      </BottomSheet>

      {/* Broker CSV Import Sheet */}
      <BottomSheet
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        title="Import Broker Tradebook CSV"
        subtitle="Supports Zerodha Kite, Groww, Upstox, or generic symbol,side,qty,price,date CSV"
        maxWidthClass="lg:max-w-lg"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Upload your .csv export or paste rows below
            </span>
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#D97706] dark:text-[#FFB020] cursor-pointer hover:underline">
              <Upload className="w-3.5 h-3.5" />
              <span>Choose CSV File</span>
              <input
                type="file"
                accept=".csv,.txt"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setCsvText(await file.text());
                    e.target.value = '';
                  }
                }}
                className="hidden"
              />
            </label>
          </div>

          <textarea
            rows={8}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="symbol,trade_type,quantity,price,trade_date&#10;RELIANCE,BUY,10,2915.50,2024-06-14&#10;TCS,BUY,5,3890.00,2025-10-03"
            className="w-full p-3.5 rounded-2xl m3-tonal-box border border-slate-200/80 dark:border-white/10 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
          />

          {csvError && <p className="text-xs text-[#FF4D6D]">{csvError}</p>}

          <button
            type="button"
            disabled={csvImporting || !csvText.trim()}
            onClick={() => void handleImportCsv()}
            className="w-full min-h-[46px] rounded-xl bg-[#FFB020] hover:bg-[#F59E0B] text-[#1C1000] font-semibold text-sm transition-colors disabled:opacity-50"
          >
            {csvImporting ? 'Importing & Building FIFO Lots...' : 'Import Trades'}
          </button>
        </div>
      </BottomSheet>

      {/* Update Liquid Cash Reserve Sheet */}
      <BottomSheet
        open={cashOpen}
        onClose={() => setCashOpen(false)}
        title="Set Actual Liquid Cash Reserve"
        subtitle="Record your actual idle bank / broker cash balance in INR"
        maxWidthClass="lg:max-w-sm"
      >
        <form onSubmit={handleSaveCashReserve} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Liquid Cash Balance (₹ INR)
            </label>
            <input
              type="number"
              min={0}
              step="any"
              required
              value={cashReserveInput}
              onChange={(e) => setCashReserveInput(e.target.value)}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm tabular-nums text-slate-900 dark:text-white"
            />
          </div>
          {cashError && <p className="text-xs text-[#FF4D6D]">{cashError}</p>}
          <button
            type="submit"
            disabled={cashSaving}
            className="w-full min-h-[46px] rounded-xl bg-[#FFB020] hover:bg-[#F59E0B] text-[#1C1000] font-semibold text-sm disabled:opacity-60"
          >
            {cashSaving ? 'Updating...' : 'Save Cash Reserve'}
          </button>
        </form>
      </BottomSheet>

      {/* Ledger Allocation Sheet */}
      <BottomSheet
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        title="Allocate Reserves"
        subtitle="Move funds across your tracked INR buckets"
        maxWidthClass="lg:max-w-md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Allocation Operation
            </label>
            <select
              value={transferAction}
              onChange={(e) => setTransferAction(e.target.value as typeof transferAction)}
              className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white"
            >
              <option value="FUND_SIP">Fund SIP Escrow (CASH_INR → SIP_ESCROW)</option>
              <option value="RESERVE_TAX">Allocate Tax Reserve (CASH_INR → TAX_RESERVE)</option>
              <option value="RELEASE_TAX">Release Tax Reserve (TAX_RESERVE → CASH_INR)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Amount (₹ INR)
            </label>
            <input
              type="number"
              min={100}
              value={transferAmt}
              onChange={(e) => setTransferAmt(e.target.value)}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm tabular-nums text-slate-900 dark:text-white"
            />
          </div>
          <button
            type="button"
            onClick={() => setTransferPinOpen(true)}
            className="w-full min-h-[46px] rounded-xl bg-[#FFB020] text-[#1C1000] font-semibold text-sm"
          >
            Authorize Allocation (PIN)
          </button>
        </div>
      </BottomSheet>

      <PinLockModal
        open={tradePinOpen}
        onClose={() => setTradePinOpen(false)}
        title={`Confirm Upstox ${tradeSide} ${tradeQty} ${resolvedTradeSymbol}`}
        onVerify={handleConfirmOrderPin}
      />

      <PinLockModal
        open={transferPinOpen}
        onClose={() => setTransferPinOpen(false)}
        title="Confirm Ledger Allocation"
        onVerify={handleConfirmTransferPin}
      />
    </div>
  );
};
