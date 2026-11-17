import { prisma } from '../index';
import {
  getValidToken,
  listAllMailFoldersFlat,
  fetchFolderDelta,
  type FlatFolder,
} from './graphService';
import {
  listAllImapFolders,
  getFolderStatus,
  fetchImapMessagesSince,
  listAllImapUids,
  type ImapFlatFolder,
} from './imapService';
import { applyArchiveRulesToEmail } from './archiveService';

interface JobState {
  jobId: string;
  errors: string[];
  foldersDone: number;
  emailsSynced: number;
  emailsRemoved: number;
  cancelled?: boolean;
}

// In-memory registry of running jobs so /cancel can set a flag the worker reads
const RUNNING_JOBS = new Map<string, JobState>();

export async function cancelJob(jobId: string): Promise<boolean> {
  const state = RUNNING_JOBS.get(jobId);
  if (!state) return false;
  state.cancelled = true;
  return true;
}

async function checkCancelled(state: JobState): Promise<boolean> {
  if (state.cancelled) return true;
  // Also check DB in case flag was set by a different process (not our case here, but safe)
  return false;
}

async function updateJob(jobId: string, patch: Record<string, any>): Promise<void> {
  await prisma.syncJob.update({ where: { id: jobId }, data: patch });
}

async function upsertEmail(accountId: string, folderId: string, g: any): Promise<{ created: boolean; email: any }> {
  const fromName = g.from?.emailAddress?.name || '';
  const fromEmail = g.from?.emailAddress?.address || 'unknown';
  const fromDisplay = fromName && fromName !== fromEmail ? `${fromName} <${fromEmail}>` : fromEmail;
  const toAddress = g.toRecipients?.[0]?.emailAddress?.address || null;
  const existing = await prisma.email.findUnique({ where: { externalId: g.id }, select: { id: true } });
  const email = await prisma.email.upsert({
    where: { externalId: g.id },
    create: {
      externalId: g.id, accountId, from: fromDisplay, to: toAddress,
      subject: g.subject || null, bodyPreview: g.bodyPreview || null,
      folder: folderId,
      receivedAt: g.receivedDateTime ? new Date(g.receivedDateTime) : new Date(),
      isRead: g.isRead || false, importance: g.importance || null,
      hasAttachments: g.hasAttachments || false,
    },
    update: {
      from: fromDisplay, to: toAddress,
      subject: g.subject || null, bodyPreview: g.bodyPreview || null,
      folder: folderId,
      isRead: g.isRead || false, importance: g.importance || null,
      hasAttachments: g.hasAttachments || false,
    },
  });
  return { created: !existing, email };
}

