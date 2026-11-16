import { Client } from '@microsoft/microsoft-graph-client';
import { getValidToken } from './graphService';

export interface MailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentBytes?: string; // base64 (file attachments only)
}

function client(token: string): Client {
  return Client.init({ authProvider: (done) => done(null, token) });
}

/**
 * List attachments metadata for a message.
 */
export async function listAttachments(accountId: string, messageId: string): Promise<MailAttachment[]> {
  const token = await getValidToken(accountId);
  const c = client(token);
  const resp: any = await c.api(`/me/messages/${messageId}/attachments`)
    .select('id,name,contentType,size,isInline')
    .get();
  return (resp.value || []).map((a: any) => ({
    id: a.id,
    name: a.name,
    contentType: a.contentType,
    size: a.size,
    isInline: !!a.isInline,
  }));
}

/**
 * Get full attachment including bytes (file attachments only).
 */
export async function getAttachmentBytes(accountId: string, messageId: string, attachmentId: string): Promise<{ name: string; contentType: string; buffer: Buffer }> {
  const token = await getValidToken(accountId);
  const c = client(token);
  const a: any = await c.api(`/me/messages/${messageId}/attachments/${attachmentId}`).get();
  if (a['@odata.type'] !== '#microsoft.graph.fileAttachment') {
    throw new Error(`Only file attachments supported (got ${a['@odata.type']})`);
  }
  return {
    name: a.name,
    contentType: a.contentType || 'application/octet-stream',
    buffer: Buffer.from(a.contentBytes, 'base64'),
  };
}
