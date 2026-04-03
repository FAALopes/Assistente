import { useState, useEffect, useCallback } from 'react';
import { Layout, Button, Typography, Space, message, Spin } from 'antd';
import {
  SyncOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import AccountList from './components/AccountList';
import EmailList from './components/EmailList';
import EmailActions from './components/EmailActions';
import SuggestionBanner from './components/SuggestionBanner';
import RulesPanel from './components/RulesPanel';
import TriagePanel from './components/TriagePanel';
import { getAccounts, getEmails, getFoldersByAccount, syncEmails, getSuggestions, deleteEmail } from './api';
import type {
  EmailAccount,
  Email,
  FoldersByAccount,
  Suggestion,
  EmailCategory,
  EmailFilters,
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
      await deleteEmail(id);
      message.success('Email apagado');
      fetchEmails();
      fetchFolders();
    } catch {
      message.error('Erro ao apagar email');
    }
  };

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
    </Layout>
  );
}

export default App;
