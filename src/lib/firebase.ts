import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export interface GooglePopupResult {
  idToken: string;
  email: string;
  displayName: string;
  photoURL?: string;
}

export async function signInWithGooglePopup(): Promise<GooglePopupResult> {
  try {
    const credential = await signInWithPopup(auth, googleProvider);
    const idToken = await credential.user.getIdToken(true);
    return {
      idToken,
      email: credential.user.email || '',
      displayName: credential.user.displayName || 'Investor',
      photoURL: credential.user.photoURL || undefined,
    };
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Google sign-in was cancelled. Please try again.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error('Popup was blocked by your browser. Allow popups and try again.');
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error('This domain is not authorized in Firebase Auth settings.');
    }
    throw new Error((err as Error).message || 'Google sign-in failed.');
  }
}

export async function firebaseSignOut(): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // Non-fatal on logout
  }
}

function sanitizeDocId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || 'item';
}

let syncAccountTail: Promise<void> = Promise.resolve();

export interface ExtendedPrivateProfileInput {
  email: string;
  displayName: string;
  avatarUrl?: string;
  upstoxConnected?: boolean;
  upiId?: string;
  phone?: string;
  city?: string;
  occupation?: string;
  dateOfBirth?: string;
  bio?: string;
  riskProfile?: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  taxRegime?: 'NEW' | 'OLD';
  investmentHorizon?: 'SHORT_TERM' | 'MEDIUM_TERM' | 'LONG_TERM';
  incomeBracket?: 'BELOW_10L' | '10L_25L' | '25L_50L' | 'ABOVE_50L';
  targetMonthlySipInr?: number;
}

export function syncUserAccountToFirestore(params: ExtendedPrivateProfileInput): Promise<void> {
  const run = syncAccountTail.then(() => performSyncUserAccountToFirestore(params));
  syncAccountTail = run.catch(() => {});
  return run;
}

