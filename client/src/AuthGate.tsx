import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, Form, Input, Spin, Typography, Alert } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { getMe, login } from './api';

const { Title, Text } = Typography;

const ERROR_MESSAGES: Record<string, string> = {
  session_expired: 'A sessão expirou. Entra de novo.',
  not_authorized: 'A sessão expirou. Entra de novo.',
};

// Checks the session before rendering the app; shows the login form otherwise.
export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    return code ? ERROR_MESSAGES[code] || null : null;
  });

  useEffect(() => {
    getMe()
      .then((me) => setState(me.authenticated ? 'in' : 'out'))
      .catch(() => setState('out'));
  }, []);

  if (state === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (state === 'in') return <>{children}</>;

  const onFinish = async (values: { username: string; password: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      await login(values.username, values.password);
      window.history.replaceState(null, '', '/');
      setState('in');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Credenciais inválidas');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
      <Card style={{ width: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <Title level={3} style={{ color: '#1677ff', marginTop: 0, marginBottom: 4 }}>Assistente</Title>
          <Text type="secondary">Painel de email</Text>
        </div>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item name="username" label="Utilizador" rules={[{ required: true, message: 'Indica o utilizador' }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Indica a password' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            Entrar
          </Button>
        </Form>
      </Card>
    </div>
  );
}
