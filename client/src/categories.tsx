import { useSyncExternalStore } from 'react';
import { Tag } from 'antd';
import { getCategories } from './api';
import type { Category } from './types';

// Tiny shared store: categories are loaded once and re-read after every change,
// so every list/banner shows the same names, colors and order.
let cache: Category[] = [];
const listeners = new Set<() => void>();

export async function reloadCategories(): Promise<Category[]> {
  cache = await getCategories();
  listeners.forEach((l) => l());
  return cache;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useCategories(): Category[] {
  return useSyncExternalStore(subscribe, () => cache);
}

export function categoryName(categories: Category[], key: string): string {
  return categories.find((c) => c.key === key)?.name || key;
}

export function ColoredTag({ name, color, style }: { name: string; color: string | null; style?: React.CSSProperties }) {
  if (!color) return <Tag style={{ margin: 0, ...style }}>{name}</Tag>;
  return (
    <Tag
      style={{
        margin: 0,
        color,
        background: `${color}14`,
        borderColor: `${color}66`,
        ...style,
      }}
    >
      {name}
    </Tag>
  );
}

export function CategoryTag({ categoryKey, style }: { categoryKey: string; style?: React.CSSProperties }) {
  const categories = useCategories();
  const c = categories.find((x) => x.key === categoryKey);
  return <ColoredTag name={c?.name || categoryKey} color={c?.color || null} style={style} />;
}
