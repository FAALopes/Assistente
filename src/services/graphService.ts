import { Client } from '@microsoft/microsoft-graph-client';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { prisma } from '../index';

interface GraphEmail {
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

interface MailFolder {
  id: string;
  displayName: string;
  totalItemCount: number;
  unreadItemCount: number;
}

// Build MSAL client dynamically so we can read the client secret from the DB
// (allowing users to rotate the secret via the app UI without a redeploy).
async function getMsalClient(): Promise<ConfidentialClientApplication> {
  let clientSecret = process.env.AZURE_CLIENT_SECRET || '';
  try {
    const config = await prisma.appConfig.findUnique({ where: { id: 'singleton' } });
    if (config?.azureClientSecret) clientSecret = config.azureClientSecret;
  } catch {
    // Table may not exist on first startup — fall back to env
  }
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.AZURE_CLIENT_ID || '',
      authority: 'https://login.microsoftonline.com/common',
      clientSecret,
    },
  });
}

/**
 * Refresh the access token using the refresh token stored in DB.
 * Updates the account record with new tokens.
 */
export async function refreshAccessToken(accountId: string): Promise<string> {
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!account || !account.refreshToken) {
    throw new Error('No refresh token available for account');
  }

  const msalClient = await getMsalClient();
  const FULL_SCOPES = ['user.read', 'mail.read', 'mail.readwrite', 'files.readwrite', 'offline_access'];
  const LEGACY_SCOPES = ['user.read', 'mail.read', 'mail.readwrite', 'offline_access'];

  const tryScopes = async (scopes: string[]) => {
    const result = await msalClient.acquireTokenByRefreshToken({
      refreshToken: account.refreshToken!,
      scopes,
    });
    if (!result) throw new Error('Token refresh returned null');
    return result;
  };

  try {
    let result;
    try {
      try {
        // Accounts (re)added after 22-11-2026 also consented to mail.send (reply/forward from the app)
        result = await tryScopes(['mail.send', ...FULL_SCOPES]);
      } catch {
        result = await tryScopes(FULL_SCOPES);
      }
    } catch (e: any) {
      // Scope not consented (likely files.readwrite on a legacy account) -> keep working with mail-only
      result = await tryScopes(LEGACY_SCOPES);
    }

    const newRefreshToken = (result as any).refreshToken || account.refreshToken;

    await prisma.emailAccount.update({
      where: { id: accountId },
      data: {
        accessToken: result.accessToken,
        refreshToken: newRefreshToken,
        tokenExpiry: result.expiresOn || null,
      },
    });

    return result.accessToken;
  } catch (error) {
    console.error(`Failed to refresh token for account ${accountId}:`, error);
    throw new Error('Token refresh failed. User may need to re-authenticate.');
  }
}

/**
 * Get a valid access token for the account, refreshing if expired.
 */
export async function getValidToken(accountId: string): Promise<string> {
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    throw new Error('Account not found');
  }

  // Check if token is expired (with 5-minute buffer)
  if (account.tokenExpiry && new Date(account.tokenExpiry) < new Date(Date.now() + 5 * 60 * 1000)) {
    return refreshAccessToken(accountId);
  }

  return account.accessToken;
}

/**
 * Create an authenticated Microsoft Graph client.
 */
function createGraphClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
}

/**
 * Fetch emails from Microsoft Graph inbox (or specific folder).
 * Paginates automatically to fetch up to `maxEmails` (default 500).
 */
export async function fetchEmails(
  accessToken: string,
  folderId?: string,
  maxEmails: number = 500,
): Promise<GraphEmail[]> {
  try {
    const client = createGraphClient(accessToken);
    const folder = folderId || 'inbox';
    const allEmails: GraphEmail[] = [];
    const pageSize = Math.min(maxEmails, 200); // Graph API max per request
    let skip = 0;

    while (allEmails.length < maxEmails) {
      const remaining = maxEmails - allEmails.length;
      const top = Math.min(pageSize, remaining);

      const response = await client
        .api(`/me/mailFolders/${folder}/messages`)
        .top(top)
        .skip(skip)
        .select('id,from,toRecipients,subject,bodyPreview,receivedDateTime,isRead,importance,hasAttachments')
        .orderby('receivedDateTime desc')
        .get();

      const emails = response.value || [];
      allEmails.push(...emails);

      // Stop if we got fewer than requested (no more emails)
      if (emails.length < top) {
        break;
      }

      skip += emails.length;
    }

    console.log(`Fetched ${allEmails.length} emails from folder ${folder}`);
    return allEmails;
  } catch (error: any) {
    console.error('Error fetching emails from Graph:', error?.message || error);
    throw new Error('Failed to fetch emails from Microsoft Graph');
  }
}

