import { useEffect, useState } from 'react';
import { Button, Modal, Breadcrumb, List, Input, message, Space, Tag } from 'antd';
import { CloudUploadOutlined, FolderOutlined, FolderAddOutlined } from '@ant-design/icons';
import {
  getEmailAttachments,
  saveAttachmentsToArchive,
  getArchiveRoot,
  listArchiveFolder,
  createArchiveFolder,
  type MailAttachment,
  type ArchiveItem,
} from '../api';
import type { Email } from '../types';

export default function SaveAttachmentsSection({ email }: { email: Email }) {
  const [atts, setAtts] = useState<MailAttachment[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rootId, setRootId] = useState<string | null>(null);
  const [path, setPath] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [newFolderName, setNewFolderName] = useState('');

  const currentId = path.length > 0 ? path[path.length - 1].id : rootId;

  useEffect(() => {
    getEmailAttachments(email.id).then(setAtts).catch(() => setAtts([]));
  }, [email.id]);

  const openPicker = async () => {
    try {
      const { rootId } = await getArchiveRoot();
      setRootId(rootId);
      setPath([]);
      setPickerOpen(true);
      const list = await listArchiveFolder(rootId);
      setItems(list);
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    }
  };

  const enter = async (it: ArchiveItem) => {
    if (!it.isFolder) return;
    setPath((p) => [...p, { id: it.id, name: it.name }]);
    const list = await listArchiveFolder(it.id);
    setItems(list);
  };

  const navCrumb = async (idx: number) => {
    const newPath = idx < 0 ? [] : path.slice(0, idx + 1);
    setPath(newPath);
    const id = newPath.length > 0 ? newPath[newPath.length - 1].id : rootId!;
    const list = await listArchiveFolder(id);
    setItems(list);
  };

  const makeFolder = async () => {
    if (!currentId || !newFolderName.trim()) return;
    try {
      await createArchiveFolder(currentId, newFolderName.trim());
      setNewFolderName('');
      const list = await listArchiveFolder(currentId);
      setItems(list);
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    }
  };

  const saveHere = async () => {
    if (!currentId) return;
    const key = 'save-att';
    message.loading({ content: 'A guardar anexos...', key });
    try {
      const r = await saveAttachmentsToArchive(email.id, currentId);
      message.success({ content: `${r.saved} anexo(s) guardado(s)`, key });
      setPickerOpen(false);
    } catch (e: any) {
      message.error({ content: e.response?.data?.error || e.message, key });
    }
  };

  if (atts.length === 0) return null;

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 6 }}>Anexos ({atts.length})</div>
      <Space wrap size={[4, 4]}>
        {atts.map((a) => <Tag key={a.id}>{a.name}</Tag>)}
      </Space>
      <div style={{ marginTop: 10 }}>
        <Button type="primary" icon={<CloudUploadOutlined />} onClick={openPicker} size="small">
          Guardar no Arquivo
        </Button>
      </div>

      <Modal
        open={pickerOpen}
        title="Escolher pasta de destino"
        onCancel={() => setPickerOpen(false)}
        onOk={saveHere}
        okText="Guardar aqui"
        cancelText="Cancelar"
        width={560}
      >
        <Breadcrumb
          items={[
            { title: <a onClick={() => navCrumb(-1)}>Arquivo</a> },
            ...path.map((p, i) => ({ title: <a onClick={() => navCrumb(i)}>{p.name}</a> })),
          ]}
        />
        <div style={{ margin: '12px 0', display: 'flex', gap: 8 }}>
          <Input
            placeholder="Nome de nova pasta"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onPressEnter={makeFolder}
          />
          <Button icon={<FolderAddOutlined />} onClick={makeFolder}>Criar</Button>
        </div>
        <List
          size="small"
          bordered
          style={{ maxHeight: 300, overflow: 'auto' }}
          dataSource={items.filter((i) => i.isFolder)}
          locale={{ emptyText: 'Pasta vazia' }}
          renderItem={(it) => (
            <List.Item onClick={() => enter(it)} style={{ cursor: 'pointer' }}>
              <FolderOutlined style={{ color: '#faad14', marginRight: 8 }} />
              {it.name}
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
}
