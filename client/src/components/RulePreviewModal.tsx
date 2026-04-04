import { Modal, Tag, Collapse, List, Button, Space, Typography, Empty } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import type { RulePreviewResult, RulePreviewMatch } from '../types';

const { Text } = Typography;

interface RulePreviewModalProps {
  open: boolean;
  data: RulePreviewResult | null;
  loading: boolean;
  onApply: () => void;
  onCancel: () => void;
}

const actionLabels: Record<string, string> = {
  DELETE: 'Apagar',
  TODO: 'Tratar depois',
  SAVE_LATER: 'Guardar',
  SAVE_ONEDRIVE: 'OneDrive',
};

const actionColors: Record<string, string> = {
  DELETE: 'red',
  TODO: 'blue',
  SAVE_LATER: 'green',
  SAVE_ONEDRIVE: 'cyan',
};

const fieldLabels: Record<string, string> = {
  FROM: 'Remetente',
  SUBJECT: 'Assunto',
  BODY: 'Corpo',
};

const operatorLabels: Record<string, string> = {
  CONTAINS: 'contém',
  EQUALS: 'igual a',
  STARTS_WITH: 'começa com',
};

function ruleDescription(match: RulePreviewMatch): string {
  const field = fieldLabels[match.rule.field] || match.rule.field;
  const op = operatorLabels[match.rule.operator] || match.rule.operator;
  return `${field} ${op} "${match.rule.value}"`;
}

function RulePreviewModal({ open, data, loading, onApply, onCancel }: RulePreviewModalProps) {
  const matches = data?.matches || [];
  const totalMatched = data?.totalMatched || 0;

  const collapseItems = matches.map((match, index) => ({
    key: String(index),
    label: (
      <Space>
        <Text strong>{ruleDescription(match)}</Text>
        <Tag color={actionColors[match.action] || 'default'}>
          {actionLabels[match.action] || match.action}
        </Tag>
        <Tag>{match.count} email{match.count !== 1 ? 's' : ''}</Tag>
      </Space>
    ),
    children: (
      <List
        size="small"
        dataSource={match.emails}
        renderItem={(email) => (
          <List.Item>
            <List.Item.Meta
              title={email.subject}
              description={
                <Space>
                  <Text type="secondary">{email.from}</Text>
                  <Text type="secondary">
                    {new Date(email.receivedAt).toLocaleString('pt-PT', {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </Space>
              }
            />
          </List.Item>
        )}
      />
    ),
  }));

  return (
    <Modal
      title="Regras a aplicar"
      open={open}
      onCancel={onCancel}
      width={700}
      footer={[
        <Button key="cancel" icon={<CloseOutlined />} onClick={onCancel}>
          Cancelar
        </Button>,
        <Button
          key="apply"
          type="primary"
          icon={<CheckOutlined />}
          onClick={onApply}
          loading={loading}
          disabled={totalMatched === 0}
        >
          Aplicar todas ({totalMatched})
        </Button>,
      ]}
    >
      {matches.length === 0 ? (
        <Empty description="Nenhuma regra corresponde a emails por categorizar" />
      ) : (
        <>
          <Text type="secondary" style={{ marginBottom: 16, display: 'block' }}>
            {totalMatched} email{totalMatched !== 1 ? 's' : ''} correspondem a {matches.length} regra{matches.length !== 1 ? 's' : ''}
          </Text>
          <Collapse items={collapseItems} />
        </>
      )}
    </Modal>
  );
}

export default RulePreviewModal;
