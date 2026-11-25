import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  Lock,
  LogOut,
  Moon,
  Pause,
  Play,
  QrCode,
  Repeat,
  ShieldCheck,
  Sun,
  Upload,
  XCircle,
} from 'lucide-react';
import type {
  CashflowAnalysis,
  QuantStrategyRecord,
  UpiMandateRecord,
  UserProfile,
} from '../../shared/types.ts';
import { apiFetch, formatInr } from '../lib/api.ts';
import { BottomSheet } from './BottomSheet.tsx';
import { InfoHint, MATERIAL_EASE, MaterialCard, MaterialSegmentedTabs } from './MotionPrimitives.tsx';
import { PinLockModal } from './PinLockModal.tsx';

interface UpiProfileTabProps {
  user: UserProfile;
  cashflow: CashflowAnalysis | null;
  mandates: UpiMandateRecord[];
  strategies: QuantStrategyRecord[];
  prefillStrategy: { id: string; name: string } | null;
  onClearPrefillStrategy: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onLockApp: () => void;
  onLogout: () => void;
  onRefreshAll: () => Promise<void>;
}

export const UpiProfileTab: React.FC<UpiProfileTabProps> = ({
  user,
  cashflow,
  mandates,
  strategies,
  prefillStrategy,
  onClearPrefillStrategy,
  theme,
  onToggleTheme,
  onLockApp,
  onLogout,
  onRefreshAll,
}) => {
  const [rawLogs, setRawLogs] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [analyzingLogs, setAnalyzingLogs] = useState(false);
  const [logStatus, setLogStatus] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  // Mandate creation
  const [selectedStratId, setSelectedStratId] = useState(strategies[0]?.id || 'strat_custom');
  const [selectedStratName, setSelectedStratName] = useState(
    strategies[0]?.dsl?.name || 'Nifty Momentum + VIX Gold Shield'
  );
  const [sipAmount, setSipAmount] = useState(() =>
    cashflow?.safeMonthlySipInr ? String(cashflow.safeMonthlySipInr) : ''
  );
  const [sipFreq, setSipFreq] = useState<'MONTHLY' | 'WEEKLY'>('MONTHLY');
  const [vpa, setVpa] = useState(user.upiId || '');
  const [mandateError, setMandateError] = useState<string | null>(null);
  const [createPinOpen, setCreatePinOpen] = useState(false);

  // Run installment PIN
  const [runMandateId, setRunMandateId] = useState<string | null>(null);

  // UPI QR & Deep Link Modal
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [upiDeepLink, setUpiDeepLink] = useState<string>('');
  const [qrAmount, setQrAmount] = useState<number>(0);
  const [qrLabel, setQrLabel] = useState<string>('');

  // Change PIN modal
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [curPin, setCurPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);

  const [upiView, setUpiView] = useState<'CASHFLOW' | 'MANDATES'>('CASHFLOW');

  useEffect(() => {
    if (prefillStrategy) {
      setSelectedStratId(prefillStrategy.id);
      setSelectedStratName(prefillStrategy.name);
      setUpiView('MANDATES');
      onClearPrefillStrategy();
    }
  }, [prefillStrategy, onClearPrefillStrategy]);

  const openQrForIntent = async (amount: number, label: string, deepLink?: string) => {
    const cleanVpa = vpa.trim();
    if (!deepLink && !/^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/.test(cleanVpa)) {
      setMandateError('Enter a valid payee/broker UPI ID (e.g., broker@okhdfcbank) first.');
      return;
    }
    if (!deepLink && (!Number.isFinite(amount) || amount < 500)) {
      setMandateError('Minimum SIP amount is ₹500.');
      return;
    }
    setMandateError(null);
    const uri =
      deepLink ||
      `upi://pay?pa=${encodeURIComponent(cleanVpa)}&pn=${encodeURIComponent(
        label.slice(0, 32)
      )}&am=${Math.round(amount)}&cu=INR&tn=${encodeURIComponent(`SIP-${label.slice(0, 24)}`)}`;
    const dataUrl = await QRCode.toDataURL(uri, {
      width: 240,
      margin: 2,
      color: { dark: '#07090F', light: '#FFFFFF' },
    });
    setQrAmount(Math.round(amount));
    setQrLabel(label);
    setUpiDeepLink(uri);
    setQrDataUrl(dataUrl);
    setQrModalOpen(true);
  };

  const handleAnalyzeLogs = async () => {
    if (!rawLogs.trim()) return;
    setAnalyzingLogs(true);
    setLogError(null);
    setLogStatus(null);
    try {
      const res = await apiFetch<{ importedCount: number }>('/api/upi/cashflow/analyze', {
        method: 'POST',
        body: JSON.stringify({ rawText: rawLogs, replace: replaceExisting }),
      });
      setLogStatus(`Analyzed & saved ${res.importedCount} bank/UPI entries. Safe SIP updated.`);
      setRawLogs('');
      await onRefreshAll();
    } catch (err) {
      setLogError((err as Error).message);
    } finally {
      setAnalyzingLogs(false);
    }
  };

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawLogs(text);
    e.target.value = '';
  };

  const handleCreateMandatePin = async (pin: string) => {
    const res = await apiFetch<{ mandate: UpiMandateRecord; upiIntentUrl: string }>(
      '/api/upi/mandates',
      {
        method: 'POST',
        idempotent: true,
        body: JSON.stringify({
          strategyId: selectedStratId,
          strategyName: selectedStratName,
          amountInr: Number(sipAmount),
          frequency: sipFreq,
          vpa: vpa.trim(),
          pin,
        }),
      }
    );
    setCreatePinOpen(false);
    await onRefreshAll();
    await openQrForIntent(res.mandate.amountInr, res.mandate.strategyName, res.upiIntentUrl);
  };

  const handleMandateStatus = async (id: string, status: UpiMandateRecord['status']) => {
    await apiFetch(`/api/upi/mandates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await onRefreshAll();
  };

  const handleRunMandatePin = async (pin: string) => {
    if (!runMandateId) return;
    await apiFetch(`/api/upi/mandates/${runMandateId}/run`, {
      method: 'POST',
      idempotent: true,
      body: JSON.stringify({ pin }),
    });
    setRunMandateId(null);
    setLogStatus('Recorded SIP installment in SIP_ESCROW ledger.');
    await onRefreshAll();
  };

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinMsg(null);
    try {
      await apiFetch('/api/auth/update-pin', {
        method: 'POST',
        body: JSON.stringify({ currentPin: curPin, newPin }),
      });
      setPinMsg('4-digit PIN updated.');
      setCurPin('');
      setNewPin('');
      setTimeout(() => setChangePinOpen(false), 700);
    } catch (err) {
      setPinMsg((err as Error).message);
    }
  };

  return (
    <div className="space-y-4 pb-6 min-w-0">
      {/* Slim User Identity + Security Strip */}
      <MaterialCard className="px-4 py-3.5 flex flex-col xl:flex-row xl:items-center justify-between gap-3 min-w-0">
        <div className="flex items-center gap-3.5 min-w-0">
          {!avatarBroken && user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              referrerPolicy="no-referrer"
              onError={() => setAvatarBroken(true)}
              className="w-11 h-11 rounded-2xl object-cover border border-slate-200 dark:border-white/15 shrink-0"
            />
          ) : (
            <div className="w-11 h-11 rounded-2xl bg-[#FFB020]/15 text-[#D97706] dark:text-[#FFB020] font-bold flex items-center justify-center shrink-0">
              {user.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-base font-bold text-slate-900 dark:text-white truncate">
              {user.name}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {[user.email, user.phone, user.city, user.occupation, user.riskProfile]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleTheme}
            className="min-h-[38px] px-3 py-1.5 rounded-2xl m3-tonal-box hover:bg-slate-200 dark:hover:bg-white/12 active:scale-[0.98] text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5 transition-all"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-[#F5B700]" /> : <Moon className="w-4 h-4" />}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>

          <button
            type="button"
            onClick={() => setChangePinOpen(true)}
            className="min-h-[38px] px-3 py-1.5 rounded-2xl m3-tonal-box hover:bg-slate-200 dark:hover:bg-white/12 active:scale-[0.98] text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5 transition-all"
          >
            <ShieldCheck className="w-4 h-4 text-[#FFB020]" />
            <span>Change PIN</span>
          </button>

          <button
            type="button"
            onClick={onLockApp}
            className="min-h-[38px] px-3 py-1.5 rounded-2xl m3-tonal-box hover:bg-slate-200 dark:hover:bg-white/12 active:scale-[0.98] text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5 transition-all"
          >
            <Lock className="w-4 h-4" />
            <span>Lock</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="min-h-[38px] px-3 py-1.5 rounded-2xl bg-[#FF4D6D]/10 hover:bg-[#FF4D6D]/20 active:scale-[0.98] text-xs font-medium text-[#E11D48] dark:text-[#FF4D6D] flex items-center gap-1.5 transition-all"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </MaterialCard>

      {/* Material 3 Workspace Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MaterialSegmentedTabs
          layoutGroupId="upiWorkspaceTab"
          activeId={upiView}
          onChange={setUpiView}
          items={[
            { id: 'CASHFLOW', label: 'Cashflow Sizer' },
            { id: 'MANDATES', label: `UPI Mandates (${mandates.length})` },
          ]}
        />
      </div>

      {logStatus && (
        <div className="p-3 rounded-2xl bg-[#FFB020]/10 border border-[#FFB020]/30 text-xs text-[#D97706] dark:text-[#FFB020]">
          {logStatus}
        </div>
      )}

      <AnimatePresence mode="wait">
      {/* UPI Cashflow Analyzer Metrics & Chart */}
      {upiView === 'CASHFLOW' && cashflow && (
        <motion.div
          key="cashflow_view"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: MATERIAL_EASE }}
          className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-w-0"
        >
          <MaterialCard delay={0.04} className="lg:col-span-7 min-w-0 p-4 sm:p-5 flex flex-col justify-between gap-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Cashflow Volatility
                </h2>
                <InfoHint text={`${cashflow.monthsAnalyzed}-month statistical spend & income buffer model sizing your safe monthly SIP.`} />
              </div>
              <span className="text-xs font-semibold text-[#D97706] dark:text-[#FFB020] tabular-nums">
                Safe SIP: {formatInr(cashflow.safeMonthlySipInr)}/mo
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-2xl m3-tonal-box">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Income (μ)</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                  {formatInr(cashflow.monthlyIncomeMeanInr)}
                </p>
              </div>
              <div className="p-3 rounded-2xl m3-tonal-box">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Spend (μ)</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                  {formatInr(cashflow.monthlySpendMeanInr)}
                </p>
              </div>
              <div className="p-3 rounded-2xl m3-tonal-box">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">StdDev (σ)</p>
                <p className="text-sm font-bold text-[#D97706] dark:text-[#F5B700] tabular-nums mt-0.5">
                  ±{formatInr(cashflow.monthlySpendStdDevInr)}
                </p>
              </div>
              <div className="p-3 rounded-2xl m3-tonal-box">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Buffer</p>
                <p className="text-sm font-bold text-[#D97706] dark:text-[#FFB020] tabular-nums mt-0.5">
                  {formatInr(cashflow.recommendedEmergencyBufferInr)}
                </p>
              </div>
            </div>

            <div className="h-56 sm:h-60 w-full">
              {cashflow.monthsAnalyzed === 0 ? (
                <div className="h-full rounded-2xl m3-tonal-box border border-dashed border-slate-300 dark:border-white/12 flex flex-col items-center justify-center p-6 text-center space-y-2">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    No bank CSV or UPI SMS imported yet
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
                    Paste real bank SMS alerts or upload a bank statement CSV on the right to compute spend volatility (μ + 1.5σ) and Safe Monthly SIP.
                  </p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cashflow.monthlySeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
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
                      formatter={(val: unknown) => formatInr(Number(val))}
                    />
                    <Bar dataKey="incomeInr" name="Income" fill="#FFB020" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="spendInr" name="Living Spend" fill="#FF4D6D" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {cashflow.categoryBreakdown.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 pt-3 border-t border-slate-100 dark:border-white/6">
                {cashflow.categoryBreakdown.slice(0, 4).map((cat) => (
                  <div key={cat.category} className="space-y-1 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-700 dark:text-slate-300 font-medium truncate">{cat.category}</span>
                      <span className="font-medium text-slate-900 dark:text-white tabular-nums shrink-0">
                        {cat.sharePct}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-white/8 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, Math.max(4, cat.sharePct))}%` }}
                        transition={{ duration: 0.5, ease: MATERIAL_EASE }}
                        className="h-full rounded-full bg-sky-500"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </MaterialCard>

          {/* Upload CSV / Paste UPI SMS Logs */}
          <MaterialCard delay={0.08} className="lg:col-span-5 min-w-0 p-4 sm:p-5 flex flex-col justify-between gap-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Import Bank CSV / UPI SMS
                </h3>
                <InfoHint text="Paste real bank/UPI SMS alerts or upload statement CSV lines (date,merchant,amount,DEBIT/CREDIT)." />
              </div>
            </div>

            <textarea
              rows={7}
              value={rawLogs}
              onChange={(e) => setRawLogs(e.target.value)}
              placeholder="2026-11-18,SWIGGY,680,DEBIT&#10;Rs 1,250 debited via UPI to ZEPTO on 2026-11-19"
              className="w-full p-3.5 rounded-2xl m3-tonal-box border border-slate-200/80 dark:border-white/10 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
            />

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>Replace logs</span>
              </label>

              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer hover:underline">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload CSV</span>
                <input type="file" accept=".csv,.txt" onChange={handleCsvFile} className="hidden" />
              </label>
            </div>

            {logError && <p className="text-xs text-[#FF4D6D]">{logError}</p>}

            <button
              type="button"
              disabled={analyzingLogs || !rawLogs.trim()}
              onClick={handleAnalyzeLogs}
              className="w-full min-h-[44px] rounded-2xl bg-slate-900 dark:bg-white/12 hover:bg-slate-800 dark:hover:bg-white/18 active:scale-[0.98] text-white text-xs font-semibold transition-all disabled:opacity-50"
            >
              {analyzingLogs ? 'Analyzing...' : 'Analyze Cashflow'}
            </button>
          </MaterialCard>
        </motion.div>
      )}

      {/* 1-Tap UPI Intent & Autopay SIP Mandates */}
      {upiView === 'MANDATES' && (
      <motion.div
        key="mandates_view"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18, ease: MATERIAL_EASE }}
        className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-w-0"
      >
        <MaterialCard delay={0.04} className="lg:col-span-5 min-w-0 p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-[#FFB020]" />
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Tracked SIP Planner
              </h2>
            </div>
            <InfoHint text="Generate an NPCI UPI pay intent & scannable QR to pay into your target VPA and track SIP installments." />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Target Quant Strategy
            </label>
            <select
              value={selectedStratId}
              onChange={(e) => {
                const found = strategies.find((s) => s.id === e.target.value);
                setSelectedStratId(e.target.value);
                setSelectedStratName(found?.dsl?.name || 'FINGuard Smart SIP');
              }}
              className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
            >
              {strategies
                .filter((s) => Boolean(s?.dsl?.name))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.dsl.name}
                  </option>
                ))}
              <option value="strat_custom">{selectedStratName}</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                SIP Amount (₹)
              </label>
              <input
                type="number"
                min={500}
                step={500}
                placeholder="5000"
                value={sipAmount}
                onChange={(e) => setSipAmount(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm tabular-nums text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Frequency
              </label>
              <select
                value={sipFreq}
                onChange={(e) => setSipFreq(e.target.value as 'MONTHLY' | 'WEEKLY')}
                className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
              >
                <option value="MONTHLY">Monthly Schedule</option>
                <option value="WEEKLY">Weekly Schedule</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Target Payee / AMC UPI ID (VPA)
            </label>
            <input
              type="text"
              value={vpa}
              onChange={(e) => {
                setMandateError(null);
                setVpa(e.target.value);
              }}
              placeholder="yourname@okhdfcbank"
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white"
            />
          </div>

          {mandateError && (
            <p className="text-xs text-[#FF4D6D]" role="alert">
              {mandateError}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const amt = Number(sipAmount);
                if (!/^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/.test(vpa.trim())) {
                  setMandateError('Enter a valid UPI ID (e.g., yourname@okhdfcbank).');
                  return;
                }
                if (!Number.isFinite(amt) || amt < 500) {
                  setMandateError('Minimum SIP amount is ₹500.');
                  return;
                }
                setMandateError(null);
                setCreatePinOpen(true);
              }}
              className="flex-1 min-h-[46px] px-4 rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] font-semibold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm"
            >
              <Repeat className="w-4 h-4" />
              <span>Save SIP &amp; Generate QR</span>
            </button>
            <button
              type="button"
              onClick={() => void openQrForIntent(Number(sipAmount), selectedStratName)}
              className="min-h-[46px] px-4 rounded-2xl m3-tonal-box hover:bg-slate-200 dark:hover:bg-white/12 active:scale-[0.98] text-xs font-semibold text-slate-900 dark:text-white transition-all"
            >
              Preview QR
            </button>
          </div>
        </MaterialCard>

        <MaterialCard delay={0.08} className="lg:col-span-7 min-w-0 p-4 sm:p-5 space-y-3">
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
            SIP Schedules ({mandates.length})
          </h3>

          {mandates.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              No SIP schedules created yet.
            </p>
          ) : (
            <div className="space-y-3 lg:max-h-[54dvh] lg:overflow-y-auto pr-1">
              {mandates.map((m) => (
                <div
                  key={m.id}
                  className="p-4 rounded-2xl m3-tonal-box border border-slate-200/70 dark:border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {m.strategyName}
                      </p>
                      <span
                        className={`text-[11px] font-semibold shrink-0 ${
                          m.status === 'ACTIVE'
                            ? 'text-[#D97706] dark:text-[#FFB020]'
                            : m.status === 'PAUSED'
                            ? 'text-[#D97706] dark:text-[#F5B700]'
                            : 'text-[#E11D48] dark:text-[#FF4D6D]'
                        }`}
                      >
                        {m.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5 break-words">
                      {formatInr(m.amountInr)} / {m.frequency} · {m.vpa} · Next: {m.nextRunAt} · Paid:{' '}
                      {formatInr(m.totalExecutedInr)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {m.status === 'ACTIVE' && (
                      <>
                        <button
                          type="button"
                          onClick={() => setRunMandateId(m.id)}
                          className="min-h-[36px] px-3 py-1 rounded-xl bg-[#FFB020] text-[#1C1000] text-xs font-semibold flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Log Paid</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleMandateStatus(m.id, 'PAUSED')}
                          className="min-h-[36px] px-2.5 py-1 rounded-xl bg-slate-200 dark:bg-white/8 text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pause</span>
                        </button>
                      </>
                    )}
                    {m.status === 'PAUSED' && (
                      <button
                        type="button"
                        onClick={() => void handleMandateStatus(m.id, 'ACTIVE')}
                        className="min-h-[36px] px-3 py-1 rounded-xl bg-[#FFB020]/15 text-[#D97706] dark:text-[#FFB020] text-xs font-semibold flex items-center gap-1"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Resume</span>
                      </button>
                    )}
                    {m.status !== 'REVOKED' && (
                      <button
                        type="button"
                        onClick={() => void handleMandateStatus(m.id, 'REVOKED')}
                        className="min-h-[36px] px-2.5 py-1 rounded-xl bg-[#FF4D6D]/10 text-[#E11D48] dark:text-[#FF4D6D] text-xs font-medium flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Revoke</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </MaterialCard>
      </motion.div>
      )}
      </AnimatePresence>

      {/* UPI Deep Link & QR Code Sheet */}
      <BottomSheet
        open={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        title="UPI Intent & Scannable QR"
        subtitle={`${qrLabel} · ${formatInr(qrAmount)}`}
        maxWidthClass="lg:max-w-sm"
      >
        <div className="flex flex-col items-center space-y-4 py-2">
          {qrDataUrl && (
            <div className="p-3 rounded-2xl bg-white border border-slate-200">
              <img src={qrDataUrl} alt="FINGuard UPI QR Code" className="w-52 h-52" />
            </div>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
            Scan with GPay, PhonePe, Paytm, or BHIM to authorize ₹{qrAmount.toLocaleString('en-IN')} SIP.
          </p>
          <div className="w-full p-2.5 rounded-xl bg-slate-100 dark:bg-[#07090F] text-[11px] font-mono text-slate-600 dark:text-slate-400 break-all">
            {upiDeepLink}
          </div>
          <a
            href={upiDeepLink}
            className="w-full min-h-[46px] rounded-xl bg-[#FFB020] text-[#1C1000] font-semibold text-sm flex items-center justify-center"
          >
            Open UPI App Intent
          </a>
        </div>
      </BottomSheet>

      {/* Change PIN Sheet */}
      <BottomSheet
        open={changePinOpen}
        onClose={() => setChangePinOpen(false)}
        title="Update 4-Digit Security PIN"
        maxWidthClass="lg:max-w-sm"
      >
        <form onSubmit={handleUpdatePin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Current PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              required
              value={curPin}
              onChange={(e) => setCurPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 tabular-nums text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              New 4-Digit PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              required
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 tabular-nums text-sm"
            />
          </div>
          {pinMsg && <p className="text-xs text-[#FFB020]">{pinMsg}</p>}
          <button
            type="submit"
            className="w-full min-h-[44px] rounded-xl bg-[#FFB020] text-[#1C1000] font-semibold text-sm"
          >
            Save New PIN
          </button>
        </form>
      </BottomSheet>

      <PinLockModal
        open={createPinOpen}
        onClose={() => setCreatePinOpen(false)}
        title={`Authorize ₹${sipAmount} ${sipFreq} UPI SIP`}
        onVerify={handleCreateMandatePin}
      />

      <PinLockModal
        open={Boolean(runMandateId)}
        onClose={() => setRunMandateId(null)}
        title="Authorize SIP Installment"
        onVerify={handleRunMandatePin}
      />
    </div>
  );
};
