import { prisma } from '../index';
import {
  ensureArchiveRoot,
  ensureFolderPath,
  uploadFile,
  type DriveItem,
} from './oneDriveService';
import { listAttachments, getAttachmentBytes } from './graphAttachments';

export async function upsertArchiveItem(accountId: string, item: DriveItem, pathRelative: string, sourceEmailId?: string) {
  return prisma.archiveItem.upsert({
    where: { accountId_driveItemId: { accountId, driveItemId: item.id } },
    create: {
      accountId,
      driveItemId: item.id,
      name: item.name,
      path: pathRelative,
      isFolder: item.isFolder,
      size: item.size ? BigInt(item.size) : null,
      mimeType: item.mimeType || null,
      sourceEmailId: sourceEmailId || null,
    },
    update: {
      name: item.name,
      path: pathRelative,
      isFolder: item.isFolder,
      size: item.size ? BigInt(item.size) : null,
      mimeType: item.mimeType || null,
    },
  });
}

function slug(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim();
}

function applyFilenamePattern(pattern: string, ctx: { date: string; entity?: string; subject?: string; original: string; ext: string }): string {
  return pattern
    .replace(/\{date\}/g, ctx.date)
    .replace(/\{entity\}/g, slug(ctx.entity || ''))
    .replace(/\{subject\}/g, slug(ctx.subject || ''))
    .replace(/\{original\}/g, ctx.original.replace(new RegExp(`\\.${ctx.ext}$`, 'i'), ''))
    .replace(/\{ext\}/g, ctx.ext);
}

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Extension of an attachment: from its name, else from its content type, else '' (never invented). */
export function attachmentExt(name: string, contentType?: string | null): string {
  const m = name.match(/\.([A-Za-z0-9]{1,8})$/);
  if (m) return m[1];
  return EXT_BY_MIME[(contentType || '').split(';')[0].trim().toLowerCase()] || '';
}

/** A saved file must keep its extension even when the rule's name pattern forgets {ext}. */
export function withExt(name: string, ext: string): string {
  if (!ext) return name;
  return name.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? name : `${name}.${ext}`;
}

/**
 * Match an incoming email against archive rules and auto-save attachments.
 * Returns number of files saved.
 */
export async function applyArchiveRulesToEmail(email: {
  id: string;
  accountId: string;
  externalId: string;
  from: string;
  subject: string | null;
  hasAttachments: boolean;
  receivedAt: Date;
}): Promise<{ saved: number; ruleIds: string[] }> {
  if (!email.hasAttachments) return { saved: 0, ruleIds: [] };

  const rules = await prisma.archiveRule.findMany({
    where: {
      enabled: true,
      OR: [{ accountId: null }, { accountId: email.accountId }],
    },
    include: { entity: true },
  });

  const matched = rules.filter((r) => {
    if (r.senderPattern && !email.from.toLowerCase().includes(r.senderPattern.toLowerCase())) return false;
    if (r.subjectPattern && !(email.subject || '').toLowerCase().includes(r.subjectPattern.toLowerCase())) return false;
    return true;
  });
  if (matched.length === 0) return { saved: 0, ruleIds: [] };

  const attachments = await listAttachments(email.accountId, email.externalId);
  const fileAtts = attachments.filter((a) => !a.isInline);
  if (fileAtts.length === 0) return { saved: 0, ruleIds: [] };

  let saved = 0;
  const appliedRuleIds: string[] = [];
  for (const rule of matched) {
    const folderId = await ensureFolderPath(email.accountId, rule.targetFolder);
    for (const att of fileAtts) {
      try {
        const { buffer, contentType, name: originalName } = await getAttachmentBytes(email.accountId, email.externalId, att.id);
        const ext = attachmentExt(originalName, contentType);
        const date = email.receivedAt.toISOString().slice(0, 10);
        const finalName = withExt(
          rule.filenamePattern
            ? applyFilenamePattern(rule.filenamePattern, {
                date,
                entity: rule.entity?.name,
                subject: email.subject || undefined,
                original: originalName,
                ext,
              })
            : originalName,
          ext,
        );
        const uploaded = await uploadFile(email.accountId, folderId, finalName, buffer, contentType);
        await upsertArchiveItem(email.accountId, uploaded, `${rule.targetFolder}/${uploaded.name}`, email.id);
        if (rule.entityId) {
          await prisma.archiveItem.update({
            where: { accountId_driveItemId: { accountId: email.accountId, driveItemId: uploaded.id } },
            data: { entityId: rule.entityId },
          });
        }
        saved++;
      } catch (e: any) {
        console.error(`[ArchiveRule ${rule.name}] failed for ${att.name}:`, e.message);
      }
    }
    appliedRuleIds.push(rule.id);
    await prisma.archiveRule.update({
      where: { id: rule.id },
      data: { timesApplied: { increment: saved }, lastAppliedAt: new Date() },
    });
  }
  return { saved, ruleIds: appliedRuleIds };
}

export { ensureArchiveRoot };
