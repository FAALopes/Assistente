import { prisma } from '../index';
import { getValidToken, fetchEmails as graphFetchEmails, deleteEmail as graphDeleteEmail } from './graphService';
import { classifyJunkEmails, TriageActionType } from './triageService';

// Confidence threshold: only auto-delete junk emails that AI is very sure about
const AUTO_DELETE_CONFIDENCE_THRESHOLD = 85;

// How often to run auto-cleanup (4 hours)
const CLEANUP_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Folder to clean
const JUNK_FOLDER = 'junkemail';

interface CleanupResult {
  accountEmail: string;
  synced: number;
  classified: number;
  deleted: number;
  errors: string[];
}

async function cleanupAccount(accountId: string, accountEmail: string): Promise<CleanupResult> {
  const result: CleanupResult = {
    accountEmail,
    synced: 0,
    classified: 0,
    deleted: 0,
    errors: [],
  };

  try {
    const accessToken = await getValidToken(accountId);

    // 1. Sync junk folder to get latest emails
    const graphEmails = await graphFetchEmails(accessToken, JUNK_FOLDER);
    const serverIds = new Set(graphEmails.map(e => e.id));

    for (const ge of graphEmails) {
      const fromName = ge.from?.emailAddress?.name || '';
      const fromEmail = ge.from?.emailAddress?.address || 'unknown';
      const fromDisplay = fromName && fromName !== fromEmail ? `${fromName} <${fromEmail}>` : fromEmail;
      const toAddress = ge.toRecipients?.[0]?.emailAddress?.address || null;

      await prisma.email.upsert({
        where: { externalId: ge.id },
        create: {
          externalId: ge.id,
          accountId,
          from: fromDisplay,
          to: toAddress,
          subject: ge.subject || null,
          bodyPreview: ge.bodyPreview || null,
          folder: JUNK_FOLDER,
          receivedAt: ge.receivedDateTime ? new Date(ge.receivedDateTime) : new Date(),
          isRead: ge.isRead || false,
          importance: ge.importance || null,
          hasAttachments: ge.hasAttachments || false,
        },
        update: {
          from: fromDisplay,
          isRead: ge.isRead || false,
          importance: ge.importance || null,
          folder: JUNK_FOLDER,
        },
      });
      result.synced++;
    }

    // Remove from DB junk emails no longer on server
    const localJunk = await prisma.email.findMany({
      where: { accountId, folder: JUNK_FOLDER },
      select: { id: true, externalId: true },
    });
    const stale = localJunk.filter(e => !serverIds.has(e.externalId)).map(e => e.id);
    if (stale.length > 0) {
      await prisma.email.deleteMany({ where: { id: { in: stale } } });
    }

    // 2. Classify uncached junk emails with AI
    const junkEmails = await prisma.email.findMany({
      where: { accountId, folder: JUNK_FOLDER, triageAction: null },
      take: 200,
      select: {
        id: true, from: true, subject: true, bodyPreview: true, receivedAt: true,
        triageAction: true, triageReason: true, triageConfidence: true, triageClassifiedAt: true,
      },
    });

    if (junkEmails.length > 0) {
      const classifications = await classifyJunkEmails(junkEmails);
      result.classified = classifications.length;
      for (const c of classifications) {
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
        } catch (e: any) {
          result.errors.push(`Save classification failed for ${c.emailId}: ${e.message}`);
        }
      }
    }

    // 3. Auto-delete high-confidence DELETE classifications
    const toDelete = await prisma.email.findMany({
      where: {
        accountId,
        folder: JUNK_FOLDER,
        triageAction: 'DELETE' as TriageActionType,
        triageConfidence: { gte: AUTO_DELETE_CONFIDENCE_THRESHOLD },
      },
    });

    for (const email of toDelete) {
      try {
        await graphDeleteEmail(accessToken, email.externalId);
        await prisma.email.delete({ where: { id: email.id } });
        result.deleted++;
      } catch (e: any) {
        result.errors.push(`Delete failed for ${email.from}: ${e.message}`);
      }
    }
  } catch (e: any) {
    result.errors.push(`Account-level error: ${e.message}`);
  }

  return result;
}

async function runCleanup(): Promise<void> {
  console.log('[AutoCleanup] Starting scheduled junk cleanup...');
  const accounts = await prisma.emailAccount.findMany({
    where: { provider: 'MICROSOFT' },
    select: { id: true, email: true },
  });

  let totalDeleted = 0;
  for (const acc of accounts) {
    try {
      const r = await cleanupAccount(acc.id, acc.email);
      totalDeleted += r.deleted;
      console.log(`[AutoCleanup] ${acc.email}: synced=${r.synced} classified=${r.classified} deleted=${r.deleted} errors=${r.errors.length}`);
      if (r.errors.length > 0) {
        for (const err of r.errors.slice(0, 3)) console.error(`  ! ${err}`);
      }
    } catch (e: any) {
      console.error(`[AutoCleanup] Failed for ${acc.email}: ${e.message}`);
    }
  }
  console.log(`[AutoCleanup] Done. Total deleted: ${totalDeleted}`);
}

export function startAutoCleanup(): void {
  // Run once on startup after a short delay (let server settle)
  setTimeout(() => {
    runCleanup().catch(e => console.error('[AutoCleanup] Initial run failed:', e));
  }, 60 * 1000); // 1 minute after startup

  // Schedule recurring runs
  setInterval(() => {
    runCleanup().catch(e => console.error('[AutoCleanup] Scheduled run failed:', e));
  }, CLEANUP_INTERVAL_MS);

  console.log(`[AutoCleanup] Scheduled to run every ${CLEANUP_INTERVAL_MS / 1000 / 60} minutes (initial run in 1 min)`);
}

// Export for manual trigger via API
export { runCleanup };
