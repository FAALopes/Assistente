import { useState } from 'react';
import { Alert, Button, List, Tag, Space, Typography, message, Modal } from 'antd';
import { UndoOutlined, CheckOutlined, HistoryOutlined } from '@ant-design/icons';
import type { RuleApplicationRecord, EmailCategory } from '../types';
import { revertApplication, acknowledgeApplications } from '../api';

const { Text } = Typography;

interface Props {
  applications: RuleApplicationRecord[];
  onRefresh: () => void;
}

const categoryLabels: Record<EmailCategory, string> = {
  INBOX: 'Caixa de entrada',
  TODO: 'Tratar depois',
  DELETE: 'Apagar',
  SAVE_LATER: 'Guardar',
  SAVE_ONEDRIVE: 'OneDrive',
  UNCATEGORIZED: 'Sem categoria',
};

const categoryColors: Record<EmailCategory, string> = {
  INBOX: 'default',
  TODO: 'blue',
  DELETE: 'red',
  SAVE_LATER: 'green',
  SAVE_ONEDRIVE: 'cyan',
  UNCATEGORIZED: 'default',
};

function RecentApplicationsBanner({ applications, onRefresh }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (applications.length === 0) return null;

  const handleRevert = async (id: string) => {
    setBusy(id);
    try {
      await revertApplication(id);
      message.success('Acao revertida');
      onRefresh();
    } catch {
      message.error('Erro ao reverter');
    } finally {
      setBusy(null);
    }
  };

  const handleAcknowledgeAll = async () => {
    try {
      await acknowledgeApplications();
      setModalOpen(false);
      onRefresh();
    } catch {
      message.error('Erro ao confirmar');
    }
  };

  return (
    <>
      <Alert
        type="info"
        showIcon
        icon={<HistoryOutlined />}
        style={{ marginBottom: 16 }}
        message={
          <Space>
            <Text strong>
              {applications.length} email{applications.length !== 1 ? 's' : ''} categorizado{applications.length !== 1 ? 's' : ''} automaticamente por regras
            </Text>
          </Space>
        }
        action={
          <Space>
            <Button size="small" onClick={() => setModalOpen(true)}>
              Ver detalhes
            </Button>
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={handleAcknowledgeAll}>
              OK, entendi
            </Button>
          </Space>
        }
      />

      <Modal
        title={`Acoes automaticas recentes (${applications.length})`}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        width={800}
        footer={[
          <Button key="close" onClick={() => setModalOpen(false)}>Fechar</Button>,
          <Button key="ack" type="primary" icon={<CheckOutlined />} onClick={handleAcknowledgeAll}>
            OK, entendi tudo
          </Button>,
        ]}
      >
        <List
          dataSource={applications}
          size="small"
          renderItem={(app) => (
            <List.Item
              actions={[
                <Button
                  key="revert"
                  size="small"
                  icon={<UndoOutlined />}
                  loading={busy === app.id}
                  onClick={() => handleRevert(app.id)}
                >
                  Reverter
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Text style={{ fontSize: 13 }}>
                      {app.email?.subject || '(sem assunto)'}
                    </Text>
                    <Tag color={categoryColors[app.previousCategory]} style={{ fontSize: 10 }}>
                      {categoryLabels[app.previousCategory]}
                    </Tag>
                    <span style={{ color: '#8c8c8c' }}>→</span>
                    <Tag color={categoryColors[app.newCategory]} style={{ fontSize: 10 }}>
                      {categoryLabels[app.newCategory]}
                    </Tag>
                  </Space>
                }
                description={
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    De: {app.email?.from || '-'}
                    {app.rule && ` • Regra: ${app.rule.field} ${app.rule.operator} "${app.rule.value}"`}
                  </Text>
                }
              />
            </List.Item>
          )}
        />
      </Modal>
    </>
  );
}

export default RecentApplicationsBanner;
