import { useEffect, useState } from 'react';
import { Button, Modal, Breadcrumb, List, Input, message } from 'antd';
import {
  CloudUploadOutlined, FolderOutlined, FolderAddOutlined,
  FilePdfOutlined, FileWordOutlined, FileExcelOutlined, FilePptOutlined, FileImageOutlined,
  FileZipOutlined, FileTextOutlined, FileOutlined, MailOutlined, CalendarOutlined,
} from '@ant-design/icons';
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

type IconType = typeof FileOutlined;

// File-type icon + colour, by extension first and content type as fallback.
function fileIcon(name: string, contentType: string): { Icon: IconType; color: string } {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const ct = (contentType || '').toLowerCase();
  if (ext === 'pdf' || ct.includes('pdf')) return { Icon: FilePdfOutlined, color: '#d4380d' };
  if (['doc', 'docx', 'dot', 'dotx', 'odt', 'rtf'].includes(ext) || ct.includes('word')) return { Icon: FileWordOutlined, color: '#1d5fbf' };
  if (['xls', 'xlsx', 'xlsm', 'xlsb', 'csv', 'ods'].includes(ext) || ct.includes('excel') || ct.includes('spreadsheet')) return { Icon: FileExcelOutlined, color: '#1e7e45' };
  if (['ppt', 'pptx', 'pps', 'ppsx', 'odp'].includes(ext) || ct.includes('powerpoint') || ct.includes('presentation')) return { Icon: FilePptOutlined, color: '#c8501e' };
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'heic', 'tif', 'tiff'].includes(ext) || ct.startsWith('image/')) return { Icon: FileImageOutlined, color: '#8a4fc7' };
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext) || ct.includes('zip') || ct.includes('compressed')) return { Icon: FileZipOutlined, color: '#b8860b' };
  if (['eml', 'msg'].includes(ext) || ct.includes('rfc822')) return { Icon: MailOutlined, color: '#1677ff' };
  if (ext === 'ics' || ct.includes('calendar')) return { Icon: CalendarOutlined, color: '#1677ff' };
  if (['txt', 'xml', 'json', 'html', 'htm', 'md', 'log'].includes(ext) || ct.startsWith('text/')) return { Icon: FileTextOutlined, color: '#595959' };
  return { Icon: FileOutlined, color: '#8c8c8c' };
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

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
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'stretch' }}>
        {atts.map((a) => {
          const { Icon, color } = fileIcon(a.name, a.contentType);
          const size = formatSize(a.size);
          return (
            <div
              key={a.id}
              title={a.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 10px 5px 8px',
                border: '1px solid #e8e8e8',
                borderRadius: 4,
                background: '#fafafa',
                maxWidth: 240,
                minWidth: 0,
              }}
            >
              <Icon style={{ fontSize: 22, color, flexShrink: 0 }} />
              <div style={{ minWidth: 0, lineHeight: 1.25 }}>
                <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                {size && <div style={{ fontSize: 11, color: '#8c8c8c' }}>{size}</div>}
              </div>
            </div>
          );
        })}
        <Button icon={<CloudUploadOutlined />} onClick={openPicker} size="small" style={{ alignSelf: 'center' }}>
          Guardar no OneDrive
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
            { title: <a onClick={() => navCrumb(-1)}>OneDrive</a> },
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
