import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  Lock,
  LogOut,
  Moon,
  Sun,
} from 'lucide-react';
import type { UserProfile } from '../../shared/types.ts';
import { apiFetch } from '../lib/api.ts';
import { syncUserAccountToFirestore } from '../lib/firebase.ts';
import { BottomSheet } from './BottomSheet.tsx';
import { MATERIAL_EASE, MaterialSegmentedTabs } from './MotionPrimitives.tsx';

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  user: UserProfile;
  upstoxConnected: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onUserUpdated: (user: UserProfile) => void;
  onLockApp: () => void;
  onLogout: () => void;
}

type SettingsSection = 'PROFILE' | 'INVESTOR' | 'SECURITY';

export const SettingsSheet: React.FC<SettingsSheetProps> = ({
  open,
  onClose,
  user,
  upstoxConnected,
  theme,
  onToggleTheme,
  onUserUpdated,
  onLockApp,
  onLogout,
}) => {
  const [section, setSection] = useState<SettingsSection>('PROFILE');

  // Personal Profile fields
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone || '');
  const [city, setCity] = useState(user.city || '');
  const [occupation, setOccupation] = useState(user.occupation || '');
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirth || '');
  const [upiId, setUpiId] = useState(user.upiId || '');
  const [bio, setBio] = useState(user.bio || '');

  // Investor Setup fields
  const [riskProfile, setRiskProfile] = useState<UserProfile['riskProfile']>(user.riskProfile);
  const [taxRegime, setTaxRegime] = useState<NonNullable<UserProfile['taxRegime']>>(
    user.taxRegime || 'NEW'
  );
  const [investmentHorizon, setInvestmentHorizon] = useState<
    NonNullable<UserProfile['investmentHorizon']>
  >(user.investmentHorizon || 'LONG_TERM');
  const [incomeBracket, setIncomeBracket] = useState<NonNullable<UserProfile['incomeBracket']>>(
    user.incomeBracket || '10L_25L'
  );
  const [targetMonthlySipInr, setTargetMonthlySipInr] = useState(
    user.targetMonthlySipInr ? String(user.targetMonthlySipInr) : ''
  );

  // PIN Security fields
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');

  // Status / Feedback
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pinSaving, setPinSaving] = useState(false);
  const [pinFeedback, setPinFeedback] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);

  // Sync local draft state when sheet opens or user updates externally
  useEffect(() => {
    if (!open) return;
    setName(user.name);
    setPhone(user.phone || '');
    setCity(user.city || '');
    setOccupation(user.occupation || '');
    setDateOfBirth(user.dateOfBirth || '');
    setUpiId(user.upiId || '');
    setBio(user.bio || '');
    setRiskProfile(user.riskProfile);
    setTaxRegime(user.taxRegime || 'NEW');
    setInvestmentHorizon(user.investmentHorizon || 'LONG_TERM');
    setIncomeBracket(user.incomeBracket || '10L_25L');
    setTargetMonthlySipInr(user.targetMonthlySipInr ? String(user.targetMonthlySipInr) : '');
    setSaveMessage(null);
    setSaveError(null);
    setPinFeedback(null);
    setPinError(null);
    setAvatarBroken(false);
  }, [open, user]);

  const handleSaveProfileOrInvestor = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const parsedSip = targetMonthlySipInr.trim() ? Number(targetMonthlySipInr) : 0;
      const payload = {
        name: name.trim(),
        phone: phone.trim(),
        city: city.trim(),
        occupation: occupation.trim(),
        dateOfBirth: dateOfBirth.trim(),
        upiId: upiId.trim(),
        bio: bio.trim(),
        riskProfile,
        taxRegime,
        investmentHorizon,
        incomeBracket,
        targetMonthlySipInr: Number.isFinite(parsedSip) ? parsedSip : 0,
      };

      const res = await apiFetch<{ user: UserProfile }>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      onUserUpdated(res.user);

      void syncUserAccountToFirestore({
        email: res.user.email,
        displayName: res.user.name,
        avatarUrl: res.user.avatarUrl,
        upstoxConnected,
        upiId: payload.upiId,
        phone: payload.phone,
        city: payload.city,
        occupation: payload.occupation,
        dateOfBirth: payload.dateOfBirth,
        bio: payload.bio,
        riskProfile: payload.riskProfile,
        taxRegime: payload.taxRegime,
        investmentHorizon: payload.investmentHorizon,
        incomeBracket: payload.incomeBracket,
        targetMonthlySipInr: payload.targetMonthlySipInr,
      }).catch(() => {});

      setSaveMessage('Profile details saved & synced.');
    } catch (err) {
      setSaveError((err as Error).message || 'Could not save profile details.');
    } finally {
      setSaving(false);
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinSaving(true);
    setPinFeedback(null);
    setPinError(null);

    try {
      if (!user.hasPin) {
        const res = await apiFetch<{ user: UserProfile }>('/api/auth/set-pin', {
          method: 'POST',
          body: JSON.stringify({ pin: newPin }),
        });
        onUserUpdated(res.user);
        setPinFeedback('4-digit security PIN created.');
      } else {
        await apiFetch('/api/auth/update-pin', {
          method: 'POST',
          body: JSON.stringify({ currentPin, newPin }),
        });
        setPinFeedback('4-digit security PIN updated.');
      }
      setCurrentPin('');
      setNewPin('');
    } catch (err) {
      setPinError((err as Error).message || 'Unable to update PIN.');
    } finally {
      setPinSaving(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Account & Settings"
      subtitle="Personal details, investor profile & security"
      maxWidthClass="lg:max-w-lg"
    >
      <div className="space-y-5">
        {/* Clean Compact Identity Header */}
        <div className="flex items-center gap-3.5 pb-4 border-b border-slate-200/80 dark:border-white/8">
          {!avatarBroken && user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              referrerPolicy="no-referrer"
              onError={() => setAvatarBroken(true)}
              className="w-12 h-12 rounded-2xl object-cover border border-slate-200 dark:border-white/15 shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-2xl bg-[#FFB020]/16 text-[#D97706] dark:text-[#FFB020] font-bold text-base flex items-center justify-center shrink-0">
              {user.name.slice(0, 2).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
              {user.name}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {[
                user.email,
                user.authProvider === 'GOOGLE' ? 'Google Account' : 'Email Account',
                user.city || null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>

        {/* Clean 3-Section Switcher */}
        <MaterialSegmentedTabs
          layoutGroupId="settingsSheetTabs"
          activeId={section}
          onChange={(next) => {
            setSection(next);
            setSaveMessage(null);
            setSaveError(null);
          }}
          items={[
            { id: 'PROFILE', label: 'Profile' },
            { id: 'INVESTOR', label: 'Investor Setup' },
            { id: 'SECURITY', label: 'Security' },
          ]}
        />

        <AnimatePresence mode="wait">
          {section === 'PROFILE' && (
            <motion.form
              key="settings_profile"
              onSubmit={handleSaveProfileOrInvestor}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: MATERIAL_EASE }}
              className="space-y-3.5"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Himanshu Mishra"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    maxLength={24}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm tabular-nums text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    City / State
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Bengaluru, Karnataka"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Occupation / Role
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={occupation}
                    onChange={(e) => setOccupation(e.target.value)}
                    placeholder="Software Engineer"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm tabular-nums text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Default UPI ID (VPA)
                  </label>
                  <input
                    type="text"
                    maxLength={100}
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    placeholder="name@okhdfcbank"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Wealth Goal / Bio
                  </label>
                  <span className="text-[11px] tabular-nums text-slate-400">
                    {bio.length}/240
                  </span>
                </div>
                <textarea
                  rows={2}
                  maxLength={240}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Long-term NSE core compounding + automated monthly Nifty & Gold SIPs"
                  className="w-full p-3 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020] resize-none"
                />
              </div>

              {saveError && (
                <p className="text-xs text-[#E11D48] dark:text-[#FF4D6D]" role="alert">
                  {saveError}
                </p>
              )}
              {saveMessage && (
                <p className="text-xs font-medium text-[#D97706] dark:text-[#FFB020] flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{saveMessage}</span>
                </p>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full min-h-[44px] rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] font-semibold text-sm transition-all disabled:opacity-60 shadow-sm"
              >
                {saving ? 'Saving Profile...' : 'Save Personal Details'}
              </button>
            </motion.form>
          )}

          {section === 'INVESTOR' && (
            <motion.form
              key="settings_investor"
              onSubmit={handleSaveProfileOrInvestor}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: MATERIAL_EASE }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Risk Appetite
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl m3-tonal-box">
                  {(
                    [
                      { id: 'CONSERVATIVE', label: 'Conservative' },
                      { id: 'BALANCED', label: 'Balanced' },
                      { id: 'AGGRESSIVE', label: 'Aggressive' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setRiskProfile(opt.id)}
                      className={`min-h-[38px] rounded-xl text-xs font-semibold transition-colors ${
                        riskProfile === opt.id
                          ? 'bg-[#FFB020] text-[#1C1000]'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    FY26 Tax Regime
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl m3-tonal-box">
                    {(
                      [
                        { id: 'NEW', label: 'New Regime' },
                        { id: 'OLD', label: 'Old Regime' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setTaxRegime(opt.id)}
                        className={`min-h-[38px] rounded-xl text-xs font-semibold transition-colors ${
                          taxRegime === opt.id
                            ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                    Investment Horizon
                  </label>
                  <select
                    value={investmentHorizon}
                    onChange={(e) =>
                      setInvestmentHorizon(
                        e.target.value as NonNullable<UserProfile['investmentHorizon']>
                      )
                    }
                    className="w-full min-h-[46px] px-3 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                  >
                    <option value="SHORT_TERM">Short Term (&lt; 2 Years)</option>
                    <option value="MEDIUM_TERM">Medium Term (2 – 5 Years)</option>
                    <option value="LONG_TERM">Long Term (5+ Years)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Annual Income Bracket
                  </label>
                  <select
                    value={incomeBracket}
                    onChange={(e) =>
                      setIncomeBracket(
                        e.target.value as NonNullable<UserProfile['incomeBracket']>
                      )
                    }
                    className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                  >
                    <option value="BELOW_10L">Below ₹10 Lakhs</option>
                    <option value="10L_25L">₹10 Lakhs – ₹25 Lakhs</option>
                    <option value="25L_50L">₹25 Lakhs – ₹50 Lakhs</option>
                    <option value="ABOVE_50L">₹50 Lakhs+</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Target Monthly SIP (₹)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000000}
                    step={500}
                    value={targetMonthlySipInr}
                    onChange={(e) => setTargetMonthlySipInr(e.target.value)}
                    placeholder="25000"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm tabular-nums text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                  />
                </div>
              </div>

              {saveError && (
                <p className="text-xs text-[#E11D48] dark:text-[#FF4D6D]" role="alert">
                  {saveError}
                </p>
              )}
              {saveMessage && (
                <p className="text-xs font-medium text-[#D97706] dark:text-[#FFB020] flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{saveMessage}</span>
                </p>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full min-h-[44px] rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.98] text-[#1C1000] font-semibold text-sm transition-all disabled:opacity-60 shadow-sm"
              >
                {saving ? 'Saving Preferences...' : 'Save Investor Setup'}
              </button>
            </motion.form>
          )}

          {section === 'SECURITY' && (
            <motion.div
              key="settings_security"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: MATERIAL_EASE }}
              className="space-y-4"
            >
              {/* Appearance Toggle Row */}
              <div className="p-3.5 rounded-2xl m3-tonal-box flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-white/80 dark:bg-white/[0.06] flex items-center justify-center shrink-0">
                    {theme === 'dark' ? (
                      <Moon className="w-4 h-4 text-[#FFB020]" />
                    ) : (
                      <Sun className="w-4 h-4 text-[#D97706]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">
                      Appearance
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {theme === 'dark' ? 'Obsidian Dark Mode' : 'Daylight Crisp Mode'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onToggleTheme}
                  className="min-h-[36px] px-3.5 rounded-xl bg-white dark:bg-white/10 border border-slate-200/80 dark:border-white/10 text-xs font-semibold text-slate-800 dark:text-white hover:border-[#FFB020]/50 transition-colors shrink-0"
                >
                  Switch to {theme === 'dark' ? 'Light' : 'Dark'}
                </button>
              </div>

              {/* 4-Digit Transaction & Lock PIN */}
              <form
                onSubmit={handlePinSubmit}
                className="p-4 rounded-2xl m3-tonal-box space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    {user.hasPin ? 'Update 4-Digit Security PIN' : 'Set 4-Digit Security PIN'}
                  </p>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {user.hasPin ? 'Configured' : 'Not set'}
                  </span>
                </div>

                <div className={`grid gap-3 ${user.hasPin ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {user.hasPin && (
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                        Current PIN
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        required
                        value={currentPin}
                        onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="••••"
                        className="w-full min-h-[42px] px-3.5 rounded-xl bg-white dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm tabular-nums tracking-[0.35em] text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      {user.hasPin ? 'New 4-Digit PIN' : 'Create 4-Digit PIN'}
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      required
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="••••"
                      className="w-full min-h-[42px] px-3.5 rounded-xl bg-white dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm tabular-nums tracking-[0.35em] text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                    />
                  </div>
                </div>

                {pinError && (
                  <p className="text-xs text-[#E11D48] dark:text-[#FF4D6D]" role="alert">
                    {pinError}
                  </p>
                )}
                {pinFeedback && (
                  <p className="text-xs font-medium text-[#D97706] dark:text-[#FFB020]">
                    {pinFeedback}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={pinSaving || newPin.length !== 4 || (user.hasPin && currentPin.length !== 4)}
                  className="w-full min-h-[40px] rounded-xl bg-[#FFB020] hover:bg-[#F59E0B] text-[#1C1000] text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {pinSaving ? 'Updating PIN...' : user.hasPin ? 'Update PIN' : 'Save 4-Digit PIN'}
                </button>
              </form>

              {/* Session Controls */}
              <div className="pt-2 border-t border-slate-200/80 dark:border-white/8 flex items-center gap-2.5">
                {user.hasPin && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onLockApp();
                    }}
                    className="flex-1 min-h-[42px] px-3.5 rounded-xl m3-tonal-box text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center justify-center gap-1.5 hover:opacity-90"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Lock App Now</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onLogout();
                  }}
                  className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-[#FF4D6D]/12 hover:bg-[#FF4D6D]/20 text-xs font-semibold text-[#E11D48] dark:text-[#FF4D6D] flex items-center justify-center gap-1.5 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </BottomSheet>
  );
};
