import { prisma } from '../index';

export interface CategoryInfo {
  key: string;
  name: string;
  color: string | null;
  sortOrder: number;
  builtin: boolean;
}

export const UNCATEGORIZED = 'UNCATEGORIZED';

// Built-in categories: the rules engine and bulk actions refer to these keys, so they
// cannot be deleted. Name, color and order can be overridden by a row in `categories`.
export const BUILTIN_CATEGORIES: CategoryInfo[] = [
  { key: 'INBOX', name: 'Caixa de entrada', color: null, sortOrder: 10, builtin: true },
  { key: 'TODO', name: 'Tratar depois', color: '#1677ff', sortOrder: 20, builtin: true },
  { key: 'DELETE', name: 'Apagar', color: '#f5222d', sortOrder: 30, builtin: true },
  { key: 'SAVE_LATER', name: 'Guardar', color: '#52c41a', sortOrder: 40, builtin: true },
  { key: 'SAVE_ONEDRIVE', name: 'OneDrive', color: '#13c2c2', sortOrder: 50, builtin: true },
  { key: UNCATEGORIZED, name: 'Sem categoria', color: null, sortOrder: 60, builtin: true },
];

const BUILTIN_KEYS = new Set(BUILTIN_CATEGORIES.map((c) => c.key));

export function isBuiltin(key: string): boolean {
  return BUILTIN_KEYS.has(key);
}

/** Built-ins (with DB overrides applied) + custom categories, in display order. */
export async function listCategories(): Promise<CategoryInfo[]> {
  const rows = await prisma.category.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out: CategoryInfo[] = BUILTIN_CATEGORIES.map((b) => {
    const o = byKey.get(b.key);
    return o ? { key: b.key, name: o.name, color: o.color, sortOrder: o.sortOrder, builtin: true } : { ...b };
  });
  for (const r of rows) {
    if (!BUILTIN_KEYS.has(r.key)) {
      out.push({ key: r.key, name: r.name, color: r.color, sortOrder: r.sortOrder, builtin: false });
    }
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return out;
}

export async function isValidCategory(key: string): Promise<boolean> {
  if (BUILTIN_KEYS.has(key)) return true;
  const row = await prisma.category.findUnique({ where: { key }, select: { key: true } });
  return !!row;
}