async function performSyncUserAccountToFirestore(
  params: ExtendedPrivateProfileInput
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;
  const uid = currentUser.uid;
  const rootPath = `users/${uid}`;
  const privatePath = `users/${uid}/private/info`;

  try {
    const rootRef = doc(db, 'users', uid);
    const existingRoot = await getDocFromServer(rootRef);
    const existingData = existingRoot.exists() ? existingRoot.data() : null;
    const hasValidSchema =
      Boolean(existingData) &&
      existingData?.ownerId === uid &&
      existingData?.createdAt != null &&
      (existingData?.tier === 'STANDARD' || existingData?.tier === 'PRO') &&
      typeof existingData?.upstoxConnected === 'boolean';

    if (!existingRoot.exists() || !hasValidSchema) {
      await setDoc(rootRef, {
        ownerId: uid,
        tier: existingData?.tier === 'PRO' ? 'PRO' : 'STANDARD',
        upstoxConnected: Boolean(params.upstoxConnected),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (
      typeof params.upstoxConnected === 'boolean' &&
      existingData?.upstoxConnected !== params.upstoxConnected
    ) {
      await updateDoc(rootRef, {
        upstoxConnected: params.upstoxConnected,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, rootPath);
  }

  try {
    const privateRef = doc(db, 'users', uid, 'private', 'info');
    const existingPrivate = await getDocFromServer(privateRef);
    const existingPii = existingPrivate.exists() ? existingPrivate.data() : null;
    const nextEmail = (params.email || currentUser.email || '').trim().slice(0, 254);
    const nextDisplayName = (params.displayName || currentUser.displayName || 'Investor')
      .trim()
      .slice(0, 100);
    const nextAvatarUrl = (params.avatarUrl || currentUser.photoURL || '').trim().slice(0, 512);

    if (!nextEmail || nextEmail.length < 3 || !nextDisplayName) return;

    const optionalFields: Record<string, unknown> = {};
    if (params.upiId !== undefined) optionalFields.upiId = params.upiId.trim().slice(0, 100);
    if (params.phone !== undefined) optionalFields.phone = params.phone.trim().slice(0, 24);
    if (params.city !== undefined) optionalFields.city = params.city.trim().slice(0, 80);
    if (params.occupation !== undefined) optionalFields.occupation = params.occupation.trim().slice(0, 80);
    if (params.dateOfBirth !== undefined) optionalFields.dateOfBirth = params.dateOfBirth.trim().slice(0, 16);
    if (params.bio !== undefined) optionalFields.bio = params.bio.trim().slice(0, 240);
    if (params.riskProfile !== undefined) optionalFields.riskProfile = params.riskProfile;
    if (params.taxRegime !== undefined) optionalFields.taxRegime = params.taxRegime;
    if (params.investmentHorizon !== undefined) optionalFields.investmentHorizon = params.investmentHorizon;
    if (params.incomeBracket !== undefined) optionalFields.incomeBracket = params.incomeBracket;
    if (
      params.targetMonthlySipInr !== undefined &&
      Number.isFinite(params.targetMonthlySipInr)
    ) {
      optionalFields.targetMonthlySipInr = Math.max(
        0,
        Math.min(10000000, Math.round(params.targetMonthlySipInr))
      );
    }

    const hasValidPiiSchema =
      Boolean(existingPii) &&
      existingPii?.ownerId === uid &&
      existingPii?.createdAt != null &&
      typeof existingPii?.email === 'string';

    if (!existingPrivate.exists() || !hasValidPiiSchema) {
      const createPayload: Record<string, unknown> = {
        ownerId: uid,
        email: nextEmail,
        displayName: nextDisplayName,
        ...optionalFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (nextAvatarUrl) {
        createPayload.avatarUrl = nextAvatarUrl;
      }
      await setDoc(privateRef, createPayload);
    } else {
      const updatePayload: Record<string, unknown> = {};
      if (existingPii?.displayName !== nextDisplayName) {
        updatePayload.displayName = nextDisplayName;
      }
      if (nextAvatarUrl && existingPii?.avatarUrl !== nextAvatarUrl) {
        updatePayload.avatarUrl = nextAvatarUrl;
      }
      for (const [k, v] of Object.entries(optionalFields)) {
        if (existingPii?.[k] !== v) {
          updatePayload[k] = v;
        }
      }
      if (Object.keys(updatePayload).length > 0) {
        updatePayload.updatedAt = serverTimestamp();
        await updateDoc(privateRef, updatePayload);
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, privatePath);
  }
}

export async function fetchUserPrivateProfileFromFirestore(): Promise<
  Partial<ExtendedPrivateProfileInput> | null
> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return null;
  const uid = currentUser.uid;
  const privatePath = `users/${uid}/private/info`;
  try {
    const snap = await getDocFromServer(doc(db, 'users', uid, 'private', 'info'));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      displayName: typeof d.displayName === 'string' ? d.displayName : undefined,
      avatarUrl: typeof d.avatarUrl === 'string' ? d.avatarUrl : undefined,
      upiId: typeof d.upiId === 'string' ? d.upiId : undefined,
      phone: typeof d.phone === 'string' ? d.phone : undefined,
      city: typeof d.city === 'string' ? d.city : undefined,
      occupation: typeof d.occupation === 'string' ? d.occupation : undefined,
      dateOfBirth: typeof d.dateOfBirth === 'string' ? d.dateOfBirth : undefined,
      bio: typeof d.bio === 'string' ? d.bio : undefined,
      riskProfile: d.riskProfile,
      taxRegime: d.taxRegime,
      investmentHorizon: d.investmentHorizon,
      incomeBracket: d.incomeBracket,
      targetMonthlySipInr: typeof d.targetMonthlySipInr === 'number' ? d.targetMonthlySipInr : undefined,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, privatePath);
  }
}

export async function syncTradeLotToFirestore(trade: {
  id: string;
  symbol: string;
  name: string;
  assetType: 'STOCK_NSE' | 'ETF' | 'MUTUAL_FUND';
  side: 'BUY' | 'SELL';
  quantity: number;
  priceInr: number;
  tradeDate: string;
  source: 'MANUAL' | 'CSV_IMPORT' | 'UPSTOX_LIVE';
  brokerOrderId?: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;
  const uid = currentUser.uid;
  const safeId = sanitizeDocId(trade.id);
  const path = `users/${uid}/trades/${safeId}`;

  const mappedType =
    trade.assetType === 'MUTUAL_FUND' ? 'MF' : trade.assetType === 'ETF' ? 'ETF' : 'EQUITY';
  const safeSymbol = trade.symbol.toUpperCase().replace(/[^A-Z0-9_.\-&]/g, '').slice(0, 32) || 'NSE';
  const safeQty = Math.max(0.0001, Math.min(100000000, Number(trade.quantity)));
  const safePrice = Math.max(0.01, Math.min(100000000, Number(trade.priceInr)));
  const safeDate = trade.tradeDate.slice(0, 32);

  try {
    const tradeRef = doc(db, 'users', uid, 'trades', safeId);
    const existingTrade = await getDocFromServer(tradeRef);
    if (!existingTrade.exists()) {
      const payload: Record<string, unknown> = {
        ownerId: uid,
        symbol: safeSymbol,
        name: (trade.name || safeSymbol).slice(0, 120),
        assetType: mappedType,
        side: trade.side,
        quantity: safeQty,
        priceInr: safePrice,
        tradeDate: safeDate,
        source: trade.source,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (trade.brokerOrderId) {
        payload.brokerOrderId = trade.brokerOrderId.slice(0, 64);
      }
      await setDoc(tradeRef, payload);
    } else {
      await updateDoc(tradeRef, {
        quantity: safeQty,
        priceInr: safePrice,
        tradeDate: safeDate,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteTradeLotFromFirestore(tradeId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;
  const uid = currentUser.uid;
  const safeId = sanitizeDocId(tradeId);
  const path = `users/${uid}/trades/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'trades', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncStrategyToFirestore(strategy: {
  id: string;
  name: string;
  promptText: string;
  signalType: string;
  universe: string[];
  rebalanceFrequency: 'WEEKLY' | 'MONTHLY';
  vixHedgeEnabled: boolean;
  hedgeAsset: string;
  cagrPct: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;
  const uid = currentUser.uid;
  const safeId = sanitizeDocId(strategy.id);
  const path = `users/${uid}/strategies/${safeId}`;

  const signalMap: Record<string, string> = {
    MOMENTUM: 'MOMENTUM',
    MEAN_REVERSION: 'MEAN_REVERSION',
    SMA_CROSSOVER: 'DUAL_MA',
    EMA_CROSSOVER: 'DUAL_MA',
    EQUAL_WEIGHT: 'MULTI_FACTOR',
  };

  try {
    const stratRef = doc(db, 'users', uid, 'strategies', safeId);
    const existingStrat = await getDocFromServer(stratRef);
    if (!existingStrat.exists()) {
      await setDoc(stratRef, {
        ownerId: uid,
        name: strategy.name.slice(0, 100),
        promptText: (strategy.promptText || strategy.name).slice(0, 500),
        signalType: signalMap[strategy.signalType] || 'MOMENTUM',
        universe: strategy.universe.slice(0, 15).map((s) => s.slice(0, 32)),
        rebalanceFrequency: strategy.rebalanceFrequency,
        vixHedgeEnabled: Boolean(strategy.vixHedgeEnabled),
        hedgeAsset: strategy.hedgeAsset.slice(0, 32),
        cagrPct: Number(strategy.cagrPct),
        sharpeRatio: Number(strategy.sharpeRatio),
        maxDrawdownPct: Number(strategy.maxDrawdownPct),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(stratRef, {
        name: strategy.name.slice(0, 100),
        cagrPct: Number(strategy.cagrPct),
        sharpeRatio: Number(strategy.sharpeRatio),
        maxDrawdownPct: Number(strategy.maxDrawdownPct),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function listUserTradesFromFirestore(): Promise<Array<Record<string, unknown>>> {
  const currentUser = auth.currentUser;
  if (!currentUser) return [];
  const uid = currentUser.uid;
  const path = `users/${uid}/trades`;
  try {
    const q = query(collection(db, 'users', uid, 'trades'), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}