/**
 * Move an email to the Deleted Items folder (trash).
 */
export async function deleteEmail(accessToken: string, emailId: string): Promise<void> {
  try {
    const client = createGraphClient(accessToken);

    // Move to deletedItems folder
    await client
      .api(`/me/messages/${emailId}/move`)
      .post({ destinationId: 'deleteditems' });
  } catch (error: any) {
    console.error('Error deleting email via Graph:', error?.message || error);
    throw new Error('Failed to delete email via Microsoft Graph');
  }
}

/**
 * Move an email to the Inbox folder.
 */
export async function moveEmailToInbox(accessToken: string, emailId: string): Promise<void> {
  try {
    const client = createGraphClient(accessToken);

    await client
      .api(`/me/messages/${emailId}/move`)
      .post({ destinationId: 'inbox' });
  } catch (error: any) {
    console.error('Error moving email to inbox via Graph:', error?.message || error);
    throw new Error('Failed to move email to inbox via Microsoft Graph');
  }
}

/**
 * List mail folders for the account.
 */
export async function getMailFolders(accessToken: string): Promise<MailFolder[]> {
  try {
    const client = createGraphClient(accessToken);

    const response = await client
      .api('/me/mailFolders')
      .select('id,displayName,totalItemCount,unreadItemCount')
      .get();

    return response.value || [];
  } catch (error: any) {
    console.error('Error fetching mail folders from Graph:', error?.message || error);
    throw new Error('Failed to fetch mail folders from Microsoft Graph');
  }
}

export interface FlatFolder {
  id: string;
  displayName: string;
  parentId: string | null;
  path: string;
  depth: number;
  wellKnownName: string | null;
  totalItemCount: number;
  unreadItemCount: number;
}

/**
 * Well-known folder names in Microsoft Graph (exposed via /me/mailFolders/{name}).
 * We derive the well-known name by matching displayName against the top-level folders.
 */
const WELL_KNOWN_BY_NAME: Record<string, string> = {
  'Inbox': 'inbox',
  'Caixa de Entrada': 'inbox',
  'Junk Email': 'junkemail',
  'E-mail de Lixo Eletronico': 'junkemail',
  'E-mail de Lixo Eletrónico': 'junkemail',
  'Sent Items': 'sentitems',
  'Itens Enviados': 'sentitems',
  'Drafts': 'drafts',
  'Rascunhos': 'drafts',
  'Deleted Items': 'deleteditems',
  'Itens Eliminados': 'deleteditems',
  'Archive': 'archive',
  'Arquivo': 'archive',
  'Outbox': 'outbox',
  'A Enviar': 'outbox',
  'Conversation History': 'conversationhistory',
  'Historico de Conversas': 'conversationhistory',
  'Histórico de Conversas': 'conversationhistory',
};

/**
 * Enumerate ALL mail folders recursively, including user-created and nested.
 * Returns a flat list with path strings ("Inbox/Projectos/Assistente").
 */
export async function listAllMailFoldersFlat(accessToken: string): Promise<FlatFolder[]> {
  const client = createGraphClient(accessToken);
  const flat: FlatFolder[] = [];

  async function fetchChildren(parentPath: string, parentId: string | null, depth: number): Promise<void> {
    const baseUrl = parentId
      ? `/me/mailFolders/${parentId}/childFolders`
      : '/me/mailFolders';
    let next: string | null = baseUrl;
    let isFirst = true;
    while (next) {
      let req = client.api(next);
      // Only add $top/$select on the first request; nextLinks already carry query params
      if (isFirst) {
        req = req.top(100).select('id,displayName,parentFolderId,totalItemCount,unreadItemCount,childFolderCount');
      }
      const resp: any = await req.get();
      isFirst = false;
      const items: any[] = resp.value || [];
      for (const f of items) {
        const path = parentPath ? `${parentPath}/${f.displayName}` : f.displayName;
        const wk = depth === 0 ? (WELL_KNOWN_BY_NAME[f.displayName] || null) : null;
        flat.push({
          id: f.id,
          displayName: f.displayName,
          parentId: parentId,
          path,
          depth,
          wellKnownName: wk,
          totalItemCount: f.totalItemCount || 0,
          unreadItemCount: f.unreadItemCount || 0,
        });
        if ((f.childFolderCount || 0) > 0) {
          await fetchChildren(path, f.id, depth + 1);
        }
      }
      next = resp['@odata.nextLink'] || null;
      // Graph returns absolute URLs on nextLink; the SDK accepts them directly
    }
  }

  await fetchChildren('', null, 0);
  return flat;
}

