import { useState, useEffect, useCallback, useRef } from 'react';
import { Layout, Button, Typography, Space, message, Spin, Modal, Progress } from 'antd';
import {
  SyncOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  FilterOutlined,
  AppstoreOutlined,
  KeyOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import AccountList from './components/AccountList';
import Archive from './components/Archive';
import SaveAttachmentsSection from './components/SaveAttachmentsSection';
import EmailList from './components/EmailList';
import EmailActions from './components/EmailActions';
import SuggestionBanner from './components/SuggestionBanner';
import RulesPanel from './components/RulesPanel';
import TriagePanel from './components/TriagePanel';
import RulePreviewModal from './components/RulePreviewModal';
import RecentApplicationsBanner from './components/RecentApplicationsBanner';
import EmailActionsPanel from './components/EmailActionsPanel';
import ConfigPanel from './components/ConfigPanel';
import { getAccounts, getEmails, getFoldersByAccount, syncEmails, getSyncStatus, cancelSyncJob, getSuggestions, deleteEmail, checkSenderRule, createRule, previewRuleApplication, applyRules, getRecentApplications, logout } from './api';
import type {
  EmailAccount,
  Email,
  FoldersByAccount,
  Suggestion,
  EmailCategory,
  EmailFilters,
  RulePreviewResult,
  RuleApplicationRecord,
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
  const [tab, setTab] = useState<'mail' | 'archive'>('mail');
  const [syncing, setSyncing] = useState(false);
  const [syncJob, setSyncJob] = useState<import('./types').SyncJob | null>(null);
  const [syncStartedAt, setSyncStartedAt] = useState<number>(0);
  const [syncJobId, setSyncJobId] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const [rulePreviewOpen, setRulePreviewOpen] = useState(false);
  const [rulePreviewData, setRulePreviewData] = useState<RulePreviewResult | null>(null);
  const [rulePreviewLoading, setRulePreviewLoading] = useState(false);
  const [recentApplications, setRecentApplications] = useState<RuleApplicationRecord[]>([]);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [filters, setFilters] = useState<EmailFilters>({
    page: 1,
    limit: 50,
  });
  const isJunkFolder = filters.folder === 'junkemail';
  const [previewEmail, setPreviewEmail] = useState<Email | null>(null);
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

  const fetchRecentApplications = useCallback(async () => {
    try {
      const data = await getRecentApplications();
      setRecentApplications(data.applications);
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchFolders();
    fetchSuggestions();
    fetchRecentApplications();
  }, [fetchAccounts, fetchFolders, fetchSuggestions, fetchRecentApplications]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  // Accounts that failed with re-auth error this session — skip until page reload
  const brokenAccountsRef = useRef<Set<string>>(new Set());
  // Auto-sync tick: every 60s, if tab is visible and some account is due, trigger per-account sync
  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;
      if (syncing) return;
      const now = Date.now();
      for (const acc of accounts) {
        if (!acc.autoSyncMinutes) continue;
        if (brokenAccountsRef.current.has(acc.id)) continue;
        const last = acc.lastSyncAt ? new Date(acc.lastSyncAt).getTime() : 0;
        if (now - last >= acc.autoSyncMinutes * 60_000) {
          handleSync(acc.id);
          return; // one at a time
        }
      }
    };
    const id = setInterval(tick, 60_000);
    tick();
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, syncing]);

  const handleSync = async (accountId?: string) => {
    if (syncing) return;
    setSyncing(true);
    setSyncStartedAt(Date.now());
    setSyncJob(null);
    try {
      const { jobId } = await syncEmails(accountId);
      setSyncJobId(jobId);
      // Poll every 1500ms
      while (true) {
        await new Promise(r => setTimeout(r, 1500));
        const job = await getSyncStatus(jobId);
        if (!job) break;
        setSyncJob(job);
        if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
          if (job.status === 'done') {
            const removedTxt = job.emailsRemoved ? `, ${job.emailsRemoved} removidos` : '';
            message.success(`${job.emailsSynced} emails sincronizados${removedTxt}`);
          } else if (job.status === 'cancelled') {
            message.info(`Sync cancelada (${job.emailsSynced} emails processados antes)`);
          } else {
            message.error('Sync falhou');
          }
          if (job.errors && job.errors.length > 0) {
            const reauthOnly = job.errors.every((e) => /Token refresh failed|re-authenticate/i.test(e));
            if (reauthOnly) {
              // Mark the account as broken so auto-sync stops nagging this session
              if (accountId) brokenAccountsRef.current.add(accountId);
              message.warning('Sessao expirou. Re-adiciona a conta Microsoft para continuar.', 6);
            } else {
              Modal.warning({
                title: `${job.errors.length} erro(s) durante sync`,
                content: (
                  <ul style={{ margin: 0, paddingLeft: 20, maxHeight: 300, overflow: 'auto' }}>
                    {job.errors.map((e, i) => (
                      <li key={i} style={{ fontSize: 12, marginBottom: 4 }}>{e}</li>
                    ))}
                  </ul>
                ),
                width: 600,
              });
            }
          }
          break;
        }
      }
      fetchEmails();
      fetchAccounts();
      fetchFolders();
      fetchSuggestions();
    } catch {
      message.error('Erro ao sincronizar emails');
    } finally {
      setSyncing(false);
      setSyncJob(null);
      setSyncJobId(null);
    }
  };

  const handleCancelSync = async () => {
    if (!syncJobId) return;
    try {
      await cancelSyncJob(syncJobId);
      message.info('A cancelar...');
    } catch {
      message.error('Nao foi possivel cancelar');
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
      fetchRecentApplications();
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
        fetchEmails();
        fetchAccounts();
        fetchFolders();
        fetchSuggestions();

        // After sync, AUTOMATICALLY apply rules (no popup)
        const result = await applyRules();
        if (result.applied > 0) {
          message.info(`Sincronização: ${result.applied} email${result.applied !== 1 ? 's' : ''} categorizado${result.applied !== 1 ? 's' : ''} automaticamente`);
          fetchEmails();
          fetchRecentApplications();
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
  }, [fetchEmails, fetchAccounts, fetchFolders, fetchSuggestions, fetchRecentApplications]);

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
            onAccountUpdated={fetchAccounts}
            onSyncAccount={handleSync}
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
          <Space size={0}>
            <Button
              type={tab === 'mail' ? 'primary' : 'text'}
              onClick={() => setTab('mail')}
              style={{ fontWeight: 600 }}
            >
              Emails
            </Button>
            <Button
              type={tab === 'archive' ? 'primary' : 'text'}
              onClick={() => setTab('archive')}
              style={{ fontWeight: 600 }}
            >
              Arquivo
            </Button>
          </Space>
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
              icon={<AppstoreOutlined />}
              onClick={() => setActionsOpen(true)}
            >
              Ações
            </Button>
            <Button
              icon={<SettingOutlined />}
              onClick={() => setRulesOpen(true)}
            >
              Regras
            </Button>
            <Button
              icon={<KeyOutlined />}
              onClick={() => setConfigOpen(true)}
            >
              Configurações
            </Button>
            <Button
              type="primary"
              icon={<SyncOutlined spin={syncing} />}
              onClick={() => handleSync()}
              loading={syncing}
              disabled={syncing}
            >
              Sincronizar
            </Button>
            <Button
              icon={<LogoutOutlined />}
              title="Terminar sessão"
              onClick={async () => {
                try { await logout(); } catch { /* ignore */ }
                window.location.href = '/';
              }}
            >
              Sair
            </Button>
          </Space>
        </Header>

        <Content style={{ padding: tab === 'archive' ? 0 : '16px 24px', background: '#f5f5f5' }}>
          {tab === 'archive' ? <Archive /> : (
          <>

          <RecentApplicationsBanner
            applications={recentApplications}
            onRefresh={() => {
              fetchRecentApplications();
              fetchEmails();
            }}
          />
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

          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
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
                  onSelectEmail={setPreviewEmail}
                  selectedEmailId={previewEmail?.id || null}
                  onRefresh={fetchEmails}
                />
              </Spin>
            </div>
            {previewEmail && (
              <div style={{
                width: 380,
                flexShrink: 0,
                background: '#fff',
                borderRadius: 8,
                padding: 16,
                border: '1px solid #f0f0f0',
                overflow: 'auto',
                maxHeight: 'calc(100vh - 140px)',
                position: 'sticky',
                top: 80,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <Title level={5} style={{ margin: 0, flex: 1 }}>
                    {previewEmail.subject || '(sem assunto)'}
                  </Title>
                  <Button type="text" size="small" onClick={() => setPreviewEmail(null)} style={{ marginLeft: 8 }}>✕</Button>
                </div>
                <div style={{ marginBottom: 12, fontSize: 13, color: '#595959' }}>
                  <div><strong>De:</strong> {previewEmail.from}</div>
                  {previewEmail.to && <div><strong>Para:</strong> {previewEmail.to}</div>}
                  <div><strong>Data:</strong> {new Date(previewEmail.receivedAt).toLocaleString('pt-PT')}</div>
                </div>
                <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12, fontSize: 13, lineHeight: 1.7, color: '#333', whiteSpace: 'pre-wrap' }}>
                  {previewEmail.bodyPreview || 'Sem preview disponível'}
                </div>
                {previewEmail.hasAttachments && (
                  <SaveAttachmentsSection email={previewEmail} />
                )}
              </div>
            )}
          </div>
          </>
          )}
        </Content>
      </Layout>

      <RulesPanel open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <EmailActionsPanel
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        accounts={accounts}
      />
      <ConfigPanel open={configOpen} onClose={() => setConfigOpen(false)} />
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

      {syncing && (() => {
        const elapsedSec = Math.round((Date.now() - syncStartedAt) / 1000);
        const elapsedStr = elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)}m${String(elapsedSec % 60).padStart(2, '0')}s`;
        const pct = syncJob && syncJob.foldersTotal > 0
          ? Math.min(100, Math.round((syncJob.foldersDone / syncJob.foldersTotal) * 100))
          : 0;
        const currentShort = syncJob?.currentFolder ? syncJob.currentFolder : (syncJob?.phase || 'A iniciar...');
        return (
          <div style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(720px, calc(100vw - 48px))',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            border: '1px solid #e8e8e8',
            padding: '14px 18px',
            zIndex: 1500,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <SyncOutlined spin style={{ color: '#1677ff', fontSize: 18 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>A sincronizar emails</div>
                <div style={{ fontSize: 12, color: '#8c8c8c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {currentShort}
                </div>
              </div>
              {syncJobId && (
                <Button size="small" danger onClick={handleCancelSync}>Cancelar</Button>
              )}
            </div>
            <Progress
              percent={pct}
              size="small"
              status="active"
              format={() => `${syncJob?.foldersDone || 0}/${syncJob?.foldersTotal || 0}`}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#595959', marginTop: 4 }}>
              <span>{syncJob?.emailsSynced || 0} emails sincronizados{syncJob?.emailsRemoved ? ` · ${syncJob.emailsRemoved} removidos` : ''}</span>
              <span>{elapsedStr}</span>
            </div>
          </div>
        );
      })()}
    </Layout>
  );
}

export default App;
