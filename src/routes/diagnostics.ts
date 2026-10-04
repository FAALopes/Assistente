import { Router, Request, Response } from 'express';
import { prisma } from '../index';

const router = Router();

// GET /api/diagnostics/triage-stats - Show triage cache state per account+folder
router.get('/triage-stats', async (_req: Request, res: Response) => {
  try {
    const accounts = await prisma.emailAccount.findMany({
      select: { id: true, email: true },
    });

    const byAccount: any[] = [];
    for (const acc of accounts) {
      const total = await prisma.email.count({
        where: { accountId: acc.id, folder: 'junkemail' },
      });
      const uncached = await prisma.email.count({
        where: { accountId: acc.id, folder: 'junkemail', triageAction: null },
      });
      const failed = await prisma.email.count({
        where: { accountId: acc.id, folder: 'junkemail', triageConfidence: 0 },
      });
      const deleteHigh = await prisma.email.count({
        where: {
          accountId: acc.id,
          folder: 'junkemail',
          triageAction: 'DELETE',
          triageConfidence: { gte: 85 },
        },
      });
      const deleteLow = await prisma.email.count({
        where: {
          accountId: acc.id,
          folder: 'junkemail',
          triageAction: 'DELETE',
          triageConfidence: { lt: 85, gt: 0 },
        },
      });
      const review = await prisma.email.count({
        where: { accountId: acc.id, folder: 'junkemail', triageAction: 'REVIEW' },
      });
      const moveInbox = await prisma.email.count({
        where: { accountId: acc.id, folder: 'junkemail', triageAction: 'MOVE_TO_INBOX' },
      });

      byAccount.push({
        accountId: acc.id,
        email: acc.email,
        total,
        uncached,
        failed,
        deleteHigh,
        deleteLow,
        review,
        moveInbox,
      });
    }

    res.json({ byAccount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/diagnostics/last-cleanup-activity - Show when classifications happened
router.get('/last-cleanup-activity', async (_req: Request, res: Response) => {
  try {
    const accounts = await prisma.emailAccount.findMany({
      select: { id: true, email: true },
    });
    const activity: any[] = [];
    for (const acc of accounts) {
      const last = await prisma.email.findFirst({
        where: { accountId: acc.id, triageClassifiedAt: { not: null } },
        orderBy: { triageClassifiedAt: 'desc' },
        select: { triageClassifiedAt: true, from: true, subject: true, triageAction: true, triageConfidence: true },
      });
      const classifiedLastHour = await prisma.email.count({
        where: {
          accountId: acc.id,
          triageClassifiedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        },
      });
      const classifiedLast24h = await prisma.email.count({
        where: {
          accountId: acc.id,
          triageClassifiedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      });
      activity.push({
        email: acc.email,
        lastClassifiedAt: last?.triageClassifiedAt,
        lastEmailSubject: last?.subject,
        lastEmailAction: last?.triageAction,
        lastEmailConfidence: last?.triageConfidence,
        classifiedLastHour,
        classifiedLast24h,
      });
    }
    res.json({ nowUtc: new Date().toISOString(), activity });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/diagnostics/anthropic-test - Direct test of Anthropic API
router.get('/anthropic-test', async (_req: Request, res: Response) => {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const keyPrefix = process.env.ANTHROPIC_API_KEY?.substring(0, 12) || null;

  if (!hasKey) {
    res.json({ hasKey: false, error: 'ANTHROPIC_API_KEY not set in environment' });
    return;
  }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say "OK" only.' }],
    });
    const text = response.content[0]?.type === 'text' ? response.content[0].text : 'no text';
    res.json({ hasKey: true, keyPrefix, success: true, response: text });
  } catch (error: any) {
    res.json({
      hasKey: true,
      keyPrefix,
      success: false,
      errorMessage: error?.message,
      errorStatus: error?.status,
      errorType: error?.error?.type,
      errorBody: error?.error,
    });
  }
});

// GET /api/diagnostics/overrides?q=SEARCH - List triage overrides (learned preferences)
router.get('/overrides', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || '').toLowerCase();
    const overrides = await prisma.triageOverride.findMany({
      orderBy: [{ occurrences: 'desc' }, { updatedAt: 'desc' }],
    });
    const filtered = q
      ? overrides.filter(o =>
          o.senderAddress.toLowerCase().includes(q) ||
          o.senderDomain.toLowerCase().includes(q))
      : overrides;
    res.json({ total: overrides.length, matched: filtered.length, overrides: filtered });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/diagnostics/reset-failed-triage - One-shot: reset emails stuck with confidence=0
router.post('/reset-failed-triage', async (_req: Request, res: Response) => {
  try {
    const result = await prisma.email.updateMany({
      where: { triageConfidence: 0 },
      data: {
        triageAction: null,
        triageReason: null,
        triageConfidence: null,
        triageClassifiedAt: null,
      },
    });
    res.json({ reset: result.count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/diagnostics/reset-all-junk-triage - One-shot: reset ALL junk classifications for re-run
router.post('/reset-all-junk-triage', async (_req: Request, res: Response) => {
  try {
    const result = await prisma.email.updateMany({
      where: { folder: 'junkemail' },
      data: {
        triageAction: null,
        triageReason: null,
        triageConfidence: null,
        triageClassifiedAt: null,
      },
    });
    res.json({ reset: result.count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/diagnostics/find-emails?q=SEARCH - Find emails by sender/subject substring
router.get('/find-emails', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q) {
      res.status(400).json({ error: 'q param required' });
      return;
    }
    const emails = await prisma.email.findMany({
      where: {
        OR: [
          { from: { contains: q, mode: 'insensitive' } },
          { subject: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { receivedAt: 'desc' },
      take: 100,
      select: {
        id: true, from: true, subject: true, folder: true,
        receivedAt: true, triageAction: true, triageConfidence: true, triageReason: true,
      },
    });
    // Group by folder
    const byFolder: Record<string, number> = {};
    for (const e of emails) byFolder[e.folder] = (byFolder[e.folder] || 0) + 1;
    res.json({ total: emails.length, byFolder, emails });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/diagnostics/env-check - Verify env vars are set (does not reveal secrets)
router.get('/env-check', async (_req: Request, res: Response) => {
  res.json({
    AZURE_CLIENT_ID: !!process.env.AZURE_CLIENT_ID,
    AZURE_CLIENT_ID_len: process.env.AZURE_CLIENT_ID?.length || 0,
    AZURE_CLIENT_ID_prefix: process.env.AZURE_CLIENT_ID?.substring(0, 8) || null,
    AZURE_CLIENT_SECRET: !!process.env.AZURE_CLIENT_SECRET,
    AZURE_CLIENT_SECRET_len: process.env.AZURE_CLIENT_SECRET?.length || 0,
    AZURE_CLIENT_SECRET_prefix: process.env.AZURE_CLIENT_SECRET?.substring(0, 4) || null,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    DATABASE_URL: !!process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  });
});

// GET /api/diagnostics/token-state - Show current token state per account
router.get('/token-state', async (_req: Request, res: Response) => {
  try {
    const accounts = await prisma.emailAccount.findMany({
      select: {
        id: true, email: true, provider: true,
        tokenExpiry: true, updatedAt: true, createdAt: true,
        accessToken: true, refreshToken: true,
      },
    });
    const now = new Date();
    const info = accounts.map(a => ({
      id: a.id,
      email: a.email,
      provider: a.provider,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      tokenExpiry: a.tokenExpiry,
      expired: a.tokenExpiry ? new Date(a.tokenExpiry) < now : null,
      minutesSinceUpdated: Math.round((now.getTime() - new Date(a.updatedAt).getTime()) / 60000),
      hasAccessToken: !!a.accessToken,
      accessTokenLen: a.accessToken?.length || 0,
      hasRefreshToken: !!a.refreshToken,
      refreshTokenLen: a.refreshToken?.length || 0,
    }));
    res.json({ nowUtc: now.toISOString(), accounts: info });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/diagnostics/try-refresh/:accountId - Attempt token refresh and return raw MSAL error
router.post('/try-refresh/:accountId', async (req: Request, res: Response) => {
  try {
    const accountId = req.params.accountId as string;
    const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    if (!account.refreshToken) {
      res.json({ success: false, reason: 'No refresh token stored for this account' });
      return;
    }

    // Read secret from DB (preferred) with env fallback — same path as real sync
    const config = await prisma.appConfig.findUnique({ where: { id: 'singleton' } });
    const clientSecret = config?.azureClientSecret || process.env.AZURE_CLIENT_SECRET || '';
    const secretSource = config?.azureClientSecret ? 'database' : 'environment';
    const hasAzureId = !!process.env.AZURE_CLIENT_ID;
    const hasAzureSecret = !!clientSecret;
    const azureIdPrefix = process.env.AZURE_CLIENT_ID?.substring(0, 8);

    const { ConfidentialClientApplication } = await import('@azure/msal-node');
    const msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.AZURE_CLIENT_ID || '',
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
        env: { hasAzureId, hasAzureSecret, azureIdPrefix, secretSource },
        hasResult: !!result,
        gotAccessToken: !!result?.accessToken,
        expiresOn: result?.expiresOn,
      });
    } catch (error: any) {
      res.json({
        success: false,
        env: { hasAzureId, hasAzureSecret, azureIdPrefix, secretSource },
        errorMessage: error?.message,
        errorName: error?.name,
        errorCode: error?.errorCode,
        subError: error?.subError,
        correlationId: error?.correlationId,
        statusCode: error?.statusCode,
        responseBody: error?.responseBody,
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

export default router;
