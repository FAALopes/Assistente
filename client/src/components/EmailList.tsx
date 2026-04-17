import { useState, useEffect } from 'react';
import { Table, Tag, Input, Select, Space, Badge, Button, Popconfirm, message } from 'antd';
import {
  SearchOutlined,
  WindowsOutlined,
  GoogleOutlined,
  DeleteOutlined,
  InboxOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { EmailCategory } from '../types';
import type {
  Email,
  EmailAccount,
  EmailFolder,
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
  onPageChange: (page: number, limit: number) => void;
  onDelete?: (id: string) => void;
  onMoveToInbox?: (id: string) => void;
  onSelectEmail?: (email: Email | null) => void;
  selectedEmailId?: string | null;
}

const categoryLabels: Record<EmailCategory, string> = {
  [EmailCategory.INBOX]: 'Caixa de entrada',
  [EmailCategory.TODO]: 'Tratar depois',
  [EmailCategory.DELETE]: 'Apagar',
  [EmailCategory.SAVE_LATER]: 'Guardar',
  [EmailCategory.SAVE_ONEDRIVE]: 'OneDrive',
  [EmailCategory.UNCATEGORIZED]: 'Sem categoria',
};

const categoryColors: Record<EmailCategory, string> = {
  [EmailCategory.INBOX]: 'default',
  [EmailCategory.TODO]: 'blue',
  [EmailCategory.DELETE]: 'red',
  [EmailCategory.SAVE_LATER]: 'green',
  [EmailCategory.SAVE_ONEDRIVE]: 'cyan',
  [EmailCategory.UNCATEGORIZED]: 'default',
};

const providerIcons: Record<string, React.ReactNode> = {
  MICROSOFT: <WindowsOutlined style={{ color: '#0078d4' }} />,
  GMAIL: <GoogleOutlined style={{ color: '#ea4335' }} />,
};

const folderLabels: Record<string, string> = {
  inbox: 'Inbox',
  junkemail: 'E-mail de Lixo',
  sentitems: 'Enviados',
  drafts: 'Rascunhos',
  deleteditems: 'Eliminados',
  archive: 'Arquivo',
};

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
  onPageChange,
  onDelete,
  onMoveToInbox,
  onSelectEmail,
  selectedEmailId,
}: EmailListProps) {
  const suggestionMap = new Map(
    suggestions.map((s) => [s.emailId, s]),
  );

  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const [ctxMenu, setCtxMenu] = useState<{ email: Email; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [ctxMenu]);

  // Extract first URL from email content
  const extractUrl = (email: Email): string | null => {
    const text = `${email.subject || ''} ${email.bodyPreview || ''}`;
    const match = text.match(/https?:\/\/[^\s<>"')]+/i);
    return match ? match[0].replace(/[.,;:!?)]+$/, '') : null;
  };

  const handleOpenLink = (email: Email) => {
    const url = extractUrl(email);
    setCtxMenu(null);
    if (!url) {
      message.warning('Nenhum link encontrado no email');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
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

  const columns: ColumnsType<Email> = [
    {
      title: '',
      key: 'actions',
      width: 64,
      render: (_: unknown, record: Email) => (
        <Space size={0}>
          <Popconfirm
            title="Apagar este email?"
            description="O email será movido para o lixo no servidor."
            onConfirm={() => onDelete?.(record.id)}
            okText="Apagar"
            cancelText="Cancelar"
            okButtonProps={{ danger: true }}
          >
            <Button
              type="text"
              size="small"
              icon={<DeleteOutlined />}
              danger
              style={{ opacity: 0.4 }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; }}
            />
          </Popconfirm>
          {record.folder !== 'inbox' && (
            <Popconfirm
              title="Mover para Inbox?"
              onConfirm={() => onMoveToInbox?.(record.id)}
              okText="Mover"
              cancelText="Cancelar"
            >
              <Button
                type="text"
                size="small"
                icon={<InboxOutlined />}
                style={{ opacity: 0.4, color: '#1677ff' }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; }}
              />
            </Popconfirm>
          )}
        </Space>
      ),
    },
    {
      title: '',
      dataIndex: 'accountId',
      key: 'provider',
      width: 32,
      render: (accountId: string) => {
        const account = accountMap.get(accountId);
        return account ? providerIcons[account.provider] : null;
      },
    },
    {
      title: 'De',
      dataIndex: 'from',
      key: 'from',
      width: 220,
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
                Sugestao: {categoryLabels[suggestion.suggestedCategory]}
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
      render: (category: EmailCategory) => (
        <Tag color={categoryColors[category]}>
          {categoryLabels[category]}
        </Tag>
      ),
    },
    {
      title: 'Data',
      dataIndex: 'receivedAt',
      key: 'receivedAt',
      width: 150,
      sorter: true,
      sortOrder: filters.sortField === 'receivedAt' ? filters.sortOrder : undefined,
      defaultSortOrder: !filters.sortField ? 'descend' as const : undefined,
      render: (date: string) =>
        new Date(date).toLocaleString('pt-PT', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
    {
      title: 'Pasta',
      dataIndex: 'folder',
      key: 'folder',
      width: 140,
      render: (folder: string) => {
        const colorMap: Record<string, string> = {
          inbox: 'blue',
          junkemail: 'red',
          sentitems: 'green',
          drafts: 'orange',
          deleteditems: 'default',
          archive: 'purple',
        };
        return (
          <Tag color={colorMap[folder] || 'default'}>
            {folderLabels[folder] || folder}
          </Tag>
        );
      },
    },
    {
      title: 'Conta',
      dataIndex: 'accountId',
      key: 'account',
      width: 160,
      ellipsis: true,
      render: (accountId: string) => {
        const account = accountMap.get(accountId);
        if (!account) return '-';
        return (
          <Badge
            color={account.provider === 'MICROSOFT' ? '#0078d4' : '#ea4335'}
            text={
              <span style={{ fontSize: 12 }}>{account.email}</span>
            }
          />
        );
      },
    },
  ];

  const categoryOptions = Object.values(EmailCategory).map((cat) => ({
    value: cat,
    label: categoryLabels[cat],
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
          {total} email{total !== 1 ? 's' : ''}
        </span>
      </div>

      <Table
        dataSource={emails}
        columns={columns}
        rowKey="id"
        size="middle"
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
            onSelectEmail?.(selectedEmailId === record.id ? null : record);
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
        pagination={{
          current: filters.page || 1,
          pageSize: filters.limit || 50,
          total,
          showSizeChanger: true,
          pageSizeOptions: ['25', '50', '100'],
          showTotal: (t, range) =>
            `${range[0]}-${range[1]} de ${t} emails`,
          onChange: (page, pageSize) => onPageChange(page, pageSize),
        }}
        style={{
          background: '#fff',
          borderRadius: '0 0 8px 8px',
        }}
        locale={{
          emptyText: 'Nenhum email encontrado',
          selectionAll: 'Selecionar todos',
        }}
      />

      {ctxMenu && (() => {
        const url = extractUrl(ctxMenu.email);
        return (
          <div
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              position: 'fixed',
              top: ctxMenu.y,
              left: ctxMenu.x,
              background: '#fff',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              padding: 8,
              zIndex: 2000,
              minWidth: 240,
              border: '1px solid #f0f0f0',
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                cursor: url ? 'pointer' : 'not-allowed',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                opacity: url ? 1 : 0.45,
              }}
              onMouseEnter={(e) => { if (url) e.currentTarget.style.background = '#f5f5f5'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              onClick={() => url && handleOpenLink(ctxMenu.email)}
              title={url || 'Nenhum link encontrado'}
            >
              <LinkOutlined /> Executar link
              {url && (
                <span style={{ fontSize: 11, color: '#8c8c8c', marginLeft: 'auto', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {url.replace(/^https?:\/\//, '')}
                </span>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default EmailList;
