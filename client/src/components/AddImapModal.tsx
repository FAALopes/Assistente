import { useState } from 'react';
import { Modal, Form, Input, InputNumber, Switch, Button, Alert, Space, Typography } from 'antd';
import { testImapAccount, createImapAccount } from '../api';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface FormValues {
  email: string;
  displayName?: string;
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}

function AddImapModal({ open, onClose, onCreated }: Props) {
  const [form] = Form.useForm<FormValues>();
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; folders?: string[]; error?: string } | null>(null);

  const handleTest = async () => {
    try {
      const values = await form.validateFields(['host', 'port', 'user', 'password', 'tls']);
      setTesting(true);
      setTestResult(null);
      const r = await testImapAccount({
        host: values.host,
        port: values.port,
        user: values.user,
        password: values.password,
        tls: values.tls,
      });
      setTestResult(r);
    } catch { /* validation */ }
    finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await createImapAccount(values);
      form.resetFields();
      setTestResult(null);
      onCreated();
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Erro';
      setTestResult({ ok: false, error: msg });
    } finally {
      setSaving(false);
    }
  };

  const emailChanged = (val: string) => {
    if (!val) return;
    const host = form.getFieldValue('host');
    const user = form.getFieldValue('user');
    const domain = val.split('@')[1];
    if (!host && domain) form.setFieldValue('host', `mail.${domain}`);
    if (!user) form.setFieldValue('user', val);
  };

  return (
    <Modal
      open={open}
      title="Adicionar conta IMAP"
      onCancel={() => { setTestResult(null); onClose(); }}
      footer={null}
      destroyOnClose
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={{ port: 993, tls: true }}
      >
        <Form.Item
          label="Email"
          name="email"
          rules={[{ required: true, type: 'email', message: 'Email valido' }]}
        >
          <Input placeholder="fernando.lopes@cdfeirense.pt" onBlur={(e) => emailChanged(e.target.value)} />
        </Form.Item>
        <Form.Item label="Nome a mostrar (opcional)" name="displayName">
          <Input placeholder="Ex: Fernando CDF" />
        </Form.Item>
        <Form.Item
          label="Servidor IMAP"
          name="host"
          rules={[{ required: true, message: 'Obrigatorio' }]}
          help="Normalmente mail.<dominio> ou imap.<dominio>"
        >
          <Input placeholder="mail.cdfeirense.pt" />
        </Form.Item>
        <Space.Compact style={{ width: '100%' }}>
          <Form.Item label="Porta" name="port" rules={[{ required: true }]} style={{ flex: 1 }}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="TLS/SSL" name="tls" valuePropName="checked" style={{ marginLeft: 12 }}>
            <Switch />
          </Form.Item>
        </Space.Compact>
        <Form.Item label="Utilizador" name="user" rules={[{ required: true }]} help="Normalmente o email completo">
          <Input placeholder="fernando.lopes@cdfeirense.pt" />
        </Form.Item>
        <Form.Item label="Password" name="password" rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>

        {testResult && (
          testResult.ok ? (
            <Alert
              type="success"
              message="Ligacao OK"
              description={testResult.folders ? <Text style={{ fontSize: 12 }}>Pastas: {testResult.folders.join(', ')}</Text> : null}
              style={{ marginBottom: 12 }}
            />
          ) : (
            <Alert type="error" message="Falha" description={testResult.error} style={{ marginBottom: 12 }} />
          )
        )}

        <Space>
          <Button onClick={handleTest} loading={testing}>Testar ligacao</Button>
          <Button type="primary" onClick={handleSave} loading={saving}>Guardar</Button>
        </Space>
      </Form>
    </Modal>
  );
}

export default AddImapModal;
