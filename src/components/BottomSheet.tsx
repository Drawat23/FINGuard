import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidthClass = 'lg:max-w-xl',
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            className={`relative z-10 w-full ${maxWidthClass} max-h-[88dvh] flex flex-col rounded-t-[28px] lg:rounded-[28px] m3-card shadow-2xl overflow-hidden`}
          >
            {/* Mobile grab handle */}
            <div className="lg:hidden pt-3 pb-1 flex justify-center">
              <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-white/20" />
            </div>

            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-slate-200/80 dark:border-white/8">
              <div className="min-w-0">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                  {title}
                </h2>
                {subtitle && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {subtitle}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close panel"
                className="min-h-[40px] min-w-[40px] -mr-2 flex items-center justify-center rounded-2xl m3-tonal-box text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white active:scale-[0.96] transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 sm:p-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
