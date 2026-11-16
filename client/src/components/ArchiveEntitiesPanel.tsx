import { useEffect, useState } from 'react';
import { Drawer, Button, List, Input, Modal, Form, message, Popconfirm, Tag, Space } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { getArchiveEntities, createArchiveEntity, updateArchiveEntity, deleteArchiveEntity, type ArchiveEntity } from '../api';

export default function ArchiveEntitiesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [entities, setEntities] = useState<ArchiveEntity[]>([]);
  const [editing, setEditing] = useState<ArchiveEntity | null>(null);
  const [form] = Form.useForm();

  const load = () => getArchiveEntities().then(setEntities).catch(() => {});
  useEffect(() => { if (open) load(); }, [open]);

  const openNew = () => {
    setEditing({ id: '', name: '', aliases: [], color: null });
    form.setFieldsValue({ name: '', aliases: '', color: '' });
  };

  const openEdit = (e: ArchiveEntity) => {
    setEditing(e);
    form.setFieldsValue({ name: e.name, aliases: e.aliases.join(', '), color: e.color || '' });
  };

  const save = async () => {
    const v = await form.validateFields();
    const payload = {
      name: v.name.trim(),
      aliases: (v.aliases || '').split(',').map((a: string) => a.trim()).filter(Boolean),
      color: (v.color || '').trim() || null,
    };
    try {
      if (editing && editing.id) await updateArchiveEntity(editing.id, payload);
      else await createArchiveEntity(payload);
      message.success('Gravado');
      setEditing(null);
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    }
  };

  const del = async (id: string) => {
    await deleteArchiveEntity(id);
    message.success('Apagada');
    load();
  };

  return (
    <Drawer open={open} onClose={onClose} title="Entidades" width={480} extra={<Button type="primary" icon={<PlusOutlined />} onClick={openNew}>Nova</Button>}>
      <List
        dataSource={entities}
        locale={{ emptyText: 'Nenhuma entidade. Cria uma para associares aos ficheiros e regras.' }}
        renderItem={(e) => (
          <List.Item
            actions={[
              <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(e)} />,
              <Popconfirm title={`Apagar ${e.name}?`} onConfirm={() => del(e.id)} okText="Apagar" cancelText="Cancelar" okButtonProps={{ danger: true }}>
                <Button type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={<Space><Tag color={e.color || 'blue'}>{e.name}</Tag></Space>}
              description={e.aliases.length > 0 ? `Aliases: ${e.aliases.join(', ')}` : null}
            />
          </List.Item>
        )}
      />

      <Modal
        open={editing !== null}
        title={editing?.id ? 'Editar entidade' : 'Nova entidade'}
        onOk={save}
        onCancel={() => setEditing(null)}
        okText="Gravar"
        cancelText="Cancelar"
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Nome" name="name" rules={[{ required: true, message: 'Nome obrigatorio' }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item label="Aliases (separados por virgula)" name="aliases" help="Nomes alternativos usados em matching (ex: 'Indaqua, Aguas de Santa Maria da Feira')">
            <Input />
          </Form.Item>
          <Form.Item label="Cor (nome AntD ou hex)" name="color" help="ex: blue, green, red, #faad14">
            <Input placeholder="blue" />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}
