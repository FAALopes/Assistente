import { useState, useEffect, useCallback } from 'react';
import {
  Drawer,
  List,
  Button,
  Form,
  Input,
  Select,
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
  FROM: 'De',
  SUBJECT: 'Assunto',
  BODY: 'Corpo',
};

const operatorLabels: Record<string, string> = {
  CONTAINS: 'contém',
  EQUALS: 'é igual a',
  STARTS_WITH: 'começa com',
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

  const handleCreate = async (values: any) => {
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
          >
            <Form.Item
              name="field"
              label="Campo"
              rules={[{ required: true, message: 'Selecione o campo' }]}
            >
              <Select
                placeholder="Selecione o campo"
                options={[
                  { value: 'FROM', label: 'De (remetente)' },
                  { value: 'SUBJECT', label: 'Assunto' },
                  { value: 'BODY', label: 'Corpo do email' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="operator"
              label="Operador"
              rules={[{ required: true, message: 'Selecione o operador' }]}
            >
              <Select
                placeholder="Selecione o operador"
                options={[
                  { value: 'CONTAINS', label: 'Contém' },
                  { value: 'EQUALS', label: 'É igual a' },
                  { value: 'STARTS_WITH', label: 'Começa com' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="value"
              label="Valor"
              rules={[{ required: true, message: 'Insira o valor' }]}
            >
              <Input placeholder="Ex: newsletter@exemplo.com" />
            </Form.Item>
            <Form.Item
              name="action"
              label="Acao"
              rules={[{ required: true, message: 'Selecione uma acao' }]}
            >
              <Select
                placeholder="O que fazer com os emails"
                options={[
                  { value: 'DELETE', label: 'Apagar' },
                  { value: 'TODO', label: 'Tratar depois' },
                  { value: 'SAVE_LATER', label: 'Guardar' },
                  { value: 'SAVE_ONEDRIVE', label: 'Guardar no OneDrive' },
                ]}
              />
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
            style={{ padding: '12px 0' }}
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
                <Text strong>
                  {fieldLabels[rule.field]} {operatorLabels[rule.operator]}
                </Text>
                <Tag color={actionColors[rule.action]}>
                  {actionLabels[rule.action]}
                </Tag>
              </div>
              <Text code style={{ fontSize: 12 }}>
                {rule.value}
              </Text>
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Aplicada {rule.timesApplied} vez{rule.timesApplied !== 1 ? 'es' : ''}
                  {rule.confidence < 100 && ` | Confianca: ${rule.confidence}%`}
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
