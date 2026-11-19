import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../index';
import { listCategories, isBuiltin, UNCATEGORIZED } from '../services/categories';

const router = Router();

const HEX = /^#[0-9a-fA-F]{6}$/;

function cleanColor(color: unknown): string | null | undefined {
  if (color === null || color === '') return null;
  if (typeof color === 'string' && HEX.test(color)) return color.toLowerCase();
  return undefined; // invalid
}

// GET /api/categories - all categories in display order, with email counts
router.get('/', async (_req: Request, res: Response) => {
  try {
    const [cats, counts] = await Promise.all([
      listCategories(),
      prisma.email.groupBy({ by: ['category'], _count: { id: true } }),
    ]);
    const countMap = new Map(counts.map((c) => [c.category, c._count.id]));
    res.json(cats.map((c) => ({ ...c, emailCount: countMap.get(c.key) || 0 })));
  } catch (error: any) {
    console.error('Error listing categories:', error);
    res.status(500).json({ error: 'Failed to list categories' });
  }
});

// POST /api/categories - create a custom category (goes to the end of the list)
router.post('/', async (req: Request, res: Response) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const color = cleanColor(req.body?.color ?? null);
    if (!name) { res.status(400).json({ error: 'O nome é obrigatório' }); return; }
    if (color === undefined) { res.status(400).json({ error: 'Cor inválida' }); return; }

    const cats = await listCategories();
    if (cats.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      res.status(409).json({ error: 'Já existe uma categoria com esse nome' });
      return;
    }
    const maxOrder = cats.reduce((m, c) => Math.max(m, c.sortOrder), 0);
    const row = await prisma.category.create({
      data: { key: `C_${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`, name, color, sortOrder: maxOrder + 10 },
    });
    res.json({ key: row.key, name: row.name, color: row.color, sortOrder: row.sortOrder, builtin: false, emailCount: 0 });
  } catch (error: any) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// PUT /api/categories/order - body { keys: string[] } in the wanted display order
router.put('/order', async (req: Request, res: Response) => {
  try {
    const keys: unknown = req.body?.keys;
    if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) {
      res.status(400).json({ error: 'keys (array) is required' });
      return;
    }
    const cats = await listCategories();
    const byKey = new Map(cats.map((c) => [c.key, c]));
    const ordered = (keys as string[]).filter((k) => byKey.has(k));
    // Anything not mentioned keeps its relative order after the mentioned ones
    for (const c of cats) if (!ordered.includes(c.key)) ordered.push(c.key);

    await prisma.$transaction(
      ordered.map((key, i) => {
        const c = byKey.get(key)!;
        return prisma.category.upsert({
          where: { key },
          create: { key, name: c.name, color: c.color, sortOrder: (i + 1) * 10 },
          update: { sortOrder: (i + 1) * 10 },
        });
      }),
    );
    res.json({ ok: true });
  } catch (error: any) {
    console.error('Error ordering categories:', error);
    res.status(500).json({ error: 'Failed to order categories' });
  }
});

// PUT /api/categories/:key - rename / recolor (built-in or custom)
router.put('/:key', async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    const cats = await listCategories();
    const current = cats.find((c) => c.key === key);
    if (!current) { res.status(404).json({ error: 'Categoria não encontrada' }); return; }

    let name = current.name;
    if (req.body?.name !== undefined) {
      name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name) { res.status(400).json({ error: 'O nome é obrigatório' }); return; }
      if (cats.some((c) => c.key !== key && c.name.toLowerCase() === name.toLowerCase())) {
        res.status(409).json({ error: 'Já existe uma categoria com esse nome' });
        return;
      }
    }
    let color = current.color;
    if (req.body?.color !== undefined) {
      const c = cleanColor(req.body.color);
      if (c === undefined) { res.status(400).json({ error: 'Cor inválida' }); return; }
      color = c;
    }

    const row = await prisma.category.upsert({
      where: { key },
      create: { key, name, color, sortOrder: current.sortOrder },
      update: { name, color },
    });
    res.json({ key: row.key, name: row.name, color: row.color, sortOrder: row.sortOrder, builtin: current.builtin });
  } catch (error: any) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// GET /api/categories/:key/emails - which emails are classified with this category
router.get('/:key/emails', async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    const [total, emails] = await Promise.all([
      prisma.email.count({ where: { category: key } }),
      prisma.email.findMany({
        where: { category: key },
        orderBy: { receivedAt: 'desc' },
        take: 500,
        select: {
          id: true, from: true, subject: true, receivedAt: true,
          account: { select: { email: true } },
        },
      }),
    ]);
    res.json({ total, emails });
  } catch (error: any) {
    console.error('Error listing category emails:', error);
    res.status(500).json({ error: 'Failed to list category emails' });
  }
});

// DELETE /api/categories/:key - custom only; its emails go back to "Sem categoria"
router.delete('/:key', async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    if (isBuiltin(key)) {
      res.status(400).json({ error: 'As categorias de sistema não podem ser apagadas' });
      return;
    }
    const existing = await prisma.category.findUnique({ where: { key } });
    if (!existing) { res.status(404).json({ error: 'Categoria não encontrada' }); return; }

    const [reset] = await prisma.$transaction([
      prisma.email.updateMany({ where: { category: key }, data: { category: UNCATEGORIZED, categorySetAt: null } }),
      prisma.category.delete({ where: { key } }),
    ]);
    res.json({ deleted: true, emailsReset: reset.count });
  } catch (error: any) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;
