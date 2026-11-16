import { Client } from '@microsoft/microsoft-graph-client';
import { getValidToken } from './graphService';

export const ARCHIVE_ROOT_NAME = 'Assistente';

function createClient(accessToken: string): Client {
  return Client.init({ authProvider: (done) => done(null, accessToken) });
}

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  isFolder: boolean;
  childCount?: number;
  parentPath?: string;
  mimeType?: string;
  webUrl?: string;
  lastModifiedDateTime?: string;
}

function mapItem(it: any, parentPath?: string): DriveItem {
  return {
    id: it.id,
    name: it.name,
    size: it.size,
    isFolder: !!it.folder,
    childCount: it.folder?.childCount,
    parentPath,
    mimeType: it.file?.mimeType,
    webUrl: it.webUrl,
    lastModifiedDateTime: it.lastModifiedDateTime,
  };
}

/**
 * Ensure the /Assistente root folder exists under the user's OneDrive root.
 * Returns the drive item id of the root folder.
 */
export async function ensureArchiveRoot(accountId: string): Promise<string> {
  const token = await getValidToken(accountId);
  const client = createClient(token);
  try {
    const existing: any = await client.api(`/me/drive/root:/${ARCHIVE_ROOT_NAME}`).get();
    return existing.id;
  } catch (e: any) {
    const sc = e?.statusCode ?? e?.status;
    const code = e?.code || e?.body?.error?.code || '';
    const isNotFound = sc === 404 || /itemNotFound|not.?found/i.test(code) || /not.?found/i.test(String(e?.message || ''));
    if (!isNotFound) throw e;
  }
  try {
    const created: any = await client.api('/me/drive/root/children').post({
      name: ARCHIVE_ROOT_NAME,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'replace',
    });
    return created.id;
  } catch (createErr: any) {
    // Race or already exists under a different case — try once more to read it
    const existing: any = await client.api(`/me/drive/root:/${ARCHIVE_ROOT_NAME}`).get();
    return existing.id;
  }
}

export async function listFolder(accountId: string, folderId: string): Promise<DriveItem[]> {
  const token = await getValidToken(accountId);
  const client = createClient(token);
  const out: DriveItem[] = [];
  let url: string | null = `/me/drive/items/${folderId}/children`;
  let isFirst = true;
  while (url) {
    let req = client.api(url);
    if (isFirst) {
      req = req.top(200).select('id,name,size,folder,file,webUrl,lastModifiedDateTime,parentReference');
      isFirst = false;
    }
    const resp: any = await req.get();
    for (const it of resp.value || []) out.push(mapItem(it));
    url = resp['@odata.nextLink'] || null;
  }
  // Folders first, then alphabetical
  out.sort((a, b) => (a.isFolder === b.isFolder ? a.name.localeCompare(b.name, 'pt') : a.isFolder ? -1 : 1));
  return out;
}

export async function createFolder(accountId: string, parentId: string, name: string): Promise<DriveItem> {
  const token = await getValidToken(accountId);
  const client = createClient(token);
  const created: any = await client.api(`/me/drive/items/${parentId}/children`).post({
    name,
    folder: {},
    '@microsoft.graph.conflictBehavior': 'rename',
  });
  return mapItem(created);
}

export async function renameItem(accountId: string, itemId: string, newName: string): Promise<DriveItem> {
  const token = await getValidToken(accountId);
  const client = createClient(token);
  const updated: any = await client.api(`/me/drive/items/${itemId}`).patch({ name: newName });
  return mapItem(updated);
}

export async function moveItem(accountId: string, itemId: string, newParentId: string): Promise<DriveItem> {
  const token = await getValidToken(accountId);
  const client = createClient(token);
  const updated: any = await client.api(`/me/drive/items/${itemId}`).patch({
    parentReference: { id: newParentId },
  });
  return mapItem(updated);
}

export async function deleteItem(accountId: string, itemId: string): Promise<void> {
  const token = await getValidToken(accountId);
  const client = createClient(token);
  await client.api(`/me/drive/items/${itemId}`).delete();
}

/**
 * Simple upload (small files, < 4 MB). For bigger files use uploadLarge.
 */
