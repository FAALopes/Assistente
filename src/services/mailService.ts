// Provider-agnostic mail operations. Dispatches to graphService (Microsoft) or imapService (IMAP).
import { prisma } from '../index';
import * as graph from './graphService';
import * as imap from './imapService';

export interface MailEnvelope {
  id: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  importance?: string | null;
  hasAttachments?: boolean;
}

// Folder keys the app uses internally. Microsoft Graph uses these names directly ("inbox", "junkemail").
// For IMAP we translate: inbox -> detected inbox path, junkemail -> detected junk path.
export type FolderKey = 'inbox' | 'junkemail';

async function imapFolderForKey(accountId: string, key: FolderKey): Promise<string | null> {
  const folders = await imap.detectFolders(accountId);
  if (key === 'inbox') return folders.inbox;
  if (key === 'junkemail') return folders.junk;
  return null;
}

export async function fetchEmails(accountId: string, folderKey: FolderKey, maxEmails = 500): Promise<MailEnvelope[]> {
  const acc = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!acc) throw new Error('Account not found');
  if (acc.provider === 'MICROSOFT') {
    const token = await graph.getValidToken(accountId);
    return graph.fetchEmails(token, folderKey, maxEmails) as Promise<MailEnvelope[]>;
  }
  if (acc.provider === 'IMAP') {
    const folderPath = await imapFolderForKey(accountId, folderKey);
    if (!folderPath) return [];
    return imap.fetchEmailsFromFolder(accountId, folderPath, maxEmails);
  }
  return [];
}

export async function deleteEmail(accountId: string, externalId: string): Promise<void> {
  const acc = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!acc) throw new Error('Account not found');
  if (acc.provider === 'MICROSOFT') {
    const token = await graph.getValidToken(accountId);
    return graph.deleteEmail(token, externalId);
  }
  if (acc.provider === 'IMAP') {
    return imap.deleteMessageByExternalId(accountId, externalId);
  }
}

export async function moveEmailToInbox(accountId: string, externalId: string): Promise<void> {
  const acc = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!acc) throw new Error('Account not found');
  if (acc.provider === 'MICROSOFT') {
    const token = await graph.getValidToken(accountId);
    return graph.moveEmailToInbox(token, externalId);
  }
  if (acc.provider === 'IMAP') {
    return imap.moveToInboxByExternalId(accountId, externalId);
  }
}

/**
 * Move a message to any folder of its account (folderId = MailFolder.id: Graph folder id or IMAP path).
 * Returns the message's new externalId when the server reports it, otherwise null.
 */
export async function moveEmailToFolder(accountId: string, externalId: string, folderId: string): Promise<string | null> {
  const acc = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!acc) throw new Error('Account not found');
  if (acc.provider === 'MICROSOFT') {
    const token = await graph.getValidToken(accountId);
    return graph.moveEmailToFolder(token, externalId, folderId);
  }
  if (acc.provider === 'IMAP') {
    const parsed = imap.parseExternalId(externalId);
    if (!parsed) throw new Error('Invalid IMAP externalId');
    const newUid = await imap.moveMessage(accountId, parsed.folder, parsed.uid, folderId);
    return newUid !== null ? imap.buildExternalId(accountId, folderId, newUid) : null;
  }
  throw new Error('Provider not supported');
}

/** Raw MIME source of a message, whatever the provider. */
export async function getRawMime(accountId: string, externalId: string): Promise<Buffer> {
  const acc = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!acc) throw new Error('Account not found');
  if (acc.provider === 'MICROSOFT') return graph.getMessageMime(await graph.getValidToken(accountId), externalId);
  if (acc.provider === 'IMAP') return imap.getRawMessage(accountId, externalId);
  throw new Error('Provider not supported');
}

/** Store a copy of a MIME message in a folder of (another) account. Returns the new externalId if known. */
export async function importMime(
  accountId: string, folderId: string, raw: Buffer, opts: { isRead: boolean; receivedAt: Date },
): Promise<string | null> {
  const acc = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!acc) throw new Error('Account not found');
  if (acc.provider === 'MICROSOFT') {
    return graph.importMimeToFolder(await graph.getValidToken(accountId), folderId, raw, opts);
  }
  if (acc.provider === 'IMAP') {
    const uid = await imap.appendMessage(accountId, folderId, raw, opts.isRead, opts.receivedAt);
    return uid !== null ? imap.buildExternalId(accountId, folderId, uid) : null;
  }
  throw new Error('Provider not supported');
}
