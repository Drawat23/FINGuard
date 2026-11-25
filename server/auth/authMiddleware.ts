import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';
import { db } from '../db/store.ts';

const JWT_SECRET_KEY = crypto
  .createHash('sha256')
  .update(process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'))
  .digest();

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

function getFirebaseProjectId(): string {
  const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (!fs.existsSync(cfgPath)) {
    throw new Error('Firebase configuration file is missing on server.');
  }
  const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as { projectId?: string };
  if (!parsed.projectId || parsed.projectId === 'remixed-project-id') {
    throw new Error('Firebase projectId is not configured.');
  }
  return parsed.projectId;
}

export async function verifyFirebaseGoogleIdToken(idToken: string): Promise<{
  uid: string;
  email: string;
  name: string;
  picture?: string;
}> {
  const projectId = getFirebaseProjectId();
  const { payload } = await jwtVerify(idToken, FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const emailVerified = payload.email_verified === true;
  if (!sub || !email || !emailVerified) {
    throw new Error('Google account email is missing or unverified.');
  }

  const name =
    typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : email.split('@')[0];
  const picture = typeof payload.picture === 'string' ? payload.picture : undefined;

  return { uid: sub, email, name, picture };
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function issueTokenPair(userId: string, email: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}> {
  const accessToken = await new SignJWT({ sub: userId, email, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(JWT_SECRET_KEY);

  const refreshToken = await new SignJWT({
    sub: userId,
    email,
    typ: 'refresh',
    jti: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL_SEC}s`)
    .sign(JWT_SECRET_KEY);

  await db.saveRefreshToken({
    id: `rt_${crypto.randomUUID().slice(0, 10)}`,
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000).toISOString(),
    revoked: false,
  });

  return { accessToken, refreshToken, expiresInSec: ACCESS_TTL_SEC };
}

export async function verifyRefreshJwt(token: string): Promise<{ userId: string; email: string }> {
  const { payload } = await jwtVerify(token, JWT_SECRET_KEY);
  if (payload.typ !== 'refresh' || typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new Error('Invalid refresh token');
  }
  const stored = db.findRefreshToken(hashToken(token));
  if (!stored || new Date(stored.expiresAt).getTime() < Date.now()) {
    throw new Error('Refresh token revoked or expired');
  }
  return { userId: payload.sub, email: payload.email };
}

export async function signOAuthStateToken(userId: string, provider: string): Promise<string> {
  return new SignJWT({ sub: userId, provider, typ: 'oauth_state' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(JWT_SECRET_KEY);
}

export async function verifyOAuthStateToken(
  token: string,
  expectedProvider: string
): Promise<{ userId: string }> {
  const { payload } = await jwtVerify(token, JWT_SECRET_KEY);
  if (
    payload.typ !== 'oauth_state' ||
    payload.provider !== expectedProvider ||
    typeof payload.sub !== 'string'
  ) {
    throw new Error('Invalid or expired OAuth state');
  }
  return { userId: payload.sub };
}

export async function verifyAccessTokenString(token?: string | null): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_KEY);
    if (payload.typ !== 'access' || typeof payload.sub !== 'string') {
      return null;
    }
    const user = db.findUserById(payload.sub);
    return user ? user.id : null;
  } catch {
    return null;
  }
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const token = header.slice(7).trim();
  const userId = await verifyAccessTokenString(token);
  if (!userId) {
    res.status(401).json({ error: 'Session expired or invalid token' });
    return;
  }
  const user = db.findUserById(userId);
  if (!user) {
    res.status(401).json({ error: 'User account not found' });
    return;
  }
  req.userId = user.id;
  req.userEmail = user.email;
  next();
}

export function requireIdempotencyKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const key = req.header('Idempotency-Key')?.trim();
  if (!key || key.length < 8) {
    res.status(400).json({ error: 'Missing or invalid Idempotency-Key header' });
    return;
  }
  const userId = req.userId || 'anon';
  const existing = db.findIdempotency(key, userId, req.originalUrl);
  if (existing) {
    res.status(existing.statusCode).json(existing.responseJson);
    return;
  }
  next();
}
