import { Router, Request, Response } from 'express';
import { startSyncJob, getJobStatus, getLatestJob, cancelJob } from '../services/syncJob';
import { prisma } from '../index';

const router = Router();

// POST /api/sync/start { accountId? } -> { jobId }
router.post('/start', async (req: Request, res: Response) => {
  try {
    const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId : undefined;
    const jobId = await startSyncJob(accountId);
    res.json({ jobId });
  } catch (e: any) {
    console.error('startSyncJob failed:', e);
    res.status(500).json({ error: e.message || 'Failed to start sync job' });
  }
});

// GET /api/sync/status/:id
router.get('/status/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const job = await getJobStatus(id);
    if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
    res.json(job);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sync/latest -> most recent job (any status)
router.get('/latest', async (_req: Request, res: Response) => {
  try {
    const job = await getLatestJob();
    res.json(job);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sync/cancel/:id
router.post('/cancel/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const ok = await cancelJob(id);
    if (!ok) {
      // Not in memory (worker restarted?) — mark as cancelled in DB anyway
      await prisma.syncJob.updateMany({
        where: { id, status: 'running' },
        data: { status: 'cancelled', finishedAt: new Date() },
      });
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sync/reset-stuck - marks running jobs older than 5 min with no update as 'error'
// (useful when a previous worker restart left orphan 'running' rows)
router.post('/reset-stuck', async (_req: Request, res: Response) => {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const result = await prisma.syncJob.updateMany({
      where: { status: 'running', startedAt: { lt: fiveMinAgo } },
      data: { status: 'error', finishedAt: new Date(), errors: ['Timeout - no updates'] as any },
    });
    res.json({ reset: result.count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
