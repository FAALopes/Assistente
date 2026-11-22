import { useEffect, useRef, useState } from 'react';
import { Modal, Input, Select, Spin, Tooltip, message } from 'antd';
import {
  BoldOutlined, ItalicOutlined, UnderlineOutlined, StrikethroughOutlined,
  UnorderedListOutlined, OrderedListOutlined, FontColorsOutlined, HighlightOutlined, ClearOutlined,
} from '@ant-design/icons';
import { getComposeDefaults, sendComposed } from '../api';
import type { Email } from '../types';

export type ComposeMode = 'reply' | 'replyAll' | 'forward';

const TITLES: Record<ComposeMode, string> = {
  reply: 'Responder',
  replyAll: 'Responder a todos',
  forward: 'Reencaminhar',
};

const TEXT_COLORS = ['#000000', '#f5222d', '#fa8c16', '#52c41a', '#1677ff', '#722ed1'];
const MARK_COLORS = ['#fff566', '#b7eb8f', '#91caff', '#ffadd2', 'transparent'];

// Toolbar button: onMouseDown + preventDefault keeps the selection inside the editor
function Tb({ title, onRun, children }: { title: string; onRun: () => void; children: React.ReactNode }) {
  return (
    <Tooltip title={title} mouseEnterDelay={0.5}>
      <span
        onMouseDown={(e) => { e.preventDefault(); onRun(); }}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 26, borderRadius: 4, cursor: 'pointer', fontSize: 14 }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {children}
      </span>
    </Tooltip>
  );
}

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
  const editorRef = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<'fore' | 'mark' | null>(null);
  const cmd = (name: string, value?: string) => { editorRef.current?.focus(); document.execCommand(name, false, value); };

  useEffect(() => {
    if (!email || !mode) return;
    setTo([]); setCc([]); setSubject(''); setFrom(''); setPalette(null);
    if (editorRef.current) editorRef.current.innerHTML = '';
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
      const html = editorRef.current?.innerHTML || '';
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
        <div style={{ border: '1px solid #d9d9d9', borderRadius: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '3px 6px', borderBottom: '1px solid #f0f0f0', position: 'relative' }}>
            <Tb title="Negrito (Ctrl+B)" onRun={() => cmd('bold')}><BoldOutlined /></Tb>
            <Tb title="Itálico (Ctrl+I)" onRun={() => cmd('italic')}><ItalicOutlined /></Tb>
            <Tb title="Sublinhado (Ctrl+U)" onRun={() => cmd('underline')}><UnderlineOutlined /></Tb>
            <Tb title="Rasurado" onRun={() => cmd('strikeThrough')}><StrikethroughOutlined /></Tb>
            <span style={{ width: 1, height: 18, background: '#e8e8e8', margin: '0 4px' }} />
            <Tb title="Lista com marcas" onRun={() => cmd('insertUnorderedList')}><UnorderedListOutlined /></Tb>
            <Tb title="Lista numerada" onRun={() => cmd('insertOrderedList')}><OrderedListOutlined /></Tb>
            <span style={{ width: 1, height: 18, background: '#e8e8e8', margin: '0 4px' }} />
            <Tb title="Cor do texto" onRun={() => setPalette(palette === 'fore' ? null : 'fore')}><FontColorsOutlined /></Tb>
            <Tb title="Realce" onRun={() => setPalette(palette === 'mark' ? null : 'mark')}><HighlightOutlined /></Tb>
            <Tb title="Limpar formatação" onRun={() => cmd('removeFormat')}><ClearOutlined /></Tb>
            {palette && (
              <span style={{ display: 'inline-flex', gap: 6, marginLeft: 8, alignItems: 'center' }}>
                {(palette === 'fore' ? TEXT_COLORS : MARK_COLORS).map((c) => (
                  <span
                    key={c}
                    title={c === 'transparent' ? 'Sem realce' : undefined}
                    onMouseDown={(e) => { e.preventDefault(); cmd(palette === 'fore' ? 'foreColor' : 'hiliteColor', c); setPalette(null); }}
                    style={{ width: 18, height: 18, borderRadius: 4, background: c, border: c === 'transparent' ? '1px dashed #bfbfbf' : '1px solid rgba(0,0,0,0.15)', cursor: 'pointer' }}
                  />
                ))}
              </span>
            )}
          </div>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            style={{ minHeight: 220, maxHeight: 440, overflowY: 'auto', padding: '8px 11px', outline: 'none', fontSize: 14, lineHeight: 1.5 }}
          />
        </div>
        <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 6 }}>
          O email original segue citado por baixo do texto
          {mode === 'forward' ? ', com os anexos.' : '.'}
        </div>
      </Spin>
    </Modal>
  );
}

export default ComposeModal;
