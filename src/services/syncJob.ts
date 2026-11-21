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

interface JobState {
  jobId: string;
  errors: string[];
  foldersDone: number;
  emailsSynced: number;
  emailsRemoved: number;
  cancelled?: boolean;
  // Per-account progress shown as one line per mailbox in the UI
  accounts: Record<string, AccountProgress>;
}

interface AccountProgress {
  email: string;
  done: number;
  total: number;
  folder: string | null;
  status: 'waiting' | 'running' | 'done' | 'error';
}

function acct(state: JobState, email: string): AccountProgress {
  return state.accounts[email] || (state.accounts[email] = { email, done: 0, total: 0, folder: null, status: 'running' });
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
  // Graph delta returns SPARSE updates: when an existing email is modified (eg isRead toggled),
  // only {id, isRead} may come back. We must not overwrite from/subject/body with defaults.
  const hasFrom = Object.prototype.hasOwnProperty.call(g, 'from');
  const hasTo = Object.prototype.hasOwnProperty.call(g, 'toRecipients');
  const hasSubject = Object.prototype.hasOwnProperty.call(g, 'subject');
  const hasBody = Object.prototype.hasOwnProperty.call(g, 'bodyPreview');
  const hasReceived = Object.prototype.hasOwnProperty.call(g, 'receivedDateTime');
  const hasRead = Object.prototype.hasOwnProperty.call(g, 'isRead');
  const hasImportance = Object.prototype.hasOwnProperty.call(g, 'importance');
  const hasAttach = Object.prototype.hasOwnProperty.call(g, 'hasAttachments');

  const fromName = g.from?.emailAddress?.name || '';
  const fromEmail = g.from?.emailAddress?.address || '';
  const fromDisplay = fromEmail
    ? (fromName && fromName !== fromEmail ? `${fromName} <${fromEmail}>` : fromEmail)
    : null;
  const toAddress = g.toRecipients?.[0]?.emailAddress?.address || null;

  const existing = await prisma.email.findUnique({ where: { externalId: g.id }, select: { id: true } });

  const updateData: any = { folder: folderId };
  if (hasFrom && fromDisplay) updateData.from = fromDisplay;
  if (hasTo) updateData.to = toAddress;
  if (hasSubject) updateData.subject = g.subject || null;
  if (hasBody) updateData.bodyPreview = g.bodyPreview || null;
  if (hasRead) updateData.isRead = !!g.isRead;
  if (hasImportance) updateData.importance = g.importance || null;
  if (hasAttach) updateData.hasAttachments = !!g.hasAttachments;

  const email = await prisma.email.upsert({
    where: { externalId: g.id },
    create: {
      externalId: g.id, accountId,
      from: fromDisplay || 'unknown',
      to: toAddress,
      subject: hasSubject ? (g.subject || null) : null,
      bodyPreview: hasBody ? (g.bodyPreview || null) : null,
      folder: folderId,
      receivedAt: hasReceived && g.receivedDateTime ? new Date(g.receivedDateTime) : new Date(),
      isRead: hasRead ? !!g.isRead : false,
      importance: hasImportance ? (g.importance || null) : null,
      hasAttachments: hasAttach ? !!g.hasAttachments : false,
    },
    update: updateData,
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
  // Parallelize upserts: thousands of folders at 1 roundtrip each stalls the whole job
  const UPSERT_CHUNK = 20;
  for (let i = 0; i < folders.length; i += UPSERT_CHUNK) {
    if (await checkCancelled(state)) return;
    const chunk = folders.slice(i, i + UPSERT_CHUNK);
    await Promise.all(chunk.map(f => prisma.mailFolder.upsert({
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
    })));
  }
  acct(state, accountEmail).total = folders.length;
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
    // Atomic increment: several accounts sync in parallel and may hit this at the same time
    await updateJob(state.jobId, { foldersTotal: { increment: folders.length - prevLocalCount }, phase: 'emails' });
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
          // Mid-folder update so UI reflects progress inside big folders
          if (changed.length > 0) {
            await updateJob(state.jobId, { emailsSynced: state.emailsSynced });
          }
          // Archive rules are applied manually (context menu), not automatically here
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
    { const a = acct(state, accountEmail); a.done++; a.folder = folder.path; }
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
  acct(state, accountEmail).total = folders.length;
  const serverPaths = new Set(folders.map(f => f.path));
  const localFolders = await prisma.mailFolder.findMany({ where: { accountId }, select: { id: true } });
  const toDrop = localFolders.filter(f => !serverPaths.has(f.id)).map(f => f.id);
  if (toDrop.length > 0) {
    await prisma.mailFolder.deleteMany({ where: { accountId, id: { in: toDrop } } });
  }

  const prevLocalCount = localFolders.length;
  if (folders.length > prevLocalCount) {
    // Atomic increment: several accounts sync in parallel and may hit this at the same time
    await updateJob(state.jobId, { foldersTotal: { increment: folders.length - prevLocalCount }, phase: 'emails' });
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
      acct(state, accountEmail).folder = folder.path;
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
    } finally {
      // Count EVERY folder, including the fast-path ones that return early above
      state.foldersDone++;
      acct(state, accountEmail).done++;
    }
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

export async function startSyncJob(accountIds?: string[]): Promise<string> {
  const accountId = accountIds && accountIds.length === 1 ? accountIds[0] : undefined;
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
    accounts: {},
  };

  RUNNING_JOBS.set(job.id, state);
  // Flush per-account progress once a second (cheap: one row update)
  const flushProgress = () => updateJob(job.id, {
    accountsProgress: Object.values(state.accounts) as any,
    foldersDone: state.foldersDone,
    emailsSynced: state.emailsSynced,
    emailsRemoved: state.emailsRemoved,
  }).catch(() => {});
  const flushTimer = setInterval(flushProgress, 1000);

  // Fire-and-forget
  (async () => {
    try {
      const accounts = await prisma.emailAccount.findMany({
        where: accountIds && accountIds.length > 0
          ? { id: { in: accountIds } }
          : { provider: { in: ['MICROSOFT', 'IMAP'] } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      });
      accounts.sort((a, b) => {
        const score = (p: string) => (p === 'MICROSOFT' ? 0 : 1);
        return score(a.provider) - score(b.provider);
      });
      for (const a of accounts) state.accounts[a.email] = { email: a.email, done: 0, total: 0, folder: null, status: 'running' };

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

      // All mailboxes sync at the same time (like Outlook's send/receive): each account
      // talks to a different server, so total time ~ the slowest account, not the sum.
      let accountsDone = 0;
      const active = new Set<string>();
      const showActive = () => updateJob(job.id, { currentAccount: [...active].join(', ') || null });
      await Promise.all(accounts.map(async (acc) => {
        if (state.cancelled) return;
        active.add(acc.email);
        await showActive();
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
          acct(state, acc.email).status = 'done';
        } catch (e: any) {
          state.errors.push(`${acc.email}: ${e.message}`);
          acct(state, acc.email).status = 'error';
        }
        active.delete(acc.email);
        accountsDone++;
        await updateJob(job.id, { accountsDone, currentAccount: [...active].join(', ') || null });
      }));
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
      clearInterval(flushTimer);
      await flushProgress();
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