/**
 * Fetch ALL emails from a folder, paginating until done (no artificial cap).
 */
export async function fetchAllEmailsFromFolder(
  accessToken: string,
  folderId: string,
  onBatch?: (batch: GraphEmail[], totalSoFar: number) => Promise<void>,
): Promise<number> {
  const client = createGraphClient(accessToken);
  let total = 0;
  let skip = 0;
  const pageSize = 200;

  while (true) {
    const resp: any = await client
      .api(`/me/mailFolders/${folderId}/messages`)
      .top(pageSize)
      .skip(skip)
      .select('id,from,toRecipients,subject,bodyPreview,receivedDateTime,isRead,importance,hasAttachments')
      .orderby('receivedDateTime desc')
      .get();

    const items: GraphEmail[] = resp.value || [];
    total += items.length;
    if (onBatch && items.length > 0) await onBatch(items, total);

    if (items.length < pageSize) break;
    skip += items.length;
  }

  return total;
}

export interface DeltaResult {
  changed: GraphEmail[];
  deleted: string[]; // external ids
  deltaLink: string;
}

/**
 * Delta sync for a folder: returns only changes since last deltaLink.
 * On first call (no previous deltaLink) returns current state + a new deltaLink.
 */
export async function fetchMessageBody(accessToken: string, messageId: string): Promise<{ contentType: 'html' | 'text'; content: string; subject?: string }> {
  const client = createGraphClient(accessToken);
  const msg: any = await client.api(`/me/messages/${messageId}`).select('id,subject,body').get();
  const body = msg?.body || {};
  return {
    contentType: (body.contentType || '').toLowerCase() === 'html' ? 'html' : 'text',
    content: body.content || '',
    subject: msg?.subject || undefined,
  };
}

export async function fetchFolderDelta(
  accessToken: string,
  folderId: string,
  previousDeltaLink?: string | null,
  onBatch?: (changed: GraphEmail[], deleted: string[], totalSoFar: number) => Promise<void>,
): Promise<DeltaResult> {
  const client = createGraphClient(accessToken);
  const changedAll: GraphEmail[] = [];
  const deletedAll: string[] = [];

  let url: string = previousDeltaLink || `/me/mailFolders/${folderId}/messages/delta`;
  let totalSoFar = 0;
  let deltaLink = '';

  let isFirst = true;
  while (true) {
    let req = client.api(url);
    // Only set top/select on the initial request (not on nextLink/deltaLink URLs — they carry params)
    if (isFirst && !url.includes('$deltatoken') && !url.includes('$skiptoken')) {
      req = req.top(500).select('id,from,toRecipients,subject,bodyPreview,receivedDateTime,isRead,importance,hasAttachments');
    }
    isFirst = false;
    // Graph delta supports a prefer header for max page size
    req = req.header('Prefer', 'odata.maxpagesize=500');
    const resp: any = await req.get();
    const items: any[] = resp.value || [];
    const batchChanged: GraphEmail[] = [];
    const batchDeleted: string[] = [];
    for (const item of items) {
      if (item['@removed']) {
        batchDeleted.push(item.id);
      } else {
        batchChanged.push(item as GraphEmail);
      }
    }
    changedAll.push(...batchChanged);
    deletedAll.push(...batchDeleted);
    totalSoFar += items.length;
    if (onBatch && items.length > 0) await onBatch(batchChanged, batchDeleted, totalSoFar);

    const nextLink = resp['@odata.nextLink'];
    const dLink = resp['@odata.deltaLink'];
    if (dLink) { deltaLink = dLink; break; }
    if (nextLink) { url = nextLink; continue; }
    break;
  }

  return { changed: changedAll, deleted: deletedAll, deltaLink };
}

export interface AccountDeltaItem {
  removed?: boolean;
  id: string;
  parentFolderId?: string;
  from?: any;
  toRecipients?: any;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  importance?: string;
  hasAttachments?: boolean;
}

/**
 * Account-wide delta: single stream of ALL mail changes across every folder.
 * Returns new deltaLink to store on the account. Replaces per-folder delta.
 */
