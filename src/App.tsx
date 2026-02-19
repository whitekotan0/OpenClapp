import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect, useRef } from 'react';

// ─── Data Interfaces ─────────────────────────────────────────────────────────
interface Message { role: 'user' | 'agent' | 'system'; text: string; ts: number; }
interface TermLine { text: string; type: 'input' | 'output' | 'error'; }
interface Agent {
  id: string; name: string; provider: string;
  apiKey: string; model: string; systemPrompt: string; braveKey?: string;
}

// ─── Persistence Layer ────────────────────────────────────────────────────────
const STORAGE_KEY = 'clapp_agents_v2';
const HISTORY_KEY = 'clapp_history_v1';
const ONBOARDED_KEY = 'clapp_onboarded';

function loadAgents(): Agent[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}
function persistAgents(a: Agent[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(a)); }

function loadHistory(agentId: string): Message[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY + '_' + agentId) ?? '[]'); } catch { return []; }
}
function saveHistory(agentId: string, msgs: Message[]) {
  const trimmed = msgs.slice(-100);
  localStorage.setItem(HISTORY_KEY + '_' + agentId, JSON.stringify(trimmed));
}

function makeId() { return 'ag_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function blankAgent(): Agent {
  return { id: makeId(), name: '', provider: 'anthropic', apiKey: '', model: 'claude-opus-4-5', systemPrompt: 'You are a helpful assistant.', braveKey: '' };
}