export async function uploadSmall(accountId: string, parentId: string, name: string, buffer: Buffer, contentType?: string): Promise<DriveItem> {
  const token = await getValidToken(accountId);
  const safe = encodeURIComponent(name);
  const url = `https://graph.microsoft.com/v1.0/me/drive/items/${parentId}:/${safe}:/content`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType || 'application/octet-stream',
    },
    body: buffer as any,
  });
  if (!resp.ok) throw new Error(`upload failed: ${resp.status} ${await resp.text()}`);
  const it = await resp.json() as any;
  return mapItem(it);
}

/**
 * Large file upload via session.
 */
export async function uploadLarge(accountId: string, parentId: string, name: string, buffer: Buffer, contentType?: string): Promise<DriveItem> {
  const token = await getValidToken(accountId);
  const client = createClient(token);
  const safe = encodeURIComponent(name);
  const session: any = await client
    .api(`/me/drive/items/${parentId}:/${safe}:/createUploadSession`)
    .post({ item: { '@microsoft.graph.conflictBehavior': 'rename', name } });
  const uploadUrl = session.uploadUrl;
  const total = buffer.length;
  const CHUNK = 5 * 1024 * 1024; // 5 MB
  let start = 0;
  let last: any = null;
  while (start < total) {
    const end = Math.min(start + CHUNK, total) - 1;
    const slice = buffer.subarray(start, end + 1);
    const resp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(slice.length),
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Type': contentType || 'application/octet-stream',
      },
      body: slice as any,
    });
    if (resp.status !== 202 && resp.status !== 200 && resp.status !== 201) {
      throw new Error(`large upload chunk failed: ${resp.status} ${await resp.text()}`);
    }
    if (resp.status === 200 || resp.status === 201) {
      last = await resp.json();
    }
    start = end + 1;
  }
  return mapItem(last);
}

export async function uploadFile(accountId: string, parentId: string, name: string, buffer: Buffer, contentType?: string): Promise<DriveItem> {
  if (buffer.length < 4 * 1024 * 1024) return uploadSmall(accountId, parentId, name, buffer, contentType);
  return uploadLarge(accountId, parentId, name, buffer, contentType);
}

/**
 * Download file content as Buffer.
 */
export async function downloadFile(accountId: string, itemId: string): Promise<{ buffer: Buffer; name: string; mimeType?: string }> {
  const token = await getValidToken(accountId);
  const client = createClient(token);
  const meta: any = await client.api(`/me/drive/items/${itemId}`).select('id,name,file').get();
  const resp = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return { buffer: buf, name: meta.name, mimeType: meta.file?.mimeType };
}

export async function searchItems(accountId: string, query: string): Promise<DriveItem[]> {
  const token = await getValidToken(accountId);
  const client = createClient(token);
  const rootId = await ensureArchiveRoot(accountId);
  const q = encodeURIComponent(query);
  const resp: any = await client.api(`/me/drive/items/${rootId}/search(q='${q}')`).get();
  const items = (resp.value || []) as any[];
  return items.map((it) => mapItem(it));
}

/**
 * Ensure a nested path exists under the archive root (e.g. "Faturas/Indaqua"). Returns final folder id.
 */
export async function ensureFolderPath(accountId: string, relativePath: string): Promise<string> {
  const parts = relativePath.split('/').map(p => p.trim()).filter(Boolean);
  let parentId = await ensureArchiveRoot(accountId);
  if (parts.length === 0) return parentId;
  const token = await getValidToken(accountId);
  const client = createClient(token);
  for (const part of parts) {
    // Try fetch existing child by name
    const children: any = await client
      .api(`/me/drive/items/${parentId}/children`)
      .filter(`name eq '${part.replace(/'/g, "''")}'`)
      .select('id,name,folder')
      .get();
    const existing = (children.value || []).find((c: any) => c.folder);
    if (existing) {
      parentId = existing.id;
    } else {
      const created: any = await client.api(`/me/drive/items/${parentId}/children`).post({
        name: part,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'rename',
      });
      parentId = created.id;
    }
  }
  return parentId;
}
