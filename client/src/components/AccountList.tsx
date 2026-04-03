import { Badge, Button, List, Space, Tag, Typography } from 'antd';
import {
  WindowsOutlined,
  GoogleOutlined,
  PlusOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
} from '@ant-design/icons';
import type { EmailAccount } from '../types';

const { Text } = Typography;

interface AccountListProps {
  accounts: EmailAccount[];
  selectedAccountId?: string;
  onSelectAccount: (accountId: string | undefined) => void;
}

const providerColors: Record<string, string> = {
  microsoft: '#0078d4',
  gmail: '#ea4335',
};

const providerIcons: Record<string, React.ReactNode> = {
  microsoft: <WindowsOutlined />,
  gmail: <GoogleOutlined />,
};

function AccountList({
  accounts,
  selectedAccountId,
  onSelectAccount,
}: AccountListProps) {
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
        {selectedAccountId && (
          <Button
            type="link"
            size="small"
            onClick={() => onSelectAccount(undefined)}
          >
            Ver todas
          </Button>
        )}
      </div>

      <List
        dataSource={accounts}
        locale={{ emptyText: 'Nenhuma conta ligada' }}
        renderItem={(account) => (
          <List.Item
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              borderRadius: 8,
              marginBottom: 4,
              background:
                selectedAccountId === account.id ? '#e6f4ff' : 'transparent',
              border:
                selectedAccountId === account.id
                  ? '1px solid #91caff'
                  : '1px solid transparent',
            }}
            onClick={() =>
              onSelectAccount(
                selectedAccountId === account.id ? undefined : account.id,
              )
            }
          >
            <div style={{ width: '100%' }}>
              <Space size={8} style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space size={6}>
                  <span style={{ color: providerColors[account.provider] }}>
                    {providerIcons[account.provider]}
                  </span>
                  <Text
                    ellipsis
                    style={{ maxWidth: 150, fontSize: 13 }}
                    title={account.email}
                  >
                    {account.displayName || account.email}
                  </Text>
                </Space>
                <Space size={4}>
                  {account.unreadCount > 0 && (
                    <Badge
                      count={account.unreadCount}
                      size="small"
                      style={{ backgroundColor: '#1677ff' }}
                    />
                  )}
                  {account.connected ? (
                    <CheckCircleFilled style={{ color: '#52c41a', fontSize: 12 }} />
                  ) : (
                    <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 12 }} />
                  )}
                </Space>
              </Space>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {account.email}
              </Text>
              {account.lastSyncAt && (
                <div>
                  <Tag
                    style={{ fontSize: 10, marginTop: 4 }}
                    color="default"
                  >
                    Sync: {new Date(account.lastSyncAt).toLocaleString('pt-PT')}
                  </Tag>
                </div>
              )}
            </div>
          </List.Item>
        )}
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
