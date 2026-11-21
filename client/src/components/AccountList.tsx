import { useState, useRef, useEffect } from 'react';
import { Button, List, Space, Tag, Typography, Input, Popover, message } from 'antd';
import type { InputRef } from 'antd';
import {
  WindowsOutlined,
  GoogleOutlined,
  InboxOutlined,
  DeleteOutlined,
  SendOutlined,
  FolderOutlined,
  EditOutlined,
  BgColorsOutlined,
  CloseOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  EyeOutlined,
  MailOutlined,
  SyncOutlined,
  CaretRightOutlined,
  CaretDownOutlined,
} from '@ant-design/icons';
import type { EmailAccount, FoldersByAccount } from '../types';
import { updateAccount, moveAccount } from '../api';
import { COLOR_PALETTE } from '../constants/colorPalette';
import AddImapModal from './AddImapModal';

const { Text } = Typography;

interface AccountListProps {
  accounts: EmailAccount[];
  foldersByAccount: FoldersByAccount;
  selectedAccountId?: string;
  selectedFolder?: string;
  onSelectAccount: (accountId: string | undefined) => void;
  onSelectFolder: (folder: string | undefined) => void;
  onAccountUpdated?: () => void;
  onSyncAccount?: (accountId: string) => void;
}

const providerColors: Record<string, string> = {
  MICROSOFT: '#0078d4',
  GMAIL: '#ea4335',
  IMAP: '#8c8c8c',
};

const providerIcons: Record<string, React.ReactNode> = {
  MICROSOFT: <WindowsOutlined />,
  GMAIL: <GoogleOutlined />,
  IMAP: <MailOutlined />,
};

const folderIcons: Record<string, React.ReactNode> = {
  inbox: <InboxOutlined />,
  junkemail: <DeleteOutlined style={{ color: '#ff4d4f' }} />,
  sentitems: <SendOutlined />,
  drafts: <FolderOutlined />,
  deleteditems: <DeleteOutlined />,
  archive: <FolderOutlined />,
};

const folderColors: Record<string, string> = {
  inbox: '#1677ff',
  junkemail: '#ff4d4f',
  sentitems: '#52c41a',
  drafts: '#faad14',
  deleteditems: '#8c8c8c',
  archive: '#722ed1',
};

function textColorFor(bg?: string | null): string {
  if (!bg) return '#000';
  const hex = bg.replace('#', '');
  if (hex.length !== 6) return '#000';
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 140 ? '#000' : '#fff';
}

interface ContextMenuState {
  accountId: string;
  x: number;
  y: number;
}

const COLLAPSED_KEY = 'assistente.collapsedAccounts';
const EXPANDED_FOLDERS_KEY = 'assistente.expandedFolders';

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveCollapsed(s: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(s)));
  } catch { /* storage unavailable */ }
}

function loadExpandedFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_FOLDERS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveExpandedFolders(s: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_FOLDERS_KEY, JSON.stringify(Array.from(s)));
  } catch { /* storage unavailable */ }
}

