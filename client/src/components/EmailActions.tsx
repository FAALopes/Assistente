import { Button, Space, message, Card } from 'antd';
import {
  DeleteOutlined,
  ClockCircleOutlined,
  CheckSquareOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons';
import { bulkUpdateCategory, bulkDeleteEmails } from '../api';
import { EmailCategory } from '../types';

interface EmailActionsProps {
  selectedIds: string[];
  onActionComplete: () => void;
}

function EmailActions({ selectedIds, onActionComplete }: EmailActionsProps) {
  const count = selectedIds.length;

  const handleCategory = async (category: EmailCategory) => {
    try {
      const result = await bulkUpdateCategory(selectedIds, category);
      message.success(`${result.updated} email(s) atualizado(s)`);
      onActionComplete();
    } catch {
      message.error('Erro ao atualizar emails');
    }
  };

  const handleDelete = async () => {
    try {
      const result = await bulkDeleteEmails(selectedIds);
      message.success(`${result.deleted} email(s) apagado(s)`);
      onActionComplete();
    } catch {
      message.error('Erro ao apagar emails');
    }
  };

  return (
    <Card
      size="small"
      style={{
        marginBottom: 12,
        borderColor: '#1677ff',
        background: '#f0f5ff',
      }}
      bodyStyle={{ padding: '8px 16px' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <span style={{ fontWeight: 500 }}>
          {count} email{count !== 1 ? 's' : ''} selecionado{count !== 1 ? 's' : ''}
        </span>
        <Space wrap>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={handleDelete}
          >
            Apagar
          </Button>
          <Button
            style={{ borderColor: '#fa8c16', color: '#fa8c16' }}
            icon={<ClockCircleOutlined />}
            onClick={() => handleCategory(EmailCategory.TODO)}
          >
            Tratar Depois
          </Button>
          <Button
            type="primary"
            icon={<CheckSquareOutlined />}
            onClick={() => handleCategory(EmailCategory.SAVE_LATER)}
          >
            Guardar
          </Button>
          <Button
            style={{ borderColor: '#52c41a', color: '#52c41a' }}
            icon={<CloudUploadOutlined />}
            onClick={() => handleCategory(EmailCategory.SAVE_ONEDRIVE)}
          >
            Guardar OneDrive
          </Button>
        </Space>
      </div>
    </Card>
  );
}

export default EmailActions;
