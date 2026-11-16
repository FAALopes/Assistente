import { prisma } from '../index';
import {
  getValidToken,
  listAllMailFoldersFlat,
  fetchAccountDelta,
  type FlatFolder,
} from './graphService';
import {
  listAllImapFolders,
  getFolderStatus,
  fetchImapMessagesSince,
  listAllImapUids,
  type ImapFlatFolder,
} from './imapService';

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

  // 2) Account-wide delta: ONE stream for all folders instead of iterating each
  const prev = await prisma.syncJob.findUnique({ where: { id: state.jobId }, select: { foldersTotal: true } });
  await updateJob(state.jobId, {
    phase: 'emails',
    foldersTotal: (prev?.foldersTotal || 0) + 1,  // treat whole account as 1 "folder" for progress
    currentFolder: `${accountEmail} (delta global)`,
  });

  const acc = await prisma.emailAccount.findUnique({ where: { id: accountId }, select: { globalDeltaLink: true } });
  try {
    const { deltaLink } = await fetchAccountDelta(
      token,
      acc?.globalDeltaLink || null,
      async (items, _total) => {
        if (await checkCancelled(state)) return;
        const changed = items.filter(i => !i.removed);
        const removed = items.filter(i => i.removed).map(i => i.id);
        for (const em of changed) {
          try {
            await upsertEmail(accountId, em.parentFolderId || 'inbox', em as any);
            state.emailsSynced++;
          } catch (e: any) {
            state.errors.push(`${accountEmail}: upsert ${em.id}: ${e.message}`);
          }
        }
        if (removed.length > 0) {
          const res = await prisma.email.deleteMany({ where: { externalId: { in: removed } } });
          state.emailsRemoved += res.count;
        }
        await updateJob(state.jobId, {
          emailsSynced: state.emailsSynced,
          emailsRemoved: state.emailsRemoved,
        });
      },
    );
    await prisma.emailAccount.update({
      where: { id: accountId },
      data: { globalDeltaLink: deltaLink },
    });
  } catch (e: any) {
    state.errors.push(`${accountEmail}: account delta failed: ${e.message}`);
  }
  state.foldersDone++;
  await updateJob(state.jobId, { foldersDone: state.foldersDone });
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
    if (await checkCancelled(state)) return;
    await updateJob(state.jobId, { currentFolder: `${accountEmail} / ${folder.path}` });
    try {
      const row = await prisma.mailFolder.findUnique({
        where: { accountId_id: { accountId, id: folder.path } },
        select: { lastUid: true, uidValidity: true, totalItemCount: true },
      });

      // Cheap STATUS first: skip if nothing changed
      const status = await getFolderStatus(accountId, folder.path);
      if (!status) {
        state.foldersDone++;
        await updateJob(state.jobId, { foldersDone: state.foldersDone });
        continue;
      }

      const storedUidValidity = row?.uidValidity ? Number(row.uidValidity) : 0;
      const uidValidityChanged = storedUidValidity && storedUidValidity !== status.uidValidity;
      const effectiveLastUid = uidValidityChanged ? 0 : (row?.lastUid || 0);

      // Fast path: nothing new AND message count matches -> no fetch, no deletion scan
      const serverLastUid = Math.max(0, status.uidNext - 1);
      if (!uidValidityChanged && effectiveLastUid >= serverLastUid && status.messages === (row?.totalItemCount || 0)) {
        state.foldersDone++;
        await updateJob(state.jobId, { foldersDone: state.foldersDone });
        continue;
      }

      // Fetch new since lastUid (or all if uidValidity changed)
      if (uidValidityChanged) {
        // Nuke the local copy of this folder before full refetch
        await prisma.email.deleteMany({ where: { accountId, folder: folder.path } });
      }
      const { highestUid, uidValidity } = await fetchImapMessagesSince(
        accountId, folder.path, effectiveLastUid,
        async (batch, _total) => {
          for (const em of batch) {
            try { await upsertEmail(accountId, folder.path, em); state.emailsSynced++; }
            catch (e: any) { state.errors.push(`${folder.path}: upsert ${em.id}: ${e.message}`); }
          }
          await updateJob(state.jobId, { emailsSynced: state.emailsSynced });
        },
      );

      // Deletion detection: if server msg count diverges from local, reconcile via UID list
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
          await updateJob(state.jobId, { emailsRemoved: state.emailsRemoved });
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
    await updateJob(state.jobId, { foldersDone: state.foldersDone });
  }
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
      for (const acc of accounts) {
        if (state.cancelled) break;
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
