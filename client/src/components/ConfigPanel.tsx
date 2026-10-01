import { useState, useEffect, useCallback } from 'react';
import { Drawer, Form, Input, Button, Space, Typography, Alert, message, Divider, Tag } from 'antd';
import { KeyOutlined, CheckCircleOutlined, ExperimentOutlined } from '@ant-design/icons';
import { getAppConfig, updateAppConfig, testAzureConfig, type AppConfig } from '../api';

const { Text, Paragraph, Link } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

function ConfigPanel({ open, onClose }: Props) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [newSecret, setNewSecret] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const c = await getAppConfig();
      setConfig(c);
    } catch {
      message.error('Erro ao carregar configuração');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      refresh();
      setTestResult(null);
      setTestOk(null);
      setNewSecret('');
    }
  }, [open, refresh]);

  const handleSave = async () => {
    if (newSecret.trim().length < 8) {
      message.warning('O segredo tem de ter pelo menos 8 caracteres');
      return;
    }
    setSaving(true);
    try {
      await updateAppConfig(newSecret.trim());
      message.success('Segredo atualizado');
      setNewSecret('');
      await refresh();
      // Auto-test after save
      await handleTest();
    } catch {
      message.error('Erro ao guardar segredo');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestOk(null);
    try {
      const r = await testAzureConfig();
      if (r.success) {
        setTestOk(true);
        setTestResult(`Teste OK na conta ${r.testedAccount} — token de acesso obtido`);
      } else {
        setTestOk(false);
        setTestResult(r.errorMessage || r.reason || 'Erro desconhecido');
      }
    } catch {
      setTestOk(false);
      setTestResult('Falha de comunicação com o servidor');
    } finally {
      setTesting(false);
    }
  };

  return (
    <Drawer
      title={<Space><KeyOutlined />Configurações</Space>}
      open={open}
      onClose={onClose}
      width={600}
    >
      <Typography.Title level={5}>Credenciais Azure (Microsoft)</Typography.Title>
      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        Estas credenciais permitem à aplicação aceder às tuas caixas Microsoft (Outlook, Hotmail, O365).
        O <Text code>Client Secret</Text> é emitido pelo Azure Portal e expira ao fim de 1-2 anos — tens
        de o rodar aqui quando isso acontecer, caso contrário as sincronizações falham com erro de "token refresh failed".
      </Paragraph>

      <Form layout="vertical" size="small" style={{ marginTop: 16 }}>
        <Form.Item label="Azure Client ID (não editável)">
          <Input value={config?.azureClientId || ''} disabled />
        </Form.Item>

        <Form.Item label="Segredo atualmente em uso">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input value={config?.azureClientSecretMasked || '(nenhum)'} disabled />
            <Space size={4}>
              <Tag color={
                config?.azureClientSecretSource === 'database' ? 'green' :
                config?.azureClientSecretSource === 'environment' ? 'blue' : 'red'
              }>
                Fonte: {config?.azureClientSecretSource === 'database' ? 'Base de dados (editável)' :
                        config?.azureClientSecretSource === 'environment' ? 'Variável de ambiente Railway' :
                        'nenhum segredo configurado'}
              </Tag>
              {config?.azureClientSecretUpdatedAt && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Atualizado em: {new Date(config.azureClientSecretUpdatedAt).toLocaleString('pt-PT')}
                </Text>
              )}
            </Space>
          </Space>
        </Form.Item>

        <Divider />

        <Form.Item label="Novo Client Secret">
          <Input.Password
            value={newSecret}
            onChange={(e) => setNewSecret(e.target.value)}
            placeholder="Cola aqui o VALUE do novo client secret (não o ID)"
          />
        </Form.Item>

        <Space>
          <Button
            type="primary"
            onClick={handleSave}
            loading={saving}
            disabled={newSecret.trim().length < 8}
          >
            Guardar e testar
          </Button>
          <Button
            icon={<ExperimentOutlined />}
            onClick={handleTest}
            loading={testing}
            disabled={loading}
          >
            Testar segredo atual
          </Button>
        </Space>

        {testResult !== null && (
          <Alert
            style={{ marginTop: 16 }}
            type={testOk ? 'success' : 'error'}
            showIcon
            icon={testOk ? <CheckCircleOutlined /> : undefined}
            message={testOk ? 'Teste passou' : 'Teste falhou'}
            description={<Text style={{ fontSize: 12 }}>{testResult}</Text>}
          />
        )}

        <Divider />

        <Paragraph type="secondary" style={{ fontSize: 11 }}>
          <Text strong>Como obter um novo segredo:</Text>
          <br />
          1. Entra em <Link href="https://portal.azure.com" target="_blank">portal.azure.com</Link>
          <br />
          2. Microsoft Entra ID → App registrations → procura o app com Client ID acima
          <br />
          3. Certificates & secrets → + New client secret → copia o <Text code>Value</Text> (não o <Text code>Secret ID</Text>)
          <br />
          4. Cola aqui e carrega em "Guardar e testar"
        </Paragraph>
      </Form>
    </Drawer>
  );
}

export default ConfigPanel;
