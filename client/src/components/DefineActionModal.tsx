import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, message, Typography } from 'antd';
import type { Email, EmailAccount, EmailAction } from '../types';
import { createEmailAction, updateEmailAction } from '../api';

const { Text } = Typography;

interface Props {
  open: boolean;
  email?: Email | null;
  action?: EmailAction | null; // for edit mode
  accounts: EmailAccount[];
  onClose: () => void;
  onSaved: () => void;
}

function DefineActionModal({ open, email, action, accounts, onClose, onSaved }: Props) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = !!action;

  useEffect(() => {
    if (!open) return;
    if (action) {
      // Edit mode
      form.setFieldsValue({
        name: action.name,
        accountId: action.accountId || undefined,
        senderPattern: action.senderPattern || '',
        subjectPattern: action.subjectPattern || '',
        actionValue: action.actionValue,
      });
    } else if (email) {
      // Create mode with email context
      const senderMatch = email.from?.match(/<(.+)>$/);
      const senderAddr = senderMatch ? senderMatch[1] : email.from;
      const domain = senderAddr?.split('@')[1] || senderAddr;
      form.setFieldsValue({
        name: `Abrir portal de ${domain}`,
        accountId: email.accountId,
        senderPattern: domain,
        subjectPattern: '',
        actionValue: '',
      });
    } else {
      form.resetFields();
    }
  }, [open, email, action, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (isEdit && action) {
        await updateEmailAction(action.id, {
          name: values.name,
          accountId: values.accountId || null,
          senderPattern: values.senderPattern || null,
          subjectPattern: values.subjectPattern || null,
          actionValue: values.actionValue,
        });
        message.success('Ação atualizada');
      } else {
        await createEmailAction({
          name: values.name,
          accountId: values.accountId || null,
          senderPattern: values.senderPattern || null,
          subjectPattern: values.subjectPattern || null,
          actionType: 'OPEN_URL',
          actionValue: values.actionValue,
        });
        message.success('Ação criada');
      }
      onSaved();
      onClose();
      form.resetFields();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(isEdit ? 'Erro ao atualizar ação' : 'Erro ao criar ação');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={isEdit ? 'Editar ação' : 'Definir ação para este tipo de email'}
      open={open}
      onOk={handleOk}
      onCancel={() => { onClose(); form.resetFields(); }}
      confirmLoading={submitting}
      okText={isEdit ? 'Guardar' : 'Criar ação'}
      cancelText="Cancelar"
      width={560}
    >
      {email && !isEdit && (
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
