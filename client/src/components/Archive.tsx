import { useState, useEffect, useCallback, useRef } from 'react';
import { Breadcrumb, Button, Input, Space, Table, Tag, Popconfirm, Modal, Form, message, Spin, Upload, Drawer } from 'antd';
import {
  FolderOutlined,
  FileOutlined,
  UploadOutlined,
  FolderAddOutlined,
  DeleteOutlined,
  DownloadOutlined,
  SearchOutlined,
  EditOutlined,
  TagsOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  getArchiveRoot,
  listArchiveFolder,
  createArchiveFolder,
  uploadArchiveFile,
  deleteArchiveItem,
  renameArchiveItem,
  updateArchiveMeta,
  archiveDownloadUrl,
  searchArchive,
  getArchiveEntities,
  type ArchiveItem,
  type ArchiveEntity,
} from '../api';
import ArchiveEntitiesPanel from './ArchiveEntitiesPanel';
import ArchiveRulesPanel from './ArchiveRulesPanel';

interface Crumb { id: string; name: string }

function humanSize(n?: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function Archive() {
  const [rootId, setRootId] = useState<string | null>(null);
  const [path, setPath] = useState<Crumb[]>([]);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [entities, setEntities] = useState<ArchiveEntity[]>([]);
  const [detailItem, setDetailItem] = useState<ArchiveItem | null>(null);
  const [entitiesOpen, setEntitiesOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const currentFolderId = path.length > 0 ? path[path.length - 1].id : rootId;

  const load = useCallback(async (folderId: string | null) => {
    if (!folderId) return;
    setLoading(true);
    try {
      const data = await listArchiveFolder(folderId);
      setItems(data);
    } catch (e: any) {
      message.error(`Erro: ${e.response?.data?.error || e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { rootId } = await getArchiveRoot();
        setRootId(rootId);
      } catch (e: any) {
        message.error(`Nao foi possivel abrir o OneDrive: ${e.response?.data?.error || e.message}. Pode ser preciso re-autorizar a conta Microsoft.`);
      }
    })();
    getArchiveEntities().then(setEntities).catch(() => {});
  }, []);

  useEffect(() => { if (currentFolderId) load(currentFolderId); }, [currentFolderId, load]);

  const enterFolder = (it: ArchiveItem) => {
    setPath((prev) => {
      // Guard against re-entering the same leaf (stale IDs or double-click)
      if (prev.length > 0 && prev[prev.length - 1].id === it.id) return prev;
      return [...prev, { id: it.id, name: it.name }];
    });
    setSearchMode(false);
  };

  const navigateCrumb = (idx: number) => {
    if (idx < 0) setPath([]);
    else setPath((prev) => prev.slice(0, idx + 1));
    setSearchMode(false);
  };

  const handleUpload = async (file: File) => {
    if (!currentFolderId) return false;
    const key = `up-${file.name}`;
    message.loading({ content: `A carregar ${file.name}...`, key });
    try {
      await uploadArchiveFile(currentFolderId, file);
      message.success({ content: `${file.name} carregado`, key });
      load(currentFolderId);
    } catch (e: any) {
      message.error({ content: `${file.name}: ${e.response?.data?.error || e.message}`, key });
    }
    return false;
  };

  const handleCreateFolder = async () => {
    if (!currentFolderId || !newFolderName.trim()) return;
    try {
      await createArchiveFolder(currentFolderId, newFolderName.trim());
      message.success('Pasta criada');
      setNewFolderName('');
      setNewFolderOpen(false);
      load(currentFolderId);
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    }
  };

  const handleDelete = async (it: ArchiveItem) => {
    try {
      await deleteArchiveItem(it.id);
      message.success('Apagado');
      load(currentFolderId);
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    }
  };

  const handleRename = async (it: ArchiveItem) => {
    const newName = prompt('Novo nome:', it.name);
    if (!newName || newName === it.name) return;
    try {
      await renameArchiveItem(it.id, newName);
      load(currentFolderId);
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    }
  };

  const handleSearch = async () => {
    if (!searchQ.trim()) { setSearchMode(false); return; }
    setLoading(true);
    try {
      const { drive } = await searchArchive(searchQ.trim());
      setItems(drive);
      setSearchMode(true);
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    dragCounterRef.current = 0;
    const files = Array.from(e.dataTransfer.files || []);
    for (const f of files) await handleUpload(f);
  };

  const columns: ColumnsType<ArchiveItem> = [
    {
      title: '',
      key: 'icon',
      width: 36,
      render: (_, it) => it.isFolder ? <FolderOutlined style={{ color: '#faad14', fontSize: 18 }} /> : <FileOutlined style={{ color: '#8c8c8c' }} />,
    },
    {
      title: 'Nome',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string, it) => (
        <a
          onClick={(e) => { e.stopPropagation(); if (it.isFolder) enterFolder(it); else setDetailItem(it); }}
          style={{ color: it.isFolder ? '#1677ff' : '#262626', fontWeight: it.isFolder ? 500 : 400 }}
        >
          {name}
        </a>
      ),
    },
    {
      title: 'Entidade',
      key: 'entity',
      width: 130,
      render: (_, it) => it.meta?.entity ? <Tag color={it.meta.entity.color || 'blue'}>{it.meta.entity.name}</Tag> : null,
    },
    {
      title: 'Tags',
      key: 'tags',
      width: 180,
      render: (_, it) => (it.meta?.tags || []).map(t => <Tag key={t}>{t}</Tag>),
    },
    {
      title: 'Tamanho',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      render: (s: number) => humanSize(s),
    },
    {
      title: 'Modificado',
      dataIndex: 'lastModifiedDateTime',
      key: 'mod',
      width: 130,
      render: (d: string) => d ? new Date(d).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '',
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      render: (_, it) => (
        <Space size={0}>
          {!it.isFolder && (
            <Button type="text" size="small" icon={<DownloadOutlined />} href={archiveDownloadUrl(it.id)} title="Baixar" />
          )}
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleRename(it)} title="Renomear" />
          <Popconfirm title={`Apagar ${it.name}?`} onConfirm={() => handleDelete(it)} okText="Apagar" cancelText="Cancelar" okButtonProps={{ danger: true }}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} title="Apagar" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setIsDragging(true); }}
      onDragLeave={() => { dragCounterRef.current--; if (dragCounterRef.current <= 0) setIsDragging(false); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{ padding: 16, position: 'relative', minHeight: '100%' }}
    >
      <div style={{ background: '#fff', padding: '12px 16px', borderRadius: 8, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Breadcrumb
          items={[
            { title: <a onClick={() => navigateCrumb(-1)}>OneDrive</a> },
            ...path.map((p, i) => ({ title: <a onClick={() => navigateCrumb(i)}>{p.name}</a> })),
            ...(searchMode ? [{ title: `Pesquisa: "${searchQ}"` }] : []),
          ]}
        />
        <div style={{ flex: 1 }} />
        <Input
          placeholder="Pesquisar..."
          prefix={<SearchOutlined />}
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          onPressEnter={handleSearch}
          allowClear
          onClear={() => { setSearchMode(false); if (currentFolderId) load(currentFolderId); }}
          style={{ width: 260 }}
        />
        <Upload beforeUpload={handleUpload} showUploadList={false}>
          <Button icon={<UploadOutlined />}>Upload</Button>
        </Upload>
        <Button icon={<FolderAddOutlined />} onClick={() => setNewFolderOpen(true)}>Nova pasta</Button>
        <Button icon={<TagsOutlined />} onClick={() => setEntitiesOpen(true)}>Entidades</Button>
        <Button icon={<SettingOutlined />} onClick={() => setRulesOpen(true)}>Regras</Button>
      </div>

      <Spin spinning={loading}>
        <Table
          dataSource={items}
          columns={columns}
          rowKey="id"
          size="middle"
          pagination={{ pageSize: 50, showSizeChanger: true }}
          style={{ background: '#fff', borderRadius: 8 }}
          locale={{ emptyText: 'Pasta vazia. Arrasta ficheiros aqui ou carrega em Upload.' }}
        />
      </Spin>

      {isDragging && (
        <div style={{
          position: 'absolute', inset: 16, background: 'rgba(22,119,255,0.08)',
          border: '2px dashed #1677ff', borderRadius: 8, display: 'flex',
          alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
          fontSize: 18, color: '#1677ff', fontWeight: 600,
        }}>
          Largar para carregar
        </div>
      )}

      <Modal
        open={newFolderOpen}
        title="Nova pasta"
        onOk={handleCreateFolder}
        onCancel={() => setNewFolderOpen(false)}
        okText="Criar"
        cancelText="Cancelar"
      >
        <Input
          placeholder="Nome da pasta"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onPressEnter={handleCreateFolder}
          autoFocus
        />
      </Modal>

      <ItemDetailDrawer
        item={detailItem}
        entities={entities}
        onClose={() => setDetailItem(null)}
        onSaved={() => { setDetailItem(null); load(currentFolderId); }}
      />

      <ArchiveEntitiesPanel
        open={entitiesOpen}
        onClose={() => { setEntitiesOpen(false); getArchiveEntities().then(setEntities).catch(() => {}); }}
      />
      <ArchiveRulesPanel
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        entities={entities}
      />
    </div>
  );
}

function ItemDetailDrawer({ item, entities, onClose, onSaved }: {
  item: ArchiveItem | null;
  entities: ArchiveEntity[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  useEffect(() => {
    if (item) {
      form.setFieldsValue({
        tags: item.meta?.tags || [],
        notes: item.meta?.notes || '',
        entityId: item.meta?.entityId || null,
        expiresAt: item.meta?.expiresAt || null,
      });
    }
  }, [item, form]);

  const save = async () => {
    if (!item) return;
    const v = await form.validateFields();
    try {
      await updateArchiveMeta(item.id, {
        tags: v.tags || [],
        notes: v.notes || null,
        entityId: v.entityId || null,
        expiresAt: v.expiresAt || null,
      });
      message.success('Gravado');
      onSaved();
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    }
  };

  return (
    <Drawer open={!!item} onClose={onClose} title={item?.name} width={420}>
      {item && (
        <>
          <div style={{ marginBottom: 12 }}>
            <Tag>{item.isFolder ? 'Pasta' : 'Ficheiro'}</Tag>
            {item.mimeType && <Tag color="blue">{item.mimeType}</Tag>}
            <Tag>{humanSize(item.size)}</Tag>
            {!item.isFolder && (
              <Button type="link" size="small" icon={<DownloadOutlined />} href={archiveDownloadUrl(item.id)}>
                Baixar
              </Button>
            )}
          </div>
          <Form form={form} layout="vertical">
            <Form.Item label="Entidade" name="entityId">
              <select style={{ width: '100%', padding: 6 }}>
                <option value="">(nenhuma)</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Form.Item>
            <Form.Item label="Tags (separadas por virgula)" name="tags" getValueFromEvent={(e) => e.target.value.split(',').map((t: string) => t.trim()).filter(Boolean)} getValueProps={(v) => ({ value: Array.isArray(v) ? v.join(', ') : '' })}>
              <Input placeholder="ex: fatura, 2026, indaqua" />
            </Form.Item>
            <Form.Item label="Notas" name="notes">
              <Input.TextArea rows={4} />
            </Form.Item>
            <Form.Item label="Validade" name="expiresAt" getValueFromEvent={(e) => e.target.value || null} getValueProps={(v) => ({ value: v ? String(v).slice(0, 10) : '' })}>
              <Input type="date" />
            </Form.Item>
            <Button type="primary" onClick={save}>Gravar</Button>
          </Form>
        </>
      )}
    </Drawer>
  );
}

export default Archive;
