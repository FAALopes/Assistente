import { useState, useEffect, useCallback, useRef } from 'react';
import { Layout, Button, Typography, Space, message, Spin, Modal } from 'antd';
import {
  SyncOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import AccountList from './components/AccountList';
import EmailList from './components/EmailList';
import EmailActions from './components/EmailActions';
import SuggestionBanner from './components/SuggestionBanner';
import RulesPanel from './components/RulesPanel';
import TriagePanel from './components/TriagePanel';
import RulePreviewModal from './components/RulePreviewModal';
import { getAccounts, getEmails, getFoldersByAccount, syncEmails, getSuggestions, deleteEmail, checkSenderRule, createRule, previewRuleApplication, applyRules } from './api';
import type {
  EmailAccount,
  Email,
  FoldersByAccount,
  Suggestion,
  EmailCategory,
  EmailFilters,
  RulePreviewResult,
} from './types';

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

function App() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [foldersByAccount, setFoldersByAccount] = useState<FoldersByAccount>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const [rulePreviewOpen, setRulePreviewOpen] = useState(false);
  const [rulePreviewData, setRulePreviewData] = useState<RulePreviewResult | null>(null);
  const [rulePreviewLoading, setRulePreviewLoading] = useState(false);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [filters, setFilters] = useState<EmailFilters>({
    page: 1,
    limit: 50,
  });
  const isJunkFolder = filters.folder === 'junkemail';
  const [collapsed, setCollapsed] = useState(false);

  // Flatten folders for EmailList (unique by id)
  const allFolders = Object.values(foldersByAccount).flat()
    .filter((f, i, arr) => arr.findIndex(x => x.id === f.id) === i);

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await getAccounts();
      setAccounts(data);
    } catch {
      message.error('Erro ao carregar contas');
    }
  }, []);

  const fetchFolders = useCallback(async () => {
    try {
      const data = await getFoldersByAccount();
      setFoldersByAccount(data);
    } catch {
      // Silently fail
    }
  }, []);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getEmails(filters);
      setEmails(result.data);
      setTotal(result.total);
    } catch {
      message.error('Erro ao carregar emails');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const fetchSuggestions = useCallback(async () => {
    try {
      const data = await getSuggestions();
      setSuggestions(data);
    } catch {
      // Silently fail - suggestions are optional
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchFolders();
    fetchSuggestions();
  }, [fetchAccounts, fetchFolders, fetchSuggestions]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncEmails();
      message.success(`${result.synced} emails sincronizados`);
      fetchEmails();
      fetchAccounts();
      fetchFolders();
      fetchSuggestions();
    } catch {
      message.error('Erro ao sincronizar emails');
    } finally {
      setSyncing(false);
    }
  };

  const handleFilterChange = (newFilters: Partial<EmailFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters, page: 1 }));
    setSelectedIds([]);
  };

  const handleActionComplete = () => {
    setSelectedIds([]);
    fetchEmails();
    fetchSuggestions();
  };

  const handleDeleteEmail = async (id: string) => {
    try {
      // Find the email to get sender info
      const email = emails.find((e) => e.id === id);
      if (!email) {
        await deleteEmail(id);
        message.success('Email apagado');
        fetchEmails();
        fetchFolders();
        return;
      }

      // Extract sender email address from "Name <email>" format
      const senderAddress = email.from.match(/<(.+)>$/)?.[1] || email.from;

      // Check if a rule already exists for this sender
      const { hasRule } = await checkSenderRule(senderAddress);

      if (!hasRule) {
        // Show modal asking to create rule
        Modal.confirm({
          title: 'Criar regra automática?',
          content: `Criar regra para apagar sempre emails de ${senderAddress}?`,
          okText: 'Sim, criar regra',
          cancelText: 'Não, apenas apagar',
          onOk: async () => {
            try {
              await createRule({
                field: 'FROM',
                operator: 'CONTAINS',
                value: senderAddress,
                action: 'DELETE',
                confidence: 100,
                timesApplied: 0,
              });
              message.success(`Regra criada para ${senderAddress}`);
            } catch {
              message.error('Erro ao criar regra');
            }
            await deleteEmail(id);
            message.success('Email apagado');
            fetchEmails();
            fetchFolders();
          },
          onCancel: async () => {
            await deleteEmail(id);
            message.success('Email apagado');
            fetchEmails();
            fetchFolders();
          },
        });
      } else {
        await deleteEmail(id);
        message.success('Email apagado');
        fetchEmails();
        fetchFolders();
      }
    } catch {
      message.error('Erro ao apagar email');
    }
  };

  // Feature 3: Rule preview
  const handlePreviewRules = async () => {
    setRulePreviewLoading(true);
    try {
      const data = await previewRuleApplication();
      setRulePreviewData(data);
      setRulePreviewOpen(true);
    } catch {
      message.error('Erro ao pré-visualizar regras');
    } finally {
      setRulePreviewLoading(false);
    }
  };

  const handleApplyAllRules = async () => {
    setRulePreviewLoading(true);
    try {
      const result = await applyRules();
      message.success(`${result.applied} email${result.applied !== 1 ? 's' : ''} categorizado${result.applied !== 1 ? 's' : ''}`);
      setRulePreviewOpen(false);
      setRulePreviewData(null);
      fetchEmails();
      fetchSuggestions();
    } catch {
      message.error('Erro ao aplicar regras');
    } finally {
      setRulePreviewLoading(false);
    }
  };

  // Feature 2: Auto-sync every 30 minutes
  useEffect(() => {
    const autoSync = async () => {
      try {
        await syncEmails();
        message.info('Sincronização automática concluída');
        fetchEmails();
        fetchAccounts();
        fetchFolders();
        fetchSuggestions();

        // After sync, check for rule matches
        const preview = await previewRuleApplication();
        if (preview.totalMatched > 0) {
          setRulePreviewData(preview);
          setRulePreviewOpen(true);
        }
      } catch {
        // Silent fail for auto-sync
      }
    };

    syncIntervalRef.current = setInterval(autoSync, 30 * 60 * 1000);

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [fetchEmails, fetchAccounts, fetchFolders, fetchSuggestions]);

  const handleApplySuggestions = (
    appliedSuggestions: { emailId: string; category: EmailCategory }[],
  ) => {
    // After applying, refresh
    void appliedSuggestions;
    handleActionComplete();
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={280}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="light"
        style={{
          borderRight: '1px solid #f0f0f0',
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
        }}
      >
        <div
          style={{
            padding: collapsed ? '16px 8px' : '16px',
            textAlign: 'center',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Title level={4} style={{ margin: 0, color: '#1677ff' }}>
            {collapsed ? 'A' : 'Assistente'}
          </Title>
        </div>
        {!collapsed && (
          <AccountList
            accounts={accounts}
            foldersByAccount={foldersByAccount}
            selectedAccountId={filters.account}
            selectedFolder={filters.folder}
            onSelectAccount={(accountId) =>
              handleFilterChange({ account: accountId })
            }
            onSelectFolder={(folder) =>
              handleFilterChange({ folder })
            }
          />
        )}
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 80 : 280, transition: 'all 0.2s' }}>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <Title level={4} style={{ margin: 0 }}>
            Painel de Email
          </Title>
          <Space>
            {isJunkFolder && (
              <Button
                type="primary"
                danger
                icon={<ThunderboltOutlined />}
                onClick={() => setTriageOpen(true)}
              >
                Triar Lixo
              </Button>
            )}
            <Button
              icon={<FilterOutlined />}
              onClick={handlePreviewRules}
              loading={rulePreviewLoading}
            >
              Aplicar Regras
            </Button>
            <Button
              icon={<SettingOutlined />}
              onClick={() => setRulesOpen(true)}
            >
              Regras
            </Button>
            <Button
              type="primary"
              icon={<SyncOutlined spin={syncing} />}
              onClick={handleSync}
              loading={syncing}
            >
              Sincronizar
            </Button>
          </Space>
        </Header>

        <Content style={{ padding: '16px 24px', background: '#f5f5f5' }}>
          <SuggestionBanner
            suggestions={suggestions}
            emails={emails}
            onApply={handleApplySuggestions}
          />

          {selectedIds.length > 0 && (
            <EmailActions
              selectedIds={selectedIds}
              onActionComplete={handleActionComplete}
            />
          )}

          <Spin spinning={loading}>
            <EmailList
              emails={emails}
              accounts={accounts}
              folders={allFolders}
              suggestions={suggestions}
              total={total}
              filters={filters}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onFilterChange={handleFilterChange}
              onPageChange={(page, limit) =>
                setFilters((prev) => ({ ...prev, page, limit }))
              }
              onDelete={handleDeleteEmail}
            />
          </Spin>
        </Content>
      </Layout>

      <RulesPanel open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <TriagePanel
        open={triageOpen}
        onClose={() => setTriageOpen(false)}
        emails={emails}
        onComplete={() => {
          handleActionComplete();
          fetchFolders();
        }}
      />
      <RulePreviewModal
        open={rulePreviewOpen}
        data={rulePreviewData}
        loading={rulePreviewLoading}
        onApply={handleApplyAllRules}
        onCancel={() => {
          setRulePreviewOpen(false);
          setRulePreviewData(null);
        }}
      />
    </Layout>
  );
}

export default App;
