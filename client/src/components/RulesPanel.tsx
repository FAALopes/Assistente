import { useState, useEffect, useCallback } from 'react';
import {
  Drawer,
  List,
  Button,
  Form,
  Input,
  Select,
  Switch,
  Tag,
  Space,
  Typography,
  Divider,
  Popconfirm,
  message,
  Empty,
} from 'antd';
import {
  DeleteOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { getRules, createRule, deleteRule } from '../api';
import { EmailCategory } from '../types';
import type { Rule } from '../types';

const { Text, Title } = Typography;

interface RulesPanelProps {
  open: boolean;
  onClose: () => void;
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

function RulesPanel({ open, onClose }: RulesPanelProps) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form] = Form.useForm();

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRules();
      setRules(data);
    } catch {
      message.error('Erro ao carregar regras');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchRules();
    }
  }, [open, fetchRules]);

  const handleCreate = async (values: {
    name: string;
    description: string;
    condition: string;
    action: EmailCategory;
    isActive: boolean;
  }) => {
    try {
      await createRule(values);
      message.success('Regra criada com sucesso');
      form.resetFields();
      setShowForm(false);
      fetchRules();
    } catch {
      message.error('Erro ao criar regra');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteRule(id);
      message.success('Regra apagada');
      fetchRules();
    } catch {
      message.error('Erro ao apagar regra');
    }
  };

  return (
    <Drawer
      title={
        <Space>
          <ThunderboltOutlined />
          <span>Regras de Organizacao</span>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={480}
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setShowForm(!showForm)}
        >
          Nova Regra
        </Button>
      }
    >
      {showForm && (
        <div style={{ marginBottom: 24 }}>
          <Title level={5}>Criar nova regra</Title>
          <Form
            form={form}
            layout="vertical"
            onFinish={handleCreate}
            initialValues={{ isActive: true }}
          >
            <Form.Item
              name="name"
              label="Nome"
              rules={[{ required: true, message: 'Insira um nome' }]}
            >
              <Input placeholder="Ex: Newsletters para apagar" />
            </Form.Item>
            <Form.Item
              name="description"
              label="Descricao"
            >
              <Input.TextArea
                placeholder="Descricao opcional da regra"
                rows={2}
              />
            </Form.Item>
            <Form.Item
              name="condition"
              label="Condicao"
              rules={[{ required: true, message: 'Insira uma condicao' }]}
              help="Ex: from:newsletter@exemplo.com OU subject:promocao"
            >
              <Input placeholder="Condicao para aplicar a regra" />
            </Form.Item>
            <Form.Item
              name="action"
              label="Acao"
              rules={[{ required: true, message: 'Selecione uma acao' }]}
            >
              <Select
                placeholder="O que fazer com os emails"
                options={Object.values(EmailCategory).map((cat) => ({
                  value: cat,
                  label: categoryLabels[cat],
                }))}
              />
            </Form.Item>
            <Form.Item
              name="isActive"
              label="Ativa"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                Criar
              </Button>
              <Button
                onClick={() => {
                  setShowForm(false);
                  form.resetFields();
                }}
              >
                Cancelar
              </Button>
            </Space>
          </Form>
          <Divider />
        </div>
      )}

      <List
        loading={loading}
        dataSource={rules}
        locale={{
          emptyText: (
            <Empty
              description="Nenhuma regra criada"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ),
        }}
        renderItem={(rule) => (
          <List.Item
            style={{
              padding: '12px 0',
              opacity: rule.isActive ? 1 : 0.6,
            }}
            actions={[
              <Popconfirm
                key="delete"
                title="Apagar esta regra?"
                onConfirm={() => handleDelete(rule.id)}
                okText="Sim"
                cancelText="Nao"
              >
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  size="small"
                />
              </Popconfirm>,
            ]}
          >
            <div style={{ width: '100%' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 4,
                }}
              >
                <Text strong>{rule.name}</Text>
                <Space size={4}>
                  {!rule.isActive && (
                    <Tag color="default">Inativa</Tag>
                  )}
                  <Tag color={categoryColors[rule.action]}>
                    {categoryLabels[rule.action]}
                  </Tag>
                </Space>
              </div>
              {rule.description && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {rule.description}
                </Text>
              )}
              <div style={{ marginTop: 4 }}>
                <Text code style={{ fontSize: 12 }}>
                  {rule.condition}
                </Text>
              </div>
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Aplicada {rule.appliedCount} vez{rule.appliedCount !== 1 ? 'es' : ''}
                </Text>
              </div>
            </div>
          </List.Item>
        )}
      />
    </Drawer>
  );
}

export default RulesPanel;
