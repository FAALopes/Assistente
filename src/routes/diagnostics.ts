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

export default router;
