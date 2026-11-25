import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  Lock,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { MATERIAL_EASE } from './MotionPrimitives.tsx';
import { HeroQuantCanvas } from './HeroQuantCanvas.tsx';

interface LandingShowcaseProps {
  onGetStarted: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

type SectionId = 'overview' | 'showcase' | 'about-terms';

interface ShowcaseItem {
  id: string;
  label: string;
  headline: string;
  caption: string;
  image: string;
  alt: string;
}

const LOGO_IMAGE = '/assets/aistudio/image_c96ff192.png';

const SHOWCASE_ITEMS: ShowcaseItem[] = [
  {
    id: 'markets',
    label: 'Markets',
    headline: 'Trade NSE live.',
    caption: 'Candlesticks, EMA overlays, and instant Upstox execution.',
    image: '/src/assets/images/layer_nse_markets_1795578074913.jpg',
    alt: 'Precision amber and smoked-glass candlestick bars aligned along a glowing moving-average curve on dark basalt',
  },
  {
    id: 'quant',
    label: 'Quant Lab',
    headline: 'Test before risking.',
    caption: 'Plain-English rules compiled into NSE curves and Monte Carlo stress tests.',
    image: '/src/assets/images/layer_quant_backtest_1795578075555.jpg',
    alt: 'Historical algorithmic backtest equity curve branching into a golden Monte Carlo probability distribution fan',
  },
  {
    id: 'tax',
    label: 'Portfolio & Tax',
    headline: 'Keep what compounds.',
    caption: 'FY26 FIFO capital gains, harvesting alerts, and efficient weights.',
    image: '/src/assets/images/layer_portfolio_tax_1795578074958.jpg',
    alt: 'Brushed titanium and warm gold portfolio allocation bars beside a smoked-glass tax vault prism',
  },
  {
    id: 'upi',
    label: 'UPI & Copilot',
    headline: 'Automate with a PIN.',
    caption: 'Surplus-sized UPI SIP mandates and research grounded in your holdings.',
    image: '/src/assets/images/layer_upi_pin_1795578076659.jpg',
    alt: 'Matte-black titanium security module with glowing amber 4-dot PIN indicator and golden payment ring',
  },
];

const TERMS_CLAUSES = [
  {
    id: 'scope',
    title: 'Analytical Workspace, Not Advisory',
    summary:
      'FINGuard provides market data, quantitative backtesting, tax analytics, and cashflow automation. Nothing displayed constitutes SEBI-registered investment advice or guaranteed returns.',
  },
  {
    id: 'brokerage',
    title: 'Direct Upstox Brokerage Custody',
    summary:
      'Orders route strictly through your own authorized Upstox Demat account via revocable OAuth tokens. FINGuard never holds, pools, or withdraws your funds.',
  },
  {
    id: 'tax',
    title: 'FY26 FIFO Tax Estimates',
    summary:
      'STCG and LTCG breakdowns are computed to streamline portfolio planning. Always verify statutory filings with a qualified Chartered Accountant.',
  },
  {
    id: 'security',
    title: '4-Digit Security PIN & Session Privacy',
    summary:
      'Sensitive trade orders and UPI SIP mandate actions require verification via your personal 4-digit PIN inside your authenticated session.',
  },
];

export const LandingShowcase: React.FC<LandingShowcaseProps> = ({
  onGetStarted,
  theme,
  onToggleTheme,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const overviewRef = useRef<HTMLElement | null>(null);
  const showcaseRef = useRef<HTMLElement | null>(null);
  const aboutTermsRef = useRef<HTMLElement | null>(null);

  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [activeIndex, setActiveIndex] = useState(0);
  const [stagePaused, setStagePaused] = useState(false);
  const [openTermId, setOpenTermId] = useState<string>('scope');
  const [logoBroken, setLogoBroken] = useState(false);

  const heroPointerRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  const activeItem = SHOWCASE_ITEMS[activeIndex] ?? SHOWCASE_ITEMS[0];

  // Eagerly preload all images immediately on mount so zero load delay occurs during scroll/switch
  useEffect(() => {
    const urls = [LOGO_IMAGE, ...SHOWCASE_ITEMS.map((item) => item.image)];
    urls.forEach((src) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    });
  }, []);

  const handleHeroPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    heroPointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    heroPointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    heroPointerRef.current.active = true;
  };

