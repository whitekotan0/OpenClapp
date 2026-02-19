import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect, useRef } from 'react';

// Строгая типизация структур данных в памяти V8
interface Message {
  role: 'user' | 'agent' | 'system';
  text: string;
}

interface TermLine {
  text: string;
  type: 'input' | 'output' | 'error';
}

function App() {
  const [tab, setTab] = useState<'chat' | 'terminal' | 'settings' | 'godmode'>('chat');
  const [status, setStatus] = useState('stopped');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  
  const [termLines, setTermLines] = useState<TermLine[]>([]);
  const [termInput, setTermInput] = useState('');
  
  const [internals, setInternals] = useState(''); 

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const termBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<string>('load_api_key').then(key => {
      if (key) { setApiKey(key); setSaved(true); }
    });
  }, []);

  useEffect(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);
  useEffect(() => termBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [termLines]);

  async function start() {
    try {
      await invoke('start_agent');
      setStatus('running');
    } catch (err: any) {
      alert(`Ошибка старта: ${err}`);
    }
  }

  async function stop() {
    await invoke('stop_agent');
    setStatus('stopped');
  }

  async function saveKey() {
    await invoke('save_api_key', { key: apiKey });
    setSaved(true);
  }

  // --- THE FAST CHAT (WEBSOCKETS) ---
  async function sendMessage() {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setInput('');

    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);

    try {
      const idempotencyKey =
        globalThis.crypto?.randomUUID?.() ??
        (String(Date.now()) + '-' + Math.random().toString(16).slice(2));

      const raw = await invoke<string>('gateway_call', {
        method: 'agent',
        params: JSON.stringify({
          message: userMsg,
          sessionKey: 'main',
          idempotencyKey,
          deliver: false,
        }),
      });

      const payload: any = JSON.parse(raw);

      const payloads = Array.isArray(payload?.result?.payloads)
        ? payload.result.payloads
        : [];

      const parts = payloads
        .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
        .filter((s: string) => s.trim().length > 0);

      const text =
        (parts.length ? parts.join('\n\n') : '') ||
        payload?.result?.summary ||
        payload?.summary ||
        payload?.error ||
        '[agent returned no text]';

      setMessages(prev => [...prev, { role: 'agent', text }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'system', text: `������: ${err}` }]);
    }
  }

  async function runTermCmd() {
    if (!termInput.trim()) return;
    const cmd = termInput.trim();
    setTermInput('');
    setTermLines(prev => [...prev, { text: '> ' + cmd, type: 'input' }]);
    
    try {
      const result = await invoke<string>('run_command', { cmd });
      setTermLines(prev => [...prev, { text: result || '(пусто)', type: 'output' }]);
    } catch (err: any) {
      setTermLines(prev => [...prev, { text: `[Rust Error]: ${err}`, type: 'error' }]);
    }
  }

  async function scanInternals() {
    try {
      const result = await invoke<string>('get_bot_internals');
      setInternals(result);
    } catch (err: any) {
      setInternals(`Ошибка чтения диска: ${err}`);
    }
  }

  const tabStyle = (t: string) => ({
    padding: '6px 16px', cursor: 'pointer', background: 'none',
    fontWeight: tab === t ? 'bold' : 'normal',
    border: 'none', borderBottom: tab === t ? '2px solid #0078ff' : '2px solid transparent',
    fontSize: 14,
  } as React.CSSProperties);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      
      {/* --- ШАПКА --- */}
      <div style={{ padding: '12px 20px 0', borderBottom: '1px solid #eee' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Clapp 🦞</h2>
          <div>
            <span style={{ marginRight: 8, fontSize: 13 }}>
              Agent Daemon: <b style={{ color: status === 'running' ? 'green' : 'red' }}>{status}</b>
            </span>
            <button onClick={start} disabled={status === 'running'}>Start</button>
            <button onClick={stop} disabled={status === 'stopped'} style={{ marginLeft: 6 }}>Stop</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={tabStyle('chat')} onClick={() => setTab('chat')}>Chat</button>
          <button style={tabStyle('terminal')} onClick={() => setTab('terminal')}>Terminal</button>
          <button style={tabStyle('godmode')} onClick={() => setTab('godmode')}>God Mode</button>
          <button style={tabStyle('settings')} onClick={() => setTab('settings')}>Settings</button>
        </div>
      </div>

      {/* --- ВКЛАДКА: CHAT --- */}
      {tab === 'chat' && (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 8, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                <span style={{
                  display: 'inline-block',
                  background: m.role === 'user' ? '#0078ff' : m.role === 'system' ? '#ff4444' : '#f0f0f0',
                  color: m.role === 'user' || m.role === 'system' ? '#fff' : '#000',
                  padding: '6px 12px', borderRadius: 16, maxWidth: '70%', wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap'
                }}>
                  {m.text}
                </span>
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>
          <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #eee' }}>
            <input
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #ccc' }}
              placeholder="Write to local daemon (WS)..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
            />
            <button onClick={sendMessage} style={{ padding: '8px 16px' }}>Send</button>
          </div>
        </>
      )}

      {/* --- ВКЛАДКА: TERMINAL --- */}
      {tab === 'terminal' && (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#1e1e1e', fontFamily: 'monospace' }}>
            {termLines.map((l, i) => (
              <div key={i} style={{ color: l.type === 'input' ? '#4fc3f7' : l.type === 'error' ? '#ff5555' : '#fff', marginBottom: 4, whiteSpace: 'pre-wrap' }}>
                {l.text}
              </div>
            ))}
            <div ref={termBottomRef} />
          </div>
          <div style={{ display: 'flex', gap: 8, padding: 12, background: '#1e1e1e', borderTop: '1px solid #333' }}>
            <span style={{ color: '#4fc3f7', fontFamily: 'monospace', lineHeight: '32px' }}>{'>'}</span>
            <input
              style={{ flex: 1, padding: '6px 12px', background: '#2d2d2d', border: '1px solid #444', color: '#fff', borderRadius: 6, fontFamily: 'monospace' }}
              placeholder="Системная команда..."
              value={termInput}
              onChange={e => setTermInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runTermCmd()}
            />
            <button onClick={runTermCmd} style={{ padding: '6px 16px' }}>Run</button>
          </div>
        </>
      )}

      {/* --- ВКЛАДКА: GOD MODE (Внутренности) --- */}
      {tab === 'godmode' && (
        <div style={{ padding: 20, flex: 1, overflowY: 'auto', background: '#fafafa' }}>
          <h3 style={{ marginTop: 0 }}>Внутренности Агента (God Mode)</h3>
          <p style={{ fontSize: 13, color: '#555' }}>
            Прямое чтение директории <code>~/.openclaw</code> через системные вызовы Rust.
          </p>
          <button 
            onClick={scanInternals}
            style={{ padding: '8px 16px', background: '#333', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Просканировать ядро ОС
          </button>
          
          <pre style={{ 
            marginTop: 16, padding: 16, background: '#1e1e1e', 
            color: '#a5d6ff', borderRadius: 8, whiteSpace: 'pre-wrap',
            fontFamily: 'monospace', fontSize: 13, border: '1px solid #333'
          }}>
            {internals || 'Нажми кнопку сканирования, чтобы поднять байты с диска...'}
          </pre>
        </div>
      )}

      {/* --- ВКЛАДКА: SETTINGS --- */}
      {tab === 'settings' && (
        <div style={{ padding: 20 }}>
          <h3>API Key</h3>
          <p style={{ fontSize: 12, color: '#666' }}>Сохраняется локально. Пробрасывается в изолированную память (Environment Block) демона.</p>
          <input
            type="password"
            placeholder="sk-ant-api03-..."
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setSaved(false); }}
            style={{ width: 300, marginRight: 8, padding: '6px 10px' }}
          />
          <button onClick={saveKey}>Save</button>
          {saved && <span style={{ color: 'green', marginLeft: 8, fontWeight: 'bold' }}>✔ Сохранено</span>}
        </div>
      )}
    </div>
  );
}

export default App;