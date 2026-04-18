import { useState, useEffect, useCallback } from 'react';
import { Drawer, List, Button, Space, Typography, Tag, Popconfirm, message, Empty } from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import type { EmailAction, EmailAccount } from '../types';
import { getEmailActions, deleteEmailAction } from '../api';
import DefineActionModal from './DefineActionModal';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  accounts: EmailAccount[];
}

function EmailActionsPanel({ open, onClose, accounts }: Props) {
  const [actions, setActions] = useState<EmailAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<EmailAction | null>(null);
  const [creating, setCreating] = useState(false);

  const accountMap = new Map(accounts.map(a => [a.id, a]));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getEmailActions();
      setActions(data);
    } catch {
      message.error('Erro ao carregar ações');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleDelete = async (id: string) => {
    try {
      await deleteEmailAction(id);
      message.success('Ação apagada');
      refresh();
    } catch {
      message.error('Erro ao apagar');
    }
  };

  return (
    <>
      <Drawer
        title={
          <Space>
            <ThunderboltOutlined style={{ color: '#faad14' }} />
            <span>Ações de Email</span>
          </Space>
        }
        open={open}
        onClose={onClose}
        width={600}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            Nova ação
          </Button>
        }
      >
        {actions.length === 0 && !loading ? (
          <Empty description="Sem ações definidas. Clica botão direito num email para criar." />
        ) : (
          <List
            loading={loading}
            dataSource={actions}
            renderItem={(a) => {
              const account = a.accountId ? accountMap.get(a.accountId) : null;
              return (
                <List.Item
                  actions={[
                    <Button
                      key="edit"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => setEditing(a)}
                    >
                      Editar
                    </Button>,
                    <Popconfirm
                      key="del"
                      title="Apagar esta ação?"
                      onConfirm={() => handleDelete(a.id)}
                      okText="Apagar"
                      cancelText="Cancelar"
                      okButtonProps={{ danger: true }}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={<Text strong>{a.name}</Text>}
                    description={
                      <div style={{ fontSize: 12 }}>
                        <div style={{ marginBottom: 4 }}>
                          <LinkOutlined style={{ color: '#1677ff', marginRight: 4 }} />
                          <Text code style={{ fontSize: 11 }}>{a.actionValue}</Text>
                        </div>
                        <Space size={4} wrap>
                          {account && <Tag color="blue">Conta: {account.displayName || account.email}</Tag>}
                          {a.senderPattern && <Tag color="purple">De: {a.senderPattern}</Tag>}
                          {a.subjectPattern && <Tag color="orange">Assunto: {a.subjectPattern}</Tag>}
                        </Space>
                      </div>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Drawer>

      <DefineActionModal
        open={editing !== null}
        action={editing}
        accounts={accounts}
        onClose={() => setEditing(null)}
        onSaved={refresh}
      />
      <DefineActionModal
        open={creating}
        accounts={accounts}
        onClose={() => setCreating(false)}
        onSaved={refresh}
      />
    </>
  );
}

export default EmailActionsPanel;
