import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Moon,
  ShieldCheck,
  Sun,
  UserPlus,
} from 'lucide-react';
import type { UserProfile } from '../../shared/types.ts';
import { apiFetch, setAuthTokens } from '../lib/api.ts';
import { signInWithGooglePopup } from '../lib/firebase.ts';
import { MATERIAL_EASE, ParallaxAmbientBackdrop } from './MotionPrimitives.tsx';

interface AuthScreenProps {
  onAuthenticated: (user: UserProfile) => void;
  onBack?: () => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

type EmailView = 'NONE' | 'LOGIN' | 'REGISTER_STEP1' | 'REGISTER_STEP2';

const GoogleMark: React.FC = () => (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
    />
  </svg>
);

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onAuthenticated,
  onBack,
  theme = 'dark',
  onToggleTheme,
}) => {
  const [emailView, setEmailView] = useState<EmailView>('NONE');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pin, setPin] = useState('');
  const [riskProfile, setRiskProfile] = useState<UserProfile['riskProfile']>('BALANCED');

  // First-time Google user PIN onboarding
  const [pendingGoogleUser, setPendingGoogleUser] = useState<UserProfile | null>(null);
  const [setupPin, setSetupPin] = useState('');

  const [busyAction, setBusyAction] = useState<'GOOGLE' | 'SUBMIT' | 'PIN' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heroBroken, setHeroBroken] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);

  const isBusy = busyAction !== null;

  const handleGoogleLogin = async () => {
    setBusyAction('GOOGLE');
    setError(null);
    try {
      const { idToken } = await signInWithGooglePopup();
      const res = await apiFetch<{
        user: UserProfile;
        accessToken: string;
        refreshToken: string;
        needsPinSetup?: boolean;
      }>('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      });

      setAuthTokens(res.accessToken, res.refreshToken);
      if (res.needsPinSetup || !res.user.hasPin) {
        setPendingGoogleUser(res.user);
        setSetupPin('');
      } else {
        onAuthenticated(res.user);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleCompletePinSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingGoogleUser) return;
    if (!/^\d{4}$/.test(setupPin)) {
      setError('Enter a 4-digit numeric security PIN.');
      return;
    }
    setBusyAction('PIN');
    setError(null);
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/auth/set-pin', {
        method: 'POST',
        body: JSON.stringify({ pin: setupPin }),
      });
      onAuthenticated(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction('SUBMIT');
    setError(null);
    try {
      const res = await apiFetch<{
        user: UserProfile;
        accessToken: string;
        refreshToken: string;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: email, password }),
      });
      setAuthTokens(res.accessToken, res.refreshToken);
      onAuthenticated(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRegisterStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || password.length < 6) {
      setError('Enter your name, email, and a password (min 6 characters).');
      return;
    }
    setEmailView('REGISTER_STEP2');
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(pin)) {
      setError('Enter a 4-digit numeric security PIN.');
      return;
    }
    setBusyAction('SUBMIT');
    setError(null);
    try {
      const res = await apiFetch<{
        user: UserProfile;
        accessToken: string;
        refreshToken: string;
      }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, pin, riskProfile }),
      });
      setAuthTokens(res.accessToken, res.refreshToken);
      onAuthenticated(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const inputClass =
    'w-full min-h-[42px] px-3.5 rounded-2xl m3-tonal-box border border-slate-200/80 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-[#FFB020] transition-colors';

  const headingTitle = pendingGoogleUser
    ? 'Set your 4-digit PIN'
    : emailView === 'NONE'
    ? 'Welcome back'
    : emailView === 'LOGIN'
    ? 'Sign in'
    : emailView === 'REGISTER_STEP1'
    ? 'Create account'
    : 'Security PIN';

  const headingSubtitle = pendingGoogleUser
    ? 'Required once to authorize orders and UPI mandates.'
    : emailView === 'NONE'
    ? 'Sign in with Google or pick an access method.'
    : emailView === 'LOGIN'
    ? 'Enter your email or phone credentials.'
    : emailView === 'REGISTER_STEP1'
    ? 'Step 1 of 2 · Your portfolio details'
    : 'Step 2 of 2 · Transaction PIN & risk';

  return (
    <div className="relative min-h-[100dvh] lg:h-[100dvh] w-full overflow-x-clip lg:overflow-hidden m3-surface flex flex-col lg:grid lg:grid-cols-12">
      {/* Left Half: Obsidian Architectural Brand Surface */}
      <div className="relative h-[185px] sm:h-[220px] lg:h-full lg:col-span-6 xl:col-span-7 overflow-hidden flex flex-col justify-between p-5 sm:p-8 lg:p-12 bg-[#070709] shrink-0">
        {!heroBroken ? (
          <img
            src="/src/assets/images/auth_hero_amber_obsidian_1795487864605.jpg"
            alt="FINGuard obsidian and amber architectural vault"
            referrerPolicy="no-referrer"
            onError={() => setHeroBroken(true)}
            className="absolute inset-0 w-full h-full object-cover object-center scale-[1.01] brightness-110 contrast-105"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#090A0F] via-[#1C1406] to-[#261804]" />
        )}

        <div
          className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-black/25"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 bg-gradient-to-r from-black/45 via-transparent to-transparent"
          aria-hidden="true"
        />

        <div className="relative z-10 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-black border border-white/15 overflow-hidden flex items-center justify-center shrink-0">
            {!logoBroken ? (
              <img
                src="/assets/aistudio/image_c96ff192.png"
                alt="FINGuard logo"
                referrerPolicy="no-referrer"
                onError={() => setLogoBroken(true)}
                className="w-full h-full object-cover scale-[1.32]"
              />
            ) : (
              <ShieldCheck className="w-5 h-5 text-[#FFB020]" />
            )}
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            FINGuard
          </span>
        </div>

        <div className="relative z-10 max-w-xl">
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl xl:text-[3.6rem] font-bold tracking-tight text-white leading-[1.06] text-balance">
            Quiet power.
            <span className="block text-[#FFB020]">Serious wealth.</span>
          </h1>
          <p className="hidden sm:block text-sm text-slate-300/90 mt-3 max-w-md leading-relaxed">
            NSE quant backtesting, FY26 tax harvesting, and smart UPI SIPs.
          </p>
        </div>
      </div>

      {/* Right Half: Material 3 Minimal Auth Canvas (Zero Scroll) */}
      <div className="relative z-10 flex-1 min-w-0 lg:h-full lg:col-span-6 xl:col-span-5 flex flex-col justify-center px-5 py-5 sm:px-8 lg:px-10">
        <ParallaxAmbientBackdrop />

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to FINGuard overview"
            className="absolute top-4 left-4 sm:top-5 sm:left-5 z-20 min-h-[36px] px-3 py-1.5 rounded-2xl m3-tonal-box text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Overview</span>
          </button>
        )}

        {onToggleTheme && (
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle color theme"
            className="absolute top-4 right-4 sm:top-5 sm:right-5 z-20 w-9 h-9 rounded-2xl m3-tonal-box flex items-center justify-center text-slate-600 dark:text-slate-300 hover:opacity-90 transition-opacity"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-[#FFB020]" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        )}

        <div className="relative z-10 w-full max-w-[380px] mx-auto">
          <AnimatePresence mode="wait">
            {pendingGoogleUser ? (
              <motion.form
                key="pin-setup"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: MATERIAL_EASE }}
                onSubmit={handleCompletePinSetup}
                className="space-y-4"
              >
                <div className="flex items-center gap-3 p-3 rounded-2xl m3-card">
                  {pendingGoogleUser.avatarUrl ? (
                    <img
                      src={pendingGoogleUser.avatarUrl}
                      alt={pendingGoogleUser.name}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-2xl object-cover border border-slate-200 dark:border-white/15 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-2xl bg-[#FFB020]/15 text-[#D97706] dark:text-[#FFB020] font-display font-bold flex items-center justify-center shrink-0">
                      {pendingGoogleUser.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {pendingGoogleUser.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {pendingGoogleUser.email}
                    </p>
                  </div>
                </div>

                <div>
                  <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                    {headingTitle}
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {headingSubtitle}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="setup-pin-input"
                    className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                  >
                    4-Digit Transaction PIN
                  </label>
                  <input
                    id="setup-pin-input"
                    type="password"
                    inputMode="numeric"
                    autoFocus
                    maxLength={4}
                    pattern="\d{4}"
                    required
                    value={setupPin}
                    onChange={(e) => {
                      setError(null);
                      setSetupPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                    }}
                    placeholder="••••"
                    className="w-full min-h-[50px] px-4 rounded-2xl m3-tonal-box border border-slate-200/80 dark:border-white/10 text-center text-2xl tabular-nums tracking-[0.45em] text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                  />
                </div>

                {error && (
                  <p className="text-xs font-medium text-[#FF4D6D]" role="alert">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isBusy || setupPin.length !== 4}
                  className="w-full min-h-[46px] px-4 py-2 rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 whitespace-nowrap shadow-sm"
                >
                  {busyAction === 'PIN' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>Complete Setup</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </motion.form>
            ) : (
              <motion.div
                key="auth-main"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: MATERIAL_EASE }}
                className="space-y-4"
              >
                <div>
                  <h2 className="font-display text-2xl sm:text-[1.75rem] font-bold tracking-tight text-slate-900 dark:text-white">
                    {headingTitle}
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {headingSubtitle}
                  </p>
                </div>

                {emailView === 'NONE' && (
                  <>
                    {/* Primary 1-Click Google CTA */}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={handleGoogleLogin}
                      className="w-full min-h-[46px] px-4 py-2.5 rounded-2xl m3-card m3-card-interactive active:scale-[0.98] text-slate-900 dark:text-white font-semibold text-sm flex items-center justify-center gap-2.5 disabled:opacity-60 whitespace-nowrap shadow-sm"
                    >
                      {busyAction === 'GOOGLE' ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#FFB020]" />
                      ) : (
                        <GoogleMark />
                      )}
                      <span>
                        {busyAction === 'GOOGLE' ? 'Connecting Google...' : 'Continue with Google'}
                      </span>
                    </button>

                    {error && (
                      <p className="text-xs font-medium text-[#FF4D6D]" role="alert">
                        {error}
                      </p>
                    )}

                    <div className="flex items-center gap-3 py-0.5">
                      <div className="h-px flex-1 bg-slate-200/80 dark:bg-white/10" />
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                        or
                      </span>
                      <div className="h-px flex-1 bg-slate-200/80 dark:bg-white/10" />
                    </div>

                    {/* Material 3 Launchpad Tiles (Matches In-App HomeTab Language) */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setError(null);
                          setEmailView('LOGIN');
                        }}
                        className="min-w-0 min-h-[60px] p-3.5 rounded-2xl m3-card m3-card-interactive active:scale-[0.98] text-left flex items-center gap-3"
                      >
                        <div className="w-9 h-9 rounded-xl bg-[#FFB020]/14 text-[#D97706] dark:text-[#FFB020] flex items-center justify-center shrink-0">
                          <Mail className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">
                            Email
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            Sign in
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setError(null);
                          setEmailView('REGISTER_STEP1');
                        }}
                        className="min-w-0 min-h-[60px] p-3.5 rounded-2xl m3-card m3-card-interactive active:scale-[0.98] text-left flex items-center gap-3"
                      >
                        <div className="w-9 h-9 rounded-xl bg-sky-500/14 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                          <UserPlus className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">
                            Register
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            Free account
                          </p>
                        </div>
                      </button>
                    </div>
                  </>
                )}

                {emailView === 'LOGIN' && (
                  <motion.form
                    key="email-login"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.16, ease: MATERIAL_EASE }}
                    onSubmit={handleLoginSubmit}
                    className="rounded-3xl m3-card p-5 space-y-3.5"
                  >
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Email or Phone
                      </label>
                      <input
                        type="text"
                        autoFocus
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@domain.in"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Minimum 6 characters"
                          className={`${inputClass} pr-10`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {error && (
                      <p className="text-xs font-medium text-[#FF4D6D]" role="alert">
                        {error}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={isBusy}
                      className="w-full min-h-[44px] px-4 py-2 rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-60 whitespace-nowrap shadow-sm"
                    >
                      {busyAction === 'SUBMIT' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <span>Sign In</span>
                          <ArrowRight className="w-4 h-4 shrink-0" />
                        </>
                      )}
                    </button>

                    <div className="pt-1 flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setEmailView('NONE');
                        }}
                        className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Back</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setEmailView('REGISTER_STEP1');
                        }}
                        className="font-semibold text-[#D97706] dark:text-[#FFB020] hover:underline"
                      >
                        Create account
                      </button>
                    </div>
                  </motion.form>
                )}

                {emailView === 'REGISTER_STEP1' && (
                  <motion.form
                    key="register-step1"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.16, ease: MATERIAL_EASE }}
                    onSubmit={handleRegisterStep1}
                    className="rounded-3xl m3-card p-5 space-y-3"
                  >
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Full Name
                      </label>
                      <input
                        type="text"
                        autoFocus
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Priya Nair"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="priya@domain.in"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Minimum 6 characters"
                          className={`${inputClass} pr-10`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {error && (
                      <p className="text-xs font-medium text-[#FF4D6D]" role="alert">
                        {error}
                      </p>
                    )}

                    <button
                      type="submit"
                      className="w-full min-h-[44px] px-4 py-2 rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] font-semibold text-sm flex items-center justify-center gap-2 transition-all whitespace-nowrap shadow-sm"
                    >
                      <span>Continue</span>
                      <ArrowRight className="w-4 h-4 shrink-0" />
                    </button>

                    <div className="pt-1 flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setEmailView('NONE');
                        }}
                        className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Back</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setEmailView('LOGIN');
                        }}
                        className="font-semibold text-[#D97706] dark:text-[#FFB020] hover:underline"
                      >
                        Sign in instead
                      </button>
                    </div>
                  </motion.form>
                )}

                {emailView === 'REGISTER_STEP2' && (
                  <motion.form
                    key="register-step2"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.16, ease: MATERIAL_EASE }}
                    onSubmit={handleRegisterSubmit}
                    className="rounded-3xl m3-card p-5 space-y-3.5"
                  >
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                        4-Digit Security PIN
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        autoFocus
                        maxLength={4}
                        pattern="\d{4}"
                        required
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="••••"
                        className="w-full min-h-[48px] px-4 rounded-2xl m3-tonal-box border border-slate-200/80 dark:border-white/10 text-center text-xl tabular-nums tracking-[0.45em] text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                        Risk Profile
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'] as const).map((rp) => {
                          const active = riskProfile === rp;
                          return (
                            <button
                              key={rp}
                              type="button"
                              onClick={() => setRiskProfile(rp)}
                              className={`min-h-[38px] px-2 rounded-2xl text-xs font-semibold transition-all ${
                                active
                                  ? 'bg-[#FFB020] text-[#1C1000] shadow-sm'
                                  : 'm3-tonal-box text-slate-700 dark:text-slate-300 hover:opacity-90'
                              }`}
                            >
                              {rp.charAt(0) + rp.slice(1).toLowerCase()}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {error && (
                      <p className="text-xs font-medium text-[#FF4D6D]" role="alert">
                        {error}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={isBusy}
                      className="w-full min-h-[44px] px-4 py-2 rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-60 whitespace-nowrap shadow-sm"
                    >
                      {busyAction === 'SUBMIT' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <span>Launch Portfolio</span>
                          <ArrowRight className="w-4 h-4 shrink-0" />
                        </>
                      )}
                    </button>

                    <div className="pt-1 flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setEmailView('REGISTER_STEP1');
                        }}
                        className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Back</span>
                      </button>
                    </div>
                  </motion.form>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
