import React, { useState } from 'react';
import { Delete, Lock, ShieldCheck } from 'lucide-react';
import { BottomSheet } from './BottomSheet.tsx';

interface PinLockModalProps {
  open: boolean;
  onClose?: () => void;
  title?: string;
  subtitle?: string;
  onVerify: (pin: string) => Promise<void>;
  dismissible?: boolean;
}

export const PinLockModal: React.FC<PinLockModalProps> = ({
  open,
  onClose,
  title = 'Authorize Transaction',
  subtitle = 'Enter your 4-digit FINGuard security PIN',
  onVerify,
  dismissible = true,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleDigit = async (digit: string) => {
    if (busy || pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    setError(null);
    if (next.length === 4) {
      setBusy(true);
      try {
        await onVerify(next);
        setPin('');
      } catch (err) {
        setError((err as Error).message || 'Invalid PIN');
        setPin('');
      } finally {
        setBusy(false);
      }
    }
  };

  const handleBackspace = () => {
    if (busy) return;
    setPin((prev) => prev.slice(0, -1));
    setError(null);
  };

  const content = (
    <div className="flex flex-col items-center py-2">
      <div className="w-12 h-12 rounded-2xl bg-[#FFB020]/10 border border-[#FFB020]/25 flex items-center justify-center mb-4">
        {busy ? (
          <ShieldCheck className="w-6 h-6 text-[#FFB020]" />
        ) : (
          <Lock className="w-6 h-6 text-[#FFB020]" />
        )}
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-400 text-center max-w-xs mb-6">
        {subtitle}
      </p>

      {/* 4 PIN dots */}
      <div className="flex items-center gap-4 mb-4">
        {[0, 1, 2, 3].map((idx) => {
          const filled = idx < pin.length;
          return (
            <div
              key={idx}
              className={`w-4 h-4 rounded-full border transition-all duration-150 ${
                filled
                  ? 'bg-[#FFB020] border-[#FFB020] scale-110'
                  : 'bg-transparent border-slate-300 dark:border-white/25'
              }`}
            />
          );
        })}
      </div>

      {error && (
        <p className="text-xs font-medium text-[#FF4D6D] mb-4 text-center" role="alert">
          {error}
        </p>
      )}

      {/* Numeric keypad */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[270px] mt-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            disabled={busy}
            onClick={() => handleDigit(d)}
            className="h-14 rounded-2xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 active:scale-95 text-lg font-semibold tabular-nums text-slate-900 dark:text-white transition-all"
          >
            {d}
          </button>
        ))}
        <div />
        <button
          type="button"
          disabled={busy}
          onClick={() => handleDigit('0')}
          className="h-14 rounded-2xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 active:scale-95 text-lg font-semibold tabular-nums text-slate-900 dark:text-white transition-all"
        >
          0
        </button>
        <button
          type="button"
          disabled={busy || pin.length === 0}
          onClick={handleBackspace}
          aria-label="Backspace"
          className="h-14 rounded-2xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 active:scale-95 flex items-center justify-center text-slate-700 dark:text-slate-300 transition-all disabled:opacity-40"
        >
          <Delete className="w-5 h-5" />
        </button>
      </div>
    </div>
  );

  if (!dismissible) {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-[#07090F] flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/10 p-6 shadow-2xl">
          <h2 className="text-lg font-bold text-center text-slate-900 dark:text-white mb-1">
            {title}
          </h2>
          {content}
        </div>
      </div>
    );
  }

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        setPin('');
        setError(null);
        onClose?.();
      }}
      title={title}
      subtitle="Protected by FINGuard PIN verification"
      maxWidthClass="lg:max-w-sm"
    >
      {content}
    </BottomSheet>
  );
};
