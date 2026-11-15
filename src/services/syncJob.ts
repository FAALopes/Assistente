import { prisma } from '../index';
import {
  getValidToken,
  listAllMailFoldersFlat,
  fetchFolderDelta,
  type FlatFolder,
} from './graphService';
import {
  listAllImapFolders,
  fetchAllImapMessages,
  type ImapFlatFolder,
} from './imapService';

interface JobState {
  jobId: string;
  errors: string[];
  foldersDone: number;
  emailsSynced: number;
  emailsRemoved: number;
}

async function updateJob(jobId: string, patch: Record<string, any>): Promise<void> {
  await prisma.syncJob.update({ where: { id: jobId }, data: patch });
}

async function upsertEmail(accountId: string, folderId: string, g: any): Promise<void> {
  const fromName = g.from?.emailAddress?.name || '';
  const fromEmail = g.from?.emailAddress?.address || 'unknown';
  const fromDisplay = fromName && fromName !== fromEmail ? `${fromName} <${fromEmail}>` : fromEmail;
  const toAddress = g.toRecipients?.[0]?.emailAddress?.address || null;
  await prisma.email.upsert({
    where: { externalId: g.id },
    create: {
      externalId: g.id,
      accountId,
      from: fromDisplay,
      to: toAddress,
      subject: g.subject || null,
      bodyPreview: g.bodyPreview || null,
      folder: folderId,
      receivedAt: g.receivedDateTime ? new Date(g.receivedDateTime) : new Date(),
      isRead: g.isRead || false,
      importance: g.importance || null,
      hasAttachments: g.hasAttachments || false,
    },
    update: {
      from: fromDisplay,
      to: toAddress,
      subject: g.subject || null,
      bodyPreview: g.bodyPreview || null,
      folder: folderId,
      isRead: g.isRead || false,
      importance: g.importance || null,
      hasAttachments: g.hasAttachments || false,
    },
  });
}

async function syncMicrosoftAccount(state: JobState, accountId: string, accountEmail: string): Promise<void> {
  const token = await getValidToken(accountId);
  // 1) Enumerate all folders (nested)
  await updateJob(state.jobId, { phase: 'folders', currentFolder: accountEmail });
  let folders: FlatFolder[] = [];
  try {
    folders = await listAllMailFoldersFlat(token);
  } catch (e: any) {
    state.errors.push(`${accountEmail}: list folders failed: ${e.message}`);
    return;
  }
  // Upsert folder rows
  for (const f of folders) {
    await prisma.mailFolder.upsert({
      where: { accountId_id: { accountId, id: f.id } },
      create: {
        accountId,
        id: f.id,
        displayName: f.displayName,
        parentId: f.parentId,
        path: f.path,
        depth: f.depth,
        wellKnownName: f.wellKnownName,
        totalItemCount: f.totalItemCount,
        unreadItemCount: f.unreadItemCount,
      },
      update: {
        displayName: f.displayName,
        parentId: f.parentId,
        path: f.path,
        depth: f.depth,
        wellKnownName: f.wellKnownName,
        totalItemCount: f.totalItemCount,
        unreadItemCount: f.unreadItemCount,
      },
    });
  }
  // Remove folder rows that no longer exist on server
  const serverIds = new Set(folders.map(f => f.id));
  const localFolders = await prisma.mailFolder.findMany({ where: { accountId }, select: { id: true } });
  const toDrop = localFolders.filter(f => !serverIds.has(f.id)).map(f => f.id);
  if (toDrop.length > 0) {
    await prisma.mailFolder.deleteMany({ where: { accountId, id: { in: toDrop } } });
  }

  // 2) For each folder, delta sync
  // Accumulate foldersTotal across accounts (do not overwrite)
  const prev = await prisma.syncJob.findUnique({ where: { id: state.jobId }, select: { foldersTotal: true } });
  await updateJob(state.jobId, { phase: 'emails', foldersTotal: (prev?.foldersTotal || 0) + folders.length });
  for (const folder of folders) {
    await updateJob(state.jobId, { currentFolder: `${accountEmail} / ${folder.path}` });
    try {
      const row = await prisma.mailFolder.findUnique({
        where: { accountId_id: { accountId, id: folder.id } },
        select: { deltaLink: true },
      });
      const { deltaLink } = await fetchFolderDelta(
        token,
        folder.id,
        row?.deltaLink || null,
        async (changed, deleted, _total) => {
          for (const em of changed) {
            try { await upsertEmail(accountId, folder.id, em); state.emailsSynced++; }
            catch (e: any) { state.errors.push(`${folder.path}: upsert ${em.id}: ${e.message}`); }
          }
          if (deleted.length > 0) {
            const res = await prisma.email.deleteMany({ where: { externalId: { in: deleted } } });
            state.emailsRemoved += res.count;
          }
          await updateJob(state.jobId, {
            emailsSynced: state.emailsSynced,
            emailsRemoved: state.emailsRemoved,
          });
        },
      );
      await prisma.mailFolder.update({
        where: { accountId_id: { accountId, id: folder.id } },
        data: { deltaLink, lastSyncAt: new Date() },
      });
    } catch (e: any) {
      state.errors.push(`${accountEmail} / ${folder.path}: ${e.message}`);
    }
    state.foldersDone++;
    await updateJob(state.jobId, { foldersDone: state.foldersDone });
  }
}

