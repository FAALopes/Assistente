import { Router, Request, Response } from 'express';
import multer from 'multer';
import { prisma } from '../index';
import {
  ensureArchiveRoot,
  listFolder,
  createFolder,
  renameItem,
  deleteItem,
  moveItem,
  uploadFile,
  downloadFile,
  searchItems,
  ensureFolderPath,
} from '../services/oneDriveService';
import { listAttachments, getAttachmentBytes } from '../services/graphAttachments';
import { upsertArchiveItem, applyArchiveRulesToEmail } from '../services/archiveService';

const router = Router();
const upload = multer({ limits: { fileSize: 100 * 1024 * 1024 } });

function q(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0] as string;
  return undefined;
}

// Resolve default MS account: prefer a personal Microsoft account (Hotmail/Outlook/Live),
// since corporate M365 tenants often don't have OneDrive provisioned for the user.
async function getDefaultMsAccount(): Promise<string | null> {
  const personal = await prisma.emailAccount.findFirst({
    where: {
      provider: 'MICROSOFT',
      OR: [
        { email: { endsWith: '@hotmail.com', mode: 'insensitive' } },
        { email: { endsWith: '@outlook.com', mode: 'insensitive' } },
        { email: { endsWith: '@live.com', mode: 'insensitive' } },
        { email: { endsWith: '@hotmail.pt', mode: 'insensitive' } },
        { email: { endsWith: '@outlook.pt', mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (personal) return personal.id;
  const acc = await prisma.emailAccount.findFirst({
    where: { provider: 'MICROSOFT' },
    orderBy: { createdAt: 'asc' },
  });
  return acc?.id || null;
}

// GET /api/archive/accounts â€” list MS accounts (for selector)
router.get('/accounts', async (_req: Request, res: Response) => {
  const list = await prisma.emailAccount.findMany({
    where: { provider: 'MICROSOFT' },
    select: { id: true, email: true, displayName: true },
    orderBy: { sortOrder: 'asc' },
  });
  res.json(list);
});

// GET /api/archive/root?accountId=X â€” returns root folder id
router.get('/root', async (req: Request, res: Response) => {
  try {
    const accountId = (q(req.query.accountId)) || (await getDefaultMsAccount());
    if (!accountId) { res.status(400).json({ error: 'No MS account' }); return; }
    const id = await ensureArchiveRoot(accountId);
    res.json({ accountId, rootId: id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/archive/folder/:id?accountId=X â€” list contents
router.get('/folder/:id', async (req: Request, res: Response) => {
  try {
    const accountId = (q(req.query.accountId)) || (await getDefaultMsAccount());
    if (!accountId) { res.status(400).json({ error: 'No MS account' }); return; }
    const items = await listFolder(accountId, (req.params.id as string));
    // Join with local metadata
    const meta = await prisma.archiveItem.findMany({
      where: { accountId, driveItemId: { in: items.map(i => i.id) } },
      include: { entity: true },
    });
    const metaMap = new Map(meta.map(m => [m.driveItemId, m]));
    const out = items.map((it) => ({
      ...it,
      meta: metaMap.get(it.id) || null,
    }));
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/archive/folder â€” create folder { parentId, name, accountId? }
router.post('/folder', async (req: Request, res: Response) => {
  try {
    const { parentId, name, accountId: aid } = req.body;
    const accountId = aid || (await getDefaultMsAccount());
    if (!accountId || !parentId || !name) { res.status(400).json({ error: 'Missing params' }); return; }
    const item = await createFolder(accountId, parentId, name);
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/archive/upload â€” upload file (multipart: file, parentId, accountId?)
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { parentId, accountId: aid } = req.body;
    const accountId = aid || (await getDefaultMsAccount());
    const file = req.file;
    if (!accountId || !parentId || !file) { res.status(400).json({ error: 'Missing file/parentId' }); return; }
    const item = await uploadFile(accountId, parentId, file.originalname, file.buffer, file.mimetype);
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/archive/download/:id?accountId=X â€” stream file
router.get('/download/:id', async (req: Request, res: Response) => {
  try {
    const accountId = (q(req.query.accountId)) || (await getDefaultMsAccount());
    if (!accountId) { res.status(400).json({ error: 'No MS account' }); return; }
    const { buffer, name, mimeType } = await downloadFile(accountId, (req.params.id as string));
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.send(buffer);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/archive/item/:id â€” rename { newName } or move { parentId } or set metadata
router.patch('/item/:id', async (req: Request, res: Response) => {
  try {
    const accountId = (q(req.query.accountId)) || (await getDefaultMsAccount());
    if (!accountId) { res.status(400).json({ error: 'No MS account' }); return; }
    const { newName, parentId, tags, notes, entityId, expiresAt } = req.body;
    let item = null as any;
    if (newName) item = await renameItem(accountId, (req.params.id as string), newName);
    if (parentId) item = await moveItem(accountId, (req.params.id as string), parentId);
    // Metadata update (independent)
    if (tags !== undefined || notes !== undefined || entityId !== undefined || expiresAt !== undefined) {
      await prisma.archiveItem.update({
        where: { accountId_driveItemId: { accountId, driveItemId: (req.params.id as string) } },
        data: {
          ...(tags !== undefined ? { tags } : {}),
          ...(notes !== undefined ? { notes } : {}),
          ...(entityId !== undefined ? { entityId } : {}),
          ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
        },
      }).catch(async () => {
        // Not yet in DB â€” create a stub
        await prisma.archiveItem.create({
          data: {
            accountId,
            driveItemId: (req.params.id as string),
            name: newName || 'unknown',
            path: '',
            tags: tags || [],
            notes: notes || null,
            entityId: entityId || null,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
          },
        });
      });
    }
    res.json(item || { ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/archive/item/:id
router.delete('/item/:id', async (req: Request, res: Response) => {
  try {
    const accountId = (q(req.query.accountId)) || (await getDefaultMsAccount());
    if (!accountId) { res.status(400).json({ error: 'No MS account' }); return; }
    await deleteItem(accountId, (req.params.id as string));
    await prisma.archiveItem.deleteMany({ where: { accountId, driveItemId: (req.params.id as string) } });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/archive/search?q=...&accountId=X
router.get('/search', async (req: Request, res: Response) => {
  try {
    const accountId = (q(req.query.accountId)) || (await getDefaultMsAccount());
    const query = (q(req.query.q)) || '';
    if (!accountId || !query.trim()) { res.json([]); return; }
    // Search drive items by name/content
    const drive = await searchItems(accountId, query);
    // Also search local metadata (tags, notes, entity name)
    const meta = await prisma.archiveItem.findMany({
      where: {
        accountId,
        OR: [
          { tags: { has: query } },
          { notes: { contains: query, mode: 'insensitive' } },
          { entity: { name: { contains: query, mode: 'insensitive' } } },
        ],
      },
      include: { entity: true },
    });
    res.json({ drive, meta });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Entities
router.get('/entities', async (_req: Request, res: Response) => {
  const list = await prisma.archiveEntity.findMany({ orderBy: { name: 'asc' } });
  res.json(list);
});

router.post('/entities', async (req: Request, res: Response) => {
  try {
    const { name, aliases, color } = req.body;
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    const created = await prisma.archiveEntity.create({
      data: { name, aliases: aliases || [], color: color || null },
    });
    res.json(created);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/entities/:id', async (req: Request, res: Response) => {
  try {
    const { name, aliases, color } = req.body;
    const updated = await prisma.archiveEntity.update({
      where: { id: (req.params.id as string) },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(aliases !== undefined ? { aliases } : {}),
        ...(color !== undefined ? { color } : {}),
      },
    });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/entities/:id', async (req: Request, res: Response) => {
  await prisma.archiveEntity.delete({ where: { id: (req.params.id as string) } });
  res.json({ ok: true });
});

// Rules
router.get('/rules', async (_req: Request, res: Response) => {
  const list = await prisma.archiveRule.findMany({
    include: { entity: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(list);
});

router.post('/rules', async (req: Request, res: Response) => {
  try {
    const { name, accountId, senderPattern, subjectPattern, attachmentOnly, targetFolder, filenamePattern, entityId, enabled } = req.body;
    if (!name || !targetFolder) { res.status(400).json({ error: 'name and targetFolder required' }); return; }
    const created = await prisma.archiveRule.create({
      data: {
        name,
        accountId: accountId || null,
        senderPattern: senderPattern || null,
        subjectPattern: subjectPattern || null,
        attachmentOnly: attachmentOnly !== false,
        targetFolder,
        filenamePattern: filenamePattern || null,
        entityId: entityId || null,
        enabled: enabled !== false,
      },
      include: { entity: true },
    });
    res.json(created);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/rules/:id', async (req: Request, res: Response) => {
  try {
    const { name, accountId, senderPattern, subjectPattern, attachmentOnly, targetFolder, filenamePattern, entityId, enabled } = req.body;
    const updated = await prisma.archiveRule.update({
      where: { id: (req.params.id as string) },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(accountId !== undefined ? { accountId: accountId || null } : {}),
        ...(senderPattern !== undefined ? { senderPattern: senderPattern || null } : {}),
        ...(subjectPattern !== undefined ? { subjectPattern: subjectPattern || null } : {}),
        ...(attachmentOnly !== undefined ? { attachmentOnly } : {}),
        ...(targetFolder !== undefined ? { targetFolder } : {}),
        ...(filenamePattern !== undefined ? { filenamePattern: filenamePattern || null } : {}),
        ...(entityId !== undefined ? { entityId: entityId || null } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      },
      include: { entity: true },
    });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/rules/:id', async (req: Request, res: Response) => {
  await prisma.archiveRule.delete({ where: { id: (req.params.id as string) } });
  res.json({ ok: true });
});

// Save attachment(s) manually from an email to a folder
// POST /api/archive/save-attachments { emailId, parentId }
router.post('/save-attachments', async (req: Request, res: Response) => {
  try {
    const { emailId, parentId } = req.body;
    if (!emailId || !parentId) { res.status(400).json({ error: 'emailId and parentId required' }); return; }
    const email = await prisma.email.findUnique({ where: { id: emailId } });
    if (!email) { res.status(404).json({ error: 'Email not found' }); return; }
    const account = await prisma.emailAccount.findUnique({ where: { id: email.accountId } });
    if (!account || account.provider !== 'MICROSOFT') { res.status(400).json({ error: 'Only Microsoft accounts support attachment save' }); return; }
    const atts = await listAttachments(email.accountId, email.externalId);
    const files = atts.filter((a) => !a.isInline);
    const saved: any[] = [];
    for (const a of files) {
      try {
        const { buffer, contentType, name } = await getAttachmentBytes(email.accountId, email.externalId, a.id);
        const uploaded = await uploadFile(email.accountId, parentId, name, buffer, contentType);
        await upsertArchiveItem(email.accountId, uploaded, uploaded.name, email.id);
        saved.push(uploaded);
      } catch (e: any) {
        console.error(`Save attachment ${a.name} failed:`, e.message);
      }
    }
    res.json({ saved: saved.length, items: saved });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/archive/apply-rules/:emailId — run archive rules manually against one email
router.post('/apply-rules/:emailId', async (req: Request, res: Response) => {
  try {
    const email = await prisma.email.findUnique({ where: { id: (req.params.emailId as string) } });
    if (!email) { res.status(404).json({ error: 'Email not found' }); return; }
    const result = await applyArchiveRulesToEmail({
      id: email.id,
      accountId: email.accountId,
      externalId: email.externalId,
      from: email.from,
      subject: email.subject,
      hasAttachments: email.hasAttachments,
      receivedAt: email.receivedAt,
    });
    res.json(result);
  } catch (e: any) {
    console.error('apply-rules failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/archive/attachments/:emailId â€” list attachments of an email
router.get('/attachments/:emailId', async (req: Request, res: Response) => {
  try {
    const email = await prisma.email.findUnique({ where: { id: (req.params.emailId as string) } });
    if (!email) { res.status(404).json({ error: 'Email not found' }); return; }
    const account = await prisma.emailAccount.findUnique({ where: { id: email.accountId } });
    if (!account || account.provider !== 'MICROSOFT') { res.json([]); return; }
    const atts = await listAttachments(email.accountId, email.externalId);
    res.json(atts.filter((a) => !a.isInline));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Ensure a nested path exists (used by rules UI to create targets ahead of time)
router.post('/ensure-path', async (req: Request, res: Response) => {
  try {
    const { path, accountId: aid } = req.body;
    const accountId = aid || (await getDefaultMsAccount());
    if (!accountId || !path) { res.status(400).json({ error: 'Missing params' }); return; }
    const id = await ensureFolderPath(accountId, path);
    res.json({ id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