async function syncMicrosoftAccount(state: JobState, accountId: string, accountEmail: string): Promise<void> {
  const token = await getValidToken(accountId);

  // 1) Enumerate folders (metadata for sidebar). Cheap compared to messages.
  await updateJob(state.jobId, { phase: 'folders', currentFolder: accountEmail });
  let folders: FlatFolder[] = [];
  try {
    folders = await listAllMailFoldersFlat(token);
  } catch (e: any) {
    state.errors.push(`${accountEmail}: list folders failed: ${e.message}`);
    return;
  }
  for (const f of folders) {
    await prisma.mailFolder.upsert({
      where: { accountId_id: { accountId, id: f.id } },
      create: {
        accountId, id: f.id, displayName: f.displayName, parentId: f.parentId,
        path: f.path, depth: f.depth, wellKnownName: f.wellKnownName,
        totalItemCount: f.totalItemCount, unreadItemCount: f.unreadItemCount,
      },
      update: {
        displayName: f.displayName, parentId: f.parentId, path: f.path, depth: f.depth,
        wellKnownName: f.wellKnownName, totalItemCount: f.totalItemCount, unreadItemCount: f.unreadItemCount,
      },
    });
  }
  const serverIds = new Set(folders.map(f => f.id));
  const localFolders = await prisma.mailFolder.findMany({ where: { accountId }, select: { id: true } });
  const toDrop = localFolders.filter(f => !serverIds.has(f.id)).map(f => f.id);
  if (toDrop.length > 0) {
    await prisma.mailFolder.deleteMany({ where: { accountId, id: { in: toDrop } } });
  }

  // 2) Per-folder delta sync, in PARALLEL batches (Graph doesn't support account-wide delta)
  // Correct the upfront estimate if the server has more folders than DB knew about
  const prevLocalCount = localFolders.length;
  if (folders.length > prevLocalCount) {
    const job = await prisma.syncJob.findUnique({ where: { id: state.jobId }, select: { foldersTotal: true } });
    await updateJob(state.jobId, { foldersTotal: (job?.foldersTotal || 0) + (folders.length - prevLocalCount), phase: 'emails' });
  } else {
    await updateJob(state.jobId, { phase: 'emails' });
  }

  const CONCURRENCY = 6;
  const syncOneFolder = async (folder: FlatFolder) => {
    if (await checkCancelled(state)) return;
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
          // Parallelize upserts (10 at a time) instead of serial
          const CHUNK = 10;
          const newEmails: any[] = [];
          for (let i = 0; i < changed.length; i += CHUNK) {
            const chunk = changed.slice(i, i + CHUNK);
            const results = await Promise.all(chunk.map(async (em) => {
              try { const r = await upsertEmail(accountId, folder.id, em); state.emailsSynced++; return r; }
              catch (e: any) { state.errors.push(`${folder.path}: upsert ${em.id}: ${e.message}`); return null; }
            }));
            for (const r of results) if (r?.created) newEmails.push(r.email);
          }
          // Fire archive rules for newly-created MS emails with attachments (best-effort, don't block)
          for (const em of newEmails) {
            if (!em.hasAttachments) continue;
            applyArchiveRulesToEmail(em).catch(e => state.errors.push(`archive rules: ${e.message}`));
          }
          if (deleted.length > 0) {
            const res = await prisma.email.deleteMany({ where: { externalId: { in: deleted } } });
            state.emailsRemoved += res.count;
          }
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
    await updateJob(state.jobId, {
      foldersDone: state.foldersDone,
      emailsSynced: state.emailsSynced,
      emailsRemoved: state.emailsRemoved,
      currentFolder: `${accountEmail} / ${folder.path}`,
    });
  };

  // Worker pool: N workers each pull the next folder from the queue (no batch waiting)
  const queue = [...folders];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      if (await checkCancelled(state)) return;
      const folder = queue.shift();
      if (!folder) return;
      await syncOneFolder(folder);
    }
  });
  await Promise.all(workers);
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

  const prevLocalCount = localFolders.length;
  if (folders.length > prevLocalCount) {
    const job = await prisma.syncJob.findUnique({ where: { id: state.jobId }, select: { foldersTotal: true } });
    await updateJob(state.jobId, { foldersTotal: (job?.foldersTotal || 0) + (folders.length - prevLocalCount), phase: 'emails' });
  } else {
    await updateJob(state.jobId, { phase: 'emails' });
  }

  const IMAP_CONCURRENCY = 4;
  const syncOneImapFolder = async (folder: ImapFlatFolder) => {
    if (await checkCancelled(state)) return;
    try {
      const row = await prisma.mailFolder.findUnique({
        where: { accountId_id: { accountId, id: folder.path } },
        select: { lastUid: true, uidValidity: true, totalItemCount: true },
      });

      // Cheap STATUS first: skip if nothing changed
      const status = await getFolderStatus(accountId, folder.path);
      if (!status) return;

      const storedUidValidity = row?.uidValidity ? Number(row.uidValidity) : 0;
      const uidValidityChanged = storedUidValidity && storedUidValidity !== status.uidValidity;
      const effectiveLastUid = uidValidityChanged ? 0 : (row?.lastUid || 0);

      // Fast path: nothing new AND message count matches -> no fetch, no deletion scan
      const serverLastUid = Math.max(0, status.uidNext - 1);
      if (!uidValidityChanged && effectiveLastUid >= serverLastUid && status.messages === (row?.totalItemCount || 0)) {
        return;
      }

      // Only touch currentFolder when the folder actually needs work (avoids 8000+ no-op updates)
      await updateJob(state.jobId, { currentFolder: `${accountEmail} / ${folder.path}` });

      if (uidValidityChanged) {
        await prisma.email.deleteMany({ where: { accountId, folder: folder.path } });
      }
      const { highestUid, uidValidity } = await fetchImapMessagesSince(
        accountId, folder.path, effectiveLastUid,
        async (batch, _total) => {
          const CHUNK = 10;
          for (let i = 0; i < batch.length; i += CHUNK) {
            const chunk = batch.slice(i, i + CHUNK);
            await Promise.all(chunk.map(async (em) => {
              try { await upsertEmail(accountId, folder.path, em); state.emailsSynced++; }
              catch (e: any) { state.errors.push(`${folder.path}: upsert ${em.id}: ${e.message}`); }
            }));
          }
        },
      );

      const localCount = await prisma.email.count({ where: { accountId, folder: folder.path } });
      if (localCount !== status.messages) {
        const serverUids = new Set((await listAllImapUids(accountId, folder.path)).map(String));
        const local = await prisma.email.findMany({
          where: { accountId, folder: folder.path },
          select: { id: true, externalId: true },
        });
        const stale = local.filter(e => {
          const parts = e.externalId.split(':');
          const uid = parts[parts.length - 1];
          return !serverUids.has(uid);
        }).map(e => e.id);
        if (stale.length > 0) {
          const res = await prisma.email.deleteMany({ where: { id: { in: stale } } });
          state.emailsRemoved += res.count;
        }
      }

      await prisma.mailFolder.update({
        where: { accountId_id: { accountId, id: folder.path } },
        data: {
          lastUid: Math.max(highestUid, effectiveLastUid),
          uidValidity: BigInt(uidValidity || status.uidValidity),
          totalItemCount: status.messages,
          lastSyncAt: new Date(),
        },
      });
    } catch (e: any) {
      state.errors.push(`${accountEmail} / ${folder.path}: ${e.message}`);
    }
    state.foldersDone++;
    // Throttle UI updates: write every 10 folders or when something interesting happened
    if (state.foldersDone % 10 === 0) {
      await updateJob(state.jobId, {
        foldersDone: state.foldersDone,
        emailsSynced: state.emailsSynced,
        emailsRemoved: state.emailsRemoved,
      });
    }
  };

  const queue = [...folders];
  const workers = Array.from({ length: IMAP_CONCURRENCY }, async () => {
    while (queue.length > 0) {
      if (await checkCancelled(state)) return;
      const folder = queue.shift();
      if (!folder) return;
      await syncOneImapFolder(folder);
    }
  });
  await Promise.all(workers);
  // Final flush so the UI sees the exact end state
  await updateJob(state.jobId, {
    foldersDone: state.foldersDone,
    emailsSynced: state.emailsSynced,
    emailsRemoved: state.emailsRemoved,
  });
}

