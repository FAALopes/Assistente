import { Router, Request, Response } from 'express';
import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import crypto from 'crypto';
import { prisma } from '../index';

const router = Router();

const SCOPES = ['user.read', 'mail.read', 'mail.readwrite', 'offline_access'];

// Stateless signed state (no session dependency — survives Railway restarts/multi-instance)
const STATE_SECRET = process.env.SESSION_SECRET || process.env.AZURE_CLIENT_SECRET || 'dev-fallback-change-me';
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function createSignedState(payloadObj: Record<string, string>): string {
  const payload = Buffer.from(JSON.stringify({ ...payloadObj, ts: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySignedState(state: string): Record<string, string> | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const age = Date.now() - (obj.ts || 0);
    if (age < 0 || age > STATE_MAX_AGE_MS) return null;
    return obj;
  } catch {
    return null;
  }
}

// Build MSAL client dynamically so client secret can be rotated via UI (DB → env fallback)
async function getMsalClient(): Promise<ConfidentialClientApplication> {
  let clientSecret = process.env.AZURE_CLIENT_SECRET || '';
  try {
    const config = await prisma.appConfig.findUnique({ where: { id: 'singleton' } });
    if (config?.azureClientSecret) clientSecret = config.azureClientSecret;
  } catch { /* table may not exist yet */ }
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.AZURE_CLIENT_ID || '',
      authority: 'https://login.microsoftonline.com/common',
      clientSecret,
    },
  });
}

const cryptoProvider = new CryptoProvider();


// GET /auth/microsoft - Redirect to Microsoft login
router.get('/microsoft', async (_req: Request, res: Response) => {
  try {
    const nonce = cryptoProvider.createNewGuid();
    const state = createSignedState({ nonce });

    const msalClient = await getMsalClient();
    const authCodeUrl = await msalClient.getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: process.env.REDIRECT_URI || '',
      state,
    });

    res.redirect(authCodeUrl);
  } catch (error) {
    console.error('Error initiating Microsoft auth:', error);
    res.status(500).json({ error: 'Failed to initiate authentication' });
  }
});

// GET /auth/microsoft/callback - Handle OAuth callback
router.get('/microsoft/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Authorization code missing' });
      return;
    }

    // Verify signed state (stateless CSRF — survives server restarts and multi-instance)
    if (typeof state !== 'string' || !verifySignedState(state)) {
      res.status(403).json({ error: 'Invalid or expired state' });
      return;
    }

    const msalClient = await getMsalClient();
    const tokenResponse = await msalClient.acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: process.env.REDIRECT_URI || '',
    });

    if (!tokenResponse) {
      res.status(500).json({ error: 'Failed to acquire token' });
      return;
    }

    const { accessToken, account, expiresOn } = tokenResponse;

    // Extract refresh token from MSAL cache
    let refreshToken: string | null = null;
    try {
      const cacheData = JSON.parse(msalClient.getTokenCache().serialize());
      const refreshTokens = cacheData.RefreshToken || {};
      const refreshTokenEntry = Object.values(refreshTokens)[0] as any;
      if (refreshTokenEntry?.secret) {
        refreshToken = refreshTokenEntry.secret;
      }
    } catch (cacheErr) {
      console.warn('Could not extract refresh token from MSAL cache:', cacheErr);
    }

    // Fetch user profile from Graph
    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile: any = await profileRes.json();

    // Upsert email account
    const existingAccount = await prisma.emailAccount.findFirst({
      where: { email: profile.mail || profile.userPrincipalName },
    });

    if (existingAccount) {
      await prisma.emailAccount.update({
        where: { id: existingAccount.id },
        data: {
          accessToken,
          refreshToken,
          tokenExpiry: expiresOn || null,
          displayName: profile.displayName,
          userId: account?.homeAccountId || null,
        },
      });
    } else {
      await prisma.emailAccount.create({
        data: {
          email: profile.mail || profile.userPrincipalName,
          displayName: profile.displayName,
          provider: 'MICROSOFT',
          accessToken,
          refreshToken: refreshToken || '',
          tokenExpiry: expiresOn || null,
          userId: account?.homeAccountId || null,
        },
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/accounts?connected=true`);
  } catch (error) {
    console.error('Error in Microsoft callback:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/accounts?error=auth_failed`);
  }
});

// GET /auth/accounts - List connected accounts
router.get('/accounts', async (_req: Request, res: Response) => {
  try {
    const accounts = await prisma.emailAccount.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        color: true,
        provider: true,
        createdAt: true,
        _count: { select: { emails: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(accounts);
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// PATCH /auth/accounts/:id - Update account displayName or color
router.patch('/accounts/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { displayName, color } = req.body;

    const account = await prisma.emailAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const data: { displayName?: string | null; color?: string | null } = {};
    if (displayName !== undefined) {
      const trimmed = typeof displayName === 'string' ? displayName.trim() : '';
      data.displayName = trimmed.length > 0 ? trimmed : null;
    }
    if (color !== undefined) {
      data.color = color || null;
    }

    const updated = await prisma.emailAccount.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        displayName: true,
        color: true,
        provider: true,
        createdAt: true,
        _count: { select: { emails: true } },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating account:', error);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// DELETE /auth/accounts/:id - Disconnect account
router.delete('/accounts/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const account = await prisma.emailAccount.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    await prisma.emailAccount.delete({ where: { id } });

    res.json({ message: 'Account disconnected successfully' });
  } catch (error) {
    console.error('Error disconnecting account:', error);
    res.status(500).json({ error: 'Failed to disconnect account' });
  }
});

export default router;
