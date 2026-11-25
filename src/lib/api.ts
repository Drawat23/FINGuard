import type { UserProfile } from '../../shared/types.ts';

// Keep auth tokens strictly in JS memory (never localStorage/sessionStorage)
let accessTokenMemory: string | null = null;
let refreshTokenMemory: string | null = null;
let onSessionExpiredCallback: (() => void) | null = null;

export function setAuthTokens(accessToken: string | null, refreshToken: string | null): void {
  accessTokenMemory = accessToken;
  refreshTokenMemory = refreshToken;
}

export function getAccessToken(): string | null {
  return accessTokenMemory;
}

export function setSessionExpiredHandler(cb: () => void): void {
  onSessionExpiredCallback = cb;
}

export function generateIdempotencyKey(prefix = 'fq'): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function tryRefreshTokens(): Promise<boolean> {
  if (!refreshTokenMemory) return false;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshTokenMemory }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
      user?: UserProfile;
    };
    setAuthTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { idempotent?: boolean } = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (accessTokenMemory) {
    headers.set('Authorization', `Bearer ${accessTokenMemory}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.idempotent && !headers.has('Idempotency-Key')) {
    headers.set('Idempotency-Key', generateIdempotencyKey());
  }

  let res = await fetch(path, { ...options, headers });

  if (res.status === 401 && refreshTokenMemory) {
    const refreshed = await tryRefreshTokens();
    if (refreshed && accessTokenMemory) {
      headers.set('Authorization', `Bearer ${accessTokenMemory}`);
      res = await fetch(path, { ...options, headers });
    } else {
      setAuthTokens(null, null);
      onSessionExpiredCallback?.();
    }
  }

  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text || 'Unexpected server response' };
  }

  if (!res.ok) {
    const errMsg = (json as { error?: string })?.error || `Request failed (${res.status})`;
    throw new Error(errMsg);
  }

  return json as T;
}

export function formatInr(amount: number, showDecimals = false): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  });
  return `${amount < 0 ? '-' : ''}₹${formatted}`;
}

export function formatCompactInr(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}