/**
 * Called once at server startup: any 'running' row is an orphan from a prior
 * process (restart killed its worker). Mark them error so new jobs can start.
 */
export async function cleanupOrphanJobs(): Promise<number> {
  const result = await prisma.syncJob.updateMany({
    where: { status: 'running' },
    data: { status: 'error', finishedAt: new Date(), errors: ['Orphan (server restarted during sync)'] as any },
  });
  if (result.count > 0) console.log(`[SyncJob] cleaned ${result.count} orphan running job(s)`);
  return result.count;
}

export async function startSyncJob(accountId?: string): Promise<string> {
  // Only block if we actually have a worker in memory for that running job
  const running = await prisma.syncJob.findFirst({ where: { status: 'running' } });
  if (running && RUNNING_JOBS.has(running.id)) return running.id;
  // Running row with no in-memory worker = orphan; mark as error and continue
  if (running) {
    await prisma.syncJob.update({
      where: { id: running.id },
      data: { status: 'error', finishedAt: new Date(), errors: ['Orphan (no worker)'] as any },
    });
  }

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

  RUNNING_JOBS.set(job.id, state);

  // Fire-and-forget
  (async () => {
    try {
      const accounts = await prisma.emailAccount.findMany({
        where: accountId
          ? { id: accountId }
          : { provider: { in: ['MICROSOFT', 'IMAP'] } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      });
      accounts.sort((a, b) => {
        const score = (p: string) => (p === 'MICROSOFT' ? 0 : 1);
        return score(a.provider) - score(b.provider);
      });

      // Pre-compute total folders across all accounts so the progress bar is stable from the start
      const folderCounts = await prisma.mailFolder.groupBy({
        by: ['accountId'],
        where: { accountId: { in: accounts.map(a => a.id) } },
        _count: { id: true },
      });
      const totalFoldersEstimate = folderCounts.reduce((s, r) => s + r._count.id, 0);
      await updateJob(job.id, {
        foldersTotal: totalFoldersEstimate,
        accountsTotal: accounts.length,
        accountsDone: 0,
      });

      let accountsDone = 0;
      for (const acc of accounts) {
        if (state.cancelled) break;
        await updateJob(job.id, { currentAccount: acc.email });
        try {
          if (acc.provider === 'MICROSOFT') {
            await syncMicrosoftAccount(state, acc.id, acc.email);
          } else if (acc.provider === 'IMAP') {
            await syncImapAccount(state, acc.id, acc.email);
          }
          await prisma.emailAccount.update({
            where: { id: acc.id },
            data: { lastSyncAt: new Date() },
          });
        } catch (e: any) {
          state.errors.push(`${acc.email}: ${e.message}`);
        }
        accountsDone++;
        await updateJob(job.id, { accountsDone });
      }
      await updateJob(job.id, {
        status: state.cancelled ? 'cancelled' : 'done',
        phase: 'cleanup',
        currentFolder: null,
        finishedAt: new Date(),
        errors: state.errors.length > 0 ? state.errors.slice(0, 50) : null,
      });
      console.log(`[SyncJob ${job.id}] ${state.cancelled ? 'cancelled' : 'done'}: ${state.emailsSynced} synced, ${state.emailsRemoved} removed, ${state.errors.length} errors`);
    } catch (e: any) {
      console.error(`[SyncJob ${job.id}] fatal:`, e);
      await updateJob(job.id, {
        status: 'error',
        finishedAt: new Date(),
        errors: [e.message, ...state.errors].slice(0, 50),
      });
    } finally {
      RUNNING_JOBS.delete(job.id);
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
