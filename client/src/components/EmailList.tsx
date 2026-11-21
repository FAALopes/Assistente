import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Table, Tag, Input, Select, Space, Button, Modal, TreeSelect, message } from 'antd';
import {
  SearchOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  PlusOutlined,
  EditOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import { matchEmailAction, updateCategory, applyArchiveRulesToEmail, moveEmailToFolder } from '../api';
import DefineActionModal from './DefineActionModal';
import type { EmailAction } from '../types';
import type { ColumnsType } from 'antd/es/table';
import { EmailCategory } from '../types';
import { useCategories, categoryName, ColoredTag } from '../categories';
import type {
  Email,
  EmailAccount,
  EmailFolder,
  FoldersByAccount,
  Suggestion,
  EmailFilters,
} from '../types';

interface EmailListProps {
  emails: Email[];
  accounts: EmailAccount[];
  folders: EmailFolder[];
  suggestions: Suggestion[];
  total: number;
  filters: EmailFilters;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onFilterChange: (filters: Partial<EmailFilters>) => void;
  onDelete?: (id: string) => void;
  onSelectEmail?: (email: Email | null) => void;
  selectedEmailId?: string | null;
  onRefresh?: () => void;
  onManageCategories?: () => void;
  foldersByAccount?: FoldersByAccount;
  onMoved?: () => void;
}

function EmailList({
  emails,
  accounts,
  folders,
  suggestions,
  total,
  filters,
  selectedIds,
  onSelectionChange,
  onFilterChange,
  onDelete,
  onSelectEmail,
  selectedEmailId,
  onRefresh,
  onManageCategories,
  foldersByAccount,
  onMoved,
}: EmailListProps) {
  const categories = useCategories();
  const suggestionMap = new Map(
    suggestions.map((s) => [s.emailId, s]),
  );

  const handleCategoryChange = async (id: string, cat: EmailCategory) => {
    try {
      await updateCategory(id, cat);
      onRefresh?.();
    } catch {
      message.error('Erro ao mudar categoria');
    }
  };

  const [ctxMenu, setCtxMenu] = useState<{ email: Email; x: number; y: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  // Keep the context menu inside the window (it grows after the action lookup loads):
  // near the bottom/right edge it opens upwards/leftwards, like a native menu.
  useLayoutEffect(() => {
    const el = ctxRef.current;
    if (!ctxMenu || !el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const top = ctxMenu.y + h + 8 > window.innerHeight ? Math.max(8, ctxMenu.y - h) : ctxMenu.y;
    const left = ctxMenu.x + w + 8 > window.innerWidth ? Math.max(8, ctxMenu.x - w) : ctxMenu.x;
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  });
  const [matchedAction, setMatchedAction] = useState<EmailAction | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [defineModalEmail, setDefineModalEmail] = useState<Email | null>(null);
  const [editingAction, setEditingAction] = useState<EmailAction | null>(null);
  const [moveEmail, setMoveEmail] = useState<Email | null>(null);
  const [moving, setMoving] = useState(false);
  // Whole folder in one scrollable (virtualised) list, sized to the window
  const [tableHeight, setTableHeight] = useState(() => Math.max(300, window.innerHeight - 260));
  useEffect(() => {
    const onResize = () => setTableHeight(Math.max(300, window.innerHeight - 260));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [moveTarget, setMoveTarget] = useState<string | undefined>(undefined);

  // Folder tree of every mailbox: the email can go to any folder of this or another account
  const SEP = '';
  const moveTree = (() => {
    if (!moveEmail) return [];
    const ordered = [...accounts].sort((x, y) => (x.id === moveEmail.accountId ? -1 : y.id === moveEmail.accountId ? 1 : 0));
    return ordered
      .filter((acc) => (foldersByAccount?.[acc.id] || []).length > 0)
      .map((acc) => {
        const folders = foldersByAccount?.[acc.id] || [];
        const ids = new Set(folders.map((f) => f.id));
        const node = (f: (typeof folders)[number]): any => ({
          value: `${acc.id}${SEP}${f.id}`,
          title: f.label,
          search: `${acc.email} ${f.path || f.label}`,
          disabled: acc.id === moveEmail.accountId && f.id === moveEmail.folder,
          children: folders
            .filter((c) => c.parentId === f.id)
            .sort((x, y) => x.label.localeCompare(y.label, 'pt'))
            .map(node),
        });
        return {
          value: `acc${SEP}${acc.id}`,
          title: <strong>{acc.email}</strong>,
          search: acc.email,
          selectable: false,
          children: folders
            .filter((f) => !f.parentId || !ids.has(f.parentId))
            .sort((x, y) => x.label.localeCompare(y.label, 'pt'))
            .map(node),
        };
      });
  })();

  const handleMove = async (value: string) => {
    if (!moveEmail) return;
    const [accountId, folderId] = value.split(SEP);
    if (!folderId || accountId === 'acc') return;
    setMoving(true);
    try {
      const r = await moveEmailToFolder(moveEmail.id, folderId, accountId);
      if (r.warning) message.warning(r.warning, 8);
      else message.success(`Movido para "${r.folder}"`);
      setMoveEmail(null);
      onMoved?.();
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Erro ao mover email', 8);
    } finally {
      setMoving(false);
    }
  };

  useEffect(() => {
    if (!ctxMenu) {
      setMatchedAction(null);
      return;
    }
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);

    // Fetch matching action
    setMatchLoading(true);
    matchEmailAction(ctxMenu.email.id)
      .then((res) => setMatchedAction(res.action))
      .catch(() => setMatchedAction(null))
      .finally(() => setMatchLoading(false));

    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [ctxMenu]);

  const handleRunAction = () => {
    if (!matchedAction) return;
    setCtxMenu(null);
    if (matchedAction.actionType === 'OPEN_URL') {
      window.open(matchedAction.actionValue, '_blank', 'noopener,noreferrer');
    } else {
      message.warning('Tipo de ação desconhecido');
    }
  };

  const handleDefineAction = () => {
    if (!ctxMenu) return;
    setDefineModalEmail(ctxMenu.email);
    setCtxMenu(null);
  };

  const handleEditAction = () => {
    if (!matchedAction) return;
    setEditingAction(matchedAction);
    setCtxMenu(null);
  };

  const folderRowColors: Record<string, string> = {
    junkemail: '#fff1f0',
    sentitems: '#f6ffed',
    drafts: '#fffbe6',
    deleteditems: '#f5f5f5',
  };

  const getRowStyle = (record: Email): React.CSSProperties => {
    const suggestion = suggestionMap.get(record.id);
    if (suggestion) {
      if (suggestion.suggestedCategory === EmailCategory.DELETE) {
        return { background: '#fff1f0' };
      }
      if (suggestion.suggestedCategory === EmailCategory.TODO) {
        return { background: '#e6f4ff' };
      }
      if (suggestion.suggestedCategory === EmailCategory.SAVE_ONEDRIVE) {
        return { background: '#f6ffed' };
      }
    }
    // Folder-based coloring
    const folderBg = folderRowColors[record.folder];
    if (folderBg) {
      return { background: folderBg, ...(record.isRead ? {} : { fontWeight: 600 }) };
    }
    if (!record.isRead) {
      return { fontWeight: 600 };
    }
    return {};
  };

  const actionsColumn = {
    title: '',
    key: 'actions',
    width: 36,
    render: (_: unknown, record: Email) => (
      <Button
        type="text"
        size="small"
        icon={<DeleteOutlined />}
        danger
        style={{ opacity: 0.4 }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; }}
        onClick={(e) => { e.stopPropagation(); onDelete?.(record.id); }}
      />
    ),
  };

  const columns: ColumnsType<Email> = [
    {
      title: 'De',
      dataIndex: 'from',
      key: 'from',
      width: 180,
      ellipsis: true,
      sorter: true,
      sortOrder: filters.sortField === 'from' ? filters.sortOrder : undefined,
      render: (_: unknown, record: Email) => {
        // Parse "Name <email>" format
        const match = record.from?.match(/^(.+?)\s*<(.+)>$/);
        if (match) {
          return (
            <div style={{ lineHeight: 1.3 }}>
              <div style={{ fontWeight: record.isRead ? 400 : 600, fontSize: 13 }}>
                {match[1]}
              </div>
              <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                {match[2]}
              </div>
            </div>
          );
        }
        return (
          <span style={{ fontWeight: record.isRead ? 400 : 600 }}>
            {record.from}
          </span>
        );
      },
    },
    {
      title: 'Assunto',
      dataIndex: 'subject',
      key: 'subject',
      ellipsis: true,
      render: (subject: string, record: Email) => {
        const suggestion = suggestionMap.get(record.id);
        return (
          <Space>
            <span style={{ fontWeight: record.isRead ? 400 : 600 }}>
              {subject || '(sem assunto)'}
            </span>
            {suggestion && (
              <Tag color="orange" style={{ fontSize: 11 }}>
                Sugestao: {categoryName(categories, suggestion.suggestedCategory)}
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Categoria',
      dataIndex: 'category',
      key: 'category',
      width: 130,
      render: (category: EmailCategory, record: Email) => (
        <Select
          size="small"
          variant="borderless"
          value={category}
          style={{ width: '100%' }}
          popupMatchSelectWidth={false}
          onClick={(e) => e.stopPropagation()}
          onChange={(val) => handleCategoryChange(record.id, val as EmailCategory)}
          options={categories.map((cat) => ({
            value: cat.key,
            label: <ColoredTag name={cat.name} color={cat.color} />,
          }))}
          dropdownRender={(menu) => (
            <>
              {menu}
              {onManageCategories && (
                <div
                  style={{ borderTop: '1px solid #f0f0f0', marginTop: 4, padding: '6px 12px', fontSize: 12, color: '#1677ff', cursor: 'pointer' }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onManageCategories()}
                >
                  Gerir categorias...
                </div>
              )}
            </>
          )}
        />
      ),
    },
    {
      title: 'Data',
      dataIndex: 'receivedAt',
      key: 'receivedAt',
      width: 95,
      sorter: true,
      sortOrder: filters.sortField === 'receivedAt' ? filters.sortOrder : undefined,
      defaultSortOrder: !filters.sortField ? 'descend' as const : undefined,
      render: (date: string) => {
        const d = new Date(date);
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        return (
          <span style={{ fontSize: 11, color: '#595959' }}>
            {sameDay
              ? d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
              : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit' })}
          </span>
        );
      },
    },
    actionsColumn,
  ];

  const categoryOptions = categories.map((cat) => ({
    value: cat.key,
    label: cat.name,
  }));

  const folderOptions = folders.map((f) => ({
    value: f.id,
    label: `${f.label} (${f.count})`,
  }));

  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: a.email,
  }));

  return (
    <div>
      <div
        style={{
          background: '#fff',
          padding: '12px 16px',
          borderRadius: '8px 8px 0 0',
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Input
          placeholder="Pesquisar emails..."
          prefix={<SearchOutlined />}
          allowClear
          style={{ maxWidth: 300 }}
          onChange={(e) =>
            onFilterChange({ search: e.target.value || undefined })
          }
          value={filters.search}
        />
        <Select
          placeholder="Conta"
          allowClear
          style={{ minWidth: 200 }}
          options={accountOptions}
          value={filters.account}
          onChange={(val) => onFilterChange({ account: val })}
        />
        <Select
          placeholder="Pasta"
          allowClear
          style={{ minWidth: 160 }}
          options={folderOptions}
          value={filters.folder}
          onChange={(val) => onFilterChange({ folder: val })}
        />
        <Select
          placeholder="Categoria"
          allowClear
          style={{ minWidth: 160 }}
          options={categoryOptions}
          value={filters.category}
          onChange={(val) => onFilterChange({ category: val })}
        />
        <span style={{ color: '#8c8c8c', fontSize: 13, marginLeft: 'auto' }}>
          {emails.length < total ? `a mostrar ${emails.length} de ` : ''}{total} email{total !== 1 ? 's' : ''}
        </span>
      </div>

      <Table
        dataSource={emails}
        columns={columns}
        rowKey="id"
        size="small"
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => onSelectionChange(keys as string[]),
        }}
        onRow={(record) => ({
          style: {
            ...getRowStyle(record),
            cursor: 'pointer',
            ...(selectedEmailId === record.id ? { background: '#e6f4ff' } : {}),
          },
          onClick: (e) => {
            // Don't trigger on checkbox, button or select clicks
            const target = e.target as HTMLElement;
            if (target.closest('.ant-checkbox-wrapper') || target.closest('.ant-btn') || target.closest('.ant-select')) return;
            onSelectEmail?.(record);
          },
          onContextMenu: (e) => {
            e.preventDefault();
            setCtxMenu({ email: record, x: e.clientX, y: e.clientY });
          },
        })}
        onChange={(_pagination, _filters, sorter) => {
          if (!Array.isArray(sorter) && sorter.columnKey) {
            onFilterChange({
              sortField: sorter.order ? (sorter.columnKey as string) : undefined,
              sortOrder: sorter.order || undefined,
            });
          }
        }}
        pagination={false}
        virtual
        scroll={{ y: tableHeight }}
        style={{
          background: '#fff',
          borderRadius: '0 0 8px 8px',
        }}
        locale={{
          emptyText: 'Nenhum email encontrado',
          selectionAll: 'Selecionar todos',
        }}
      />

      {ctxMenu && (
        <div
          ref={ctxRef}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            top: ctxMenu.y,
            left: ctxMenu.x,
            maxHeight: 'calc(100vh - 16px)',
            overflowY: 'auto',
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            padding: 8,
            zIndex: 2000,
            minWidth: 260,
            border: '1px solid #f0f0f0',
          }}
        >
          {matchLoading ? (
            <div style={{ padding: '8px 12px', fontSize: 12, color: '#8c8c8c' }}>A procurar ação...</div>
          ) : matchedAction ? (
            <>
              <div
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                onClick={handleRunAction}
                title={matchedAction.actionValue}
              >
                <ThunderboltOutlined style={{ color: '#faad14' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>Executar ação</div>
                  <div style={{ fontSize: 11, color: '#8c8c8c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {matchedAction.name}
                  </div>
                </div>
              </div>
              <div
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                onClick={handleEditAction}
              >
                <EditOutlined /> Editar ação
              </div>
            </>
          ) : (
            <div style={{ padding: '8px 12px', fontSize: 11, color: '#8c8c8c' }}>
              Nenhuma ação definida para este email
            </div>
          )}
          <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0' }} />
          <div
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={handleDefineAction}
          >
            <PlusOutlined /> {matchedAction ? 'Definir outra ação...' : 'Definir ação...'}
          </div>
          <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0' }} />
          <div
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={() => {
              if (!ctxMenu) return;
              setMoveTarget(undefined);
              setMoveEmail(ctxMenu.email);
              setCtxMenu(null);
            }}
          >
            <FolderOpenOutlined style={{ color: '#faad14' }} /> Enviar para pasta...
          </div>
          <div
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={async () => {
              if (!ctxMenu) return;
              const emailId = ctxMenu.email.id;
              setCtxMenu(null);
              const key = 'apply-rules';
              message.loading({ content: 'A aplicar regras...', key });
              try {
                const r = await applyArchiveRulesToEmail(emailId);
                if (r.saved === 0 && r.ruleIds.length === 0) {
                  message.info({ content: 'Nenhuma regra corresponde a este email', key, duration: 3 });
                } else if (r.saved === 0) {
                  message.warning({ content: 'Regras combinaram, mas sem anexos para guardar', key, duration: 4 });
                } else {
                  message.success({ content: `${r.saved} ficheiro(s) guardado(s) no OneDrive`, key });
                }
              } catch (e: any) {
                message.error({ content: e?.response?.data?.error || e.message, key, duration: 5 });
              }
            }}
          >
            <FolderAddOutlined style={{ color: '#52c41a' }} /> Aplicar regras do OneDrive
          </div>
        </div>
      )}

      <Modal
        title="Enviar para pasta"
        open={moveEmail !== null}
        onCancel={() => setMoveEmail(null)}
        okText="OK"
        cancelText="Cancelar"
        okButtonProps={{ disabled: !moveTarget, loading: moving }}
        cancelButtonProps={{ disabled: moving }}
        onOk={() => moveTarget && handleMove(moveTarget)}
        destroyOnClose
        width={520}
      >
        {moveEmail && (
          <>
            <div style={{ fontSize: 12, color: '#595959', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {moveEmail.subject || '(sem assunto)'}
            </div>
            <TreeSelect
              showSearch
              autoFocus
              defaultOpen
              style={{ width: '100%' }}
              placeholder="Escolher a pasta (desta ou doutra caixa) ou escrever para procurar..."
              treeData={moveTree}
              treeNodeFilterProp="search"
              treeDefaultExpandedKeys={[`acc${SEP}${moveEmail.accountId}`]}
              loading={moving}
              disabled={moving}
              value={moveTarget}
              onChange={(val) => setMoveTarget(val as string)}
              notFoundContent="Nenhuma pasta encontrada"
              listHeight={400}
            />
            <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 8 }}>
              Para outra caixa de email, o email é copiado (com anexos) e o original vai para o Lixo.
            </div>
          </>
        )}
      </Modal>

      <DefineActionModal
        open={defineModalEmail !== null}
        email={defineModalEmail}
        accounts={accounts}
        onClose={() => setDefineModalEmail(null)}
        onSaved={() => { /* refresh not strictly needed */ }}
      />
      <DefineActionModal
        open={editingAction !== null}
        action={editingAction}
        accounts={accounts}
        onClose={() => setEditingAction(null)}
        onSaved={() => { /* refresh not strictly needed */ }}
      />
    </div>
  );
}

export default EmailList;
