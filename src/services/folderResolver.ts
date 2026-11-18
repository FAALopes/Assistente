import { prisma } from '../index';

// Microsoft Graph wellKnownName values we care about
export type WellKnown = 'inbox' | 'junkemail' | 'sentitems' | 'drafts' | 'deleteditems' | 'archive';

const NAME_HINTS: Record<WellKnown, string[]> = {
  inbox: ['inbox', 'caixa de entrada', 'bandeja de entrada', 'posteingang'],
  junkemail: ['junk', 'lixo', 'spam'],
  sentitems: ['sent', 'enviad', 'gesendet'],
  drafts: ['draft', 'rascunh', 'borrador', 'entwurf'],
  deleteditems: ['deleted', 'eliminad', 'papelera', 'gelöscht', 'trash'],
  archive: ['archive', 'arquivo', 'archivo'],
};

/**
 * Resolve the real stored folder id for a given wellKnown kind in an account.
 * Order: wellKnownName match -> top-level displayName heuristic -> null.
 * Returns null when nothing sensible matches (callers must handle it).
 */
export async function resolveFolderId(accountId: string, kind: WellKnown): Promise<string | null> {
  const byWk = await prisma.mailFolder.findFirst({
    where: { accountId, wellKnownName: kind },
    select: { id: true },
  });
  if (byWk) return byWk.id;

  const hints = NAME_HINTS[kind];
  const byName = await prisma.mailFolder.findFirst({
    where: {
      accountId,
      parentId: null, // top-level only to avoid random user subfolders
      OR: hints.map(h => ({ displayName: { contains: h, mode: 'insensitive' as const } })),
    },
    select: { id: true },
  });
  return byName?.id || null;
}

/**
 * Resolve the same kind for MANY accounts at once. Returns a map accountId -> folderId.
 * Accounts with no match are simply not present in the map.
 */
export async function resolveFolderIdForAccounts(accountIds: string[], kind: WellKnown): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const hints = NAME_HINTS[kind];
  const rows = await prisma.mailFolder.findMany({
    where: {
      accountId: { in: accountIds },
      OR: [
        { wellKnownName: kind },
        {
          parentId: null,
          OR: hints.map(h => ({ displayName: { contains: h, mode: 'insensitive' as const } })),
        },
      ],
    },
    select: { id: true, accountId: true, wellKnownName: true },
  });
  // Prefer wellKnownName matches when both exist for the same account
  for (const r of rows) if (r.wellKnownName === kind) out.set(r.accountId, r.id);
  for (const r of rows) if (!out.has(r.accountId)) out.set(r.accountId, r.id);
  return out;
}