const PROVIDERS = [{ id: 'anthropic', label: 'Anthropic (Claude)', models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'] }];

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  app: { display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: "'DM Sans', sans-serif", background: '#f6f7f9' } as React.CSSProperties,
  header: { padding: '0 20px', borderBottom: '1px solid #e8e8e8', background: '#fff', display: 'flex', alignItems: 'center', minHeight: 52 } as React.CSSProperties,
  logo: { fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px', color: '#111', marginRight: 24, display: 'flex', alignItems: 'center', gap: 6 } as React.CSSProperties,
  tab: (active: boolean) => ({ padding: '16px 14px 14px', cursor: 'pointer', background: 'none', border: 'none', fontSize: 13, fontWeight: active ? 700 : 400, color: active ? '#111' : '#888', borderBottom: active ? '2px solid #111' : '2px solid transparent' } as React.CSSProperties),
  dot: (ok: boolean) => ({ width: 8, height: 8, borderRadius: '50%', background: ok ? '#22c55e' : '#ef4444', boxShadow: ok ? '0 0 0 2px #bbf7d0' : '0 0 0 2px #fecaca', flexShrink: 0 } as React.CSSProperties),
  btn: (v: 'primary' | 'ghost' | 'danger' | 'outline' = 'primary', sm = false) => ({ padding: sm ? '5px 12px' : '8px 18px', border: v === 'outline' ? '1px solid #d1d5db' : 'none', borderRadius: 8, cursor: 'pointer', fontSize: sm ? 12 : 13, fontWeight: 600, background: v === 'primary' ? '#111' : v === 'danger' ? '#ef4444' : v === 'outline' ? '#fff' : '#f3f4f6', color: v === 'primary' || v === 'danger' ? '#fff' : '#111', whiteSpace: 'nowrap' as const } as React.CSSProperties),
  card: { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 } as React.CSSProperties,
  label: { fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4, display: 'block' } as React.CSSProperties,
  hint: { fontSize: 11, color: '#aaa', marginTop: 3 } as React.CSSProperties,
  input: (err?: boolean) => ({ width: '100%', padding: '9px 12px', border: `1px solid ${err ? '#ef4444' : '#e0e0e0'}`, borderRadius: 8, fontSize: 14, background: '#fff', outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' } as React.CSSProperties),
  textarea: { width: '100%', padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit', resize: 'vertical' as const, minHeight: 80 } as React.CSSProperties,
  select: { width: '100%', padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, background: '#fff', outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit', cursor: 'pointer' } as React.CSSProperties,
  row: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  page: { flex: 1, overflowY: 'auto' as const, padding: 24 },
};

// ─── ONBOARDING ───────────────────────────────────────────────────────────────
function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      icon: '🦞',
      title: 'Hi! This is Clapp.',
      body: 'A personal AI agent that lives on your computer. Not in the cloud — locally with you.',
      btn: "Let's set it up",
    },
    {
      icon: '🔑',
      title: 'Anthropic API Key Required',
      body: 'The agent works via Claude. Get your key at console.anthropic.com → API Keys. It looks like sk-ant-api03-...\n\nYou will enter it when creating an agent.',
      btn: 'Got it, next',
    },
    {
      icon: '🌐',
      title: 'Want Web Search?',
      body: 'The agent can browse the web if you provide a Brave Search API key. Free up to 2,000 requests/month.\n\nGet it at brave.com/search/api\n\nYou can skip this and add it later.',
      btn: 'Got it, next',
    },
    {
      icon: '🧩',
      title: 'Control your Browser?',
      body: 'Install the OpenClaw Browser Relay extension in Chrome — then the agent can open pages, click, and read websites.\n\nSearch Chrome Web Store for: "OpenClaw Browser Relay"\n\nOptional.',
      btn: 'Got it, next',
    },
    {
      icon: '✅',
      title: "All set!",
      body: 'Create your first agent — give it a name, paste your API key, and write its instructions.\n\nThen click Start and begin chatting.',
      btn: 'Create Agent',
    },
  ];

  const current = steps[step];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 40, maxWidth: 440, width: '90%', textAlign: 'center' }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>{current.icon}</div>
        <h2 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 800 }}>{current.title}</h2>
        <p style={{ margin: '0 0 28px', fontSize: 14, color: '#555', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{current.body}</p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {step > 0 && (
            <button style={S.btn('ghost')} onClick={() => setStep(s => s - 1)}>Back</button>
          )}
          <button style={S.btn('primary')} onClick={() => {
            if (step < steps.length - 1) setStep(s => s + 1);
            else onDone();
          }}>
            {current.btn}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 24 }}>
          {steps.map((_, i) => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i === step ? '#111' : '#ddd' }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── AGENT FORM ───────────────────────────────────────────────────────────────
function AgentForm({ initial, onSave, onCancel, onDelete }: {
  initial: Agent; onSave: (a: Agent) => void; onCancel: () => void; onDelete?: () => void;
}) {
  const [form, setForm] = useState<Agent>(initial);
  const [showKey, setShowKey] = useState(false);
  const [showBrave, setShowBrave] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Agent) => (e: React.ChangeEvent<any>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const provider = PROVIDERS.find(p => p.id === form.provider) ?? PROVIDERS[0];

  async function submit() {
    const errs: Record<string, boolean> = {};
    if (!form.name.trim()) errs.name = true;
    if (!form.apiKey.trim()) errs.apiKey = true;
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await invoke('sync_agent_auth', {
        agentId: form.id,
        apiKey: form.apiKey,
        agentName: form.name,
        systemPrompt: form.systemPrompt,
      });
      onSave({ ...form, name: form.name.trim() });
    } catch (e: any) {
      alert(`Error: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={S.row}>
        <label style={S.label}>Agent Name</label>
        <input style={S.input(errors.name)} placeholder="My Assistant" value={form.name} onChange={set('name')} />
        {errors.name && <span style={{ fontSize: 11, color: '#ef4444' }}>Required field</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={S.row}>
          <label style={S.label}>Provider</label>
          <select style={S.select} value={form.provider} onChange={set('provider')}>
            {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div style={S.row}>
          <label style={S.label}>Model</label>
          <select style={S.select} value={form.model} onChange={set('model')}>
            {provider.models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <div style={S.row}>
        <label style={S.label}>Anthropic API Key</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...S.input(errors.apiKey), flex: 1 }} type={showKey ? 'text' : 'password'} placeholder="sk-ant-api03-..." value={form.apiKey} onChange={set('apiKey')} />
          <button style={S.btn('outline', true)} onClick={() => setShowKey(v => !v)}>{showKey ? 'Hide' : 'Show'}</button>
        </div>
        {errors.apiKey && <span style={{ fontSize: 11, color: '#ef4444' }}>Required field</span>}
        <span style={S.hint}>Stored only on this device</span>
      </div>

      <div style={S.row}>
        <label style={S.label}>
          Brave Search API Key{' '}
          <span style={{ fontWeight: 400, color: '#aaa' }}>(for web search, optional)</span>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...S.input(), flex: 1 }} type={showBrave ? 'text' : 'password'} placeholder="BSA..." value={form.braveKey ?? ''} onChange={set('braveKey')} />
          <button style={S.btn('outline', true)} onClick={() => setShowBrave(v => !v)}>{showBrave ? 'Hide' : 'Show'}</button>
        </div>
        <span style={S.hint}>brave.com/search/api — free 2,000 requests/month</span>
      </div>

      <div style={S.row}>
        <label style={S.label}>Instructions <span style={{ fontWeight: 400, color: '#aaa' }}>(who is this agent)</span></label>
        <textarea style={S.textarea} placeholder="You are an expert helper. Be concise..." value={form.systemPrompt} onChange={set('systemPrompt')} rows={4} />
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <button style={S.btn('primary')} onClick={submit} disabled={saving}>{saving ? 'Saving...' : onDelete ? 'Save Changes' : 'Create Agent'}</button>
        <button style={S.btn('ghost')} onClick={onCancel} disabled={saving}>Cancel</button>
        {onDelete && <button style={{ ...S.btn('danger'), marginLeft: 'auto' }} onClick={onDelete}>Delete Agent</button>}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<'agents' | 'chat' | 'terminal' | 'settings'>('agents');
  const [gatewayStatus, setGatewayStatus] = useState<'stopped' | 'starting' | 'running' | 'error'>('stopped');
  const [gatewayError, setGatewayError] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(!localStorage.getItem(ONBOARDED_KEY));

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const [termLines, setTermLines] = useState<TermLine[]>([]);
  const [termInput, setTermInput] = useState('');
  const termBottomRef = useRef<HTMLDivElement>(null);

  const [agents, setAgents] = useState<Agent[]>(loadAgents);
  const [agentView, setAgentView] = useState<'list' | 'create' | 'edit'>('list');
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(() => loadAgents()[0]?.id ?? null);

  const activeAgent = agents.find(a => a.id === activeAgentId) ?? null;
  const running = gatewayStatus === 'running';

  useEffect(() => persistAgents(agents), [agents]);
  useEffect(() => { if (!activeAgentId && agents.length) setActiveAgentId(agents[0].id); }, [agents]);
  useEffect(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);
  useEffect(() => termBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [termLines]);

  useEffect(() => {
    if (activeAgentId) setMessages(loadHistory(activeAgentId));
  }, [activeAgentId]);

  useEffect(() => {
    if (activeAgentId && messages.length) saveHistory(activeAgentId, messages);
  }, [messages]);

  useEffect(() => {
    let alive = true;
    async function poll() {
      if (!alive) return;
      try {
        const s = await invoke<string>('gateway_status');
        if (alive) setGatewayStatus(s === 'running' ? 'running' : prev => prev === 'starting' ? 'starting' : 'stopped');
      } catch { }
      if (alive) setTimeout(poll, 5000);
    }
    poll();
    return () => { alive = false; };
  }, []);

  function saveAgent(a: Agent) {
    setAgents(prev => prev.find(x => x.id === a.id) ? prev.map(x => x.id === a.id ? a : x) : [...prev, a]);
    if (!activeAgentId) setActiveAgentId(a.id);
    setAgentView('list');
  }

  function removeAgent(id: string) {
    if (!confirm('Delete this agent?')) return;
    const next = agents.filter(a => a.id !== id);
    setAgents(next);
    if (activeAgentId === id) setActiveAgentId(next[0]?.id ?? null);
    setAgentView('list');
  }

  async function startGateway() {
    setGatewayStatus('starting');
    setGatewayError('');
    try {
      await invoke('start_agent');
      setGatewayStatus('running');
    } catch (e: any) {
      setGatewayStatus('error');
      setGatewayError(String(e));
    }
  }

  async function stopGateway() {
    await invoke('stop_agent');
    setGatewayStatus('stopped');
  }

  async function sendMessage() {
    if (!input.trim() || !activeAgent || sending || !running) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    const userMsg: Message = { role: 'user', text, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const raw = await invoke<string>('gateway_call', {
        agentId: activeAgent.id,
        message: text,
        sessionKey: activeAgent.id,
        systemPrompt: activeAgent.systemPrompt || '',
      });
      const payload: any = JSON.parse(raw);
      const payloads = Array.isArray(payload?.result?.payloads) ? payload.result.payloads : [];
      const parts = payloads.map((p: any) => p?.text ?? '').filter((s: string) => s.trim());
      const reply = parts.join('\n\n') || payload?.result?.summary || payload?.error || '[no response]';
      setMessages(prev => [...prev, { role: 'agent', text: reply, ts: Date.now() }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'system', text: `Error: ${e}`, ts: Date.now() }]);
    } finally {
      setSending(false);
    }
  }

  async function runTermCmd() {
    if (!termInput.trim()) return;
    const cmd = termInput.trim();
    setTermInput('');
    setTermLines(prev => [...prev, { text: '$ ' + cmd, type: 'input' }]);
    try {
      const result = await invoke<string>('run_command', { cmd });
      setTermLines(prev => [...prev, { text: result || '(empty)', type: 'output' }]);
    } catch (e: any) {
      setTermLines(prev => [...prev, { text: `Error: ${e}`, type: 'error' }]);
    }
  }

  const statusLabel = { stopped: 'Stopped', starting: 'Starting...', running: 'Running', error: 'Error' }[gatewayStatus];
  const statusColor = { stopped: '#ef4444', starting: '#f59e0b', running: '#22c55e', error: '#ef4444' }[gatewayStatus];

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap" rel="stylesheet" />

      {showOnboarding && (
        <Onboarding onDone={() => {
          localStorage.setItem(ONBOARDED_KEY, '1');
          setShowOnboarding(false);
          setTab('agents');
          setEditingAgent(blankAgent());
          setAgentView('create');
        }} />
      )}

      <div style={S.app}>
        {/* HEADER */}
        <div style={S.header}>
          <div style={S.logo}>🦞 Clapp</div>
          {(['agents', 'chat', 'terminal', 'settings'] as const).map(t => (
            <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
              {t === 'agents' ? 'Agents' : t === 'chat' ? 'Chat' : t === 'terminal' ? 'Terminal' : 'Settings'}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
            <span style={{ fontSize: 13, color: '#888' }}>{statusLabel}</span>
            {running
              ? <button style={S.btn('outline', true)} onClick={stopGateway}>Stop</button>
              : <button style={S.btn('primary', true)} onClick={startGateway} disabled={gatewayStatus === 'starting'}>
                  {gatewayStatus === 'starting' ? '...' : 'Start'}
                </button>
            }
          </div>
        </div>

        {/* Gateway error banner */}
        {gatewayStatus === 'error' && gatewayError && (
          <div style={{ padding: '10px 20px', background: '#fef2f2', borderBottom: '1px solid #fecaca', fontSize: 13, color: '#991b1b', display: 'flex', gap: 12 }}>
            <span>⚠️ {gatewayError}</span>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', marginLeft: 'auto' }} onClick={() => setGatewayError('')}>✕</button>
          </div>
        )}

        {/* AGENTS */}
        {tab === 'agents' && (
          <div style={S.page}>
            {agentView === 'list' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Agents</h2>
                  <button style={{ ...S.btn('primary', true), marginLeft: 'auto' }} onClick={() => { setEditingAgent(blankAgent()); setAgentView('create'); }}>
                    + New Agent
                  </button>
                </div>

                {agents.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#aaa' }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
                    <div style={{ fontSize: 15, marginBottom: 20 }}>No agents found. Create your first one!</div>
                    <button style={S.btn('primary')} onClick={() => { setEditingAgent(blankAgent()); setAgentView('create'); }}>Create Agent</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
                    {agents.map(agent => {
                      const isActive = agent.id === activeAgentId;
                      const historyCount = loadHistory(agent.id).length;
                      return (
                        <div key={agent.id} style={{ ...S.card, border: isActive ? '1.5px solid #111' : '1px solid #e8e8e8' }}>
                          <div style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0, background: isActive ? '#111' : '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🤖</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>{agent.name}</div>
                            <div style={{ fontSize: 12, color: '#888', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                              <span>{agent.model}</span>
                              <span>·</span>
                              <span style={{ color: agent.apiKey ? '#22c55e' : '#ef4444' }}>{agent.apiKey ? '🔑 Key Active' : '⚠️ No Key'}</span>
                              <span>·</span>
                              <span style={{ color: agent.braveKey ? '#22c55e' : '#aaa' }}>{agent.braveKey ? '🌐 Web Search' : '🌐 No Search'}</span>
                              {historyCount > 0 && <><span>·</span><span>💬 {historyCount} messages</span></>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            {isActive
                              ? <span style={{ fontSize: 12, color: '#aaa', padding: '5px 10px' }}>Active</span>
                              : <button style={S.btn('outline', true)} onClick={() => { setActiveAgentId(agent.id); setTab('chat'); }}>Select</button>
                            }
                            <button style={S.btn('ghost', true)} onClick={() => { setEditingAgent(agent); setAgentView('edit'); }}>Edit</button>
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
                  <button style={S.btn('ghost', true)} onClick={() => setAgentView('list')}>← Back</button>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{agentView === 'create' ? 'New Agent' : `Edit: ${editingAgent.name}`}</h2>
                </div>
                <AgentForm initial={editingAgent} onSave={saveAgent} onCancel={() => setAgentView('list')} onDelete={agentView === 'edit' ? () => removeAgent(editingAgent.id) : undefined} />
              </>
            )}
          </div>
        )}

        {/* CHAT */}
        {tab === 'chat' && (
          <>
            <div style={{ padding: '8px 16px', background: '#fff', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 10 }}>
              {agents.length > 1 && (
                <select style={{ ...S.select, width: 'auto', padding: '4px 10px', fontSize: 13 }} value={activeAgentId ?? ''} onChange={e => setActiveAgentId(e.target.value)}>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              {activeAgent && <span style={{ fontSize: 12, color: '#aaa' }}>{messages.length} messages</span>}
              {activeAgent && messages.length > 0 && (
                <button style={{ ...S.btn('ghost', true), marginLeft: 'auto', fontSize: 11 }} onClick={() => {
                  if (confirm('Clear chat history?')) {
                    setMessages([]);
                    if (activeAgentId) saveHistory(activeAgentId, []);
                  }
                }}>
                  Clear History
                </button>
              )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {agents.length === 0 && (
                <div style={{ textAlign: 'center', padding: '80px 0', color: '#aaa' }}>
                  <div style={{ fontSize: 15, marginBottom: 14 }}>Create an agent in the "Agents" tab</div>
                  <button style={S.btn('primary')} onClick={() => setTab('agents')}>Create Agent</button>
                </div>
              )}
              {agents.length > 0 && !running && (
                <div style={{ maxWidth: 420, margin: '20px auto', padding: '12px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, fontSize: 13, color: '#92400e', textAlign: 'center' }}>
                  ⚠️ Gateway not running — click <b>Start</b> at the top right
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ marginBottom: 10, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <span style={{
                    display: 'inline-block', maxWidth: '72%', wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                    padding: '10px 14px', fontSize: 14,
                    borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: m.role === 'user' ? '#111' : m.role === 'system' ? '#fef2f2' : '#f0f0f0',
                    color: m.role === 'user' ? '#fff' : m.role === 'system' ? '#991b1b' : '#111',
                  }}>{m.text}</span>
                </div>
              ))}
              {sending && (
                <div style={{ display: 'flex', marginBottom: 10 }}>
                  <span style={{ padding: '10px 14px', background: '#f0f0f0', borderRadius: '16px 16px 16px 4px', fontSize: 14, color: '#888' }}>···</span>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid #eee', background: '#fff' }}>
              <input
                style={{ ...S.input(), flex: 1 }}
                placeholder={!activeAgent ? 'Select an agent...' : !running ? 'Start Gateway first...' : `Message ${activeAgent.name}...`}
                value={input}
                disabled={!activeAgent || !running || sending}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              />
              <button style={S.btn('primary')} onClick={sendMessage} disabled={!activeAgent || !running || sending}>
                {sending ? '...' : 'Send'}
              </button>
            </div>
          </>
        )}

        {/* TERMINAL */}
        {tab === 'terminal' && (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#0f0f0f', fontFamily: 'monospace' }}>
              {termLines.map((l, i) => (
                <div key={i} style={{ color: l.type === 'input' ? '#60a5fa' : l.type === 'error' ? '#f87171' : '#e5e7eb', marginBottom: 4, whiteSpace: 'pre-wrap', fontSize: 13 }}>{l.text}</div>
              ))}
              <div ref={termBottomRef} />
            </div>
            <div style={{ display: 'flex', gap: 8, padding: 12, background: '#0f0f0f', borderTop: '1px solid #222' }}>
              <span style={{ color: '#60a5fa', fontFamily: 'monospace', lineHeight: '34px' }}>$</span>
              <input style={{ flex: 1, padding: '7px 12px', background: '#1a1a1a', border: '1px solid #333', color: '#fff', borderRadius: 6, fontFamily: 'monospace', fontSize: 13 }} placeholder="Command..." value={termInput} onChange={e => setTermInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && runTermCmd()} />
              <button style={{ ...S.btn('ghost', true), background: '#222', color: '#fff' }} onClick={runTermCmd}>Run</button>
            </div>
          </>
        )}

        {/* SETTINGS */}
        {tab === 'settings' && (
          <div style={S.page}>
            <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 800 }}>Settings</h2>
            <div style={{ ...S.card, flexDirection: 'column', alignItems: 'flex-start', maxWidth: 480, gap: 10 }}>
              <div style={{ fontWeight: 700 }}>Gateway</div>
              <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>
                Status: <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span><br />
                Requirements: Node.js + <code>npm install -g openclaw</code>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={S.btn('primary', true)} onClick={startGateway} disabled={running || gatewayStatus === 'starting'}>Start Gateway</button>
                <button style={S.btn('outline', true)} onClick={stopGateway} disabled={!running}>Stop Gateway</button>
              </div>
            </div>
            <div style={{ marginTop: 16, ...S.card, flexDirection: 'column', alignItems: 'flex-start', maxWidth: 480, gap: 10 }}>
              <div style={{ fontWeight: 700 }}>Onboarding</div>
              <div style={{ fontSize: 13, color: '#888' }}>Show the welcome screen again</div>
              <button style={S.btn('outline', true)} onClick={() => { localStorage.removeItem(ONBOARDED_KEY); setShowOnboarding(true); }}>Reset Onboarding</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}