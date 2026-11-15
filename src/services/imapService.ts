import { ImapFlow } from 'imapflow';
import { prisma } from '../index';
import { decryptSecret } from './crypto';

export interface MailEnvelope {
  id: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  importance?: string;
  hasAttachments?: boolean;
}

export interface ImapFolderMap {
  inbox: string;
  junk: string | null;
  trash: string | null;
  sent: string | null;
  drafts: string | null;
  archive: string | null;
}

async function openClient(accountId: string): Promise<ImapFlow> {
  const acc = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!acc || acc.provider !== 'IMAP') throw new Error('Not an IMAP account');
  if (!acc.imapHost || !acc.imapPort || !acc.imapUser || !acc.imapPasswordEnc) {
    throw new Error('IMAP account missing connection details');
  }
  const pass = decryptSecret(acc.imapPasswordEnc);
  const client = new ImapFlow({
    host: acc.imapHost,
    port: acc.imapPort,
    secure: acc.imapTls,
    auth: { user: acc.imapUser, pass },
    logger: false,
  });
  await client.connect();
  return client;
}

export async function testImapConnection(params: {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}): Promise<{ ok: true; folders: string[] } | { ok: false; error: string }> {
  const client = new ImapFlow({
    host: params.host,
    port: params.port,
    secure: params.tls,
    auth: { user: params.user, pass: params.password },
    logger: false,
  });
  try {
    await client.connect();
    const list = await client.list();
    await client.logout();
    return { ok: true, folders: list.map(f => f.path) };
  } catch (e: any) {
    try { await client.logout(); } catch { /* ignore */ }
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function detectFolders(accountId: string): Promise<ImapFolderMap> {
  const client = await openClient(accountId);
  try {
    const list = await client.list();
    const byRole: Partial<Record<string, string>> = {};
    for (const f of list) {
      const role = (f.specialUse || '').toLowerCase().replace('\\', '');
      if (role && !byRole[role]) byRole[role] = f.path;
    }
    const pathByName = (candidates: string[]): string | null => {
      for (const c of candidates) {
        const match = list.find(f => f.path.toLowerCase() === c.toLowerCase());
        if (match) return match.path;
      }
      return null;
    };
    return {
      inbox: byRole['inbox'] || pathByName(['INBOX']) || 'INBOX',
      junk: byRole['junk'] || pathByName(['INBOX.Junk', 'INBOX.spam', 'Junk', 'Spam', 'INBOX.SPAM']),
      trash: byRole['trash'] || pathByName(['INBOX.Trash', 'Trash', 'Deleted', 'INBOX.Deleted']),
      sent: byRole['sent'] || pathByName(['INBOX.Sent', 'Sent']),
      drafts: byRole['drafts'] || pathByName(['INBOX.Drafts', 'Drafts']),
      archive: byRole['archive'] || pathByName(['INBOX.Archive', 'Archive']),
    };
  } finally {
    await client.logout();
  }
}

export interface ImapFlatFolder {
  path: string;
  displayName: string;
  parentPath: string | null;
  depth: number;
  wellKnownName: string | null;
  totalItemCount: number;
}

const IMAP_ROLE_TO_WK: Record<string, string> = {
  inbox: 'inbox',
  junk: 'junkemail',
  trash: 'deleteditems',
  sent: 'sentitems',
  drafts: 'drafts',
  archive: 'archive',
};

export async function listAllImapFolders(accountId: string): Promise<ImapFlatFolder[]> {
  const client = await openClient(accountId);
  try {
    const list = await client.list();
    const out: ImapFlatFolder[] = [];
    for (const f of list) {
      const path = f.path;
      const delim = f.delimiter || '/';
      const parts = path.split(delim);
      const displayName = parts[parts.length - 1];
      const parentPath = parts.length > 1 ? parts.slice(0, -1).join(delim) : null;
      const depth = parts.length - 1;
      const role = (f.specialUse || '').toLowerCase().replace('\\', '');
      let wk: string | null = IMAP_ROLE_TO_WK[role] || null;
      if (!wk && path.toUpperCase() === 'INBOX') wk = 'inbox';
      // Get mailbox stats (exists/unseen). client.status is cheap on many servers.
      let total = 0;
      try {
        const st: any = await client.status(path, { messages: true });
        total = st?.messages || 0;
      } catch { /* ignore */ }
      out.push({ path, displayName, parentPath, depth, wellKnownName: wk, totalItemCount: total });
    }
    return out;
  } finally {
    await client.logout();
  }
}

/**
 * Fetch ALL messages in a folder (no cap). Calls onBatch periodically.
 */
export async function fetchAllImapMessages(
  accountId: string,
  folderPath: string,
  onBatch?: (batch: MailEnvelope[], totalSoFar: number) => Promise<void>,
  chunkSize = 500,
): Promise<number> {
  const client = await openClient(accountId);
  let totalSoFar = 0;
  try {
    const lock = await client.getMailboxLock(folderPath);
    try {
      const mb: any = client.mailbox;
      const total: number = mb?.exists || 0;
      if (total === 0) return 0;
      // Fetch in chunks from newest to oldest
      let end = total;
      while (end >= 1) {
        const start = Math.max(1, end - chunkSize + 1);
        const range = `${start}:${end}`;
        const batch: MailEnvelope[] = [];
        for await (const msg of client.fetch(range, {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
          bodyStructure: true,
          source: false,
        } as any)) {
          const env = msg.envelope as any;
          const fromAddr = env?.from?.[0];
          const toAddr = env?.to?.[0];
          const flagsVal = msg.flags as unknown;
          const flags = flagsVal instanceof Set ? flagsVal : new Set<string>(flagsVal as string[] | undefined);
          const bs: any = msg.bodyStructure;
          const hasAttachments = Boolean(bs && hasAttachmentPart(bs));
          batch.push({
            id: buildExternalId(accountId, folderPath, Number(msg.uid)),
            from: fromAddr ? {
              emailAddress: {
                address: fromAddr.address ? `${fromAddr.address}` : undefined,
                name: fromAddr.name || undefined,
              },
            } : undefined,
            toRecipients: toAddr ? [{ emailAddress: { address: toAddr.address } }] : [],
            subject: env?.subject || '',
            bodyPreview: '',
            receivedDateTime: (msg.internalDate || env?.date || new Date()).toISOString(),
            isRead: flags.has('\\Seen'),
            importance: null as any,
            hasAttachments,
          });
        }
        totalSoFar += batch.length;
        if (onBatch && batch.length > 0) await onBatch(batch, totalSoFar);
        end = start - 1;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return totalSoFar;
}

export function buildExternalId(accountId: string, folder: string, uid: number): string {
  return `imap:${accountId}:${folder}:${uid}`;
}

export function parseExternalId(ext: string): { accountId: string; folder: string; uid: number } | null {
  if (!ext.startsWith('imap:')) return null;
  const parts = ext.split(':');
  if (parts.length < 4) return null;
  const uid = parseInt(parts[parts.length - 1], 10);
  if (!Number.isFinite(uid)) return null;
  const accountId = parts[1];
  const folder = parts.slice(2, -1).join(':');
  return { accountId, folder, uid };
}

export async function fetchEmailsFromFolder(
  accountId: string,
  folderPath: string,
  maxEmails = 500,
): Promise<MailEnvelope[]> {
  const client = await openClient(accountId);
  try {
    const lock = await client.getMailboxLock(folderPath);
    const out: MailEnvelope[] = [];
    try {
      const mb: any = client.mailbox;
      const total: number = mb?.exists || 0;
      if (total === 0) return out;
      const first = Math.max(1, total - maxEmails + 1);
      const range = `${first}:*`;
      for await (const msg of client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        bodyStructure: true,
        source: false,
        headers: ['importance', 'x-priority'],
      } as any)) {
        const env = msg.envelope as any;
        const fromAddr = env?.from?.[0];
        const toAddr = env?.to?.[0];
        const flagsVal = msg.flags as unknown;
        const flags = flagsVal instanceof Set ? flagsVal : new Set<string>(flagsVal as string[] | undefined);
        const bs: any = msg.bodyStructure;
        const hasAttachments = Boolean(bs && hasAttachmentPart(bs));
        out.push({
          id: buildExternalId(accountId, folderPath, Number(msg.uid)),
          from: fromAddr ? {
            emailAddress: {
              address: fromAddr.address ? `${fromAddr.address}` : undefined,
              name: fromAddr.name || undefined,
            },
          } : undefined,
          toRecipients: toAddr ? [{ emailAddress: { address: toAddr.address } }] : [],
          subject: env?.subject || '',
          bodyPreview: '',
          receivedDateTime: (msg.internalDate || env?.date || new Date()).toISOString(),
          isRead: flags.has('\\Seen'),
          importance: null as any,
          hasAttachments,
        });
      }
    } finally {
      lock.release();
    }
    return out.reverse();
  } finally {
    await client.logout();
  }
}

function hasAttachmentPart(bs: any): boolean {
  if (!bs) return false;
  if (bs.disposition && String(bs.disposition).toLowerCase() === 'attachment') return true;
  if (Array.isArray(bs.childNodes)) {
    for (const c of bs.childNodes) if (hasAttachmentPart(c)) return true;
  }
  return false;
}

export async function moveMessage(
  accountId: string,
  fromFolder: string,
  uid: number,
  toFolder: string,
): Promise<void> {
  const client = await openClient(accountId);
  try {
    const lock = await client.getMailboxLock(fromFolder);
    try {
      await client.messageMove(String(uid), toFolder, { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

export async function deleteMessageByExternalId(accountId: string, externalId: string): Promise<void> {
  const parsed = parseExternalId(externalId);
  if (!parsed) throw new Error('Invalid IMAP externalId');
  const folders = await detectFolders(accountId);
  const dest = folders.trash || 'Trash';
  if (parsed.folder.toLowerCase() === dest.toLowerCase()) {
    // Already in trash — expunge
    const client = await openClient(accountId);
    try {
      const lock = await client.getMailboxLock(parsed.folder);
      try {
        await client.messageDelete(String(parsed.uid), { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  } else {
    await moveMessage(accountId, parsed.folder, parsed.uid, dest);
  }
}

export async function moveToInboxByExternalId(accountId: string, externalId: string): Promise<void> {
  const parsed = parseExternalId(externalId);
  if (!parsed) throw new Error('Invalid IMAP externalId');
  const folders = await detectFolders(accountId);
  await moveMessage(accountId, parsed.folder, parsed.uid, folders.inbox);
}
