import { Router, Request, Response } from 'express';
import { RuleAction } from '@prisma/client';
import { isValidCategory } from '../services/categories';
import { prisma } from '../index';
import { deleteEmail as mailDeleteEmail, moveEmailToInbox as mailMoveToInbox, moveEmailToFolder as mailMoveToFolder, getRawMime, importMime, getComposeDefaults, sendComposed } from '../services/mailService';
import { getValidToken, fetchMessageBody } from '../services/graphService';
import { fetchImapMessageBody, parseExternalId } from '../services/imapService';
import { resolveFolderId, resolveFolderIdForAccounts } from '../services/folderResolver';
import { startSyncJob } from '../services/syncJob';
import { learnFromAction } from '../services/ruleEngine';
import { classifyJunkEmails, recordOverride, TriageActionType, TriageClassification } from '../services/triageService';

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
      sortField,
      sortOrder,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    // The list shows the whole folder (no pages); 20k is just a safety cap for the "all folders" view
    const limitNum = Math.min(20000, Math.max(1, parseInt(limit as string, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (account && typeof account === 'string') {
      where.accountId = account;
    }

    if (folder && typeof folder === 'string') {
      where.folder = folder;
    }

    if (category && typeof category === 'string') {
      where.category = category;
    }

    if (search && typeof search === 'string') {
      where.OR = [
        { from: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
        { bodyPreview: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build sort order
    const allowedSortFields = ['from', 'subject', 'receivedAt', 'folder', 'category'];
    const field = typeof sortField === 'string' && allowedSortFields.includes(sortField) ? sortField : 'receivedAt';
    const direction = sortOrder === 'ascend' ? 'asc' : 'desc';
    const orderBy = { [field]: direction };

    const [emails, total] = await Promise.all([
      prisma.email.findMany({
        where,
        orderBy,
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

// POST /api/emails/sync - Triggers the background sync job (returns immediately).
// For progress, poll /api/sync/status/:jobId.
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    const jobId = await startSyncJob();
    res.json({ message: 'Sync started', jobId });
  } catch (error: any) {
    console.error('Error starting sync:', error);
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

// GET /api/emails/folders - List available folders (optionally per account)
// Reads from MailFolder table (populated by sync job) and joins with email counts.
router.get('/folders', async (req: Request, res: Response) => {
  try {
    const { account } = req.query;

    const accounts = await prisma.emailAccount.findMany({ select: { id: true } });

    const mailFolders = await prisma.mailFolder.findMany({
      where: account && typeof account === 'string' ? { accountId: account } : {},
      orderBy: [{ path: 'asc' }],
    });

    // Group email counts by account + folder (total + unread)
    const counts = await prisma.email.groupBy({
      by: ['accountId', 'folder'],
      _count: { id: true },
    });
    const unreadCounts = await prisma.email.groupBy({
      by: ['accountId', 'folder'],
      where: { isRead: false },
      _count: { id: true },
    });
    const countMap: Record<string, number> = {};
    const unreadMap: Record<string, number> = {};
    for (const c of counts) countMap[`${c.accountId}:${c.folder}`] = c._count.id;
    for (const c of unreadCounts) unreadMap[`${c.accountId}:${c.folder}`] = c._count.id;

    const toRow = (f: typeof mailFolders[number]) => ({
      id: f.id,
      label: f.displayName,
      path: f.path,
      depth: f.depth,
      wellKnownName: f.wellKnownName,
      parentId: f.parentId,
      count: countMap[`${f.accountId}:${f.id}`] || 0,
      unreadCount: unreadMap[`${f.accountId}:${f.id}`] || 0,
    });

    if (account && typeof account === 'string') {
      res.json(mailFolders.map(toRow));
      return;
    }

    const byAccount: Record<string, ReturnType<typeof toRow>[]> = {};
    for (const acc of accounts) byAccount[acc.id] = [];
    for (const f of mailFolders) {
      if (!byAccount[f.accountId]) byAccount[f.accountId] = [];
      byAccount[f.accountId].push(toRow(f));
    }
    res.json(byAccount);
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

    if (!category || typeof category !== 'string' || !(await isValidCategory(category))) {
      res.status(400).json({ error: 'Invalid category' });
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
        category,
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
    if (typeof category !== 'string' || !(await isValidCategory(category))) {
      res.status(400).json({ error: 'Invalid category' });
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
        await mailDeleteEmail(email.accountId, email.externalId);
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
// GET /api/emails/:id/body - Fetch full body (HTML or text) on demand
router.get('/:id/body', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const email = await prisma.email.findUnique({ where: { id }, include: { account: true } });
    if (!email) { res.status(404).json({ error: 'Email not found' }); return; }

    if (email.account.provider === 'MICROSOFT') {
      const token = await getValidToken(email.accountId);
      const body = await fetchMessageBody(token, email.externalId);
      res.json(body);
      return;
    }
    if (email.account.provider === 'IMAP') {
      const parsed = parseExternalId(email.externalId);
      if (!parsed) { res.status(400).json({ error: 'Invalid IMAP externalId' }); return; }
      const body = await fetchImapMessageBody(email.accountId, parsed.folder, parsed.uid);
      res.json(body);
      return;
    }
    res.status(400).json({ error: 'Unsupported provider' });
  } catch (e: any) {
    console.error('Error fetching email body:', e);
    res.status(500).json({ error: e?.message || 'Failed to fetch body' });
  }
});

const MODES = ['reply', 'replyAll', 'forward'];
const ADDR = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

// GET /api/emails/:id/compose?mode=reply|replyAll|forward - recipients and subject to prefill
router.get('/:id/compose', async (req: Request, res: Response) => {
  try {
    const mode = String(req.query.mode || '');
    if (!MODES.includes(mode)) { res.status(400).json({ error: 'mode inválido' }); return; }
    const email = await prisma.email.findUnique({ where: { id: req.params.id as string }, include: { account: { select: { email: true } } } });
    if (!email) { res.status(404).json({ error: 'Email not found' }); return; }
    const d = await getComposeDefaults(email.accountId, email.externalId, mode as any);
    res.json({ ...d, from: email.account.email });
  } catch (e: any) {
    console.error('Error preparing compose:', e);
    res.status(500).json({ error: e?.message || 'Failed to prepare reply' });
  }
});

// POST /api/emails/:id/send { mode, to[], cc[], subject, html } - reply / reply all / forward
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const { mode, subject, html } = req.body || {};
    const clean = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean);
    const to = clean(req.body?.to);
    const cc = clean(req.body?.cc);
    if (!MODES.includes(mode)) { res.status(400).json({ error: 'mode inválido' }); return; }
    if (to.length === 0) { res.status(400).json({ error: 'Falta o destinatário' }); return; }
    const bad = [...to, ...cc].find((a) => !ADDR.test(a));
    if (bad) { res.status(400).json({ error: `Endereço inválido: ${bad}` }); return; }
    if (typeof html !== 'string' || typeof subject !== 'string') { res.status(400).json({ error: 'Pedido inválido' }); return; }

    const email = await prisma.email.findUnique({ where: { id: req.params.id as string } });
    if (!email) { res.status(404).json({ error: 'Email not found' }); return; }
    try {
      await sendComposed(email.accountId, email.externalId, mode, { to, cc, subject, html });
    } catch (e: any) {
      console.error('Send error:', e?.message);
      res.status(502).json({ error: `Não foi enviado: ${e?.message || 'erro'}` });
      return;
    }
    res.json({ sent: true });
  } catch (e: any) {
    console.error('Error sending email:', e);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

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
      await mailDeleteEmail(email.accountId, email.externalId);
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

// POST /api/emails/:id/move-to-inbox - Move email to inbox
router.post('/:id/move-to-inbox', async (req: Request, res: Response) => {
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

    // Move to inbox in Microsoft Graph
    try {
      await mailMoveToInbox(email.accountId, email.externalId);
    } catch (graphError: any) {
      console.error('Graph move error:', graphError.message);
      res.status(500).json({ error: 'Failed to move email in server' });
      return;
    }

    // Update folder in local DB to the account's REAL inbox id (not the literal 'inbox')
    const inboxId = await resolveFolderId(email.accountId, 'inbox');
    await prisma.email.update({
      where: { id },
      data: { folder: inboxId || email.folder, triageAction: null, triageReason: null, triageConfidence: null, triageClassifiedAt: null },
    });

    res.json({ message: 'Email moved to inbox' });
  } catch (error) {
    console.error('Error moving email:', error);
    res.status(500).json({ error: 'Failed to move email' });
  }
});

// POST /api/emails/:id/move - Move email to any folder of its own account. Body: { folderId }
router.post('/:id/move', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const folderId = req.body?.folderId;
    if (!folderId || typeof folderId !== 'string') {
      res.status(400).json({ error: 'folderId is required' });
      return;
    }

    const email = await prisma.email.findUnique({ where: { id } });
    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }
    const targetAccountId: string = typeof req.body?.accountId === 'string' && req.body.accountId ? req.body.accountId : email.accountId;
    const target = await prisma.mailFolder.findUnique({
      where: { accountId_id: { accountId: targetAccountId, id: folderId } },
      include: { account: { select: { email: true } } },
    });
    if (!target) {
      res.status(400).json({ error: 'Pasta de destino não encontrada' });
      return;
    }
    if (targetAccountId === email.accountId && email.folder === folderId) {
      res.json({ moved: false, folder: target.displayName });
      return;
    }
    const cleared = { triageAction: null, triageReason: null, triageConfidence: null, triageClassifiedAt: null };

    if (targetAccountId !== email.accountId) {
      // Another mailbox: servers cannot move between accounts, so copy the full message
      // (MIME, with attachments) into the destination, then send the original to the Trash.
      let copiedId: string | null;
      try {
        const raw = await getRawMime(email.accountId, email.externalId);
        copiedId = await importMime(targetAccountId, folderId, raw, { isRead: email.isRead, receivedAt: email.receivedAt });
      } catch (e: any) {
        console.error('Cross-account copy error:', e?.message);
        res.status(502).json({ error: `Não foi possível copiar para a outra caixa (o original não foi tocado): ${e?.message || 'erro'}` });
        return;
      }
      let warning: string | null = null;
      try {
        await mailDeleteEmail(email.accountId, email.externalId);
      } catch (e: any) {
        warning = `Copiado, mas o original não foi para o Lixo: ${e?.message || 'erro'}`;
      }
      if (warning) {
        res.json({ moved: true, folder: `${target.account.email} / ${target.displayName}`, warning });
        return;
      }
      if (copiedId) {
        await prisma.email.update({
          where: { id },
          data: { accountId: targetAccountId, folder: folderId, externalId: copiedId, ...cleared },
        });
      } else {
        await prisma.email.delete({ where: { id } }); // next sync of the destination brings it back
      }
      res.json({ moved: true, folder: `${target.account.email} / ${target.displayName}` });
      return;
    }

    let newExternalId: string | null;
    try {
      newExternalId = await mailMoveToFolder(email.accountId, email.externalId, folderId);
    } catch (moveError: any) {
      console.error('Move error:', moveError?.message);
      res.status(502).json({ error: `O servidor de email recusou mover: ${moveError?.message || 'erro'}` });
      return;
    }

    if (newExternalId) {
      await prisma.email.update({ where: { id }, data: { folder: folderId, externalId: newExternalId, ...cleared } });
    } else if (email.externalId.startsWith('imap:')) {
      // IMAP server did not report the new UID: the old id is dead, so drop the local row;
      // the next sync of the destination folder brings the message back with its new id.
      await prisma.email.delete({ where: { id } });
    } else {
      await prisma.email.update({ where: { id }, data: { folder: folderId, ...cleared } });
    }

    res.json({ moved: true, folder: target.displayName });
  } catch (error) {
    console.error('Error moving email:', error);
    res.status(500).json({ error: 'Failed to move email' });
  }
});

// POST /api/emails/triage - Classify junk emails with AI (with cache)
router.post('/triage', async (req: Request, res: Response) => {
  try {
    const { accountId, forceReclassify } = req.body;

    // Resolve each account's real junk folder id (Hotmail PT etc. have no wellKnownName)
    const accountIds = accountId
      ? [accountId]
      : (await prisma.emailAccount.findMany({ select: { id: true } })).map(a => a.id);
    const junkByAccount = await resolveFolderIdForAccounts(accountIds, 'junkemail');
    const junkFolderIds = Array.from(junkByAccount.values());
    if (junkFolderIds.length === 0) {
      res.json({ classifications: [], total: 0, fromCache: 0, newlyClassified: 0 });
      return;
    }
    const where: any = { folder: { in: junkFolderIds } };
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
        triageAction: true,
        triageReason: true,
        triageConfidence: true,
        triageClassifiedAt: true,
      },
    });

    if (junkEmails.length === 0) {
      res.json({ classifications: [], total: 0, fromCache: 0, newlyClassified: 0 });
      return;
    }

    // Separate already-classified from needing AI
    const cached: TriageClassification[] = [];
    const needsClassification: typeof junkEmails = [];

    for (const email of junkEmails) {
      if (!forceReclassify && email.triageAction && email.triageClassifiedAt) {
        cached.push({
          emailId: email.id,
          action: email.triageAction as TriageActionType,
          reason: email.triageReason || '',
          confidence: email.triageConfidence || 50,
        });
      } else {
        needsClassification.push(email);
      }
    }

    console.log(`Triage: ${cached.length} from cache, ${needsClassification.length} need AI classification`);

    // Only call AI for unclassified emails
    let newClassifications: TriageClassification[] = [];
    if (needsClassification.length > 0) {
      newClassifications = await classifyJunkEmails(needsClassification);

      // Save classifications to DB (skip failed ones so they get retried)
      for (const c of newClassifications) {
        if (c.confidence === 0) continue; // AI error fallback — don't cache
        try {
          await prisma.email.update({
            where: { id: c.emailId },
            data: {
              triageAction: c.action as any,
              triageReason: c.reason,
              triageConfidence: c.confidence,
              triageClassifiedAt: new Date(),
            },
          });
        } catch (saveErr: any) {
          console.error(`Failed to save triage for email ${c.emailId}:`, saveErr.message);
        }
      }
    }

    const allClassifications = [...cached, ...newClassifications];

    res.json({
      classifications: allClassifications,
      total: junkEmails.length,
      fromCache: cached.length,
      newlyClassified: needsClassification.length,
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
          await mailDeleteEmail(email.accountId, email.externalId);
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

      const inboxIds = await resolveFolderIdForAccounts(
        Array.from(new Set(emails.map(e => e.accountId))),
        'inbox'
      );
      for (const email of emails) {
        try {
          await mailMoveToInbox(email.accountId, email.externalId);
          const inboxId = inboxIds.get(email.accountId);
          await prisma.email.update({
            where: { id: email.id },
            data: { folder: inboxId || email.folder },
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
