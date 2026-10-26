import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare module 'express-session' {
  interface SessionData {
    user?: { username: string };
  }
}

export function isAuthenticated(req: Request): boolean {
  return Boolean(req.session?.user?.username);
}

// Requires a logged-in session. 401 otherwise.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Authentication required' });
}

function hasValidCronToken(req: Request): boolean {
  const expected = process.env.CRON_TOKEN;
  if (!expected) return false;
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const given = Buffer.from(match[1].trim());
  const exp = Buffer.from(expected);
  return given.length === exp.length && crypto.timingSafeEqual(given, exp);
}

// Session OR shared cron token (Authorization: Bearer <CRON_TOKEN>). 401 otherwise.
export function requireAuthOrCronToken(req: Request, res: Response, next: NextFunction): void {
  if (isAuthenticated(req) || hasValidCronToken(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Authentication required' });
}

// ---- Local user/password login ----
// ADMIN_USER (default "faal") and ADMIN_PASSWORD_HASH in the form "scrypt$<salt hex>$<hash hex>".
// Generate a hash with: node -e "require('./dist/middleware/auth').printPasswordHash('<password>')"

export function hashPassword(password: string, saltHex?: string): string {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function printPasswordHash(password: string): void {
  console.log(hashPassword(password));
}

export function verifyCredentials(username: string, password: string): boolean {
  const expectedUser = process.env.ADMIN_USER || 'faal';
  const stored = process.env.ADMIN_PASSWORD_HASH || '';
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false; // no hash configured → nobody logs in
  const candidate = hashPassword(password, parts[1]);
  const a = Buffer.from(candidate);
  const b = Buffer.from(stored);
  const passOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  const userOk = username.trim().toLowerCase() === expectedUser.toLowerCase();
  return passOk && userOk;
}

// Minimal brute-force protection: 5 failures per IP → 60 s lockout.
const failures = new Map<string, { count: number; until: number }>();
export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip || 'unknown';
  const f = failures.get(key);
  if (f && f.count >= 5 && Date.now() < f.until) {
    res.status(429).json({ error: 'Demasiadas tentativas. Tenta novamente dentro de 1 minuto.' });
    return;
  }
  next();
}
export function recordLoginFailure(req: Request): void {
  const key = req.ip || 'unknown';
  const f = failures.get(key) || { count: 0, until: 0 };
  f.count += 1;
  f.until = Date.now() + 60 * 1000;
  failures.set(key, f);
}
export function clearLoginFailures(req: Request): void {
  failures.delete(req.ip || 'unknown');
}
