import { useState, useEffect, useCallback } from 'react';
import {
  Drawer,
  Tabs,
  List,
  Checkbox,
  Tag,
  Button,
  Space,
  Typography,
  Select,
  message,
  Spin,
  Badge,
  Alert,
  Progress,
  Segmented,
} from 'antd';
import {
  DeleteOutlined,
  InboxOutlined,
  EyeOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  SortAscendingOutlined,
} from '@ant-design/icons';
import type { Email, TriageAction, TriageClassification } from '../types';
import { triageJunkEmails, executeTriageActions, recordTriageOverride } from '../api';

const { Text, Title } = Typography;

interface TriagePanelProps {
  open: boolean;
  onClose: () => void;
  emails: Email[];
  onComplete: () => void;
}

interface TriageItem {
  emailId: string;
  email: Email;
  aiAction: TriageAction;
  currentAction: TriageAction;
  reason: string;
  confidence: number;
  checked: boolean;
}

function TriagePanel({ open, onClose, emails, onComplete }: TriagePanelProps) {
  const [items, setItems] = useState<TriageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState<TriageAction>('DELETE');
  const [done, setDone] = useState(false);
  const [sortBy, setSortBy] = useState<'date' | 'sender' | 'confidence'>('date');

  const emailMap = new Map(emails.map(e => [e.id, e]));

  const [cacheInfo, setCacheInfo] = useState<{ fromCache: number; newlyClassified: number } | null>(null);

  const runTriage = useCallback(async (forceReclassify = false) => {
    setLoading(true);
    setDone(false);
    setCacheInfo(null);
    try {
      const result = await triageJunkEmails(undefined, forceReclassify);
      const triageItems: TriageItem[] = result.classifications
        .map((c: TriageClassification) => {
          const email = emailMap.get(c.emailId);
          if (!email) return null;
          return {
            emailId: c.emailId,
            email,
            aiAction: c.action,
            currentAction: c.action,
            reason: c.reason,
            confidence: c.confidence,
            checked: true,
          };
        })
        .filter((item): item is TriageItem => item !== null);

      setItems(triageItems);
      setCacheInfo({
        fromCache: result.fromCache || 0,
        newlyClassified: result.newlyClassified || 0,
      });

      // Set active tab to the one with most items
      const counts = { DELETE: 0, MOVE_TO_INBOX: 0, REVIEW: 0 };
      triageItems.forEach(i => counts[i.currentAction]++);
      if (counts.DELETE >= counts.MOVE_TO_INBOX && counts.DELETE >= counts.REVIEW) {
        setActiveTab('DELETE');
      } else if (counts.MOVE_TO_INBOX >= counts.REVIEW) {
        setActiveTab('MOVE_TO_INBOX');
      } else {
        setActiveTab('REVIEW');
      }
    } catch {
      message.error('Erro ao classificar emails');
    } finally {
      setLoading(false);
    }
  }, [emails]);

  useEffect(() => {
    if (open && emails.length > 0) {
      runTriage();
    }
  }, [open]);

  const toggleCheck = (emailId: string) => {
    setItems(prev =>
      prev.map(item =>
        item.emailId === emailId ? { ...item, checked: !item.checked } : item,
      ),
    );
  };

  const changeAction = (emailId: string, newAction: TriageAction) => {
    setItems(prev =>
      prev.map(item => {
        if (item.emailId !== emailId) return item;

        // Record override if different from AI suggestion
        if (newAction !== item.aiAction) {
          recordTriageOverride(emailId, item.aiAction, newAction).catch(() => {});
          message.info(`Preferencia registada para ${item.email.from}`);
        }

        return { ...item, currentAction: newAction };
      }),
    );
  };

  const selectAllInTab = (action: TriageAction, checked: boolean) => {
    setItems(prev =>
      prev.map(item =>
        item.currentAction === action ? { ...item, checked } : item,
      ),
    );
  };

  const getItemsByAction = (action: TriageAction) => {
    const filtered = items.filter(i => i.currentAction === action);
    return filtered.sort((a, b) => {
      if (sortBy === 'sender') return (a.email.from || '').localeCompare(b.email.from || '');
      if (sortBy === 'confidence') return b.confidence - a.confidence;
      return new Date(b.email.receivedAt).getTime() - new Date(a.email.receivedAt).getTime();
    });
  };

  const getCheckedCount = (action: TriageAction) =>
    items.filter(i => i.currentAction === action && i.checked).length;

  const handleExecute = async () => {
    const checkedItems = items.filter(i => i.checked);
    if (checkedItems.length === 0) {
      message.warning('Nenhum email selecionado');
      return;
    }

    setExecuting(true);
    try {
      const actions = checkedItems.map(i => ({
        emailId: i.emailId,
        action: i.currentAction,
      }));

      const result = await executeTriageActions(actions);

      const parts: string[] = [];
      if (result.deleted > 0) parts.push(`${result.deleted} apagados`);
      if (result.moved > 0) parts.push(`${result.moved} movidos para Inbox`);
      if (result.reviewed > 0) parts.push(`${result.reviewed} para rever`);

      message.success(`Triagem concluida: ${parts.join(', ')}`);

      if (result.errors.length > 0) {
        message.warning(`${result.errors.length} erro(s) durante execucao`);
      }

      setDone(true);
      onComplete();
    } catch {
      message.error('Erro ao executar triagem');
    } finally {
      setExecuting(false);
    }
  };

  const deleteCount = getItemsByAction('DELETE').length;
  const moveCount = getItemsByAction('MOVE_TO_INBOX').length;
  const reviewCount = getItemsByAction('REVIEW').length;

  const confidenceColor = (c: number) => {
    if (c >= 85) return '#52c41a';
    if (c >= 60) return '#faad14';
    return '#ff4d4f';
  };

  const renderList = (action: TriageAction) => {
    const tabItems = getItemsByAction(action);
    const allChecked = tabItems.length > 0 && tabItems.every(i => i.checked);
    const someChecked = tabItems.some(i => i.checked);

    return (
      <div>
        {tabItems.length > 0 && (
          <div style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0', marginBottom: 8 }}>
            <Checkbox
              checked={allChecked}
              indeterminate={someChecked && !allChecked}
              onChange={(e) => selectAllInTab(action, e.target.checked)}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>
                Selecionar todos ({tabItems.length})
              </Text>
            </Checkbox>
          </div>
        )}
        <List
          dataSource={tabItems}
          locale={{ emptyText: 'Nenhum email nesta categoria' }}
          renderItem={(item) => (
            <List.Item
              style={{
                padding: '10px 0',
                borderBottom: '1px solid #f5f5f5',
                opacity: item.checked ? 1 : 0.5,
              }}
            >
              <div style={{ display: 'flex', width: '100%', alignItems: 'flex-start', gap: 10 }}>
                <Checkbox
                  checked={item.checked}
                  onChange={() => toggleCheck(item.emailId)}
                  style={{ marginTop: 4 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <Text strong ellipsis style={{ maxWidth: 280 }}>
                      {item.email.from}
                    </Text>
                    <Space size={4}>
                      <Progress
                        type="circle"
                        percent={item.confidence}
                        size={24}
                        strokeColor={confidenceColor(item.confidence)}
                        format={(p) => `${p}`}
                      />
                      <Select
                        size="small"
                        value={item.currentAction}
                        onChange={(val) => changeAction(item.emailId, val)}
                        style={{ width: 160 }}
                        options={[
                          { value: 'DELETE', label: 'Apagar' },
                          { value: 'MOVE_TO_INBOX', label: 'Mover para Inbox' },
                          { value: 'REVIEW', label: 'Rever' },
                        ]}
                      />
                    </Space>
                  </div>
                  <Text ellipsis style={{ fontSize: 13, display: 'block', marginBottom: 2 }}>
                    {item.email.subject || '(sem assunto)'}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {item.reason}
                  </Text>
                  {item.currentAction !== item.aiAction && (
                    <Tag color="purple" style={{ fontSize: 10, marginLeft: 8 }}>
                      Alterado por si
                    </Tag>
                  )}
                </div>
              </div>
            </List.Item>
          )}
        />
      </div>
    );
  };

  const tabItems = [
    {
      key: 'DELETE',
      label: (
        <Space>
          <DeleteOutlined style={{ color: '#ff4d4f' }} />
          <span>Apagar</span>
          <Badge count={deleteCount} style={{ backgroundColor: '#ff4d4f' }} />
        </Space>
      ),
      children: renderList('DELETE'),
    },
    {
      key: 'MOVE_TO_INBOX',
      label: (
        <Space>
          <InboxOutlined style={{ color: '#1677ff' }} />
          <span>Mover para Inbox</span>
          <Badge count={moveCount} style={{ backgroundColor: '#1677ff' }} />
        </Space>
      ),
      children: renderList('MOVE_TO_INBOX'),
    },
    {
      key: 'REVIEW',
      label: (
        <Space>
          <EyeOutlined style={{ color: '#faad14' }} />
          <span>Rever</span>
          <Badge count={reviewCount} style={{ backgroundColor: '#faad14' }} />
        </Space>
      ),
      children: renderList('REVIEW'),
    },
  ];

  return (
    <Drawer
      title={
        <Space>
          <ThunderboltOutlined style={{ color: '#faad14' }} />
          <span>Triagem Inteligente de Lixo</span>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={600}
      footer={
        !done ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {getCheckedCount('DELETE')} apagar, {getCheckedCount('MOVE_TO_INBOX')} mover, {getCheckedCount('REVIEW')} rever
            </Text>
            <Space>
              <Button onClick={onClose}>Cancelar</Button>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={handleExecute}
                loading={executing}
                disabled={loading || items.filter(i => i.checked).length === 0}
              >
                Executar ({items.filter(i => i.checked).length})
              </Button>
            </Space>
          </div>
        ) : (
          <Button type="primary" onClick={onClose} block>
            Fechar
          </Button>
        )
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin size="large" />
          <Title level={5} style={{ marginTop: 16, color: '#8c8c8c' }}>
            A analisar emails com IA...
          </Title>
          <Text type="secondary">Isto pode demorar alguns segundos</Text>
        </div>
      ) : done ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a' }} />
          <Title level={4} style={{ marginTop: 16 }}>
            Triagem concluida!
          </Title>
          <Text type="secondary">
            Os emails foram processados com sucesso
          </Text>
        </div>
      ) : items.length === 0 ? (
        <Alert
          type="info"
          message="Nenhum email de lixo para triar"
          description="A pasta de lixo esta vazia."
          showIcon
        />
      ) : (
        <>
          <Alert
            type="info"
            message={`${items.length} emails analisados`}
            description={
              cacheInfo
                ? cacheInfo.newlyClassified > 0
                  ? `${cacheInfo.fromCache} do cache, ${cacheInfo.newlyClassified} classificados agora pela IA. Reveja as classificações abaixo.`
                  : `Todos do cache (sem custo IA). Reveja as classificações abaixo.`
                : 'Reveja as classificações abaixo. Pode alterar a ação de cada email antes de executar.'
            }
            showIcon
            style={{ marginBottom: 16 }}
            action={
              cacheInfo && cacheInfo.fromCache > 0 ? (
                <Button
                  size="small"
                  type="link"
                  danger
                  onClick={() => runTriage(true)}
                >
                  Reclassificar tudo (usa IA)
                </Button>
              ) : undefined
            }
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <SortAscendingOutlined style={{ color: '#8c8c8c' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>Ordenar:</Text>
            <Segmented
              size="small"
              value={sortBy}
              onChange={(val) => setSortBy(val as 'date' | 'sender' | 'confidence')}
              options={[
                { value: 'date', label: 'Data' },
                { value: 'sender', label: 'Remetente' },
                { value: 'confidence', label: 'Confiança' },
              ]}
            />
          </div>
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as TriageAction)}
            items={tabItems}
          />
        </>
      )}
    </Drawer>
  );
}

export default TriagePanel;