function renderFolderTree(
  folders: Array<{ id: string; label: string; count: number; unreadCount?: number; parentId?: string | null; wellKnownName?: string | null; depth?: number }>,
  accountId: string,
  parentId: string | null,
  expanded: Set<string>,
  selectedAccountId: string | undefined,
  selectedFolder: string | undefined,
  toggleExpand: (accountId: string, folderId: string) => void,
  onSelectFolder: (folderId: string) => void,
  level = 0,
): React.ReactNode {
  const children = folders.filter(f => (f.parentId || null) === parentId);
  if (children.length === 0) return null;
  // Sort: wellKnown folders first in canonical order, then alphabetical
  const wellKnownOrder = ['inbox', 'drafts', 'sentitems', 'junkemail', 'archive', 'deleteditems', 'outbox'];
  const wkIdx = (wk: string | null | undefined) => {
    const i = wellKnownOrder.indexOf(wk || '');
    return i === -1 ? 99 : i;
  };
  children.sort((a, b) => {
    const ia = wkIdx(a.wellKnownName), ib = wkIdx(b.wellKnownName);
    if (ia !== ib) return ia - ib;
    return a.label.localeCompare(b.label, 'pt');
  });
  return (
    <>
      {children.map(folder => {
        const hasChildren = folders.some(f => f.parentId === folder.id);
        const key = `${accountId}:${folder.id}`;
        const isExpanded = expanded.has(key);
        const isSelected = selectedAccountId === accountId && selectedFolder === folder.id;
        const wk = folder.wellKnownName || folder.id;
        const icon = folderIcons[wk] || <FolderOutlined />;
        const color = folderColors[wk] || '#8c8c8c';
        return (
          <div key={folder.id}>
            <div
              style={{
                padding: '4px 6px',
                paddingLeft: 6 + level * 14,
                cursor: 'pointer',
                borderRadius: 6,
                background: isSelected ? '#e6f4ff' : 'transparent',
                border: isSelected ? '1px solid #91caff' : '1px solid transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = '#f5f5f5'; }}
              onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              onClick={(e) => { e.stopPropagation(); onSelectFolder(folder.id); }}
              title={folder.label}
            >
              <Space size={2} style={{ minWidth: 0, flex: 1 }}>
                <span
                  onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleExpand(accountId, folder.id); }}
                  style={{
                    width: 14,
                    display: 'inline-flex',
                    justifyContent: 'center',
                    color: hasChildren ? '#8c8c8c' : 'transparent',
                    cursor: hasChildren ? 'pointer' : 'default',
                    fontSize: 10,
                  }}
                >
                  {hasChildren ? (isExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />) : null}
                </span>
                <span style={{ color, fontSize: 13 }}>{icon}</span>
                <Text style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {folder.label}
                </Text>
              </Space>
              <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                {folder.count}
                {folder.unreadCount ? (
                  <span style={{ color: '#1677ff', fontWeight: 600, marginLeft: 4 }}>
                    ({folder.unreadCount})
                  </span>
                ) : null}
              </Text>
            </div>
            {hasChildren && isExpanded && renderFolderTree(
              folders, accountId, folder.id, expanded, selectedAccountId, selectedFolder, toggleExpand, onSelectFolder, level + 1,
            )}
          </div>
        );
      })}
    </>
  );
}

