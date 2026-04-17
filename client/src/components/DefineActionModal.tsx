import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, message, Typography } from 'antd';
import type { Email, EmailAccount } from '../types';
import { createEmailAction } from '../api';

const { Text } = Typography;

interface Props {
  open: boolean;
  email: Email | null;
  accounts: EmailAccount[];
  onClose: () => void;
  onCreated: () => void;
}

function DefineActionModal({ open, email, accounts, onClose, onCreated }: Props) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && email) {
      // Pre-fill with email context
      const senderMatch = email.from?.match(/<(.+)>$/);
      const senderAddr = senderMatch ? senderMatch[1] : email.from;
      // Use the domain of sender as default pattern (more reusable)
      const domain = senderAddr?.split('@')[1] || senderAddr;
      form.setFieldsValue({
        name: `Abrir portal de ${domain}`,
        accountId: email.accountId,
        senderPattern: domain,
        subjectPattern: '',
        actionValue: '',
      });
    }
  }, [open, email, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await createEmailAction({
        name: values.name,
        accountId: values.accountId || null,
        senderPattern: values.senderPattern || null,
        subjectPattern: values.subjectPattern || null,
        actionType: 'OPEN_URL',
        actionValue: values.actionValue,
      });
      message.success('Ação criada');
      onCreated();
      onClose();
      form.resetFields();
    } catch (err: any) {
      if (err?.errorFields) return; // validation
      message.error('Erro ao criar ação');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Definir ação para este tipo de email"
      open={open}
      onOk={handleOk}
      onCancel={() => { onClose(); form.resetFields(); }}
      confirmLoading={submitting}
      okText="Criar ação"
      cancelText="Cancelar"
      width={560}
    >
      {email && (
        <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 12 }}>
          <div><Text type="secondary">Email:</Text> <Text>{email.subject || '(sem assunto)'}</Text></div>
          <div><Text type="secondary">De:</Text> <Text>{email.from}</Text></div>
        </div>
      )}

      <Form form={form} layout="vertical" size="small">
        <Form.Item
          label="Nome da ação"
          name="name"
          rules={[{ required: true, message: 'Nome obrigatório' }]}
        >
          <Input placeholder="ex: Abrir portal Vodafone" />
        </Form.Item>

        <Form.Item
          label="URL a abrir"
          name="actionValue"
          rules={[
            { required: true, message: 'URL obrigatório' },
            { type: 'url', message: 'URL inválido' },
          ]}
          extra="O URL abre em nova aba ao executar a ação"
        >
          <Input placeholder="https://..." />
        </Form.Item>

        <Typography.Title level={5} style={{ marginTop: 16, marginBottom: 8 }}>
          Quando aplicar esta ação (pelo menos um critério)
        </Typography.Title>

        <Form.Item label="Conta (caixa)" name="accountId">
          <Select
            allowClear
            placeholder="Qualquer conta"
            options={accounts.map(a => ({ value: a.id, label: a.displayName || a.email }))}
          />
        </Form.Item>

        <Form.Item
          label="Origem contém (FROM)"
          name="senderPattern"
          extra="ex: @vodafone.pt ou noreply@amazon"
        >
          <Input placeholder="domínio ou email" />
        </Form.Item>

        <Form.Item
          label="Assunto contém"
          name="subjectPattern"
          extra="texto que tem de aparecer no assunto"
        >
          <Input placeholder="ex: Fatura" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default DefineActionModal;
