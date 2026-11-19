import { useEffect, useState } from 'react';
import { Drawer, Button, List, Input, Modal, Form, message, Popconfirm, Tag, Space, Switch, Select } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { getArchiveRules, createArchiveRule, updateArchiveRule, deleteArchiveRule, type ArchiveRule, type ArchiveEntity } from '../api';

export default function ArchiveRulesPanel({ open, onClose, entities }: { open: boolean; onClose: () => void; entities: ArchiveEntity[] }) {
  const [rules, setRules] = useState<ArchiveRule[]>([]);
  const [editing, setEditing] = useState<ArchiveRule | null>(null);
  const [form] = Form.useForm();

  const load = () => getArchiveRules().then(setRules).catch(() => {});
  useEffect(() => { if (open) load(); }, [open]);

  const openNew = () => {
    const stub = {
      id: '', name: '', accountId: null, senderPattern: '', subjectPattern: '',
      attachmentOnly: true, targetFolder: '', filenamePattern: '{date}_{entity}_{original}',
      entityId: null, enabled: true, timesApplied: 0, lastAppliedAt: null,
    } as ArchiveRule;
    setEditing(stub);
    form.setFieldsValue(stub);
  };

  const openEdit = (r: ArchiveRule) => {
    setEditing(r);
    form.setFieldsValue(r);
  };

  const save = async () => {
    const v = await form.validateFields();
    try {
      if (editing && editing.id) await updateArchiveRule(editing.id, v);
      else await createArchiveRule(v);
      message.success('Gravado');
      setEditing(null);
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message);
    }
  };

  const del = async (id: string) => {
    await deleteArchiveRule(id);
    message.success('Apagada');
    load();
  };

  const toggle = async (r: ArchiveRule, enabled: boolean) => {
    await updateArchiveRule(r.id, { enabled });
    load();
  };

  return (
    <Drawer open={open} onClose={onClose} title="Regras do OneDrive" width={560} extra={<Button type="primary" icon={<PlusOutlined />} onClick={openNew}>Nova</Button>}>
      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 12 }}>
        Emails novos com anexos sao verificados contra as regras. Quando ha match, os anexos vao para a pasta indicada em OneDrive (criada se nao existir).
      </div>
      <List
        dataSource={rules}
        locale={{ emptyText: 'Sem regras. Cria a primeira (ex: remetente "indaqua" -> Faturas/Indaqua).' }}
        renderItem={(r) => (
          <List.Item
            actions={[
              <Switch size="small" checked={r.enabled} onChange={(v) => toggle(r, v)} />,
              <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />,
              <Popconfirm title={`Apagar ${r.name}?`} onConfirm={() => del(r.id)} okText="Apagar" cancelText="Cancelar" okButtonProps={{ danger: true }}>
                <Button type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={<Space>{r.name}{r.entity && <Tag color={r.entity.color || 'blue'}>{r.entity.name}</Tag>}{r.timesApplied > 0 && <Tag color="green">{r.timesApplied}x</Tag>}</Space>}
              description={
                <div style={{ fontSize: 12 }}>
                  <div>De contem: <b>{r.senderPattern || '*'}</b> · Assunto contem: <b>{r.subjectPattern || '*'}</b></div>
                  <div>Destino: <code>{r.targetFolder}</code> · Nome: <code>{r.filenamePattern || '{original}'}</code></div>
                </div>
              }
            />
          </List.Item>
        )}
      />

      <Modal
        open={editing !== null}
        title={editing?.id ? 'Editar regra' : 'Nova regra'}
        onOk={save}
        onCancel={() => setEditing(null)}
        okText="Gravar"
        cancelText="Cancelar"
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Nome" name="name" rules={[{ required: true }]}>
            <Input placeholder="ex: Faturas Indaqua" />
          </Form.Item>
          <Form.Item label="Remetente contem (vazio = qualquer)" name="senderPattern">
            <Input placeholder="indaqua" />
          </Form.Item>
          <Form.Item label="Assunto contem (vazio = qualquer)" name="subjectPattern">
            <Input placeholder="fatura" />
          </Form.Item>
          <Form.Item label="Pasta destino (sob /Assistente/)" name="targetFolder" rules={[{ required: true }]}>
            <Input placeholder="Faturas/Indaqua" />
          </Form.Item>
          <Form.Item label="Padrao de nome de ficheiro" name="filenamePattern" help="Tokens: {date} {entity} {subject} {original} {ext}">
            <Input placeholder="{date}_{entity}_{original}" />
          </Form.Item>
          <Form.Item label="Entidade (opcional)" name="entityId">
            <Select allowClear placeholder="(nenhuma)">
              {entities.map((e) => <Select.Option key={e.id} value={e.id}>{e.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item label="Activa" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}