function AccountList({
  accounts,
  foldersByAccount,
  selectedAccountId,
  selectedFolder,
  onSelectAccount,
  onSelectFolder,
  onAccountUpdated,
  onSyncAccount,
}: AccountListProps) {
  const hasActiveFilter = selectedAccountId || selectedFolder;
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<InputRef>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => loadExpandedFolders());
  const [imapModalOpen, setImapModalOpen] = useState(false);
  const [gmailModalOpen, setGmailModalOpen] = useState(false);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (!menu) return;
    const handler = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('click', handler);
    window.addEventListener('scroll', handler, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [menu]);

  const toggleCollapsed = (accountId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId); else next.add(accountId);
      saveCollapsed(next);
      return next;
    });
  };

  const toggleFolderExpand = (accountId: string, folderId: string) => {
    const key = `${accountId}:${folderId}`;
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveExpandedFolders(next);
      return next;
    });
  };

  const startRename = (account: EmailAccount) => {
    setEditingId(account.id);
    setEditValue(account.displayName || account.email);
    setMenu(null);
  };

  const saveRename = async (accountId: string) => {
    const newName = editValue.trim();
    setEditingId(null);
    try {
      await updateAccount(accountId, { displayName: newName });
      message.success('Conta renomeada');
      onAccountUpdated?.();
    } catch {
      message.error('Erro ao renomear');
    }
  };

  const setColor = async (accountId: string, color: string | null) => {
    setMenu(null);
    try {
      await updateAccount(accountId, { color });
      onAccountUpdated?.();
    } catch {
      message.error('Erro ao aplicar cor');
    }
  };

  const [autoSyncDraft, setAutoSyncDraft] = useState<string>('');

  const saveAutoSync = async (accountId: string) => {
    const n = autoSyncDraft.trim() === '' ? null : Number(autoSyncDraft);
    setMenu(null);
    try {
      await updateAccount(accountId, { autoSyncMinutes: n });
      message.success(n ? `Auto-sync: ${n} min` : 'Auto-sync desligado');
      onAccountUpdated?.();
    } catch {
      message.error('Erro ao gravar');
    }
  };

  const doMove = async (accountId: string, direction: 'up' | 'down') => {
    setMenu(null);
    try {
      await moveAccount(accountId, direction);
      onAccountUpdated?.();
    } catch {
      message.error('Erro ao mover conta');
    }
  };

  const viewOnlyAccount = (accountId: string) => {
    setMenu(null);
    onSelectAccount(accountId);
    onSelectFolder(undefined);
  };

  const syncOnlyAccount = (accountId: string) => {
    setMenu(null);
    if (onSyncAccount) {
      onSyncAccount(accountId);
    } else {
      message.error('Sync nao disponivel');
    }
  };

  const menuAccount = menu ? accounts.find(a => a.id === menu.accountId) : null;
  const menuIndex = menu ? accounts.findIndex(a => a.id === menu.accountId) : -1;
  const canMoveUp = menuIndex > 0;
  const canMoveDown = menuIndex !== -1 && menuIndex < accounts.length - 1;

  return (
    <div style={{ padding: '12px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <Text strong style={{ fontSize: 13, textTransform: 'uppercase', color: '#8c8c8c' }}>
          Contas
        </Text>
        {hasActiveFilter && (
          <Button
            type="link"
            size="small"
            onClick={() => {
              onSelectAccount(undefined);
              onSelectFolder(undefined);
            }}
          >
            Ver todas
          </Button>
        )}
      </div>

      <List
        dataSource={accounts}
        locale={{ emptyText: 'Nenhuma conta ligada' }}
        renderItem={(account) => {
          const isAccountSelected = selectedAccountId === account.id && !selectedFolder;
          const bg = account.color;
          const fg = textColorFor(bg);
          const isEditing = editingId === account.id;
          const isCollapsed = collapsed.has(account.id);
          const folders = foldersByAccount[account.id] || [];
          const inboxFolder = folders.find(f => (f.wellKnownName || f.id) === 'inbox');
          const inboxCount = inboxFolder?.count ?? 0;
          const inboxUnread = inboxFolder?.unreadCount ?? 0;
          const totalCount = account._count?.emails ?? 0;
          const totalUnread = folders.reduce((sum, f) => sum + (f.unreadCount || 0), 0);

          return (
            <div key={account.id} style={{ marginBottom: 8 }}>
              <div
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ accountId: account.id, x: e.clientX, y: e.clientY });
                }}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderRadius: 8,
                  background: bg || (isAccountSelected ? '#e6f4ff' : 'transparent'),
                  color: bg ? fg : undefined,
                  border: isAccountSelected ? '1px solid #91caff' : '1px solid transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
                onClick={() => {
                  if (isEditing) return;
                  toggleCollapsed(account.id);
                }}
              >
                <Space size={6} style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: bg ? fg : providerColors[account.provider] }}>
                    {providerIcons[account.provider]}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isEditing ? (
                      <Input
                        ref={editInputRef}
                        size="small"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onPressEnter={() => saveRename(account.id)}
                        onBlur={() => saveRename(account.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setEditingId(null);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: 13 }}
                      />
                    ) : (
                      <>
                        <div
                          style={{
                            maxWidth: 140,
                            fontSize: 13,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: bg ? fg : undefined,
                          }}
                          title={account.email}
                        >
                          {account.displayName || account.email}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: bg ? fg : '#8c8c8c',
                            opacity: bg ? 0.85 : 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {account.email}
                        </div>
                      </>
                    )}
                  </div>
                </Space>
                <Space size={4}>
                  {isCollapsed && (
                    <Tag
                      color="blue"
                      style={{ fontSize: 14, margin: 0, padding: '2px 8px', fontWeight: 600 }}
                      title="Inbox"
                    >
                      <InboxOutlined style={{ marginRight: 4 }} />
                      {inboxCount}
                      {inboxUnread > 0 && (
                        <span style={{ marginLeft: 4, fontWeight: 700 }}>({inboxUnread})</span>
                      )}
                    </Tag>
                  )}
                  {totalCount > 0 && (
                    <Tag
                      color="default"
                      style={{ fontSize: 14, margin: 0, padding: '2px 8px', fontWeight: 600 }}
                      title="Total (nao lidos)"
                    >
                      {totalCount}
                      {totalUnread > 0 && (
                        <span style={{ marginLeft: 4, color: '#1677ff', fontWeight: 700 }}>({totalUnread})</span>
                      )}
                    </Tag>
                  )}
                </Space>
              </div>

              {!isCollapsed && (
                <div style={{ paddingLeft: 8, marginTop: 2 }}>
                  {renderFolderTree(
                    folders,
                    account.id,
                    null,
                    expandedFolders,
                    selectedAccountId,
                    selectedFolder,
                    toggleFolderExpand,
                    (folderId) => {
                      onSelectAccount(account.id);
                      onSelectFolder(folderId);
                    },
                  )}
                </div>
              )}
            </div>
          );
        }}
      />

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button
          icon={<WindowsOutlined style={{ color: '#0078d4' }} />}
          block
          href="/auth/microsoft"
        >
          Adicionar conta Microsoft
        </Button>
        <Button
          icon={<MailOutlined />}
          block
          onClick={() => setImapModalOpen(true)}
        >
          Adicionar conta IMAP
        </Button>
        <Button
          icon={<GoogleOutlined style={{ color: '#ea4335' }} />}
          block
          onClick={() => setGmailModalOpen(true)}
        >
          Adicionar conta Gmail
        </Button>
        <Text
          type="secondary"
          style={{ fontSize: 11, textAlign: 'center' }}
        >
          Gmail requer App Password (2FA activo)
        </Text>
      </div>

      <AddImapModal
        open={imapModalOpen}
        onClose={() => setImapModalOpen(false)}
        onCreated={() => onAccountUpdated?.()}
      />
      <AddImapModal
        open={gmailModalOpen}
        onClose={() => setGmailModalOpen(false)}
        onCreated={() => onAccountUpdated?.()}
        title="Adicionar conta Gmail"
        presetHost="imap.gmail.com"
        presetPort={993}
        presetTls={true}
        passwordHelp="Usa a App Password de 16 chars (nao a password normal da conta Google)"
      />

      {menu && menuAccount && (
        <div
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            top: menu.y,
            left: menu.x,
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            padding: 8,
            zIndex: 2000,
            minWidth: 220,
            border: '1px solid #f0f0f0',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={() => viewOnlyAccount(menuAccount.id)}
          >
            <EyeOutlined /> Ver só esta conta
          </div>
          <div
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={() => syncOnlyAccount(menuAccount.id)}
          >
            <SyncOutlined /> Sincronizar so esta conta
          </div>
          <div
            style={{
              padding: '8px 12px',
              cursor: canMoveUp ? 'pointer' : 'not-allowed',
              opacity: canMoveUp ? 1 : 0.4,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
            }}
            onMouseEnter={(e) => { if (canMoveUp) e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={() => { if (canMoveUp) doMove(menuAccount.id, 'up'); }}
          >
            <ArrowUpOutlined /> Subir
          </div>
          <div
            style={{
              padding: '8px 12px',
              cursor: canMoveDown ? 'pointer' : 'not-allowed',
              opacity: canMoveDown ? 1 : 0.4,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
            }}
            onMouseEnter={(e) => { if (canMoveDown) e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={() => { if (canMoveDown) doMove(menuAccount.id, 'down'); }}
          >
            <ArrowDownOutlined /> Descer
          </div>
          <div
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={() => startRename(menuAccount)}
          >
            <EditOutlined /> Renomear
          </div>
          <Popover
            trigger="click"
            placement="right"
            content={
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2, marginBottom: 8 }}>
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      title={c}
                      onClick={() => setColor(menuAccount.id, c)}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 4,
                        border: '1px solid #d9d9d9',
                        background: c,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    />
                  ))}
                </div>
                {menuAccount.color && (
                  <Button
                    size="small"
                    block
                    icon={<CloseOutlined />}
                    onClick={() => setColor(menuAccount.id, null)}
                  >
                    Remover cor
                  </Button>
                )}
              </div>
            }
          >
            <div
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <BgColorsOutlined /> Cor de fundo
            </div>
          </Popover>
          <Popover
            trigger="click"
            placement="right"
            onOpenChange={(v) => { if (v) setAutoSyncDraft(menuAccount.autoSyncMinutes ? String(menuAccount.autoSyncMinutes) : ''); }}
            content={
              <div style={{ width: 200 }}>
                <div style={{ fontSize: 12, marginBottom: 6, color: '#8c8c8c' }}>
                  Sincronizar automaticamente de X em X minutos (vazio = desligado)
                </div>
                <Input
                  type="number"
                  min={1}
                  placeholder="min"
                  value={autoSyncDraft}
                  onChange={(e) => setAutoSyncDraft(e.target.value)}
                  onPressEnter={() => saveAutoSync(menuAccount.id)}
                  suffix="min"
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <Button size="small" type="primary" onClick={() => saveAutoSync(menuAccount.id)}>
                    Gravar
                  </Button>
                </div>
              </div>
            }
          >
            <div
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <SyncOutlined /> Auto-sync{menuAccount.autoSyncMinutes ? ` (${menuAccount.autoSyncMinutes} min)` : ' (off)'}
            </div>
          </Popover>
        </div>
      )}
    </div>
  );
}

export default AccountList;
