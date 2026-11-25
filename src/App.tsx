import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart3,
  Bot,
  Briefcase,
  CandlestickChart,
  Home,
  Moon,
  Newspaper,
  Settings,
  Sun,
} from 'lucide-react';
import type {
  CashflowAnalysis,
  CopilotResponse,
  EnrichedHolding,
  LedgerEntryRecord,
  MarketNewsFeedResponse,
  MarketQuote,
  OrderRecord,
  QuantStrategyDSL,
  QuantStrategyRecord,
  UpiMandateRecord,
  UserProfile,
} from '../shared/types.ts';
import { AuthScreen } from './components/AuthScreen.tsx';
import { CopilotSheet } from './components/CopilotSheet.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { HomeTab, type PortfolioSummaryData } from './components/HomeTab.tsx';
import { LandingShowcase } from './components/LandingShowcase.tsx';
import { MarketsTab } from './components/MarketsTab.tsx';
import { MATERIAL_EASE, ParallaxAmbientBackdrop } from './components/MotionPrimitives.tsx';
import { NewsTab } from './components/NewsTab.tsx';
import { PinLockModal } from './components/PinLockModal.tsx';
import { PortfolioTab } from './components/PortfolioTab.tsx';
import { QuantLabTab } from './components/QuantLabTab.tsx';
import { SettingsSheet } from './components/SettingsSheet.tsx';
import { UpiProfileTab } from './components/UpiProfileTab.tsx';
import { apiFetch, setAuthTokens, setSessionExpiredHandler } from './lib/api.ts';
import {
  auth,
  fetchUserPrivateProfileFromFirestore,
  firebaseSignOut,
  syncUserAccountToFirestore,
} from './lib/firebase.ts';

type NavTab = 'HOME' | 'MARKETS' | 'NEWS' | 'QUANT' | 'PORTFOLIO' | 'UPI';

interface PortfolioApiResponse extends PortfolioSummaryData {
  holdings: EnrichedHolding[];
  orders: OrderRecord[];
  ledgerEntries: LedgerEntryRecord[];
}