  const handleHeroPointerLeave = () => {
    heroPointerRef.current.active = false;
  };

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const smoothX = useSpring(pointerX, { stiffness: 140, damping: 24 });
  const smoothY = useSpring(pointerY, { stiffness: 140, damping: 24 });
  const imageTranslateX = useTransform(smoothX, [-0.5, 0.5], [-14, 14]);
  const imageTranslateY = useTransform(smoothY, [-0.5, 0.5], [-10, 10]);

  const handleStageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointerX.set((e.clientX - rect.left) / rect.width - 0.5);
    pointerY.set((e.clientY - rect.top) / rect.height - 0.5);
  };

  const handleStageMouseLeave = () => {
    setStagePaused(false);
    pointerX.set(0);
    pointerY.set(0);
  };

  useEffect(() => {
    if (stagePaused) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % SHOWCASE_ITEMS.length);
    }, 4200);
    return () => clearInterval(timer);
  }, [stagePaused]);

  const scrollToSection = (id: SectionId) => {
    const map: Record<SectionId, React.RefObject<HTMLElement | null>> = {
      overview: overviewRef,
      showcase: showcaseRef,
      'about-terms': aboutTermsRef,
    };
    map[id].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const sections: Array<{ id: SectionId; el: HTMLElement | null }> = [
      { id: 'overview', el: overviewRef.current },
      { id: 'showcase', el: showcaseRef.current },
      { id: 'about-terms', el: aboutTermsRef.current },
    ];

    const observer = new IntersectionObserver(
      (entries) => {
        let bestId: SectionId | null = null;
        let bestRatio = 0;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestId = entry.target.getAttribute('data-section-id') as SectionId;
          }
        }
        if (bestId) setActiveSection(bestId);
      },
      { root: container, threshold: [0.3, 0.55] }
    );

    sections.forEach(({ el }) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={scrollContainerRef}
      className="relative h-[100dvh] w-full overflow-y-auto scroll-smooth bg-white dark:bg-[#000000] text-slate-900 dark:text-white selection:bg-[#FFB020]/30 selection:text-white"
    >
      {/* Strict 3-Zone Pure Black Sticky Header */}
      <header className="sticky top-0 z-40 h-15 px-5 sm:px-10 lg:px-14 bg-white/95 dark:bg-[#000000]/95 border-b border-slate-200/80 dark:border-white/8 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => scrollToSection('overview')}
          className="flex items-center gap-2.5 whitespace-nowrap shrink-0 focus:outline-none"
        >
          <div className="w-8 h-8 rounded-full bg-black border border-slate-300/60 dark:border-white/15 overflow-hidden flex items-center justify-center shrink-0">
            {!logoBroken ? (
              <img
                src={LOGO_IMAGE}
                alt="FINGuard logo"
                loading="eager"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setLogoBroken(true)}
                className="w-full h-full object-cover scale-[1.32]"
              />
            ) : (
              <ShieldCheck className="w-4 h-4 text-[#FFB020]" />
            )}
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
            FINGuard
          </span>
        </button>

        <nav aria-label="Primary sections" className="hidden md:flex items-center gap-8 shrink-0">
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'showcase', label: 'Platform' },
              { id: 'about-terms', label: 'About & Terms' },
            ] as const
          ).map((item) => {
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                className={`relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'text-slate-900 dark:text-white'
                    : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span>{item.label}</span>
                {active && (
                  <span
                    className="absolute inset-x-0 -bottom-0.5 h-[2px] bg-[#FFB020] rounded-full"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onGetStarted}
            className="min-h-[38px] px-5 py-1.5 rounded-full bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#140B00] text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0"
          >
            <span>Get Started</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* SECTION 1: GOOGLE I/O STYLE CENTERED BIG-TEXT HERO WITH INTERACTIVE THREE.JS HORIZON */}
      <section
        ref={overviewRef}
        data-section-id="overview"
        aria-label="What FINGuard is"
        onPointerMove={handleHeroPointerMove}
        onPointerLeave={handleHeroPointerLeave}
        className="relative min-h-[calc(100dvh-3.75rem)] flex flex-col justify-between items-center px-5 sm:px-10 lg:px-14 py-10 overflow-hidden"
      >
        {/* Subtle Three.js Interactive Obsidian Kinetic Field + Radial Text Protection */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden bg-slate-50 dark:bg-[#000000]"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-slate-100 via-white to-amber-50/40 dark:from-[#000000] dark:via-[#0d0802] dark:to-[#000000]" />
          <HeroQuantCanvas theme={theme} pointerRef={heroPointerRef} />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.78)_0%,rgba(255,255,255,0.42)_58%,rgba(255,255,255,0.88)_100%)] dark:bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.68)_0%,rgba(0,0,0,0.22)_58%,rgba(0,0,0,0.85)_100%)]" />
        </div>

        {/* Spacer for balanced optical vertical centering */}
        <div className="h-4 shrink-0" aria-hidden="true" />

        {/* Centered Google I/O Big Typography Block */}
        <div className="relative z-10 w-full max-w-[1140px] mx-auto text-center flex flex-col items-center space-y-6">
          <p className="text-xs sm:text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-300">
            FINGuard · Wealth Operating System
          </p>

          <h1 className="font-display text-5xl sm:text-7xl lg:text-[6rem] font-bold tracking-tight leading-[0.98] text-slate-900 dark:text-white">
            Command{' '}
            <span className="bg-gradient-to-r from-[#D97706] via-[#FFB020] to-[#F59E0B] bg-clip-text text-transparent">
              Your Wealth.
            </span>
          </h1>

          <p className="text-sm sm:text-xl text-slate-700 dark:text-zinc-300 max-w-2xl leading-relaxed">
            NSE execution, quant backtesting, FY26 tax harvesting, and PIN-locked UPI SIPs.
          </p>

          <div className="pt-2">
            <button
              type="button"
              onClick={onGetStarted}
              className="min-h-[50px] px-9 py-3.5 rounded-full bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#140B00] text-sm sm:text-base font-semibold inline-flex items-center gap-2 transition-all shadow-xl shadow-[#FFB020]/25 whitespace-nowrap"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quiet Bottom Scroll Trigger (No Logo Strip) */}
        <div className="relative z-10 pb-1">
          <button
            type="button"
            onClick={() => scrollToSection('showcase')}
            aria-label="Scroll to platform capabilities"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white transition-colors py-1"
          >
            <span>Scroll to discover</span>
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* SECTION 2: INTERACTIVE AMBER STAGE */}
      <section
        ref={showcaseRef}
        data-section-id="showcase"
        aria-label="What FINGuard does"
        className="relative min-h-[100dvh] flex flex-col justify-center px-5 sm:px-10 lg:px-14 py-8 lg:py-12 border-t border-slate-200/80 dark:border-white/10"
      >
        <div className="w-full max-w-[1220px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          <div className="lg:col-span-5 space-y-4">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#D97706] dark:text-[#FFB020]">
                Inside FINGuard
              </p>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-[2.5rem] font-bold tracking-tight leading-[1.08] text-slate-900 dark:text-white mt-1.5">
                Every layer, unified.
              </h2>
            </div>

            <div
              className="divide-y divide-slate-200/80 dark:divide-white/10 border-y border-slate-200/80 dark:border-white/10"
              onMouseEnter={() => setStagePaused(true)}
              onMouseLeave={() => setStagePaused(false)}
            >
              {SHOWCASE_ITEMS.map((item, idx) => {
                const active = idx === activeIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setStagePaused(true);
                      setActiveIndex(idx);
                    }}
                    onMouseEnter={() => {
                      setStagePaused(true);
                      setActiveIndex(idx);
                    }}
                    className="w-full py-2.5 text-left flex items-center justify-between gap-4 group transition-colors focus:outline-none"
                  >
                    <div className="min-w-0">
                      <span
                        className={`block text-xs font-semibold tracking-wide transition-colors ${
                          active
                            ? 'text-[#D97706] dark:text-[#FFB020]'
                            : 'text-slate-400 dark:text-zinc-500'
                        }`}
                      >
                        {item.label}
                      </span>
                      <span
                        className={`block font-display text-base sm:text-lg font-semibold mt-0.5 truncate transition-colors ${
                          active
                            ? 'text-slate-900 dark:text-white'
                            : 'text-slate-500 dark:text-zinc-400 group-hover:text-slate-900 dark:group-hover:text-zinc-200'
                        }`}
                      >
                        {item.headline}
                      </span>
                    </div>
                    <ArrowRight
                      className={`w-4 h-4 shrink-0 transition-all duration-200 ${
                        active
                          ? 'text-[#FFB020] translate-x-0 opacity-100'
                          : 'text-zinc-600 -translate-x-1 opacity-0 group-hover:opacity-60 group-hover:translate-x-0'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-7">
            <div
              onMouseMove={handleStageMouseMove}
              onMouseEnter={() => setStagePaused(true)}
              onMouseLeave={handleStageMouseLeave}
              className="relative aspect-video max-h-[340px] lg:max-h-[385px] w-full rounded-3xl overflow-hidden bg-gradient-to-br from-[#120C04] via-[#050507] to-[#000000] border border-[#FFB020]/20 shadow-[0_24px_80px_-20px_rgba(255,176,32,0.18)]"
            >
              <motion.div
                style={{ x: imageTranslateX, y: imageTranslateY }}
                className="absolute inset-0"
              >
                {SHOWCASE_ITEMS.map((item, idx) => {
                  const isActive = idx === activeIndex;
                  return (
                    <img
                      key={item.id}
                      src={item.image}
                      alt={item.alt}
                      loading="eager"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className={`absolute inset-0 w-full h-full object-cover object-center transition-all duration-500 ease-out will-change-transform ${
                        isActive ? 'opacity-100 scale-105' : 'opacity-0 scale-100 pointer-events-none'
                      }`}
                    />
                  );
                })}
              </motion.div>

              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent"
              />

              <div className="relative z-10 h-full p-6 sm:p-8 flex flex-col justify-end">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeItem.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2, ease: MATERIAL_EASE }}
                  >
                    <span className="text-xs font-semibold tracking-wide text-[#FFB020]">
                      {activeItem.label}
                    </span>
                    <h3 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white mt-1">
                      {activeItem.headline}
                    </h3>
                    <p className="text-xs sm:text-sm text-zinc-300 mt-1.5 leading-relaxed">
                      {activeItem.caption}
                    </p>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: ABOUT FINGUARD & INTERACTIVE TERMS + CLOSING HOOK */}
      <section
        ref={aboutTermsRef}
        data-section-id="about-terms"
        aria-label="About FINGuard and Terms & Conditions"
        className="relative min-h-[100dvh] flex flex-col justify-between px-5 sm:px-10 lg:px-14 pt-16 pb-8 lg:pt-24 lg:pb-10 border-t border-slate-200/80 dark:border-white/10 overflow-hidden"
      >
        <div className="relative z-10 w-full max-w-[1160px] mx-auto space-y-16 my-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">
            {/* About FINGuard */}
            <div className="lg:col-span-5 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-black border border-slate-200 dark:border-white/15 overflow-hidden flex items-center justify-center shrink-0">
                  {!logoBroken ? (
                    <img
                      src={LOGO_IMAGE}
                      alt="FINGuard mark"
                      loading="eager"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={() => setLogoBroken(true)}
                      className="w-full h-full object-cover scale-[1.32]"
                    />
                  ) : (
                    <ShieldCheck className="w-5 h-5 text-[#FFB020]" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-[#16A34A] dark:text-[#00E096]">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Non-Custodial &amp; PIN-Protected</span>
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white leading-[1.08]">
                  Your Demat, your PIN.
                </h2>
                <p className="text-sm sm:text-base text-slate-600 dark:text-zinc-400 leading-relaxed">
                  Built for Indian markets from the ground up—connecting directly to your brokerage
                  without holding capital or compromising execution speed.
                </p>
              </div>

              <div className="divide-y divide-slate-200/80 dark:divide-white/10 border-t border-slate-200/80 dark:border-white/10">
                {[
                  'Revocable Upstox OAuth with zero third-party fund custody',
                  '4-digit PIN authorization on orders and UPI SIP mandates',
                  'INR-native FY26 FIFO capital-gains & harvesting engine',
                ].map((point) => (
                  <div key={point} className="py-3 flex items-center gap-3 text-xs sm:text-sm text-slate-700 dark:text-zinc-300">
                    <Check className="w-4 h-4 text-[#D97706] dark:text-[#FFB020] shrink-0" />
                    <span>{point}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Interactive Terms & Conditions */}
            <div className="lg:col-span-7 rounded-3xl bg-slate-50 dark:bg-[#060608] border border-slate-200 dark:border-white/12 divide-y divide-slate-200/80 dark:divide-white/10 overflow-hidden shadow-2xl">
              <div className="px-6 py-4 flex items-center justify-between">
                <span className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Terms &amp; Conditions
                </span>
                <span className="text-xs text-slate-500 dark:text-zinc-500">
                  Tap any disclosure
                </span>
              </div>

              {TERMS_CLAUSES.map((clause) => {
                const isOpen = openTermId === clause.id;
                return (
                  <div key={clause.id}>
                    <button
                      type="button"
                      onClick={() => setOpenTermId(isOpen ? '' : clause.id)}
                      aria-expanded={isOpen}
                      className="w-full px-6 py-4 text-left flex items-center justify-between gap-4 hover:bg-slate-100/70 dark:hover:bg-white/[0.03] transition-colors"
                    >
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">
                        {clause.title}
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0 transition-transform duration-200 ${
                          isOpen ? 'rotate-180 text-[#FFB020]' : ''
                        }`}
                      />
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2, ease: MATERIAL_EASE }}
                          className="overflow-hidden"
                        >
                          <p className="px-6 pb-4 text-xs sm:text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                            {clause.summary}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Closing Conversion Band */}
          <div className="relative rounded-3xl p-8 sm:p-12 text-center bg-slate-50 dark:bg-[#060608] border border-slate-200 dark:border-white/10 overflow-hidden flex flex-col items-center space-y-5">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-48 rounded-full bg-[#FFB020]/10 blur-3xl"
            />
            <h2 className="relative z-10 font-display text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-white leading-[1.06]">
              Built for every rupee ahead.
            </h2>
            <p className="relative z-10 text-sm sm:text-base text-slate-600 dark:text-zinc-400 max-w-md">
              Sign in with Google or email and set your 4-digit security PIN.
            </p>
            <button
              type="button"
              onClick={onGetStarted}
              className="relative z-10 min-h-[48px] px-8 py-3 rounded-full bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#140B00] text-sm font-semibold flex items-center gap-2 transition-all shadow-lg shadow-[#FFB020]/25 whitespace-nowrap"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Footer Signature */}
        <footer className="relative z-10 w-full max-w-[1160px] mx-auto pt-8 mt-8 border-t border-slate-200/80 dark:border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500 dark:text-zinc-400">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display font-semibold text-slate-900 dark:text-white">
              FINGuard
            </span>
            <span aria-hidden="true">·</span>
            <span>© 2026 FINGuard. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => scrollToSection('overview')}
              className="hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              Top
            </button>
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle color theme"
              className="w-8 h-8 rounded-full border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              {theme === 'dark' ? (
                <Sun className="w-3.5 h-3.5 text-[#FFB020]" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};
