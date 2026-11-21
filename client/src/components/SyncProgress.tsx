import { useEffect, useRef, useState } from 'react';
import { Button, Progress, Tooltip } from 'antd';
import { SyncOutlined, MinusOutlined, CloseOutlined, ExpandAltOutlined } from '@ant-design/icons';

interface Props {
  jobId: string | null;
  title: string;
  accountLine: string;
  folderLine: string;
  pct: number;
  progressText: string;
  footerLeft: string;
  elapsed: string;
  onCancel: () => void;
}

type Pos = { x: number; y: number } | null;
const POS_KEY = 'syncProgressPos';
const MIN_KEY = 'syncProgressMin';

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}

/** Sync progress panel: drag it by the header, minimize it to a pill, or hide it for this sync. */
function SyncProgress(p: Props) {
  const [pos, setPos] = useState<Pos>(() => load<Pos>(POS_KEY, null));
  const [min, setMin] = useState<boolean>(() => load<boolean>(MIN_KEY, false));
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current || !boxRef.current) return;
      const w = boxRef.current.offsetWidth, h = boxRef.current.offsetHeight;
      const x = Math.max(0, Math.min(window.innerWidth - w, e.clientX - drag.current.dx));
      const y = Math.max(0, Math.min(window.innerHeight - h, e.clientY - drag.current.dy));
      setPos({ x, y });
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.userSelect = '';
      setPos((cur) => { save(POS_KEY, cur); return cur; });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = boxRef.current!.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    document.body.style.userSelect = 'none';
  };

  const setMinimized = (v: boolean) => { setMin(v); save(MIN_KEY, v); };

  if (hiddenFor !== null && hiddenFor === (p.jobId || '')) return null;

  const place: React.CSSProperties = pos
    ? { left: Math.min(pos.x, Math.max(0, window.innerWidth - 120)), top: Math.min(pos.y, Math.max(0, window.innerHeight - 60)) }
    : min
      ? { right: 24, bottom: 24 }
      : { bottom: 24, left: '50%', transform: 'translateX(-50%)' };

  const iconBtn = (title: string, icon: React.ReactNode, onClick: () => void) => (
    <Tooltip title={title}><Button type="text" size="small" icon={icon} onClick={onClick} /></Tooltip>
  );

  if (min) {
    return (
      <div
        ref={boxRef}
        onMouseDown={startDrag}
        style={{
          position: 'fixed', ...place, zIndex: 1500, background: '#fff', borderRadius: 20,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)', border: '1px solid #e8e8e8',
          padding: '4px 6px 4px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'move',
        }}
      >
        <SyncOutlined spin style={{ color: '#1677ff' }} />
        <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>A sincronizar · {p.pct}%</span>
        {iconBtn('Expandir', <ExpandAltOutlined />, () => setMinimized(false))}
        {iconBtn('Esconder até ao fim desta sincronização', <CloseOutlined />, () => setHiddenFor(p.jobId || ''))}
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      style={{
        position: 'fixed', ...place, width: 'min(720px, calc(100vw - 48px))', background: '#fff',
        borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', border: '1px solid #e8e8e8',
        padding: '14px 18px', zIndex: 1500,
      }}
    >
      <div onMouseDown={startDrag} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, cursor: 'move' }}>
        <SyncOutlined spin style={{ color: '#1677ff', fontSize: 18 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{p.title}</div>
          <div style={{ fontSize: 12, color: '#595959', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.accountLine}
          </div>
          {p.folderLine && (
            <div style={{ fontSize: 11, color: '#8c8c8c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.folderLine}
            </div>
          )}
        </div>
        {p.jobId && <Button size="small" danger onClick={p.onCancel}>Cancelar</Button>}
        {iconBtn('Minimizar', <MinusOutlined />, () => setMinimized(true))}
        {iconBtn('Esconder até ao fim desta sincronização', <CloseOutlined />, () => setHiddenFor(p.jobId || ''))}
      </div>
      <Progress percent={p.pct} size="small" status="active" format={() => p.progressText} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#595959', marginTop: 4 }}>
        <span>{p.footerLeft}</span>
        <span>{p.elapsed}</span>
      </div>
    </div>
  );
}

export default SyncProgress;