export async function fetchAccountDelta(
  accessToken: string,
  previousDeltaLink?: string | null,
  onBatch?: (items: AccountDeltaItem[], totalSoFar: number) => Promise<void>,
): Promise<{ deltaLink: string; totalItems: number }> {
  const client = createGraphClient(accessToken);
  let url: string = previousDeltaLink || '/me/messages/delta';
  let totalSoFar = 0;
  let deltaLink = '';
  const isBootstrap = !previousDeltaLink;

  while (true) {
    let req = client.api(url);
    if (isBootstrap && !url.includes('$deltatoken') && !url.includes('$skiptoken')) {
      req = req.select('id,parentFolderId,from,toRecipients,subject,bodyPreview,receivedDateTime,isRead,importance,hasAttachments');
    }
    const resp: any = await req.get();
    const raw: any[] = resp.value || [];
    const items: AccountDeltaItem[] = raw.map((it) => {
      if (it['@removed']) return { removed: true, id: it.id } as AccountDeltaItem;
      return { id: it.id, parentFolderId: it.parentFolderId, from: it.from, toRecipients: it.toRecipients,
        subject: it.subject, bodyPreview: it.bodyPreview, receivedDateTime: it.receivedDateTime,
        isRead: it.isRead, importance: it.importance, hasAttachments: it.hasAttachments };
    });
    totalSoFar += items.length;
    if (onBatch && items.length > 0) await onBatch(items, totalSoFar);

    const nextLink = resp['@odata.nextLink'];
    const dLink = resp['@odata.deltaLink'];
    if (dLink) { deltaLink = dLink; break; }
    if (nextLink) { url = nextLink; continue; }
    break;
  }
  return { deltaLink, totalItems: totalSoFar };
}

/**
 * Move an email to a specific folder by id.
 */
export async function moveEmailToFolder(accessToken: string, emailId: string, destinationFolderId: string): Promise<string | null> {
  const client = createGraphClient(accessToken);
  // Graph gives the message a NEW id in the destination folder; return it so the caller can keep its row in sync.
  const moved: any = await client.api(`/me/messages/${emailId}/move`).post({ destinationId: destinationFolderId });
  return moved?.id || null;
}

