import { useEffect, useState } from 'react';
import { Modal, Input, Button, Popover, Tooltip, Table, message } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined, PlusOutlined, LockOutlined } from '@ant-design/icons';
import {
  createCategory, updateCategoryDef, reorderCategories, deleteCategory, getCategoryEmails,
} from '../api';
import { reloadCategories, useCategories, ColoredTag } from '../categories';
import type { Category, CategoryEmail } from '../types';

const PRESETS = [
  '#f5222d', '#fa541c', '#fa8c16', '#faad14', '#a0d911', '#52c41a',
  '#13c2c2', '#1677ff', '#2f54eb', '#722ed1', '#eb2f96', '#595959',
];

function ColorDot({ color, size = 20, onClick }: { color: string | null; size?: number; onClick?: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color || 'transparent',
        border: color ? '1px solid rgba(0,0,0,0.15)' : '1px dashed #bfbfbf',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    />
  );
}

function ColorChooser({ value, onChange }: { value: string | null; onChange: (c: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const pick = (c: string | null) => { setOpen(false); onChange(c); };
  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      content={
        <div style={{ width: 172 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PRESETS.map((c) => <ColorDot key={c} color={c} size={22} onClick={() => pick(c)} />)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <Button size="small" type="link" style={{ padding: 0 }} onClick={() => pick(null)}>Sem cor</Button>
            <label style={{ fontSize: 12, color: '#595959', display: 'flex', alignItems: 'center', gap: 6 }}>
              Outra
              <input
                type="color"
                value={value || '#1677ff'}
                onChange={(e) => onChange(e.target.value)}
                style={{ width: 28, height: 22, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
              />
            </label>
          </div>
        </div>
      }
    >
      <Tooltip title={value ? 'Mudar cor' : 'Sem cor — escolher'}>
        <span style={{ display: 'inline-flex' }}><ColorDot color={value} /></span>
      </Tooltip>
    </Popover>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void; // emails may have changed category (after a delete)
}

function CategoriesPanel({ open, onClose, onChanged }: Props) {
  const categories = useCategories();
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [delEmails, setDelEmails] = useState<CategoryEmail[]>([]);
  const [delTotal, setDelTotal] = useState(0);
  const [delLoading, setDelLoading] = useState(false);

  useEffect(() => {
    if (open) reloadCategories().catch(() => message.error('Erro ao carregar categorias'));
  }, [open]);

  useEffect(() => {
    setNames(Object.fromEntries(categories.map((c) => [c.key, c.name])));
  }, [categories]);

  const fail = (e: any, fallback: string) => message.error(e?.response?.data?.error || fallback);

  const saveName = async (c: Category) => {
    const name = (names[c.key] || '').trim();
    if (!name) { setNames((p) => ({ ...p, [c.key]: c.name })); return; }
    if (name === c.name) return;
    try {
      await updateCategoryDef(c.key, { name });
      await reloadCategories();
    } catch (e) {
      fail(e, 'Erro ao guardar o nome');
      setNames((p) => ({ ...p, [c.key]: c.name }));
    }
  };

  const saveColor = async (c: Category, color: string | null) => {
    try {
      await updateCategoryDef(c.key, { color });
      await reloadCategories();
    } catch (e) { fail(e, 'Erro ao guardar a cor'); }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= categories.length) return;
    const keys = categories.map((c) => c.key);
    [keys[index], keys[target]] = [keys[target], keys[index]];
    try {
      await reorderCategories(keys);
      await reloadCategories();
    } catch (e) { fail(e, 'Erro ao reordenar'); }
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await createCategory({ name, color: newColor });
      setNewName('');
      setNewColor(null);
      await reloadCategories();
    } catch (e) { fail(e, 'Erro ao criar categoria'); }
    finally { setBusy(false); }
  };

  const doDelete = async (c: Category) => {
    setBusy(true);
    try {
      const r = await deleteCategory(c.key);
      message.success(
        r.emailsReset > 0
          ? `Categoria apagada; ${r.emailsReset} email(s) ficaram "Sem categoria"`
          : 'Categoria apagada',
      );
      setDeleting(null);
      await reloadCategories();
      if (r.emailsReset > 0) onChanged();
    } catch (e) { fail(e, 'Erro ao apagar categoria'); }
    finally { setBusy(false); }
  };

  const askDelete = async (c: Category) => {
    if (!c.emailCount) { doDelete(c); return; }
    setDeleting(c);
    setDelEmails([]);
    setDelTotal(c.emailCount);
    setDelLoading(true);
    try {
      const r = await getCategoryEmails(c.key);
      setDelEmails(r.emails);
      setDelTotal(r.total);
    } catch (e) { fail(e, 'Erro ao carregar os emails da categoria'); }
    finally { setDelLoading(false); }
  };

  return (
    <>
      <Modal title="Categorias" open={open} onCancel={onClose} footer={null} width={560}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {categories.map((c, i) => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} />
              <Button type="text" size="small" icon={<ArrowDownOutlined />} disabled={i === categories.length - 1} onClick={() => move(i, 1)} />
              <ColorChooser value={c.color} onChange={(color) => saveColor(c, color)} />
              <Input
                size="small"
                value={names[c.key] ?? c.name}
                onChange={(e) => setNames((p) => ({ ...p, [c.key]: e.target.value }))}
                onBlur={() => saveName(c)}
                onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
                style={{ flex: 1 }}
              />
              <span style={{ width: 86, textAlign: 'right', fontSize: 12, color: '#8c8c8c' }}>
                {c.emailCount || 0} email{c.emailCount === 1 ? '' : 's'}
              </span>
              {c.builtin ? (
                <Tooltip title="Categoria de sistema (usada pelas regras): pode mudar nome, cor e ordem, mas não apagar">
                  <Button type="text" size="small" icon={<LockOutlined />} disabled />
                </Tooltip>
              ) : (
                <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => askDelete(c)} />
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
          <ColorChooser value={newColor} onChange={setNewColor} />
          <Input
            placeholder="Nome da nova categoria"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onPressEnter={add}
            style={{ flex: 1 }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={add} loading={busy} disabled={!newName.trim()}>
            Adicionar
          </Button>
        </div>
      </Modal>

      <Modal
        title={deleting ? <>Apagar categoria <ColoredTag name={deleting.name} color={deleting.color} /></> : ''}
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        width={720}
        footer={[
          <Button key="c" onClick={() => setDeleting(null)}>Cancelar</Button>,
          <Button key="d" danger type="primary" loading={busy} onClick={() => deleting && doDelete(deleting)}>
            Apagar categoria
          </Button>,
        ]}
      >
        <p style={{ marginTop: 0 }}>
          Há <strong>{delTotal}</strong> email{delTotal === 1 ? '' : 's'} classificado{delTotal === 1 ? '' : 's'} com
          esta categoria. Se a apagar, {delTotal === 1 ? 'fica' : 'ficam'} "Sem categoria" (os emails não são apagados).
        </p>
        <Table<CategoryEmail>
          size="small"
          rowKey="id"
          loading={delLoading}
          dataSource={delEmails}
          pagination={delEmails.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
          columns={[
            { title: 'De', dataIndex: 'from', ellipsis: true, width: 200 },
            { title: 'Assunto', dataIndex: 'subject', ellipsis: true, render: (s: string | null) => s || '(sem assunto)' },
            { title: 'Conta', dataIndex: ['account', 'email'], ellipsis: true, width: 150 },
            {
              title: 'Data', dataIndex: 'receivedAt', width: 90,
              render: (d: string) => new Date(d).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit' }),
            },
          ]}
        />
        {delTotal > delEmails.length && !delLoading && (
          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 6 }}>
            A mostrar os {delEmails.length} mais recentes de {delTotal}.
          </div>
        )}
      </Modal>
    </>
  );
}

export default CategoriesPanel;
