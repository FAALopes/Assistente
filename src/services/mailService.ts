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
