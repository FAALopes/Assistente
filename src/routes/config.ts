import { Router, Request, Response } from 'express';
import { prisma } from '../index';

const router = Router();

function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 8) return '••••••••';
  return `${secret.substring(0, 4)}••••••••${secret.substring(secret.length - 2)}`;
}

// GET /api/config - Return current config (secret masked)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const config = await prisma.appConfig.findUnique({ where: { id: 'singleton' } });
    const dbSecret = config?.azureClientSecret || null;
    const envSecret = process.env.AZURE_CLIENT_SECRET || null;
    const activeSecret = dbSecret || envSecret;
    res.json({
      azureClientId: process.env.AZURE_CLIENT_ID || null,
      azureClientSecretSource: dbSecret ? 'database' : (envSecret ? 'environment' : 'none'),
      azureClientSecretMasked: maskSecret(activeSecret),
      azureClientSecretUpdatedAt: config?.azureClientSecretUpdatedAt || null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/config - Update config (currently only azureClientSecret)
router.patch('/', async (req: Request, res: Response) => {
  try {
    const { azureClientSecret } = req.body;
    if (typeof azureClientSecret !== 'string' || azureClientSecret.trim().length < 8) {
      res.status(400).json({ error: 'azureClientSecret must be a string with at least 8 characters' });
      return;
    }
    const trimmed = azureClientSecret.trim();
    await prisma.appConfig.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        azureClientSecret: trimmed,
        azureClientSecretUpdatedAt: new Date(),
      },
      update: {
        azureClientSecret: trimmed,
        azureClientSecretUpdatedAt: new Date(),
      },
    });
    res.json({ success: true, azureClientSecretMasked: maskSecret(trimmed) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/config/test-azure - Try refresh any Microsoft account to validate current secret
router.post('/test-azure', async (_req: Request, res: Response) => {
  try {
    const account = await prisma.emailAccount.findFirst({
      where: { provider: 'MICROSOFT', refreshToken: { not: null } },
    });
    if (!account || !account.refreshToken) {
      res.json({ success: false, reason: 'No Microsoft account with refresh token found' });
      return;
    }

    const config = await prisma.appConfig.findUnique({ where: { id: 'singleton' } });
    const clientSecret = config?.azureClientSecret || process.env.AZURE_CLIENT_SECRET || '';
    const clientId = process.env.AZURE_CLIENT_ID || '';

    const { ConfidentialClientApplication } = await import('@azure/msal-node');
    const msalClient = new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: 'https://login.microsoftonline.com/common',
      },
    });

    try {
      const result = await msalClient.acquireTokenByRefreshToken({
        refreshToken: account.refreshToken,
        scopes: ['user.read', 'mail.read', 'mail.readwrite', 'offline_access'],
      });
      res.json({
        success: true,
        testedAccount: account.email,
        gotAccessToken: !!result?.accessToken,
        expiresOn: result?.expiresOn,
      });
    } catch (error: any) {
      res.json({
        success: false,
        testedAccount: account.email,
        errorMessage: error?.message,
        errorCode: error?.errorCode,
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
