import { Router, Request, Response } from 'express';
import { EmailCategory, RuleAction } from '@prisma/client';
import { prisma } from '../index';
import { fetchEmails, deleteEmail as graphDeleteEmail, moveEmailToInbox, getValidToken } from '../services/graphService';
import { learnFromAction } from '../services/ruleEngine';
import { classifyJunkEmails, recordOverride, TriageActionType } from '../services/triageService';

const router = Router();

// GET /api/emails - List emails with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      account,
      category,
      folder,
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

    if (folder && typeof folder === 'string') {
      where.folder = folder;
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

// Folders to sync for each Microsoft account
const SYNC_FOLDERS = [
  { graphName: 'inbox', label: 'Inbox' },
  { graphName: 'junkemail', label: 'E-mail de Lixo' },
];

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

    console.log(`Starting sync for ${accounts.length} account(s)...`);

    for (const account of accounts) {
      try {
        console.log(`Syncing account: ${account.email}`);
        const accessToken = await getValidToken(account.id);

        for (const folder of SYNC_FOLDERS) {
          try {
            console.log(`  Fetching folder: ${folder.label} (${folder.graphName})`);
            const graphEmails = await fetchEmails(accessToken, folder.graphName);
            console.log(`  Got ${graphEmails.length} emails from ${folder.label}`);

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
                  folder: folder.graphName,
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
                  folder: folder.graphName,
                },
              });

              totalSynced++;
            }
          } catch (folderErr: any) {
            const msg = `Failed to sync folder ${folder.label} for ${account.email}: ${folderErr.message}`;
            console.error(msg);
            errors.push(msg);
          }
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

// GET /api/emails/folders - List available folders
router.get('/folders', async (_req: Request, res: Response) => {
  try {
    const folders = await prisma.email.groupBy({
      by: ['folder'],
      _count: { id: true },
    });

    const folderLabels: Record<string, string> = {
      inbox: 'Inbox',
      junkemail: 'E-mail de Lixo',
      sentitems: 'Enviados',
      drafts: 'Rascunhos',
      deleteditems: 'Eliminados',
      archive: 'Arquivo',
    };

    const result = folders.map((f) => ({
      id: f.folder,
      label: folderLabels[f.folder] || f.folder,
      count: f._count.id,
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching folders:', error);
    res.status(500).json({ error: 'Failed to fetch folders' });
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

// POST /api/emails/triage - Classify junk emails with AI
router.post('/triage', async (req: Request, res: Response) => {
  try {
    const { accountId } = req.body;

    const where: any = { folder: 'junkemail' };
    if (accountId) where.accountId = accountId;

    const junkEmails = await prisma.email.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        from: true,
        subject: true,
        bodyPreview: true,
        receivedAt: true,
      },
    });

    if (junkEmails.length === 0) {
      res.json({ classifications: [], total: 0 });
      return;
    }

    const classifications = await classifyJunkEmails(junkEmails);

    res.json({
      classifications,
      total: junkEmails.length,
    });
  } catch (error) {
    console.error('Error triaging emails:', error);
    res.status(500).json({ error: 'Failed to triage emails' });
  }
});

// POST /api/emails/triage/execute - Execute triage decisions
router.post('/triage/execute', async (req: Request, res: Response) => {
  try {
    const { actions } = req.body as {
      actions: Array<{ emailId: string; action: string }>;
    };

    if (!actions || !Array.isArray(actions)) {
      res.status(400).json({ error: 'actions array is required' });
      return;
    }

    const deleteIds: string[] = [];
    const moveIds: string[] = [];
    let reviewed = 0;
    const errors: string[] = [];

    for (const item of actions) {
      if (item.action === 'DELETE') deleteIds.push(item.emailId);
      else if (item.action === 'MOVE_TO_INBOX') moveIds.push(item.emailId);
      else reviewed++;
    }

    // DELETE: move to trash in Graph + remove from DB
    if (deleteIds.length > 0) {
      const emails = await prisma.email.findMany({
        where: { id: { in: deleteIds } },
        include: { account: true },
      });

      for (const email of emails) {
        try {
          const accessToken = await getValidToken(email.accountId);
          await graphDeleteEmail(accessToken, email.externalId);
        } catch (err: any) {
          errors.push(`Delete failed for ${email.from}: ${err.message}`);
        }
      }

      await prisma.email.deleteMany({ where: { id: { in: deleteIds } } });
    }

    // MOVE_TO_INBOX: move in Graph + update folder in DB
    if (moveIds.length > 0) {
      const emails = await prisma.email.findMany({
        where: { id: { in: moveIds } },
        include: { account: true },
      });

      for (const email of emails) {
        try {
          const accessToken = await getValidToken(email.accountId);
          await moveEmailToInbox(accessToken, email.externalId);
          await prisma.email.update({
            where: { id: email.id },
            data: { folder: 'inbox' },
          });
        } catch (err: any) {
          errors.push(`Move failed for ${email.from}: ${err.message}`);
        }
      }
    }

    res.json({
      deleted: deleteIds.length,
      moved: moveIds.length,
      reviewed,
      errors,
    });
  } catch (error) {
    console.error('Error executing triage:', error);
    res.status(500).json({ error: 'Failed to execute triage actions' });
  }
});

// POST /api/emails/triage/override - Record learning override
router.post('/triage/override', async (req: Request, res: Response) => {
  try {
    const { emailId, aiDecision, userDecision } = req.body;

    if (!emailId || !aiDecision || !userDecision) {
      res.status(400).json({ error: 'emailId, aiDecision, and userDecision are required' });
      return;
    }

    const email = await prisma.email.findUnique({ where: { id: emailId } });
    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }

    await recordOverride(
      email.from,
      aiDecision as TriageActionType,
      userDecision as TriageActionType,
    );

    res.json({ message: 'Override recorded', sender: email.from });
  } catch (error) {
    console.error('Error recording triage override:', error);
    res.status(500).json({ error: 'Failed to record override' });
  }
});

export default router;