function AppContent() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [entryStage, setEntryStage] = useState<'SHOWCASE' | 'AUTH'>('SHOWCASE');
  const [appLocked, setAppLocked] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const [activeTab, setActiveTab] = useState<NavTab>('HOME');
  const [portfolioSubTab, setPortfolioSubTab] = useState<string | undefined>(undefined);
  const [quantInitialDsl, setQuantInitialDsl] = useState<QuantStrategyDSL | null>(null);
  const [marketChartSymbol, setMarketChartSymbol] = useState<string | null>(null);
  const [preselectedTradeSymbol, setPreselectedTradeSymbol] = useState<string | null>(null);
  const [prefillSipStrategy, setPrefillSipStrategy] = useState<{ id: string; name: string } | null>(
    null
  );

  // Copilot & Settings Sheets
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotMode, setCopilotMode] = useState<CopilotResponse['mode']>('RESEARCH');
  const [copilotPrompt, setCopilotPrompt] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);

  useEffect(() => {
    setAvatarBroken(false);
  }, [user?.avatarUrl]);

  // App Data
  const [portfolio, setPortfolio] = useState<PortfolioApiResponse | null>(null);
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [newsFeed, setNewsFeed] = useState<MarketNewsFeedResponse | null>(null);
  const [strategies, setStrategies] = useState<QuantStrategyRecord[]>([]);
  const [cashflow, setCashflow] = useState<CashflowAnalysis | null>(null);
  const [mandates, setMandates] = useState<UpiMandateRecord[]>([]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setPortfolio(null);
    });
  }, []);

  const loadAllData = useCallback(async () => {
    const [portRes, quotesRes, stratRes, cashRes, mandRes] = await Promise.all([
      apiFetch<PortfolioApiResponse>('/api/portfolio/summary'),
      apiFetch<{ quotes: MarketQuote[] }>(
        '/api/market/quotes?symbols=^NSEI,^BSESN,^NSEBANK,^INDIAVIX,JIOFIN.NS,RELIANCE.NS,TCS.NS,HDFCBANK.NS,ETERNAL.NS,GOLDBEES.NS'
      ),
      apiFetch<{ strategies: QuantStrategyRecord[] }>('/api/quant/strategies'),
      apiFetch<{ analysis: CashflowAnalysis }>('/api/upi/cashflow'),
      apiFetch<{ mandates: UpiMandateRecord[] }>('/api/upi/mandates'),
    ]);
    setPortfolio(portRes);
    setQuotes(quotesRes.quotes);
    setStrategies(stratRes.strategies);
    setCashflow(cashRes.analysis);
    setMandates(mandRes.mandates);

    apiFetch<MarketNewsFeedResponse>('/api/market/news')
      .then((res) => setNewsFeed(res))
      .catch(() => {
        // non-blocking news fetch
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadAllData();
    const newsTimer = setInterval(() => {
      apiFetch<MarketNewsFeedResponse>('/api/market/news')
        .then((res) => setNewsFeed(res))
        .catch(() => {});
    }, 20000);
    return () => clearInterval(newsTimer);
  }, [user, loadAllData]);

  // Hydrate saved personal details from Firestore once on authenticated sign-in
  useEffect(() => {
    if (!user?.id || !auth.currentUser?.emailVerified) return;
    let cancelled = false;
    void fetchUserPrivateProfileFromFirestore()
      .then((cloud) => {
        if (!cloud || cancelled) return;
        const patch: Record<string, unknown> = {};
        if (cloud.displayName && cloud.displayName !== user.name) patch.name = cloud.displayName;
        if (cloud.phone && !user.phone) patch.phone = cloud.phone;
        if (cloud.upiId && !user.upiId) patch.upiId = cloud.upiId;
        if (cloud.city && !user.city) patch.city = cloud.city;
        if (cloud.occupation && !user.occupation) patch.occupation = cloud.occupation;
        if (cloud.dateOfBirth && !user.dateOfBirth) patch.dateOfBirth = cloud.dateOfBirth;
        if (cloud.bio && !user.bio) patch.bio = cloud.bio;
        if (cloud.riskProfile && cloud.riskProfile !== user.riskProfile) {
          patch.riskProfile = cloud.riskProfile;
        }
        if (cloud.taxRegime && !user.taxRegime) patch.taxRegime = cloud.taxRegime;
        if (cloud.investmentHorizon && !user.investmentHorizon) {
          patch.investmentHorizon = cloud.investmentHorizon;
        }
        if (cloud.incomeBracket && !user.incomeBracket) patch.incomeBracket = cloud.incomeBracket;
        if (cloud.targetMonthlySipInr !== undefined && user.targetMonthlySipInr === undefined) {
          patch.targetMonthlySipInr = cloud.targetMonthlySipInr;
        }
        if (Object.keys(patch).length > 0) {
          return apiFetch<{ user: UserProfile }>('/api/auth/profile', {
            method: 'PATCH',
            body: JSON.stringify(patch),
          }).then((res) => {
            if (!cancelled) setUser(res.user);
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user || !auth.currentUser?.emailVerified) return;
    void syncUserAccountToFirestore({
      email: user.email,
      displayName: user.name,
      avatarUrl: user.avatarUrl,
      upstoxConnected: Boolean(portfolio?.upstoxConnected),
      upiId: user.upiId,
      phone: user.phone,
      city: user.city,
      occupation: user.occupation,
      dateOfBirth: user.dateOfBirth,
      bio: user.bio,
      riskProfile: user.riskProfile,
      taxRegime: user.taxRegime,
      investmentHorizon: user.investmentHorizon,
      incomeBracket: user.incomeBracket,
      targetMonthlySipInr: user.targetMonthlySipInr,
    }).catch(() => {});
  }, [user, portfolio?.upstoxConnected]);

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } catch {
      // ignore
    }
    await firebaseSignOut();
    setAuthTokens(null, null);
    setUser(null);
    setPortfolio(null);
  };

  const handleVerifyAppUnlock = async (pin: string) => {
    await apiFetch('/api/auth/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
    setAppLocked(false);
  };

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  if (!user) {
    if (entryStage === 'SHOWCASE') {
      return (
        <LandingShowcase
          onGetStarted={() => setEntryStage('AUTH')}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      );
    }
    return (
      <AuthScreen
        onAuthenticated={(u) => setUser(u)}
        onBack={() => setEntryStage('SHOWCASE')}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  return (
    <div className="relative min-h-[100dvh] w-full overflow-x-clip m3-surface text-slate-900 dark:text-slate-100 flex flex-col lg:flex-row">
      <ParallaxAmbientBackdrop />

      {/* Desktop Material 3 Navigation Rail / Drawer */}
      <aside className="hidden lg:flex lg:w-60 lg:flex-col lg:fixed lg:inset-y-0 bg-white/95 dark:bg-[#0D111A]/95 backdrop-blur-md border-r border-slate-200/80 dark:border-white/8 p-4 z-30">
        <div>
          <div className="flex items-center gap-3 px-2">
            <div className="w-9 h-9 rounded-2xl bg-black border border-slate-200/80 dark:border-white/15 overflow-hidden flex items-center justify-center shadow-sm shrink-0">
              <img
                src="/assets/aistudio/image_c96ff192.png"
                alt="FINGuard logo"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover scale-[1.32]"
              />
            </div>
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              FINGuard
            </span>
          </div>

          <nav className="mt-7 space-y-1.5" aria-label="Main navigation">
            {(
              [
                { id: 'HOME', label: 'Wealth OS', icon: Home },
                { id: 'MARKETS', label: 'Markets', icon: CandlestickChart },
                { id: 'NEWS', label: 'News', icon: Newspaper },
                { id: 'QUANT', label: 'Quant Lab', icon: BarChart3 },
                { id: 'PORTFOLIO', label: 'Portfolio & Tax', icon: Briefcase },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`relative w-full min-h-[44px] px-4 py-2 rounded-full text-sm font-medium flex items-center gap-3 transition-colors ${
                    active
                      ? 'text-[#D97706] dark:text-[#FFB020] font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="desktopNavPill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-full bg-[#FFB020]/14"
                      aria-hidden="true"
                    />
                  )}
                  <Icon className="relative z-10 w-4 h-4 shrink-0" />
                  <span className="relative z-10 flex-1 text-left">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Material 3 Extended FAB for AI Copilot */}
          <button
            type="button"
            onClick={() => {
              setCopilotMode('RESEARCH');
              setCopilotPrompt('');
              setCopilotOpen(true);
            }}
            className="mt-6 w-full min-h-[48px] px-4 py-2.5 rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] font-semibold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-[#FFB020]/25"
          >
            <Bot className="w-4 h-4" />
            <span>AI Copilot &amp; RAG</span>
          </button>
        </div>
      </aside>

      {/* Main Responsive Content Canvas */}
      <div className="relative z-10 flex-1 min-w-0 lg:pl-60 flex flex-col min-h-[100dvh]">
        {/* Compact Material 3 Top App Bar */}
        <header className="sticky top-0 z-30 h-13 px-4 lg:px-6 bg-white/85 dark:bg-[#090C12]/85 backdrop-blur-md border-b border-slate-200/80 dark:border-white/8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 lg:hidden">
            <div className="w-8 h-8 rounded-xl bg-black border border-slate-200/80 dark:border-white/15 overflow-hidden flex items-center justify-center shrink-0">
              <img
                src="/assets/aistudio/image_c96ff192.png"
                alt="FINGuard logo"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover scale-[1.32]"
              />
            </div>
            <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
              FINGuard
            </span>
          </div>

          <div className="hidden lg:block font-display text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">
            {activeTab === 'HOME' && 'Wealth OS'}
            {activeTab === 'MARKETS' && 'Markets'}
            {activeTab === 'NEWS' && 'News & Macro'}
            {activeTab === 'QUANT' && 'Quant Lab'}
            {activeTab === 'PORTFOLIO' && 'Portfolio & Tax'}
            {activeTab === 'UPI' && 'UPI Cashflow & SIP'}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setCopilotMode('RESEARCH');
                setCopilotPrompt('');
                setCopilotOpen(true);
              }}
              className="lg:hidden min-h-[36px] px-3 py-1 rounded-full bg-[#FFB020] text-[#1C1000] text-xs font-semibold flex items-center gap-1.5 shadow-sm"
            >
              <Bot className="w-3.5 h-3.5" />
              <span>AI</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label="Toggle color theme"
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="min-h-[36px] min-w-[36px] rounded-full m3-tonal-box border border-transparent hover:border-[#FFB020]/35 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all active:scale-[0.96] shrink-0"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-[#F5B700]" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open Settings & Profile Details"
              title="Account Settings & Personal Details"
              className={`min-h-[36px] min-w-[36px] rounded-full border flex items-center justify-center transition-all active:scale-[0.96] shrink-0 ${
                settingsOpen
                  ? 'bg-[#FFB020]/16 border-[#FFB020]/45 text-[#D97706] dark:text-[#FFB020]'
                  : 'm3-tonal-box border-transparent hover:border-[#FFB020]/35 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('UPI')}
              aria-label={`${user.name} · Open UPI & Profile`}
              title={`${user.name} · UPI & Profile`}
              aria-pressed={activeTab === 'UPI'}
              className={`min-h-[36px] min-w-[36px] p-0.5 rounded-full border flex items-center justify-center transition-all active:scale-[0.96] shrink-0 ${
                activeTab === 'UPI'
                  ? 'bg-[#FFB020]/16 border-[#FFB020] ring-2 ring-[#FFB020]/25'
                  : 'm3-tonal-box border-transparent hover:border-[#FFB020]/45'
              }`}
            >
              {user.avatarUrl && !avatarBroken ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarBroken(true)}
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <span className="w-8 h-8 rounded-full bg-[#FFB020]/20 text-[#D97706] dark:text-[#FFB020] font-bold text-xs flex items-center justify-center">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Smooth Animated Tab Content */}
        <main className="flex-1 min-w-0 w-full max-w-[1380px] mx-auto px-4 lg:px-6 pt-3 pb-24 lg:py-3">
          <AnimatePresence
            mode="wait"
            onExitComplete={() => {
              if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
            }}
          >
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: MATERIAL_EASE }}
              className="min-w-0"
            >
              {activeTab === 'HOME' && (
                <HomeTab
                  summary={portfolio}
                  cashflow={cashflow}
                  newsFeed={newsFeed}
                  strategies={strategies}
                  mandates={mandates}
                  onOpenQuantWithDsl={(dsl) => {
                    setQuantInitialDsl(dsl);
                    setActiveTab('QUANT');
                  }}
                  onOpenCopilotMode={(mode, prefill) => {
                    setCopilotMode(mode);
                    setCopilotPrompt(prefill || '');
                    setCopilotOpen(true);
                  }}
                  onNavigateTab={(tab, sub) => {
                    setPortfolioSubTab(sub);
                    setActiveTab(tab);
                  }}
                  onQuickTrade={(sym) => {
                    setPreselectedTradeSymbol(sym);
                    setActiveTab('PORTFOLIO');
                  }}
                  onOpenMarketNews={() => {
                    setActiveTab('NEWS');
                  }}
                />
              )}

              {activeTab === 'MARKETS' && (
                <MarketsTab
                  initialQuotes={quotes}
                  theme={theme}
                  cashInr={portfolio?.cashInr || 0}
                  initialSymbol={marketChartSymbol}
                  onClearInitialSymbol={() => setMarketChartSymbol(null)}
                  onOrderExecuted={loadAllData}
                  onLogTrade={(sym) => {
                    setPreselectedTradeSymbol(sym);
                    setActiveTab('PORTFOLIO');
                  }}
                />
              )}

              {activeTab === 'NEWS' && (
                <NewsTab
                  initialFeed={newsFeed}
                  quotes={quotes}
                  onFeedUpdated={(f) => setNewsFeed(f)}
                  onFactCheckHeadline={(prompt) => {
                    setCopilotMode('BS_DETECTOR');
                    setCopilotPrompt(prompt);
                    setCopilotOpen(true);
                  }}
                  onOpenMarketChart={(sym) => {
                    setMarketChartSymbol(sym);
                    setActiveTab('MARKETS');
                  }}
                />
              )}

              {activeTab === 'QUANT' && (
                <QuantLabTab
                  initialDsl={quantInitialDsl}
                  savedStrategies={strategies}
                  onStrategySaved={() => void loadAllData()}
                  onStartSipForStrategy={(id, name) => {
                    setPrefillSipStrategy({ id, name });
                    setActiveTab('UPI');
                  }}
                />
              )}

              {activeTab === 'PORTFOLIO' && (
                <PortfolioTab
                  initialSubTab={portfolioSubTab}
                  holdings={portfolio?.holdings || []}
                  orders={portfolio?.orders || []}
                  ledgerEntries={portfolio?.ledgerEntries || []}
                  cashInr={portfolio?.cashInr || 0}
                  sipEscrowInr={portfolio?.sipEscrowInr || 0}
                  taxReserveInr={portfolio?.taxReserveInr || 0}
                  upstoxConnected={Boolean(portfolio?.upstoxConnected)}
                  portfolioSourceMode={portfolio?.portfolioSourceMode}
                  preselectedTradeSymbol={preselectedTradeSymbol}
                  onClearPreselectedSymbol={() => setPreselectedTradeSymbol(null)}
                  onRefreshPortfolio={loadAllData}
                />
              )}

              {activeTab === 'UPI' && (
                <UpiProfileTab
                  user={user}
                  cashflow={cashflow}
                  mandates={mandates}
                  strategies={strategies}
                  prefillStrategy={prefillSipStrategy}
                  onClearPrefillStrategy={() => setPrefillSipStrategy(null)}
                  theme={theme}
                  onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                  onLockApp={() => setAppLocked(true)}
                  onLogout={() => void handleLogout()}
                  onRefreshAll={loadAllData}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile Material 3 Navigation Bar */}
      <nav
        aria-label="Mobile bottom navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 dark:bg-[#0D111A]/95 backdrop-blur-md border-t border-slate-200/80 dark:border-white/10 grid grid-cols-5 items-center px-1"
      >
        {(
          [
            { id: 'HOME', label: 'Home', icon: Home },
            { id: 'MARKETS', label: 'Markets', icon: CandlestickChart },
            { id: 'NEWS', label: 'News', icon: Newspaper },
            { id: 'QUANT', label: 'Quant', icon: BarChart3 },
            { id: 'PORTFOLIO', label: 'Assets', icon: Briefcase },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center min-h-[44px] ${
                active
                  ? 'text-[#D97706] dark:text-[#FFB020]'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <span
                className={`relative px-2.5 py-0.5 rounded-full transition-colors ${
                  active ? 'bg-[#FFB020]/18' : 'bg-transparent'
                }`}
              >
                <Icon className="w-5 h-5" />
              </span>
              <span className="text-[10px] font-medium mt-0.5">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* AI Copilot Bottom Sheet */}
      <CopilotSheet
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        initialMode={copilotMode}
        initialPrompt={copilotPrompt}
      />

      {/* Full-Screen 4-Digit App PIN Lock */}
      <PinLockModal
        open={appLocked}
        dismissible={false}
        title="FINGuard Locked"
        subtitle={`Unlock ${user.name}'s Wealth OS with your 4-digit security PIN`}
        onVerify={handleVerifyAppUnlock}
      />

      {/* Account & Personal Profile Settings Sheet */}
      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user}
        upstoxConnected={Boolean(portfolio?.upstoxConnected)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onUserUpdated={(updated) => setUser(updated)}
        onLockApp={() => setAppLocked(true)}
        onLogout={() => void handleLogout()}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
