import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare module 'express-session' {
  interface SessionData {
    user?: { email: string; displayName?: string | null };
  }
}

export function isAuthenticated(req: Request): boolean {
  return Boolean(req.session?.user?.email);
}

// Requires a logged-in session (Microsoft login). 401 otherwise.
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

// Emails allowed to start a session: already-connected accounts, plus ALLOWED_EMAILS (comma-separated).
export function allowedEmailsFromEnv(): string[] {
  return (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