async function syncImapAccount(state: JobState, accountId: string, accountEmail: string): Promise<void> {
  await updateJob(state.jobId, { phase: 'folders', currentFolder: accountEmail });
  let folders: ImapFlatFolder[] = [];
  try {
    folders = await listAllImapFolders(accountId);
  } catch (e: any) {
    state.errors.push(`${accountEmail}: list folders failed: ${e.message}`);
    return;
  }

  // Build parentId map (use path as id for IMAP)
  const pathToId = new Map(folders.map(f => [f.path, f.path]));
  for (const f of folders) {
    const parentId = f.parentPath && pathToId.has(f.parentPath) ? f.parentPath : null;
    await prisma.mailFolder.upsert({
      where: { accountId_id: { accountId, id: f.path } },
      create: {
        accountId,
        id: f.path,
        displayName: f.displayName,
        parentId,
        path: f.path,
        depth: f.depth,
        wellKnownName: f.wellKnownName,
        totalItemCount: f.totalItemCount,
      },
      update: {
        displayName: f.displayName,
        parentId,
        path: f.path,
        depth: f.depth,
        wellKnownName: f.wellKnownName,
        totalItemCount: f.totalItemCount,
      },
    });
  }
  const serverPaths = new Set(folders.map(f => f.path));
  const localFolders = await prisma.mailFolder.findMany({ where: { accountId }, select: { id: true } });
  const toDrop = localFolders.filter(f => !serverPaths.has(f.id)).map(f => f.id);
  if (toDrop.length > 0) {
    await prisma.mailFolder.deleteMany({ where: { accountId, id: { in: toDrop } } });
  }

  const prev = await prisma.syncJob.findUnique({ where: { id: state.jobId }, select: { foldersTotal: true } });
  await updateJob(state.jobId, { phase: 'emails', foldersTotal: (prev?.foldersTotal || 0) + folders.length });
  for (const folder of folders) {
    await updateJob(state.jobId, { currentFolder: `${accountEmail} / ${folder.path}` });
    try {
      // IMAP has no delta — full fetch per folder (uses upsert so no dup)
      // Collect external ids to compute stale
      const seen = new Set<string>();
      await fetchAllImapMessages(accountId, folder.path, async (batch, _total) => {
        for (const em of batch) {
          seen.add(em.id);
          try { await upsertEmail(accountId, folder.path, em); state.emailsSynced++; }
          catch (e: any) { state.errors.push(`${folder.path}: upsert ${em.id}: ${e.message}`); }
        }
        await updateJob(state.jobId, { emailsSynced: state.emailsSynced });
      });
      // Remove local emails no longer on server for this folder
      const local = await prisma.email.findMany({
        where: { accountId, folder: folder.path },
        select: { id: true, externalId: true },
      });
      const stale = local.filter(e => !seen.has(e.externalId)).map(e => e.id);
      if (stale.length > 0) {
        const res = await prisma.email.deleteMany({ where: { id: { in: stale } } });
        state.emailsRemoved += res.count;
        await updateJob(state.jobId, { emailsRemoved: state.emailsRemoved });
      }
      await prisma.mailFolder.update({
        where: { accountId_id: { accountId, id: folder.path } },
        data: { lastSyncAt: new Date() },
      });
    } catch (e: any) {
      state.errors.push(`${accountEmail} / ${folder.path}: ${e.message}`);
    }
    state.foldersDone++;
    await updateJob(state.jobId, { foldersDone: state.foldersDone });
  }
}

export async function startSyncJob(accountId?: string): Promise<string> {
  // Avoid duplicate concurrent jobs
  const running = await prisma.syncJob.findFirst({ where: { status: 'running' } });
  if (running) return running.id;

  const job = await prisma.syncJob.create({
    data: { status: 'running', phase: 'folders', accountId: accountId || null },
  });

  const state: JobState = {
    jobId: job.id,
    errors: [],
    foldersDone: 0,
    emailsSynced: 0,
    emailsRemoved: 0,
  };

  // Fire-and-forget
  (async () => {
    try {
      const accounts = await prisma.emailAccount.findMany({
        where: accountId
          ? { id: accountId }
          : { provider: { in: ['MICROSOFT', 'IMAP'] } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      });
      for (const acc of accounts) {
        try {
          if (acc.provider === 'MICROSOFT') {
            await syncMicrosoftAccount(state, acc.id, acc.email);
          } else if (acc.provider === 'IMAP') {
            await syncImapAccount(state, acc.id, acc.email);
          }
        } catch (e: any) {
          state.errors.push(`${acc.email}: ${e.message}`);
        }
      }
      await updateJob(job.id, {
        status: 'done',
        phase: 'cleanup',
        currentFolder: null,
        finishedAt: new Date(),
        errors: state.errors.length > 0 ? state.errors.slice(0, 50) : null,
      });
      console.log(`[SyncJob ${job.id}] done: ${state.emailsSynced} synced, ${state.emailsRemoved} removed, ${state.errors.length} errors`);
    } catch (e: any) {
      console.error(`[SyncJob ${job.id}] fatal:`, e);
      await updateJob(job.id, {
        status: 'error',
        finishedAt: new Date(),
        errors: [e.message, ...state.errors].slice(0, 50),
      });
    }
  })();

  return job.id;
}

export async function getJobStatus(id: string): Promise<any> {
  return prisma.syncJob.findUnique({ where: { id } });
}

export async function getLatestJob(): Promise<any> {
  return prisma.syncJob.findFirst({ orderBy: { startedAt: 'desc' } });
}
