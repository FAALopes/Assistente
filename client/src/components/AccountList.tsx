import { Button, List, Space, Tag, Typography } from 'antd';
import {
  WindowsOutlined,
  GoogleOutlined,
  PlusOutlined,
  InboxOutlined,
  DeleteOutlined,
  SendOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import type { EmailAccount, FoldersByAccount } from '../types';

const { Text } = Typography;

interface AccountListProps {
  accounts: EmailAccount[];
  foldersByAccount: FoldersByAccount;
  selectedAccountId?: string;
  selectedFolder?: string;
  onSelectAccount: (accountId: string | undefined) => void;
  onSelectFolder: (folder: string | undefined) => void;
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

function AccountList({
  accounts,
  foldersByAccount,
  selectedAccountId,
  selectedFolder,
  onSelectAccount,
  onSelectFolder,
}: AccountListProps) {
  const hasActiveFilter = selectedAccountId || selectedFolder;

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

          return (
            <div key={account.id} style={{ marginBottom: 8 }}>
              {/* Account row */}
              <div
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderRadius: 8,
                  background: isAccountSelected ? '#e6f4ff' : 'transparent',
                  border: isAccountSelected ? '1px solid #91caff' : '1px solid transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
                onClick={() => {
                  if (isAccountSelected) {
                    onSelectAccount(undefined);
                    onSelectFolder(undefined);
                  } else {
                    onSelectAccount(account.id);
                    onSelectFolder(undefined);
                  }
                }}
              >
                <Space size={6}>
                  <span style={{ color: providerColors[account.provider] }}>
                    {providerIcons[account.provider]}
                  </span>
                  <div>
                    <Text
                      ellipsis
                      style={{ maxWidth: 140, fontSize: 13, display: 'block' }}
                      title={account.email}
                    >
                      {account.displayName || account.email}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {account.email}
                    </Text>
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
    </div>
  );
}

export default AccountList;
