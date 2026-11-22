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

export interface ImapFolderStatus {
  messages: number;
  uidNext: number;
  uidValidity: number;
}

export async function getFolderStatus(accountId: string, folderPath: string): Promise<ImapFolderStatus | null> {
  const client = await openClient(accountId);
  try {
    const st: any = await client.status(folderPath, { messages: true, uidNext: true, uidValidity: true });
    return {
      messages: Number(st?.messages || 0),
      uidNext: Number(st?.uidNext || 0),
      uidValidity: Number(st?.uidValidity || 0),
    };
  } catch {
    return null;
  } finally {
    await client.logout();
  }
}

/**
 * Fetch messages with UID strictly greater than `sinceUid`. Returns highest UID seen.
 * Also returns the UIDVALIDITY of the mailbox (caller should compare with stored).
 */
export async function fetchImapMessagesSince(
  accountId: string,
  folderPath: string,
  sinceUid: number,
  onBatch?: (batch: MailEnvelope[], totalSoFar: number) => Promise<void>,
): Promise<{ highestUid: number; uidValidity: number; total: number }> {
  const client = await openClient(accountId);
  let totalSoFar = 0;
  let highestUid = sinceUid;
  let uidValidity = 0;
  try {
    const lock = await client.getMailboxLock(folderPath);
    try {
      const mb: any = client.mailbox;
      uidValidity = Number(mb?.uidValidity || 0);
      if ((mb?.exists || 0) === 0) return { highestUid, uidValidity, total: 0 };
      const range = `${sinceUid + 1}:*`;
      const batch: MailEnvelope[] = [];
      for await (const msg of client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        bodyStructure: true,
        source: false,
      } as any, { uid: true } as any)) {
        const uid = Number(msg.uid);
        if (uid <= sinceUid) continue; // defensive
        if (uid > highestUid) highestUid = uid;
        const env = msg.envelope as any;
        const fromAddr = env?.from?.[0];
        const toAddr = env?.to?.[0];
        const flagsVal = msg.flags as unknown;
        const flags = flagsVal instanceof Set ? flagsVal : new Set<string>(flagsVal as string[] | undefined);
        const bs: any = msg.bodyStructure;
        const hasAttachments = Boolean(bs && hasAttachmentPart(bs));
        batch.push({
          id: buildExternalId(accountId, folderPath, uid),
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
        if (batch.length >= 500) {
          totalSoFar += batch.length;
          if (onBatch) await onBatch([...batch], totalSoFar);
          batch.length = 0;
        }
      }
      if (batch.length > 0) {
        totalSoFar += batch.length;
        if (onBatch) await onBatch(batch, totalSoFar);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return { highestUid, uidValidity, total: totalSoFar };
}

/**
 * Return all UIDs currently in a folder (used for deletion detection). Lightweight: UIDs only.
 */
export async function listAllImapUids(accountId: string, folderPath: string): Promise<number[]> {
  const client = await openClient(accountId);
  try {
    const lock = await client.getMailboxLock(folderPath);
    try {
      const uids = await client.search({ all: true }, { uid: true }) as unknown as number[];
      return Array.isArray(uids) ? uids.map(Number) : [];
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
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
): Promise<number | null> {
  const client = await openClient(accountId);
  try {
    const lock = await client.getMailboxLock(fromFolder);
    try {
      const r: any = await client.messageMove(String(uid), toFolder, { uid: true });
      if (r === false) throw new Error('O servidor IMAP recusou mover a mensagem');
      // With UIDPLUS the server tells us the UID in the destination folder
      const newUid = r?.uidMap?.get?.(uid);
      return typeof newUid === 'number' ? newUid : null;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

export async function fetchImapMessageBody(accountId: string, folder: string, uid: number): Promise<{ contentType: 'html' | 'text'; content: string }> {
  const { simpleParser } = await import('mailparser');
  const client = await openClient(accountId);
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const msg: any = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg?.source) return { contentType: 'text', content: '' };
      const parsed = await simpleParser(msg.source as Buffer);
      if (parsed.html) return { contentType: 'html', content: parsed.html };
      return { contentType: 'text', content: parsed.text || '' };
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

/** Raw RFC 822 source of a message. */
export async function getRawMessage(accountId: string, externalId: string): Promise<Buffer> {
  const parsed = parseExternalId(externalId);
  if (!parsed) throw new Error('Invalid IMAP externalId');
  const client = await openClient(accountId);
  try {
    const lock = await client.getMailboxLock(parsed.folder);
    try {
      const msg: any = await client.fetchOne(String(parsed.uid), { source: true }, { uid: true });
      if (!msg?.source) throw new Error('Mensagem não encontrada no servidor IMAP');
      return msg.source as Buffer;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

/** APPEND a raw message to a folder. Returns the new UID when the server reports it (UIDPLUS). */
export async function appendMessage(accountId: string, folder: string, raw: Buffer, seen: boolean, date: Date): Promise<number | null> {
  const client = await openClient(accountId);
  try {
    const r: any = await client.append(folder, raw, seen ? ['\\Seen'] : [], date);
    if (!r) throw new Error('O servidor IMAP recusou guardar a mensagem');
    return typeof r.uid === 'number' ? r.uid : null;
  } finally {
    await client.logout();
  }
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Addresses and subject of a message, to prefill a reply/forward. */
export async function getImapComposeSource(accountId: string, externalId: string): Promise<{ subject: string; from: string | null; replyTo: string[]; to: string[]; cc: string[] }> {
  const { simpleParser } = await import('mailparser');
  const p: any = await simpleParser(await getRawMessage(accountId, externalId));
  const list = (a: any) => (a?.value || []).map((v: any) => v.address).filter(Boolean);
  return { subject: p.subject || '', from: list(p.from)[0] || null, replyTo: list(p.replyTo), to: list(p.to), cc: list(p.cc) };
}

/**
 * Reply / reply-all / forward over SMTP (same user and password as IMAP), keeping the thread
 * headers, quoting the original and, for a forward, re-attaching its attachments.
 * A copy is appended to the Sent folder (Gmail does that by itself).
 */
export async function sendImapComposed(
  accountId: string,
  externalId: string,
  mode: 'reply' | 'replyAll' | 'forward',
  data: { to: string[]; cc: string[]; subject: string; html: string },
): Promise<void> {
  const acc = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!acc || !acc.imapHost || !acc.imapUser || !acc.imapPasswordEnc) throw new Error('Conta IMAP sem dados de ligação');
  const { simpleParser } = await import('mailparser');
  const nodemailer = await import('nodemailer');
  const MailComposer = (await import('nodemailer/lib/mail-composer')).default;

  const p: any = await simpleParser(await getRawMessage(accountId, externalId));
  const when = p.date instanceof Date ? p.date.toLocaleString('pt-PT') : '';
  const header = `<div style="border-top:1px solid #ccc;padding-top:8px;margin-top:12px;font-family:Segoe UI,Arial,sans-serif;font-size:10pt">`
    + `<b>De:</b> ${esc(p.from?.text || '')}<br><b>Enviado:</b> ${esc(when)}<br><b>Para:</b> ${esc(p.to?.text || '')}<br>`
    + (p.cc?.text ? `<b>Cc:</b> ${esc(p.cc.text)}<br>` : '')
    + `<b>Assunto:</b> ${esc(p.subject || '')}</div><br>`;
  const original = p.html || (p.textAsHtml || `<pre>${esc(p.text || '')}</pre>`);
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:11pt">${data.html}</div>${header}${original}`;

  const refs: string[] = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
  const mail: any = {
    from: acc.displayName ? { name: acc.displayName, address: acc.email } : acc.email,
    to: data.to,
    cc: data.cc,
    subject: data.subject,
    html,
  };
  if (mode !== 'forward' && p.messageId) {
    mail.inReplyTo = p.messageId;
    mail.references = [...refs, p.messageId];
  }
  // Inline images of the original are needed in both cases; real attachments only when forwarding
  mail.attachments = (p.attachments || [])
    .filter((a: any) => mode === 'forward' || (a.cid && a.contentDisposition === 'inline'))
    .map((a: any) => ({ filename: a.filename, content: a.content, contentType: a.contentType, cid: a.cid || undefined, contentDisposition: a.contentDisposition }));

  const raw: Buffer = await new Promise((resolve, reject) =>
    new MailComposer(mail).compile().build((err: any, msg: Buffer) => (err ? reject(err) : resolve(msg))));

  const gmail = /gmail\.com$|googlemail\.com$/i.test(acc.imapHost);
  const host = acc.smtpHost || (gmail ? 'smtp.gmail.com' : acc.imapHost.replace(/^imap\./i, 'smtp.'));
  const pass = decryptSecret(acc.imapPasswordEnc);
  const ports = acc.smtpPort ? [acc.smtpPort] : [465, 587];
  let lastErr: any = null;
  let sent = false;
  for (const port of ports) {
    try {
      const transport = nodemailer.createTransport({
        host, port, secure: port === 465, auth: { user: acc.imapUser, pass },
        connectionTimeout: 15000, greetingTimeout: 15000,
      });
      await transport.sendMail({ envelope: { from: acc.email, to: [...data.to, ...data.cc] }, raw });
      sent = true;
      break;
    } catch (e: any) {
      lastErr = e;
      // Only a connection problem justifies trying the other port; a refusal is final
      if (!/ECONN|ETIMEDOUT|ESOCKET|ENOTFOUND|Greeting|timeout/i.test(`${e?.code} ${e?.message}`)) break;
    }
  }
  if (!sent) throw new Error(`Servidor de envio ${host}: ${lastErr?.message || 'erro'}`);

  if (!gmail) {
    try {
      const folders = await detectFolders(accountId);
      if (folders.sent) await appendMessage(accountId, folders.sent, raw, true, new Date());
    } catch (e: any) {
      console.warn('Sent copy not saved:', e?.message);
    }
  }
}
