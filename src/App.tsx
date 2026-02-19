import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message { role: 'user' | 'agent' | 'system'; text: string; }
interface TermLine { text: string; type: 'input' | 'output' | 'error'; }

interface Agent {
  id: string;       // уникальный id, используется как sessionKey и agent_id в Rust
  name: string;
  provider: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
  },
];

const STORAGE_KEY = 'clapp_agents_v2';

// ─── Storage ──────────────────────────────────────────────────────────────────

function loadAgents(): Agent[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); }
  catch { return []; }
}

function persistAgents(agents: Agent[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
}

function makeId(): string {
  return 'ag_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function blankAgent(): Agent {
  return {
    id: makeId(),
    name: '',
    provider: 'anthropic',
    apiKey: '',
    model: 'claude-opus-4-5',
    systemPrompt: 'You are a helpful assistant.',
  };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  app: { display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: "'DM Sans', sans-serif", background: '#f6f7f9' } as React.CSSProperties,
  header: { padding: '0 20px', borderBottom: '1px solid #e8e8e8', background: '#fff', display: 'flex', alignItems: 'center', minHeight: 52 } as React.CSSProperties,
  logo: { fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px', color: '#111', marginRight: 24, display: 'flex', alignItems: 'center', gap: 6 } as React.CSSProperties,

  tab: (active: boolean) => ({
    padding: '16px 14px 14px', cursor: 'pointer', background: 'none', border: 'none',
    fontSize: 13, fontWeight: active ? 700 : 400, color: active ? '#111' : '#888',
    borderBottom: active ? '2px solid #111' : '2px solid transparent',
  } as React.CSSProperties),

  dot: (ok: boolean) => ({
    width: 8, height: 8, borderRadius: '50%',
    background: ok ? '#22c55e' : '#ef4444',
    boxShadow: ok ? '0 0 0 2px #bbf7d0' : '0 0 0 2px #fecaca',
    flexShrink: 0,
  } as React.CSSProperties),

  btn: (v: 'primary' | 'ghost' | 'danger' | 'outline' = 'primary', sm = false) => ({
    padding: sm ? '5px 12px' : '8px 18px', border: v === 'outline' ? '1px solid #d1d5db' : 'none',
    borderRadius: 8, cursor: 'pointer', fontSize: sm ? 12 : 13, fontWeight: 600,
    background: v === 'primary' ? '#111' : v === 'danger' ? '#ef4444' : v === 'outline' ? '#fff' : '#f3f4f6',
    color: v === 'primary' || v === 'danger' ? '#fff' : '#111',
    whiteSpace: 'nowrap' as const, transition: 'opacity .15s',
  } as React.CSSProperties),

  card: { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 } as React.CSSProperties,
  label: { fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4, display: 'block' } as React.CSSProperties,
  hint: { fontSize: 11, color: '#aaa', marginTop: 3 } as React.CSSProperties,

  input: (err?: boolean) => ({
    width: '100%', padding: '9px 12px', border: `1px solid ${err ? '#ef4444' : '#e0e0e0'}`,
    borderRadius: 8, fontSize: 14, background: '#fff', outline: 'none',
    boxSizing: 'border-box' as const, fontFamily: 'inherit',
  } as React.CSSProperties),

  textarea: {
    width: '100%', padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8,
    fontSize: 13, background: '#fff', outline: 'none', boxSizing: 'border-box' as const,
    fontFamily: 'inherit', resize: 'vertical' as const, minHeight: 80,
  } as React.CSSProperties,

  select: {
    width: '100%', padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8,
    fontSize: 14, background: '#fff', outline: 'none', boxSizing: 'border-box' as const,
    fontFamily: 'inherit', cursor: 'pointer',
  } as React.CSSProperties,

  row: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  page: { flex: 1, overflowY: 'auto' as const, padding: 24 },

  toast: (ok: boolean) => ({
    padding: '10px 14px', borderRadius: 8, fontSize: 13,
    background: ok ? '#ecfdf5' : '#fef2f2',
    color: ok ? '#065f46' : '#991b1b',
    border: `1px solid ${ok ? '#a7f3d0' : '#fecaca'}`,
    marginBottom: 16,
  } as React.CSSProperties),
};

// ─── Agent Form ───────────────────────────────────────────────────────────────

function AgentForm({ initial, onSave, onCancel, onDelete }: {
  initial: Agent;
  onSave: (a: Agent) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [form, setForm] = useState<Agent>(initial);
  const [showKey, setShowKey] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Agent) => (e: React.ChangeEvent<any>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const provider = PROVIDERS.find(p => p.id === form.provider) ?? PROVIDERS[0];

  async function submit() {
    const errs: Record<string, boolean> = {};
    if (!form.name.trim()) errs.name = true;
    if (!form.apiKey.trim()) errs.apiKey = true;
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      // Синхронизируем auth-profile на диске чтобы openclaw знал ключ
      await invoke('sync_agent_auth', {
  agentId: form.id,
  apiKey: form.apiKey,
  agentName: form.name,
  systemPrompt: form.systemPrompt,
});
      onSave({ ...form, name: form.name.trim() });
    } catch (e: any) {
      alert(`Ошибка сохранения: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={S.row}>
        <label style={S.label}>Имя агента</label>
        <input style={S.input(errors.name)} placeholder="Мой помощник" value={form.name} onChange={set('name')} />
        {errors.name && <span style={{ fontSize: 11, color: '#ef4444' }}>Обязательное поле</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={S.row}>
          <label style={S.label}>Провайдер</label>
          <select style={S.select} value={form.provider} onChange={set('provider')}>
            {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div style={S.row}>
          <label style={S.label}>Модель</label>
          <select style={S.select} value={form.model} onChange={set('model')}>
            {provider.models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <div style={S.row}>
        <label style={S.label}>API ключ</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...S.input(errors.apiKey), flex: 1 }}
            type={showKey ? 'text' : 'password'}
            placeholder="sk-ant-api03-..."
            value={form.apiKey}
            onChange={set('apiKey')}
          />
          <button style={S.btn('outline', true)} onClick={() => setShowKey(v => !v)}>
            {showKey ? 'Скрыть' : 'Показать'}
          </button>
        </div>
        {errors.apiKey && <span style={{ fontSize: 11, color: '#ef4444' }}>Обязательное поле</span>}
        <span style={S.hint}>Ключ хранится только на этом устройстве</span>
      </div>

      <div style={S.row}>
        <label style={S.label}>Инструкция <span style={{ fontWeight: 400, color: '#aaa' }}>(необязательно)</span></label>
        <textarea
          style={S.textarea}
          placeholder="Ты помощник компании X. Отвечай кратко..."
          value={form.systemPrompt}
          onChange={set('systemPrompt')}
          rows={3}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <button style={S.btn('primary')} onClick={submit} disabled={saving}>
          {saving ? 'Сохраняем...' : onDelete ? 'Сохранить' : 'Создать агента'}
        </button>
        <button style={S.btn('ghost')} onClick={onCancel} disabled={saving}>Отмена</button>
        {onDelete && (
          <button style={{ ...S.btn('danger'), marginLeft: 'auto' }} onClick={onDelete} disabled={saving}>
            Удалить
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState<'agents' | 'chat' | 'terminal' | 'settings'>('agents');

  // Gateway
  const [gatewayStatus, setGatewayStatus] = useState<'stopped' | 'starting' | 'running' | 'error'>('stopped');
  const [gatewayError, setGatewayError] = useState('');

  // Chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Terminal
  const [termLines, setTermLines] = useState<TermLine[]>([]);
  const [termInput, setTermInput] = useState('');
  const termBottomRef = useRef<HTMLDivElement>(null);

  // Agents
  const [agents, setAgents] = useState<Agent[]>(loadAgents);
  const [agentView, setAgentView] = useState<'list' | 'create' | 'edit'>('list');
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(() => loadAgents()[0]?.id ?? null);

  // Sync
  useEffect(() => persistAgents(agents), [agents]);
  useEffect(() => { if (!activeAgentId && agents.length) setActiveAgentId(agents[0].id); }, [agents]);
  useEffect(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);
  useEffect(() => termBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [termLines]);

  // Периодически проверяем статус gateway
  useEffect(() => {
    let alive = true;
    async function poll() {
      if (!alive) return;
      try {
        const s = await invoke<string>('gateway_status');
        if (alive) setGatewayStatus(s === 'running' ? 'running' : 'stopped');
      } catch { /* ignore */ }
      if (alive) setTimeout(poll, 5000);
    }
    poll();
    return () => { alive = false; };
  }, []);

  const activeAgent = agents.find(a => a.id === activeAgentId) ?? null;
  const running = gatewayStatus === 'running';

  // ── Agents CRUD ──────────────────────────────────────────────────────────────

  function saveAgent(a: Agent) {
    setAgents(prev =>
      prev.find(x => x.id === a.id)
        ? prev.map(x => x.id === a.id ? a : x)
        : [...prev, a]
    );
    if (!activeAgentId) setActiveAgentId(a.id);
    setAgentView('list');
  }

  function removeAgent(id: string) {
    if (!confirm('Удалить агента?')) return;
    const next = agents.filter(a => a.id !== id);
    setAgents(next);
    if (activeAgentId === id) setActiveAgentId(next[0]?.id ?? null);
    setAgentView('list');
  }

  // ── Gateway ──────────────────────────────────────────────────────────────────

  async function startGateway() {
    setGatewayStatus('starting');
    setGatewayError('');
    try {
      await invoke('start_agent'); // возвращает "running" или кидает ошибку
      setGatewayStatus('running');
    } catch (e: any) {
      setGatewayStatus('error');
      setGatewayError(String(e));
    }
  }

  async function stopGateway() {
    try {
      await invoke('stop_agent');
      setGatewayStatus('stopped');
    } catch (e: any) {
      alert(`Ошибка остановки: ${e}`);
    }
  }

  // ── Chat ─────────────────────────────────────────────────────────────────────

  async function sendMessage() {
    if (!input.trim() || !activeAgent || sending) return;
    if (!running) {
      setMessages(prev => [...prev, { role: 'system', text: 'Сначала запусти Gateway (кнопка вверху справа)' }]);
      return;
    }

    const text = input.trim();
    setInput('');
    setSending(true);
    setMessages(prev => [...prev, { role: 'user', text }]);

    try {
      const raw = await invoke<string>('gateway_call', {
        agentId: activeAgent.id,
        message: text,
        sessionKey: activeAgent.id,
      });

      const payload: any = JSON.parse(raw);
      const payloads = Array.isArray(payload?.result?.payloads) ? payload.result.payloads : [];
      const parts = payloads.map((p: any) => p?.text ?? '').filter((s: string) => s.trim());
      const reply = parts.join('\n\n') || payload?.result?.summary || payload?.error || '[нет ответа от агента]';
      setMessages(prev => [...prev, { role: 'agent', text: reply }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'system', text: `Ошибка: ${e}` }]);
    } finally {
      setSending(false);
    }
  }

  // ── Terminal ─────────────────────────────────────────────────────────────────

  async function runTermCmd() {
    if (!termInput.trim()) return;
    const cmd = termInput.trim();
    setTermInput('');
    setTermLines(prev => [...prev, { text: '> ' + cmd, type: 'input' }]);
    try {
      const result = await invoke<string>('run_command', { cmd });
      setTermLines(prev => [...prev, { text: result || '(пусто)', type: 'output' }]);
    } catch (e: any) {
      setTermLines(prev => [...prev, { text: `Ошибка: ${e}`, type: 'error' }]);
    }
  }

  // ── Gateway status label ──────────────────────────────────────────────────────

  const statusLabel = gatewayStatus === 'starting' ? 'Запускаем...' : gatewayStatus === 'running' ? 'Работает' : gatewayStatus === 'error' ? 'Ошибка' : 'Остановлен';
  const statusColor = gatewayStatus === 'running' ? '#22c55e' : gatewayStatus === 'starting' ? '#f59e0b' : '#ef4444';

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <div style={S.app}>

        {/* HEADER */}
        <div style={S.header}>
          <div style={S.logo}>🦞 Clapp</div>

          {(['agents', 'chat', 'terminal', 'settings'] as const).map(t => (
            <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
              {t === 'agents' ? 'Агенты' : t === 'chat' ? 'Чат' : t === 'terminal' ? 'Терминал' : 'Настройки'}
            </button>
          ))}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#888' }}>{statusLabel}</span>
            {running
              ? <button style={S.btn('outline', true)} onClick={stopGateway}>Стоп</button>
              : <button style={S.btn('primary', true)} onClick={startGateway} disabled={gatewayStatus === 'starting'}>
                  {gatewayStatus === 'starting' ? '...' : 'Запустить'}
                </button>
            }
          </div>
        </div>

        {/* Gateway error banner */}
        {gatewayStatus === 'error' && gatewayError && (
          <div style={{ padding: '10px 20px', background: '#fef2f2', borderBottom: '1px solid #fecaca', fontSize: 13, color: '#991b1b', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span>⚠️</span>
            <span style={{ flex: 1 }}>{gatewayError}</span>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', fontSize: 16 }} onClick={() => setGatewayError('')}>✕</button>
          </div>
        )}

        {/* ── AGENTS ── */}
        {tab === 'agents' && (
          <div style={S.page}>
            {agentView === 'list' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Агенты</h2>
                  <button
                    style={{ ...S.btn('primary', true), marginLeft: 'auto' }}
                    onClick={() => { setEditingAgent(blankAgent()); setAgentView('create'); }}
                  >
                    + Новый агент
                  </button>
                </div>

                {agents.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#aaa' }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
                    <div style={{ fontSize: 15, marginBottom: 20 }}>Нет агентов. Создай первого!</div>
                    <button style={S.btn('primary')} onClick={() => { setEditingAgent(blankAgent()); setAgentView('create'); }}>
                      Создать агента
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
                    {agents.map(agent => {
                      const isActive = agent.id === activeAgentId;
                      return (
                        <div key={agent.id} style={{
                          ...S.card,
                          border: isActive ? '1.5px solid #111' : '1px solid #e8e8e8',
                        }}>
                          <div style={{
                            width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                            background: isActive ? '#111' : '#f0f0f0',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                          }}>🤖</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>{agent.name}</div>
                            <div style={{ fontSize: 12, color: '#888', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                              <span>{PROVIDERS.find(p => p.id === agent.provider)?.label}</span>
                              <span>·</span>
                              <span>{agent.model}</span>
                              <span>·</span>
                              <span style={{ color: agent.apiKey ? '#22c55e' : '#ef4444' }}>
                                {agent.apiKey ? '🔑 Ключ есть' : '⚠️ Нет ключа'}
                              </span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            {isActive
                              ? <span style={{ fontSize: 12, color: '#aaa', padding: '5px 10px' }}>Активный</span>
                              : <button style={S.btn('outline', true)} onClick={() => { setActiveAgentId(agent.id); setTab('chat'); }}>Выбрать</button>
                            }
                            <button style={S.btn('ghost', true)} onClick={() => { setEditingAgent(agent); setAgentView('edit'); }}>
                              Изменить
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {(agentView === 'create' || agentView === 'edit') && editingAgent && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                  <button style={S.btn('ghost', true)} onClick={() => setAgentView('list')}>← Назад</button>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
                    {agentView === 'create' ? 'Новый агент' : `Изменить: ${editingAgent.name}`}
                  </h2>
                </div>
                <AgentForm
                  initial={editingAgent}
                  onSave={saveAgent}
                  onCancel={() => setAgentView('list')}
                  onDelete={agentView === 'edit' ? () => removeAgent(editingAgent.id) : undefined}
                />
              </>
            )}
          </div>
        )}

        {/* ── CHAT ── */}
        {tab === 'chat' && (
          <>
            {agents.length > 1 && (
              <div style={{ padding: '8px 16px', background: '#fff', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: '#888' }}>Агент:</span>
                <select style={{ ...S.select, width: 'auto', padding: '4px 10px', fontSize: 13 }} value={activeAgentId ?? ''} onChange={e => setActiveAgentId(e.target.value)}>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {agents.length === 0 && (
                <div style={{ textAlign: 'center', padding: '80px 0', color: '#aaa' }}>
                  <div style={{ fontSize: 15, marginBottom: 14 }}>Создай агента во вкладке «Агенты»</div>
                  <button style={S.btn('primary')} onClick={() => setTab('agents')}>Создать агента</button>
                </div>
              )}
              {agents.length > 0 && !running && (
                <div style={{ ...S.toast(false), maxWidth: 480, margin: '20px auto' }}>
                  ⚠️ Gateway не запущен. Нажми <b>Запустить</b> в верхнем правом углу.
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ marginBottom: 10, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <span style={{
                    display: 'inline-block', maxWidth: '72%', wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap', padding: '10px 14px', fontSize: 14,
                    borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: m.role === 'user' ? '#111' : m.role === 'system' ? '#fef2f2' : '#f0f0f0',
                    color: m.role === 'user' ? '#fff' : m.role === 'system' ? '#991b1b' : '#111',
                  }}>
                    {m.text}
                  </span>
                </div>
              ))}
              {sending && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
                  <span style={{ padding: '10px 14px', background: '#f0f0f0', borderRadius: '16px 16px 16px 4px', fontSize: 14, color: '#888' }}>
                    ···
                  </span>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid #eee', background: '#fff' }}>
              <input
                style={{ ...S.input(), flex: 1 }}
                placeholder={!activeAgent ? 'Выбери агента...' : !running ? 'Сначала запусти Gateway...' : `Написать ${activeAgent.name}...`}
                value={input}
                disabled={!activeAgent || !running || sending}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              />
              <button style={S.btn('primary')} onClick={sendMessage} disabled={!activeAgent || !running || sending}>
                {sending ? '...' : 'Отправить'}
              </button>
            </div>
          </>
        )}

        {/* ── TERMINAL ── */}
        {tab === 'terminal' && (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#0f0f0f', fontFamily: 'monospace' }}>
              {termLines.map((l, i) => (
                <div key={i} style={{ color: l.type === 'input' ? '#60a5fa' : l.type === 'error' ? '#f87171' : '#e5e7eb', marginBottom: 4, whiteSpace: 'pre-wrap', fontSize: 13 }}>
                  {l.text}
                </div>
              ))}
              <div ref={termBottomRef} />
            </div>
            <div style={{ display: 'flex', gap: 8, padding: 12, background: '#0f0f0f', borderTop: '1px solid #222' }}>
              <span style={{ color: '#60a5fa', fontFamily: 'monospace', lineHeight: '34px' }}>$</span>
              <input
                style={{ flex: 1, padding: '7px 12px', background: '#1a1a1a', border: '1px solid #333', color: '#fff', borderRadius: 6, fontFamily: 'monospace', fontSize: 13 }}
                placeholder="Команда..."
                value={termInput}
                onChange={e => setTermInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runTermCmd()}
              />
              <button style={{ ...S.btn('ghost', true), background: '#222', color: '#fff' }} onClick={runTermCmd}>Run</button>
            </div>
          </>
        )}

        {/* ── SETTINGS ── */}
        {tab === 'settings' && (
          <div style={S.page}>
            <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 800 }}>Настройки</h2>
            <div style={{ ...S.card, flexDirection: 'column', alignItems: 'flex-start', maxWidth: 480, gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Gateway</div>
              <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>
                Статус: <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
                <br />
                Gateway — локальный процесс связи с агентами. Каждый агент хранит свой API ключ отдельно — настрой во вкладке «Агенты».
                <br /><br />
                <b>Требования:</b> Node.js и <code>npx openclaw</code> должны быть доступны в PATH.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={S.btn('primary', true)} onClick={startGateway} disabled={running || gatewayStatus === 'starting'}>Запустить</button>
                <button style={S.btn('outline', true)} onClick={stopGateway} disabled={!running}>Остановить</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  );
}