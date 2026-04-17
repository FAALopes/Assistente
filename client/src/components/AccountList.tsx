import { useState, useRef, useEffect } from 'react';
import { Button, List, Space, Tag, Typography, Input, Popover, message } from 'antd';
import type { InputRef } from 'antd';
import {
  WindowsOutlined,
  GoogleOutlined,
  PlusOutlined,
  InboxOutlined,
  DeleteOutlined,
  SendOutlined,
  FolderOutlined,
  EditOutlined,
  BgColorsOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import type { EmailAccount, FoldersByAccount } from '../types';
import { updateAccount } from '../api';
import { COLOR_PALETTE } from '../constants/colorPalette';

const { Text } = Typography;

interface AccountListProps {
  accounts: EmailAccount[];
  foldersByAccount: FoldersByAccount;
  selectedAccountId?: string;
  selectedFolder?: string;
  onSelectAccount: (accountId: string | undefined) => void;
  onSelectFolder: (folder: string | undefined) => void;
  onAccountUpdated?: () => void;
}

const providerColors: Record<string, string> = {
  MICROSOFT: '#0078d4',
  GMAIL: '#ea4335',
  IMAP: '#8c8c8c',
};

const providerIcons: Record<string, React.ReactNode> = {
  MICROSOFT: <WindowsOutlined />,
  GMAIL: <GoogleOutlined />,
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

// Compute readable text color based on background brightness
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

function AccountList({
  accounts,
  foldersByAccount,
  selectedAccountId,
  selectedFolder,
  onSelectAccount,
  onSelectFolder,
  onAccountUpdated,
}: AccountListProps) {
  const hasActiveFilter = selectedAccountId || selectedFolder;
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (!menu) return;
    const handler = () => setMenu(null);
    window.addEventListener('click', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('click', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [menu]);

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

  const menuAccount = menu ? accounts.find(a => a.id === menu.accountId) : null;

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

          return (
            <div key={account.id} style={{ marginBottom: 8 }}>
              {/* Account row */}
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
                  if (isAccountSelected) {
                    onSelectAccount(undefined);
                    onSelectFolder(undefined);
                  } else {
                    onSelectAccount(account.id);
                    onSelectFolder(undefined);
                  }
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
                {account._count && account._count.emails > 0 && (
                  <Tag color="blue" style={{ fontSize: 11 }}>
                    {account._count.emails}
                  </Tag>
                )}
              </div>

              {/* Folder sub-items */}
              <div style={{ paddingLeft: 20, marginTop: 2 }}>
                {(foldersByAccount[account.id] || []).map((folder) => {
                  const isFolderSelected =
                    selectedAccountId === account.id && selectedFolder === folder.id;
                  const icon = folderIcons[folder.id] || <FolderOutlined />;
                  const color = folderColors[folder.id] || '#8c8c8c';

                  return (
                    <div
                      key={folder.id}
                      style={{
                        padding: '4px 10px',
                        cursor: 'pointer',
                        borderRadius: 6,
                        background: isFolderSelected ? '#e6f4ff' : 'transparent',
                        border: isFolderSelected ? '1px solid #91caff' : '1px solid transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        if (!isFolderSelected) {
                          (e.currentTarget as HTMLDivElement).style.background = '#f5f5f5';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isFolderSelected) {
                          (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isFolderSelected) {
                          onSelectFolder(undefined);
                          onSelectAccount(account.id);
                        } else {
                          onSelectAccount(account.id);
                          onSelectFolder(folder.id);
                        }
                      }}
                    >
                      <Space size={6}>
                        <span style={{ color, fontSize: 13 }}>{icon}</span>
                        <Text style={{ fontSize: 12 }}>{folder.label}</Text>
                      </Space>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {folder.count}
                      </Text>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }}
      />

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          block
          href="/auth/microsoft"
        >
          Adicionar conta Microsoft
        </Button>
        <Button
          icon={<GoogleOutlined />}
          block
          disabled
          title="Em breve"
        >
          Adicionar conta Gmail
        </Button>
        <Text
          type="secondary"
          style={{ fontSize: 11, textAlign: 'center' }}
        >
          Gmail disponivel em breve
        </Text>
      </div>

      {/* Context menu */}
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
        </div>
      )}
    </div>
  );
}

export default AccountList;
