import { Router, Request, Response } from 'express';
import { prisma } from '../index';

const router = Router();

// Score a match: more specific criteria = higher score
function scoreAction(
  action: { accountId: string | null; senderPattern: string | null; subjectPattern: string | null },
  email: { accountId: string; from: string; subject: string | null },
): number {
  let score = 0;
  const from = (email.from || '').toLowerCase();
  const subject = (email.subject || '').toLowerCase();

  if (action.accountId) {
    if (action.accountId !== email.accountId) return -1;
    score += 10;
  }
  if (action.senderPattern) {
    const p = action.senderPattern.toLowerCase().trim();
    if (!from.includes(p)) return -1;
    score += 5;
  }
  if (action.subjectPattern) {
    const p = action.subjectPattern.toLowerCase().trim();
    if (!subject.includes(p)) return -1;
    score += 3;
  }
  // Action must have at least one criterion to match
  if (!action.accountId && !action.senderPattern && !action.subjectPattern) return -1;
  return score;
}

// GET /api/email-actions - List all
router.get('/', async (_req: Request, res: Response) => {
  try {
    const actions = await prisma.emailAction.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(actions);
  } catch (error) {
    console.error('Error fetching email actions:', error);
    res.status(500).json({ error: 'Failed to fetch email actions' });
  }
});

// POST /api/email-actions - Create
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, accountId, senderPattern, subjectPattern, actionType, actionValue } = req.body;

    if (!name || !actionValue) {
      res.status(400).json({ error: 'name and actionValue are required' });
      return;
    }
    if (!accountId && !senderPattern && !subjectPattern) {
      res.status(400).json({ error: 'At least one of accountId, senderPattern or subjectPattern is required' });
      return;
    }

    const action = await prisma.emailAction.create({
      data: {
        name,
        accountId: accountId || null,
        senderPattern: senderPattern || null,
        subjectPattern: subjectPattern || null,
        actionType: actionType || 'OPEN_URL',
        actionValue,
      },
    });
    res.status(201).json(action);
  } catch (error) {
    console.error('Error creating email action:', error);
    res.status(500).json({ error: 'Failed to create email action' });
  }
});

// PATCH /api/email-actions/:id - Update
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, accountId, senderPattern, subjectPattern, actionType, actionValue } = req.body;

    const existing = await prisma.emailAction.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Action not found' });
      return;
    }

    const data: any = {};
    if (name !== undefined) data.name = name;
    if (accountId !== undefined) data.accountId = accountId || null;
    if (senderPattern !== undefined) data.senderPattern = senderPattern || null;
    if (subjectPattern !== undefined) data.subjectPattern = subjectPattern || null;
    if (actionType !== undefined) data.actionType = actionType;
    if (actionValue !== undefined) data.actionValue = actionValue;

    const updated = await prisma.emailAction.update({ where: { id }, data });
    res.json(updated);
  } catch (error) {
    console.error('Error updating email action:', error);
    res.status(500).json({ error: 'Failed to update email action' });
  }
});

// DELETE /api/email-actions/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.emailAction.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    console.error('Error deleting email action:', error);
    res.status(500).json({ error: 'Failed to delete email action' });
  }
});

// GET /api/email-actions/match/:emailId - Find best matching action for an email
router.get('/match/:emailId', async (req: Request, res: Response) => {
  try {
    const emailId = req.params.emailId as string;
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      select: { id: true, accountId: true, from: true, subject: true },
    });
    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }

    const actions = await prisma.emailAction.findMany();
    let best: typeof actions[0] | null = null;
    let bestScore = -1;
    for (const action of actions) {
      const score = scoreAction(action, email);
      if (score > bestScore) {
        bestScore = score;
        best = action;
      }
    }

    res.json({ action: best, score: bestScore });
  } catch (error) {
    console.error('Error matching email action:', error);
    res.status(500).json({ error: 'Failed to match email action' });
  }
});

export default router;
