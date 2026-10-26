import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, Spin, Typography, Alert } from 'antd';
import { WindowsOutlined } from '@ant-design/icons';
import { getMe } from './api';

const { Title, Text } = Typography;

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Esta conta Microsoft não está autorizada a entrar na Assistente.',
  auth_failed: 'A autenticação Microsoft falhou. Tenta novamente.',
};

// Checks the session before rendering the app; shows a login page otherwise.
export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');

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

  const errorCode = new URLSearchParams(window.location.search).get('error');
  const errorText = errorCode ? ERROR_MESSAGES[errorCode] || 'Não foi possível iniciar sessão.' : null;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
      <Card style={{ width: 380, textAlign: 'center' }}>
        <Title level={3} style={{ color: '#1677ff', marginTop: 0 }}>Assistente</Title>
        <Text type="secondary">Painel de email. Inicia sessão para continuar.</Text>
        {errorText && <Alert type="error" showIcon message={errorText} style={{ marginTop: 16, textAlign: 'left' }} />}
        <Button
          type="primary"
          size="large"
          icon={<WindowsOutlined />}
          href="/auth/microsoft"
          block
          style={{ marginTop: 24 }}
        >
          Entrar com Microsoft
        </Button>
      </Card>
    </div>
  );
}
