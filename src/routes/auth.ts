import { Router, Request, Response } from 'express';
import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import { prisma } from '../index';

const router = Router();

const SCOPES = ['user.read', 'mail.read', 'mail.readwrite', 'offline_access'];

const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID || '',
    authority: 'https://login.microsoftonline.com/common',
    clientSecret: process.env.AZURE_CLIENT_SECRET || '',
  },
};

const msalClient = new ConfidentialClientApplication(msalConfig);
const cryptoProvider = new CryptoProvider();

// Extend express-session types
declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
    pkceCodes?: {
      challengeMethod: string;
      verifier: string;
      challenge: string;
    };
  }
}

// GET /auth/microsoft - Redirect to Microsoft login
router.get('/microsoft', async (req: Request, res: Response) => {
  try {
    const csrfToken = cryptoProvider.createNewGuid();
    const { verifier, challenge } = await cryptoProvider.generatePkceCodes();

    req.session.csrfToken = csrfToken;
    req.session.pkceCodes = {
      challengeMethod: 'S256',
      verifier,
      challenge,
    };

    const authCodeUrl = await msalClient.getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: process.env.REDIRECT_URI || '',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      state: csrfToken,
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

    // Validate CSRF token
    if (state !== req.session.csrfToken) {
      res.status(403).json({ error: 'CSRF token mismatch' });
      return;
    }

    const tokenResponse = await msalClient.acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: process.env.REDIRECT_URI || '',
      codeVerifier: req.session.pkceCodes?.verifier,
    });

    if (!tokenResponse) {
      res.status(500).json({ error: 'Failed to acquire token' });
      return;
    }

    const { accessToken, account, expiresOn } = tokenResponse;
    const refreshToken = (tokenResponse as any).refreshToken || null;

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

    // Clean session
    delete req.session.csrfToken;
    delete req.session.pkceCodes;

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
