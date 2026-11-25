import React, { useRef } from 'react';
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';

export const MATERIAL_EASE: [number, number, number, number] = [0.2, 0, 0, 1];

export const ParallaxAmbientBackdrop: React.FC<{ className?: string }> = ({ className = '' }) => {
  const prefersReduced = useReducedMotion();
  const { scrollY } = useScroll();
  const ySlow = useTransform(scrollY, [0, 700], [0, prefersReduced ? 0 : -55]);
  const yFast = useTransform(scrollY, [0, 700], [0, prefersReduced ? 0 : 42]);
  const scaleOrb = useTransform(scrollY, [0, 600], [1, prefersReduced ? 1 : 1.08]);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 overflow-hidden z-0 ${className}`}
    >
      <motion.div
        style={{ y: ySlow, scale: scaleOrb }}
        className="absolute -top-32 -right-24 w-[420px] h-[420px] rounded-full bg-[#FFB020]/[0.08] dark:bg-[#FFB020]/[0.09] blur-3xl"
      />
      <motion.div
        style={{ y: yFast }}
        className="absolute top-[38%] -left-32 w-[360px] h-[360px] rounded-full bg-sky-500/[0.06] dark:bg-sky-400/[0.07] blur-3xl"
      />
    </div>
  );
};

interface ParallaxHeroCardProps {
  children: React.ReactNode;
  className?: string;
}

export const ParallaxHeroCard: React.FC<ParallaxHeroCardProps> = ({ children, className = '' }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotion();
  const { scrollY } = useScroll();
  const innerParallaxY = useTransform(scrollY, [0, 420], [0, prefersReduced ? 0 : 18]);

  const mouseX = useMotionValue(50);
  const mouseY = useMotionValue(50);
  const smoothX = useSpring(mouseX, { stiffness: 180, damping: 24 });
  const smoothY = useSpring(mouseY, { stiffness: 180, damping: 24 });

  const spotlightBg = useMotionTemplate`radial-gradient(460px circle at ${smoothX}% ${smoothY}%, rgba(255, 176, 32, 0.14), transparent 65%)`;

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReduced || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    mouseX.set(xPct);
    mouseY.set(yPct);
  };

  return (
    <motion.div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        mouseX.set(50);
        mouseY.set(50);
      }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: MATERIAL_EASE }}
      className={`relative min-w-0 overflow-hidden rounded-[28px] m3-card shadow-sm dark:shadow-[0_14px_40px_-18px_rgba(0,0,0,0.75)] ${className}`}
    >
      {!prefersReduced && (
        <>
          <motion.div
            aria-hidden="true"
            style={{ y: innerParallaxY }}
            className="pointer-events-none absolute -top-16 -right-12 w-56 h-56 rounded-full bg-[#FFB020]/[0.09] blur-2xl z-0"
          />
          <motion.div
            aria-hidden="true"
            style={{ background: spotlightBg }}
            className="pointer-events-none absolute inset-0 z-0"
          />
        </>
      )}
      <div className="relative z-10 h-full min-w-0">{children}</div>
    </motion.div>
  );
};

interface MaterialCardProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export const MaterialCard: React.FC<MaterialCardProps> = ({
  children,
  className = '',
  delay = 0,
}) => {
  const prefersReduced = useReducedMotion();
  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay, ease: MATERIAL_EASE }}
      className={`rounded-3xl m3-card ${className}`}
    >
      {children}
    </motion.div>
  );
};

interface SegmentedItem<T extends string> {
  id: T;
  label: string;
}

export function MaterialSegmentedTabs<T extends string>({
  items,
  activeId,
  onChange,
  layoutGroupId,
}: {
  items: ReadonlyArray<SegmentedItem<T>>;
  activeId: T;
  onChange: (id: T) => void;
  layoutGroupId: string;
}) {
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-2xl m3-tonal-box border border-slate-200/70 dark:border-white/8 overflow-x-auto no-scrollbar max-w-full">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`relative shrink-0 min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
              active
                ? 'text-[#1C1000]'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutGroupId}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className="absolute inset-0 rounded-xl bg-[#FFB020] shadow-sm"
                aria-hidden="true"
              />
            )}
            <span className="relative z-10">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export const InfoHint: React.FC<{ text: string }> = ({ text }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={text}
        className="w-4 h-4 rounded-full m3-tonal-box text-[10px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50 w-56 p-2.5 rounded-xl bg-slate-900 dark:bg-[#1E2638] text-white text-[11px] leading-snug shadow-xl border border-white/10 pointer-events-none"
        >
          {text}
        </span>
      )}
    </span>
  );
};
