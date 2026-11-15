import { Router, Request, Response } from 'express';
import { startSyncJob, getJobStatus, getLatestJob } from '../services/syncJob';

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

export default router;
