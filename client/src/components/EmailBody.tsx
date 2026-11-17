import { useEffect, useRef, useState } from 'react';
import { Spin } from 'antd';
import { getEmailBody } from '../api';

export default function EmailBody({ emailId, fallbackPreview }: { emailId: string; fallbackPreview?: string | null }) {
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState<{ contentType: 'html' | 'text'; content: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setBody(null); setErr(null);
    getEmailBody(emailId)
      .then((b) => { if (!cancelled) setBody(b); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.error || e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [emailId]);

  // When HTML body arrives, write it into the iframe via srcdoc + sandbox (no scripts, no top-level nav)
  useEffect(() => {
    if (!body || body.contentType !== 'html' || !iframeRef.current) return;
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <base target="_blank">
      <style>
        body{font:13px -apple-system,Segoe UI,Roboto,sans-serif;color:#222;margin:0;padding:8px;background:#fff;word-wrap:break-word;overflow-wrap:break-word}
        img{max-width:100%;height:auto}
        a{color:#1677ff;word-break:break-all}
        table{max-width:100% !important;}
        blockquote{border-left:3px solid #ddd;margin:8px 0;padding-left:10px;color:#666}
        pre{white-space:pre-wrap;word-wrap:break-word}
      </style>
    </head><body>${body.content}</body></html>`;
    const iframe = iframeRef.current;
    iframe.srcdoc = html;
    // Auto-size to content after load
    const resize = () => {
      try {
        const h = iframe.contentDocument?.body?.scrollHeight;
        if (h) iframe.style.height = h + 20 + 'px';
      } catch { /* cross-origin — skip */ }
    };
    iframe.onload = resize;
    const t = setTimeout(resize, 400);
    return () => { clearTimeout(t); };
  }, [body]);

  if (loading) return <div style={{ padding: 20, textAlign: 'center' }}><Spin /></div>;
  if (err) {
    return (
      <div>
        <div style={{ fontSize: 12, color: '#c00', marginBottom: 8 }}>Nao foi possivel carregar o conteudo: {err}</div>
        <div style={{ fontSize: 13, color: '#555', whiteSpace: 'pre-wrap' }}>{fallbackPreview || ''}</div>
      </div>
    );
  }
  if (!body) return null;

  if (body.contentType === 'html') {
    return (
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin allow-popups"
        style={{ width: '100%', border: 'none', background: '#fff' }}
        title="Email body"
      />
    );
  }
  return <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{body.content}</div>;
}
