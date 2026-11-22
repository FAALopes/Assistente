import SyncProgress from './components/SyncProgress';
import ComposeModal, { type ComposeMode } from './components/ComposeModal';
import { ReplyIcon, ReplyAllIcon, ForwardIcon } from './components/MailIcons';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Layout, Button, Typography, Space, message, Spin, Modal, Tooltip } from 'antd';
import {
  DeleteOutlined,
  SyncOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  FilterOutlined,
  AppstoreOutlined,
  KeyOutlined,
  LogoutOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import AccountList from './components/AccountList';
import Archive from './components/Archive';
import SaveAttachmentsSection from './components/SaveAttachmentsSection';
import EmailBody from './components/EmailBody';
import EmailList from './components/EmailList';
import EmailActions from './components/EmailActions';
import SuggestionBanner from './components/SuggestionBanner';
import RulesPanel from './components/RulesPanel';
import TriagePanel from './components/TriagePanel';
import RulePreviewModal from './components/RulePreviewModal';
import RecentApplicationsBanner from './components/RecentApplicationsBanner';
import EmailActionsPanel from './components/EmailActionsPanel';
import ConfigPanel from './components/ConfigPanel';
import CategoriesPanel from './components/CategoriesPanel';
import { reloadCategories } from './categories';
import { getAccounts, getEmails, getFoldersByAccount, syncEmails, getSyncStatus, cancelSyncJob, getSuggestions, deleteEmail, previewRuleApplication, applyRules, getRecentApplications, logout } from './api';
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
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const [rulePreviewOpen, setRulePreviewOpen] = useState(false);
  const [rulePreviewData, setRulePreviewData] = useState<RulePreviewResult | null>(null);
  const [rulePreviewLoading, setRulePreviewLoading] = useState(false);
  const [recentApplications, setRecentApplications] = useState<RuleApplicationRecord[]>([]);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [filters, setFilters] = useState<EmailFilters>({
    page: 1,
    limit: 20000, // whole folder, no pagination
  });
  const isJunkFolder = filters.folder === 'junkemail';
  const [previewEmail, setPreviewEmail] = useState<Email | null>(null);
  const [composeMode, setComposeMode] = useState<ComposeMode | null>(null);
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
    reloadCategories().catch(() => message.error('Erro ao carregar categorias'));
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
      // Every account that is due syncs in ONE job, all at the same time (like Outlook)
      const due = accounts.filter((acc) => {
        if (!acc.autoSyncMinutes) return false;
        if (brokenAccountsRef.current.has(acc.id)) return false;
        const last = acc.lastSyncAt ? new Date(acc.lastSyncAt).getTime() : 0;
        return now - last >= acc.autoSyncMinutes * 60_000;
      });
      if (due.length > 0) handleSync(due.map((a) => a.id));
    };
    const id = setInterval(tick, 60_000);
    tick();
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, syncing]);

  const handleSync = async (accountIds?: string | string[]) => {
    if (syncing) return;
    setSyncing(true);
    setSyncStartedAt(Date.now());
    setSyncJob(null);
    try {
      const { jobId } = await syncEmails(accountIds);
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
              // Mark the accounts named in the errors so auto-sync stops retrying them this session
              for (const acc of accounts) {
                if (job.errors.some((e) => e.startsWith(`${acc.email}:`))) brokenAccountsRef.current.add(acc.id);
              }
              if (typeof accountIds === 'string') brokenAccountsRef.current.add(accountIds);
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
      await deleteEmail(id);
      message.success('Email apagado');
      fetchEmails();
      fetchFolders();
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
              OneDrive
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
              icon={<TagsOutlined />}
              onClick={() => setCategoriesOpen(true)}
            >
              Categorias
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
            <div style={{ flex: 2, minWidth: 0 }}>
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
                  onDelete={handleDeleteEmail}
                  onSelectEmail={setPreviewEmail}
                  selectedEmailId={previewEmail?.id || null}
                  onRefresh={fetchEmails}
                  onManageCategories={() => setCategoriesOpen(true)}
                  foldersByAccount={foldersByAccount}
                  onMoved={() => {
                    fetchEmails();
                    fetchFolders();
                  }}
                />
              </Spin>
            </div>
            <div style={{
              flex: 1,
              minWidth: 320,
              background: '#fff',
              borderRadius: 8,
              padding: previewEmail ? 14 : 16,
              border: '1px solid #f0f0f0',
              overflow: 'auto',
              maxHeight: 'calc(100vh - 140px)',
              position: 'sticky',
              top: 80,
            }}>
              {previewEmail ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #f0f0f0' }}>
                    <Tooltip title="Responder">
                      <Button type="text" size="small" icon={<ReplyIcon />} onClick={() => setComposeMode('reply')} />
                    </Tooltip>
                    <Tooltip title="Responder a todos">
                      <Button type="text" size="small" icon={<ReplyAllIcon />} onClick={() => setComposeMode('replyAll')} />
                    </Tooltip>
                    <Tooltip title="Reencaminhar">
                      <Button type="text" size="small" icon={<ForwardIcon />} onClick={() => setComposeMode('forward')} />
                    </Tooltip>
                    <Tooltip title="Apagar (vai para o Lixo)">
                      <Button
                        type="text" size="small" danger icon={<DeleteOutlined />}
                        onClick={() => { const id = previewEmail.id; setPreviewEmail(null); handleDeleteEmail(id); }}
                      />
                    </Tooltip>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <Title level={5} style={{ margin: 0, flex: 1, fontSize: 15, lineHeight: 1.3 }}>
                      {previewEmail.subject || '(sem assunto)'}
                    </Title>
                    <Button type="text" size="small" onClick={() => setPreviewEmail(null)} style={{ marginLeft: 8 }}>✕</Button>
                  </div>
                  <div style={{ marginBottom: 8, fontSize: 12, color: '#595959', lineHeight: 1.5 }}>
                    <div><strong>De:</strong> {previewEmail.from}</div>
                    {previewEmail.to && <div><strong>Para:</strong> {previewEmail.to}</div>}
                    <div><strong>Data:</strong> {new Date(previewEmail.receivedAt).toLocaleString('pt-PT')}</div>
                  </div>
                  {previewEmail.hasAttachments && (
                    <SaveAttachmentsSection key={previewEmail.id} email={previewEmail} />
                  )}
                  <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
                    <EmailBody emailId={previewEmail.id} fallbackPreview={previewEmail.bodyPreview} />
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', color: '#bfbfbf', paddingTop: 80, fontSize: 13 }}>
                  Selecciona um email para pre-visualizar
                </div>
              )}
            </div>
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
      <CategoriesPanel
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        onChanged={fetchEmails}
      />
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

      <ComposeModal
        email={composeMode ? previewEmail : null}
        mode={composeMode}
        onClose={() => setComposeMode(null)}
        onSent={() => setComposeMode(null)}
      />

      {syncing && (() => {
        const elapsedSec = Math.round((Date.now() - syncStartedAt) / 1000);
        const elapsedStr = elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)}m${String(elapsedSec % 60).padStart(2, '0')}s`;
        const pct = syncJob && syncJob.foldersTotal > 0
          ? Math.min(100, Math.round((syncJob.foldersDone / syncJob.foldersTotal) * 100))
          : 0;
        const accountLine = syncJob?.accountsTotal
          ? `${syncJob.accountsDone} de ${syncJob.accountsTotal} contas concluídas${syncJob.currentAccount ? ` — em curso: ${syncJob.currentAccount}` : ''}`
          : (syncJob?.currentFolder || syncJob?.phase || 'A iniciar...');
        const folderLine = syncJob?.currentFolder || '';
        return (
          <SyncProgress
            jobId={syncJobId}
            title="A sincronizar emails"
            accountLine={accountLine}
            folderLine={folderLine}
            pct={pct}
            progressText={`${syncJob?.foldersDone || 0}/${syncJob?.foldersTotal || 0}`}
            footerLeft={`${syncJob?.emailsSynced || 0} novos/alterados${syncJob?.emailsRemoved ? ` · ${syncJob.emailsRemoved} removidos` : ''}`}
            elapsed={elapsedStr}
            onCancel={handleCancelSync}
            accounts={syncJob?.accountsProgress}
          />
        );
      })()}
    </Layout>
  );
}

export default App;
