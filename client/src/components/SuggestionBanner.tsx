import { useState } from 'react';
import { Alert, Button, Space, List, Tag, Typography, message } from 'antd';
import {
  BulbOutlined,
  DownOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { bulkUpdateCategory } from '../api';
import { EmailCategory } from '../types';
import type { Suggestion, Email } from '../types';

const { Text } = Typography;

interface SuggestionBannerProps {
  suggestions: Suggestion[];
  emails: Email[];
  onApply: (applied: { emailId: string; category: EmailCategory }[]) => void;
}

const categoryLabels: Record<EmailCategory, string> = {
  [EmailCategory.INBOX]: 'Caixa de entrada',
  [EmailCategory.TODO]: 'Tratar depois',
  [EmailCategory.DELETE]: 'Apagar',
  [EmailCategory.ARCHIVE]: 'Arquivo',
  [EmailCategory.ONEDRIVE]: 'OneDrive',
};

const categoryColors: Record<EmailCategory, string> = {
  [EmailCategory.INBOX]: 'default',
  [EmailCategory.TODO]: 'blue',
  [EmailCategory.DELETE]: 'red',
  [EmailCategory.ARCHIVE]: 'green',
  [EmailCategory.ONEDRIVE]: 'cyan',
};

function SuggestionBanner({ suggestions, emails, onApply }: SuggestionBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [applying, setApplying] = useState(false);

  if (suggestions.length === 0) return null;

  const emailMap = new Map(emails.map((e) => [e.id, e]));

  const deleteCount = suggestions.filter(
    (s) => s.suggestedCategory === EmailCategory.DELETE,
  ).length;

  const handleApplyAll = async () => {
    setApplying(true);
    try {
      // Group by category
      const groups = new Map<EmailCategory, string[]>();
      for (const s of suggestions) {
        const ids = groups.get(s.suggestedCategory) || [];
        ids.push(s.emailId);
        groups.set(s.suggestedCategory, ids);
      }

      for (const [category, ids] of groups) {
        await bulkUpdateCategory(ids, category);
      }

      message.success(`${suggestions.length} sugestao(oes) aplicada(s)`);
      onApply(
        suggestions.map((s) => ({
          emailId: s.emailId,
          category: s.suggestedCategory,
        })),
      );
    } catch {
      message.error('Erro ao aplicar sugestoes');
    } finally {
      setApplying(false);
    }
  };

  const description = expanded ? (
    <div style={{ marginTop: 8 }}>
      <List
        size="small"
        dataSource={suggestions}
        renderItem={(suggestion) => {
          const email = emailMap.get(suggestion.emailId);
          return (
            <List.Item>
              <div style={{ width: '100%' }}>
                <Space>
                  <Tag color={categoryColors[suggestion.suggestedCategory]}>
                    {categoryLabels[suggestion.suggestedCategory]}
                  </Tag>
                  <Text strong>{email?.fromName || email?.from || 'Desconhecido'}</Text>
                  <Text type="secondary">
                    {email?.subject || '(sem assunto)'}
                  </Text>
                </Space>
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Motivo: {suggestion.reason}
                  </Text>
                  <Tag style={{ marginLeft: 8, fontSize: 11 }}>
                    {Math.round(suggestion.confidence * 100)}% confianca
                  </Tag>
                </div>
              </div>
            </List.Item>
          );
        }}
      />
    </div>
  ) : undefined;

  return (
    <Alert
      type="info"
      showIcon
      icon={<BulbOutlined />}
      style={{ marginBottom: 12, borderRadius: 8 }}
      message={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <span>
            O Assistente sugere organizar{' '}
            <strong>{suggestions.length} email(s)</strong>
            {deleteCount > 0 && (
              <span>
                {' '}
                (incluindo <strong>{deleteCount}</strong> para apagar)
              </span>
            )}
          </span>
          <Space>
            <Button
              size="small"
              icon={expanded ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Esconder' : 'Ver sugestoes'}
            </Button>
            <Button
              size="small"
              type="primary"
              loading={applying}
              onClick={handleApplyAll}
            >
              Aplicar todas
            </Button>
          </Space>
        </div>
      }
      description={description}
    />
  );
}

export default SuggestionBanner;