/** Raw RFC 822 (MIME) source of a message. */
export async function getMessageMime(accessToken: string, messageId: string): Promise<Buffer> {
  const r = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/$value`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`Graph $value ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

const GRAPH_INLINE_LIMIT = 3 * 1024 * 1024; // Graph rejects request bodies over ~4 MB

/**
 * Put a copy of a MIME message into a folder of this mailbox as a normal RECEIVED message.
 * Graph's MIME upload always creates a draft, so the message is rebuilt from the parsed MIME
 * as JSON with PR_MESSAGE_FLAGS set at creation (the only moment it can be set).
 * Returns the new message id. If anything fails after creation, the partial copy is removed.
 */
export async function importMimeToFolder(
  accessToken: string,
  folderId: string,
  mime: Buffer,
  opts: { isRead: boolean; receivedAt: Date },
): Promise<string> {
  const { simpleParser } = await import('mailparser');
  const p: any = await simpleParser(mime);
  const addr = (a: any) => (a?.value || []).filter((v: any) => v.address).map((v: any) => ({ emailAddress: { address: v.address, name: v.name || v.address } }));
  const from = addr(p.from)[0];
  const date = (p.date instanceof Date && !isNaN(p.date.getTime())) ? p.date : opts.receivedAt;

  const atts = (p.attachments || []).map((a: any) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: a.filename || 'anexo',
    contentType: a.contentType || 'application/octet-stream',
    contentBytes: Buffer.from(a.content).toString('base64'),
    isInline: a.contentDisposition === 'inline' && !!a.cid,
    ...(a.cid ? { contentId: a.cid } : {}),
    _size: a.size || a.content?.length || 0,
  }));
  const totalAtt = atts.reduce((s: number, a: any) => s + a._size, 0);
  const strip = (a: any) => { const { _size, ...rest } = a; return rest; };

  const message: any = {
    subject: p.subject || '',
    body: p.html ? { contentType: 'html', content: p.html } : { contentType: 'text', content: p.text || '' },
    toRecipients: addr(p.to),
    ccRecipients: addr(p.cc),
    replyTo: addr(p.replyTo),
    isRead: opts.isRead,
    singleValueExtendedProperties: [
      // PR_MESSAGE_FLAGS: no MSGFLAG_UNSENT => a received message, not a draft (1 = read)
      { id: 'Integer 0x0E07', value: opts.isRead ? '1' : '0' },
      { id: 'SystemTime 0x0E06', value: opts.receivedAt.toISOString() }, // delivery time
      { id: 'SystemTime 0x0039', value: date.toISOString() },             // sent time
    ],
  };
  if (from) { message.from = from; message.sender = from; }
  if (totalAtt <= GRAPH_INLINE_LIMIT && atts.length > 0) message.attachments = atts.map(strip);

  const client = createGraphClient(accessToken);
  const created: any = await client.api(`/me/mailFolders/${folderId}/messages`).post(message);
  const id: string = created.id;

  if (totalAtt > GRAPH_INLINE_LIMIT) {
    try {
      for (const a of atts) {
        if (a._size <= GRAPH_INLINE_LIMIT) {
          await client.api(`/me/messages/${id}/attachments`).post(strip(a));
        } else {
          const session: any = await client.api(`/me/messages/${id}/attachments/createUploadSession`).post({
            AttachmentItem: { attachmentType: 'file', name: a.name, size: a._size, contentType: a.contentType, isInline: false },
          });
          const bytes = Buffer.from(a.contentBytes, 'base64');
          const CHUNK = 4 * 320 * 1024;
          for (let start = 0; start < bytes.length; start += CHUNK) {
            const end = Math.min(bytes.length, start + CHUNK);
            const r = await fetch(session.uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Length': String(end - start), 'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}` },
              body: bytes.subarray(start, end),
            });
            if (!r.ok) throw new Error(`upload ${a.name}: ${r.status}`);
          }
        }
      }
    } catch (e) {
      await client.api(`/me/messages/${id}`).delete().catch(() => {});
      throw e;
    }
  }
  return id;
}


export type ComposeMode = 'reply' | 'replyAll' | 'forward';

export interface ComposeSource {
  subject: string;
  from: string | null;
  replyTo: string[];
  to: string[];
  cc: string[];
}

/** Addresses and subject of a message, to prefill a reply/forward. */
export async function getComposeSource(accessToken: string, messageId: string): Promise<ComposeSource> {
  const client = createGraphClient(accessToken);
  const m: any = await client.api(`/me/messages/${messageId}`).select('subject,from,replyTo,toRecipients,ccRecipients').get();
  const list = (a: any[]) => (a || []).map((r) => r?.emailAddress?.address).filter(Boolean);
  return {
    subject: m?.subject || '',
    from: m?.from?.emailAddress?.address || null,
    replyTo: list(m?.replyTo),
    to: list(m?.toRecipients),
    cc: list(m?.ccRecipients),
  };
}

/**
 * Reply / reply-all / forward: Graph builds the draft (quoted original, threading headers and,
 * for a forward, the original attachments); we put the user's text on top and send it.
 * If anything fails the draft is removed, so nothing half-written is left in Drafts.
 */
export async function sendComposed(
  accessToken: string,
  messageId: string,
  mode: ComposeMode,
  data: { to: string[]; cc: string[]; subject: string; html: string },
): Promise<void> {
  const client = createGraphClient(accessToken);
  const action = mode === 'reply' ? 'createReply' : mode === 'replyAll' ? 'createReplyAll' : 'createForward';
  const draft: any = await client.api(`/me/messages/${messageId}/${action}`).post({});
  try {
    const quoted: string = draft?.body?.content || '';
    const block = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:11pt">${data.html}</div><br>`;
    const m = quoted.match(/<body[^>]*>/i);
    const content = m ? quoted.replace(m[0], m[0] + block) : block + quoted;
    const rcpt = (a: string[]) => a.map((address) => ({ emailAddress: { address } }));
    await client.api(`/me/messages/${draft.id}`).patch({
      subject: data.subject,
      toRecipients: rcpt(data.to),
      ccRecipients: rcpt(data.cc),
      body: { contentType: 'html', content },
    });
    await client.api(`/me/messages/${draft.id}/send`).post({});
  } catch (e: any) {
    await client.api(`/me/messages/${draft.id}`).delete().catch(() => {});
    if (e?.statusCode === 403 || /access.?denied|ErrorAccessDenied/i.test(`${e?.code} ${e?.message}`)) {
      throw new Error('Esta conta ainda não deu permissão para enviar. Volta a adicionar a conta Microsoft (Contas → Adicionar) para aceitar a permissão de envio.');
    }
    throw e;
  }
}
