import { Router, Request, Response } from 'express';
import { EmailCategory, RuleAction } from '@prisma/client';
import { prisma } from '../index';
import { fetchEmails, deleteEmail as graphDeleteEmail, getValidToken } from '../services/graphService';
import { learnFromAction } from '../services/ruleEngine';

const router = Router();

// GET /api/emails - List emails with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      account,
      category,
      search,
      page = '1',
      limit = '50',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (account && typeof account === 'string') {
      where.accountId = account;
    }

    if (category && typeof category === 'string') {
      where.category = category as EmailCategory;
    }

    if (search && typeof search === 'string') {
      where.OR = [
        { from: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
        { bodyPreview: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [emails, total] = await Promise.all([
      prisma.email.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        take: limitNum,
        skip,
        include: {
          account: {
            select: { id: true, email: true, displayName: true },
          },
        },
      }),
      prisma.email.count({ where }),
    ]);

    res.json({
      data: emails,
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error('Error fetching emails:', error);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// GET /api/emails/sync - Sync emails from all accounts
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    const accounts = await prisma.emailAccount.findMany({
      where: { provider: 'MICROSOFT' },
    });

    if (accounts.length === 0) {
      res.json({ message: 'No accounts to sync', synced: 0 });
      return;
    }

    let totalSynced = 0;
    const errors: string[] = [];

    for (const account of accounts) {
      try {
        const accessToken = await getValidToken(account.id);
        const graphEmails = await fetchEmails(accessToken);

        for (const graphEmail of graphEmails) {
          const fromAddress = graphEmail.from?.emailAddress?.address || 'unknown';
          const toAddress = graphEmail.toRecipients?.[0]?.emailAddress?.address || null;

          await prisma.email.upsert({
            where: { externalId: graphEmail.id },
            create: {
              externalId: graphEmail.id,
              accountId: account.id,
              from: fromAddress,
              to: toAddress,
              subject: graphEmail.subject || null,
              bodyPreview: graphEmail.bodyPreview || null,
              receivedAt: graphEmail.receivedDateTime
                ? new Date(graphEmail.receivedDateTime)
                : new Date(),
              isRead: graphEmail.isRead || false,
              importance: graphEmail.importance || null,
              hasAttachments: graphEmail.hasAttachments || false,
            },
            update: {
              isRead: graphEmail.isRead || false,
              importance: graphEmail.importance || null,
            },
          });

          totalSynced++;
        }
      } catch (err: any) {
        const msg = `Failed to sync account ${account.email}: ${err.message}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    res.json({
      message: `Sync complete`,
      synced: totalSynced,
      accounts: accounts.length,
      ...(errors.length > 0 && { errors }),
    });
  } catch (error) {
    console.error('Error syncing emails:', error);
    res.status(500).json({ error: 'Failed to sync emails' });
  }
});

// PATCH /api/emails/:id/category - Update email category
router.patch('/:id/category', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { category } = req.body;

    if (!category || !Object.values(EmailCategory).includes(category)) {
      res.status(400).json({
        error: 'Invalid category',
        validCategories: Object.values(EmailCategory),
      });
      return;
    }

    const email = await prisma.email.findUnique({ where: { id } });
    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }

    const updated = await prisma.email.update({
      where: { id },
      data: {
        category: category as EmailCategory,
        categorySetAt: new Date(),
      },
    });

    // Try to learn from this action
    const actionMap: Record<string, RuleAction> = {
      DELETE: 'DELETE',
      TODO: 'TODO',
      SAVE_LATER: 'SAVE_LATER',
      SAVE_ONEDRIVE: 'SAVE_ONEDRIVE',
    };

    const action = actionMap[category];
    if (action) {
      const newRule = await learnFromAction(email, action);
      if (newRule) {
        res.json({
          email: updated,
          newRule: {
            id: newRule.id,
            message: `Nova regra criada automaticamente: ${action} emails de "${newRule.value}"`,
          },
        });
        return;
      }
    }

    res.json({ email: updated });
  } catch (error) {
    console.error('Error updating email category:', error);
    res.status(500).json({ error: 'Failed to update email category' });
  }
});

// PATCH /api/emails/bulk/category - Bulk update category
router.patch('/bulk/category', async (req: Request, res: Response) => {
  try {
    const { ids, category } = req.body;

    if (!ids || !Array.isArray(ids) || !category) {
      res.status(400).json({ error: 'ids (array) and category are required' });
      return;
    }

    const result = await prisma.email.updateMany({
      where: { id: { in: ids } },
      data: { category },
    });

    res.json({ updated: result.count });
  } catch (error) {
    console.error('Error bulk updating category:', error);
    res.status(500).json({ error: 'Failed to bulk update category' });
  }
});

// POST /api/emails/bulk/delete - Bulk delete emails
router.post('/bulk/delete', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      res.status(400).json({ error: 'ids (array) is required' });
      return;
    }

    const emails = await prisma.email.findMany({
      where: { id: { in: ids } },
      include: { account: true },
    });

    // Try to delete from Graph for each email
    for (const email of emails) {
      try {
        const accessToken = await getValidToken(email.accountId);
        await graphDeleteEmail(accessToken, email.externalId);
      } catch (graphError: any) {
        console.error(`Graph delete error for ${email.id}:`, graphError.message);
      }
    }

    // Remove from local DB
    const result = await prisma.email.deleteMany({
      where: { id: { in: ids } },
    });

    res.json({ deleted: result.count });
  } catch (error) {
    console.error('Error bulk deleting emails:', error);
    res.status(500).json({ error: 'Failed to bulk delete emails' });
  }
});

// DELETE /api/emails/:id - Delete email (move to trash via Graph)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const email = await prisma.email.findUnique({
      where: { id },
      include: { account: true },
    });

    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }

    // Move to trash in Microsoft Graph
    try {
      const accessToken = await getValidToken(email.accountId);
      await graphDeleteEmail(accessToken, email.externalId);
    } catch (graphError: any) {
      console.error('Graph delete error (continuing with local delete):', graphError.message);
    }

    // Remove from local DB
    await prisma.email.delete({ where: { id } });

    res.json({ message: 'Email deleted successfully' });
  } catch (error) {
    console.error('Error deleting email:', error);
    res.status(500).json({ error: 'Failed to delete email' });
  }
});

export default router;
