import { useEffect, useState } from 'react';
import { Modal, Input, Select, Spin, message } from 'antd';
import { getComposeDefaults, sendComposed } from '../api';
import type { Email } from '../types';

export type ComposeMode = 'reply' | 'replyAll' | 'forward';

const TITLES: Record<ComposeMode, string> = {
  reply: 'Responder',
  replyAll: 'Responder a todos',
  forward: 'Reencaminhar',
};

const escapeHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Props {
  email: Email | null;
  mode: ComposeMode | null;
  onClose: () => void;
  onSent: () => void;
}

/** Write and send a reply / forward from the app. The original message is quoted by the server. */
function ComposeModal({ email, mode, onClose, onSent }: Props) {
  const open = !!email && !!mode;
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    if (!email || !mode) return;
    setTo([]); setCc([]); setSubject(''); setText(''); setFrom('');
    setLoading(true);
    getComposeDefaults(email.id, mode)
      .then((d) => { setTo(d.to); setCc(d.cc); setSubject(d.subject); setFrom(d.from); })
      .catch((e) => message.error(e?.response?.data?.error || 'Erro ao preparar a resposta'))
      .finally(() => setLoading(false));
  }, [email?.id, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!email || !mode) return;
    setSending(true);
    try {
      const html = escapeHtml(text).replace(/\r?\n/g, '<br>');
      await sendComposed(email.id, { mode, to, cc, subject, html });
      message.success('Email enviado');
      onSent();
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Erro ao enviar', 10);
    } finally {
      setSending(false);
    }
  };

  const label: React.CSSProperties = { width: 62, fontSize: 12, color: '#595959', flexShrink: 0 };
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };

  return (
    <Modal
      title={mode ? TITLES[mode] : ''}
      open={open}
      onCancel={() => !sending && onClose()}
      onOk={send}
      okText="Enviar"
      cancelText="Cancelar"
      okButtonProps={{ disabled: loading || to.length === 0, loading: sending }}
      cancelButtonProps={{ disabled: sending }}
      maskClosable={false}
      destroyOnClose
      width={720}
    >
      <Spin spinning={loading}>
        <div style={row}><span style={label}>De</span><span style={{ fontSize: 13 }}>{from}</span></div>
        <div style={row}>
          <span style={label}>Para</span>
          <Select mode="tags" open={false} suffixIcon={null} style={{ flex: 1 }} value={to} onChange={setTo}
            tokenSeparators={[',', ';', ' ']} placeholder="Endereços (Enter, vírgula ou espaço para separar)" />
        </div>
        <div style={row}>
          <span style={label}>Cc</span>
          <Select mode="tags" open={false} suffixIcon={null} style={{ flex: 1 }} value={cc} onChange={setCc}
            tokenSeparators={[',', ';', ' ']} />
        </div>
        <div style={row}>
          <span style={label}>Assunto</span>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <Input.TextArea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoSize={{ minRows: 10, maxRows: 22 }}
          placeholder="Escrever a mensagem..."
        />
        <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 6 }}>
          O email original segue citado por baixo do texto
          {mode === 'forward' ? ', com os anexos.' : '.'}
        </div>
      </Spin>
    </Modal>
  );
}

export default ComposeModal;
