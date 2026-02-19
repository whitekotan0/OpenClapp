import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message { role: 'user' | 'agent' | 'system'; text: string; ts: number; }
interface TermLine { text: string; type: 'input' | 'output' | 'error'; }
interface Agent {
  id: string; name: string; provider: string;
  apiKey: string; model: string; systemPrompt: string;
  braveKey?: string; baseUrl?: string;
}
interface EnvCheck { node: boolean; node_version: string; openclaw: boolean; openclaw_version: string; }

// ─── Constants ────────────────────────────────────────────────────────────────

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic',                  models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],                          needsKey: true,  hasUrl: false },
  { id: 'openai',    label: 'OpenAI',                     models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],                             needsKey: true,  hasUrl: false },
  { id: 'groq',      label: 'Groq',                       models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'],                     needsKey: true,  hasUrl: false },
  { id: 'together',  label: 'Together AI',                models: ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],            needsKey: true,  hasUrl: false },
  { id: 'ollama',    label: 'Ollama (local)',             models: ['llama3.2', 'mistral', 'gemma2', 'qwen2.5'],                                          needsKey: false, hasUrl: true  },
  { id: 'custom',    label: 'Custom (OpenAI-compatible)', models: [],                                                                                    needsKey: true,  hasUrl: true  },
];

const STORAGE_KEY   = 'clapp_agents_v2';
const HISTORY_KEY   = 'clapp_history_v1';
const ONBOARDED_KEY = 'clapp_onboarded';

// ─── Storage ──────────────────────────────────────────────────────────────────

function loadAgents(): Agent[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}
function persistAgents(a: Agent[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(a)); }
function loadHistory(id: string): Message[] {
  try { return JSON.parse(localStorage.getItem(`${HISTORY_KEY}_${id}`) ?? '[]'); } catch { return []; }
}
function saveHistory(id: string, msgs: Message[]) {
  localStorage.setItem(`${HISTORY_KEY}_${id}`, JSON.stringify(msgs.slice(-100)));
}
function makeId() { return 'ag_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function blankAgent(): Agent {
  return { id: makeId(), name: '', provider: 'anthropic', apiKey: '', model: 'claude-opus-4-5', systemPrompt: 'You are a helpful assistant.', braveKey: '', baseUrl: '' };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  app:    { display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: "'DM Sans', sans-serif", background: '#f6f7f9' } as React.CSSProperties,
  header: { padding: '0 20px', borderBottom: '1px solid #e8e8e8', background: '#fff', display: 'flex', alignItems: 'center', minHeight: 52 } as React.CSSProperties,
  logo:   { fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px', color: '#111', marginRight: 24, display: 'flex', alignItems: 'center', gap: 6 } as React.CSSProperties,
  tab:    (a: boolean) => ({ padding: '16px 14px 14px', cursor: 'pointer', background: 'none', border: 'none', fontSize: 13, fontWeight: a ? 700 : 400, color: a ? '#111' : '#888', borderBottom: a ? '2px solid #111' : '2px solid transparent' } as React.CSSProperties),
  btn:    (v: 'primary'|'ghost'|'danger'|'outline' = 'primary', sm = false) => ({ padding: sm ? '5px 12px' : '8px 18px', border: v === 'outline' ? '1px solid #d1d5db' : 'none', borderRadius: 8, cursor: 'pointer', fontSize: sm ? 12 : 13, fontWeight: 600, background: v === 'primary' ? '#111' : v === 'danger' ? '#ef4444' : v === 'outline' ? '#fff' : '#f3f4f6', color: v === 'primary' || v === 'danger' ? '#fff' : '#111', whiteSpace: 'nowrap' as const } as React.CSSProperties),
  card:   { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 } as React.CSSProperties,
  label:  { fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4, display: 'block' } as React.CSSProperties,
  hint:   { fontSize: 11, color: '#aaa', marginTop: 3 } as React.CSSProperties,
  input:  (err?: boolean) => ({ width: '100%', padding: '9px 12px', border: `1px solid ${err ? '#ef4444' : '#e0e0e0'}`, borderRadius: 8, fontSize: 14, background: '#fff', outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' } as React.CSSProperties),
  textarea: { width: '100%', padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit', resize: 'vertical' as const, minHeight: 80 } as React.CSSProperties,
  select: { width: '100%', padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, background: '#fff', outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit', cursor: 'pointer' } as React.CSSProperties,
  row:    { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  page:   { flex: 1, overflowY: 'auto' as const, padding: 24 },
};

// ─── Environment Check Screen ─────────────────────────────────────────────────

function EnvSetup({ onDone }: { onDone: () => void }) {
  const [env, setEnv] = useState<EnvCheck | null>(null);
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      const result = await invoke<EnvCheck>('check_environment');
      setEnv(result);
    } catch (e) {
      setEnv({ node: false, node_version: '', openclaw: false, openclaw_version: '' });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => { check(); }, []);

  const allGood = env?.node && env?.openclaw;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 40, maxWidth: 460, width: '90%' }}>
        <div style={{ fontSize: 40, marginBottom: 12, textAlign: 'center' }}>🔧</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, textAlign: 'center' }}>Setting up ClawDesk</h2>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: '#888', textAlign: 'center' }}>ClawDesk needs Node.js and OpenClaw to run agents on your machine.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {/* Node.js */}
          <div style={{ padding: '12px 16px', borderRadius: 10, border: `1px solid ${env === null ? '#e0e0e0' : env.node ? '#a7f3d0' : '#fecaca'}`, background: env === null ? '#fafafa' : env.node ? '#f0fdf4' : '#fef2f2', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 22 }}>{env === null ? '⏳' : env.node ? '✅' : '❌'}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Node.js {env?.node && <span style={{ fontWeight: 400, color: '#666', fontSize: 12 }}>{env.node_version}</span>}</div>
              {!env?.node && env !== null && (
                <div style={{ fontSize: 12, color: '#991b1b', marginTop: 2 }}>
                  Not found. <a href="https://nodejs.org" target="_blank" style={{ color: '#1d4ed8' }}>Download at nodejs.org</a> (LTS version)
                </div>
              )}
            </div>
          </div>

          {/* OpenClaw */}
          <div style={{ padding: '12px 16px', borderRadius: 10, border: `1px solid ${env === null ? '#e0e0e0' : env.openclaw ? '#a7f3d0' : '#fecaca'}`, background: env === null ? '#fafafa' : env.openclaw ? '#f0fdf4' : '#fef2f2', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 22 }}>{env === null ? '⏳' : env.openclaw ? '✅' : '❌'}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>OpenClaw {env?.openclaw && <span style={{ fontWeight: 400, color: '#666', fontSize: 12 }}>{env.openclaw_version}</span>}</div>
              {!env?.openclaw && env !== null && (
                <div style={{ fontSize: 12, color: '#991b1b', marginTop: 2 }}>
                  Not found. Run in terminal: <code style={{ background: '#fee2e2', padding: '1px 5px', borderRadius: 4 }}>npm install -g openclaw</code>
                </div>
              )}
            </div>
          </div>
        </div>

        {!allGood && env !== null && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#92400e', marginBottom: 16 }}>
            After installing, click <b>Check Again</b> below.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button style={S.btn('outline')} onClick={check} disabled={checking}>
            {checking ? 'Checking...' : 'Check Again'}
          </button>
          {allGood && (
            <button style={S.btn('primary')} onClick={onDone}>
              All good — Continue →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);

  const steps = [
    { icon: '🦞', title: 'Welcome to ClawDesk', body: 'Your personal AI agent that runs locally on your machine.\nNot in the cloud — right here, on your computer.', btn: "Let's set it up" },
    { icon: '🔑', title: 'Get your API key', body: 'Your agent needs an API key to think.\n\nFor Anthropic (Claude): console.anthropic.com → API Keys\nFor OpenAI: platform.openai.com → API Keys\nFor Groq: console.groq.com (free tier available)\nFor Ollama: no key needed, runs fully offline', btn: 'Got it, next' },
    { icon: '🌐', title: 'Want web search?', body: 'Give your agent a Brave Search API key and it can search the web in real time.\n\nFree tier: 2,000 requests/month\nGet it at brave.com/search/api\n\nYou can skip this and add it later.', btn: 'Got it, next' },
    { icon: '🧩', title: 'Want browser control?', body: 'Install the OpenClaw Browser Relay extension in Chrome and your agent can open pages, click, and read websites.\n\nSearch "OpenClaw Browser Relay" in the Chrome Web Store.\n\nYou can skip this too.', btn: 'Got it, next' },
    { icon: '✅', title: "You're all set!", body: "Create your first agent — give it a name, paste your API key, and write a short instruction for who it is.\n\nThen hit Start and start chatting.", btn: 'Create my first agent' },
  ];

  const cur = steps[step];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 40, maxWidth: 440, width: '90%', textAlign: 'center' }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>{cur.icon}</div>
        <h2 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 800 }}>{cur.title}</h2>
        <p style={{ margin: '0 0 28px', fontSize: 14, color: '#555', lineHeight: 1.7, whiteSpace: 'pre-line', textAlign: 'left' }}>{cur.body}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {step > 0 && <button style={S.btn('ghost')} onClick={() => setStep(s => s - 1)}>Back</button>}
          <button style={S.btn('primary')} onClick={() => step < steps.length - 1 ? setStep(s => s + 1) : onDone()}>{cur.btn}</button>
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 20 }}>
          {steps.map((_, i) => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i === step ? '#111' : '#ddd' }} />)}
        </div>
      </div>
    </div>
  );
}

// ─── Agent Form ───────────────────────────────────────────────────────────────

function AgentForm({ initial, onSave, onCancel, onDelete }: {
  initial: Agent; onSave: (a: Agent) => void; onCancel: () => void; onDelete?: () => void;
}) {
  const [form, setForm] = useState<Agent>(initial);
  const [showKey, setShowKey] = useState(false);
  const [showBrave, setShowBrave] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Agent) => (e: React.ChangeEvent<any>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const pInfo = PROVIDERS.find(p => p.id === form.provider) ?? PROVIDERS[0];

  async function submit() {
    const errs: Record<string, boolean> = {};
    if (!form.name.trim()) errs.name = true;
    if (pInfo.needsKey && !form.apiKey.trim()) errs.apiKey = true;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await invoke('sync_agent_auth', {
        agentId: form.id, apiKey: form.apiKey, agentName: form.name,
        systemPrompt: form.systemPrompt, provider: form.provider, baseUrl: form.baseUrl ?? null,
      });
      onSave({ ...form, name: form.name.trim() });
    } catch (e: any) { alert(`Error: ${e}`); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={S.row}>
        <label style={S.label}>Agent name</label>
        <input style={S.input(errors.name)} placeholder="My Assistant" value={form.name} onChange={set('name')} />
        {errors.name && <span style={{ fontSize: 11, color: '#ef4444' }}>Required</span>}
      </div>

      <div style={S.row}>
        <label style={S.label}>Provider</label>
        <select style={S.select} value={form.provider} onChange={e => {
          const p = PROVIDERS.find(x => x.id === e.target.value) ?? PROVIDERS[0];
          setForm(f => ({ ...f, provider: e.target.value, model: p.models[0] ?? '' }));
        }}>
          {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>

      <div style={S.row}>
        <label style={S.label}>Model</label>
        {pInfo.models.length > 0
          ? <select style={S.select} value={form.model} onChange={set('model')}>{pInfo.models.map(m => <option key={m} value={m}>{m}</option>)}</select>
          : <input style={S.input()} placeholder="e.g. my-model-name" value={form.model} onChange={set('model')} />
        }
      </div>

      {pInfo.hasUrl && (
        <div style={S.row}>
          <label style={S.label}>Base URL {pInfo.id === 'ollama' && <span style={{ fontWeight: 400, color: '#aaa' }}>(default: http://localhost:11434)</span>}</label>
          <input style={S.input()} placeholder={pInfo.id === 'ollama' ? 'http://localhost:11434' : 'https://api.yourprovider.com/v1'} value={form.baseUrl ?? ''} onChange={set('baseUrl')} />
        </div>
      )}

      {pInfo.needsKey && (
        <div style={S.row}>
          <label style={S.label}>API Key</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...S.input(errors.apiKey), flex: 1 }}
              type={showKey ? 'text' : 'password'}
              placeholder={pInfo.id === 'openai' ? 'sk-...' : pInfo.id === 'groq' ? 'gsk_...' : pInfo.id === 'together' ? 'your Together key' : 'sk-ant-api03-...'}
              value={form.apiKey} onChange={set('apiKey')}
            />
            <button style={S.btn('outline', true)} onClick={() => setShowKey(v => !v)}>{showKey ? 'Hide' : 'Show'}</button>
          </div>
          {errors.apiKey && <span style={{ fontSize: 11, color: '#ef4444' }}>Required</span>}
          <span style={S.hint}>Stored only on this device</span>
        </div>
      )}

      <div style={S.row}>
        <label style={S.label}>Brave Search API Key <span style={{ fontWeight: 400, color: '#aaa' }}>(optional — enables web search)</span></label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...S.input(), flex: 1 }} type={showBrave ? 'text' : 'password'} placeholder="BSA..." value={form.braveKey ?? ''} onChange={set('braveKey')} />
          <button style={S.btn('outline', true)} onClick={() => setShowBrave(v => !v)}>{showBrave ? 'Hide' : 'Show'}</button>
        </div>
        <span style={S.hint}>brave.com/search/api — free 2,000 req/month</span>
      </div>

      <div style={S.row}>
        <label style={S.label}>Instructions <span style={{ fontWeight: 400, color: '#aaa' }}>(who is this agent?)</span></label>
        <textarea style={S.textarea} placeholder="You are a helpful assistant for company X. Be concise..." value={form.systemPrompt} onChange={set('systemPrompt')} rows={4} />
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <button style={S.btn('primary')} onClick={submit} disabled={saving}>{saving ? 'Saving...' : onDelete ? 'Save' : 'Create Agent'}</button>
        <button style={S.btn('ghost')} onClick={onCancel} disabled={saving}>Cancel</button>
        {onDelete && <button style={{ ...S.btn('danger'), marginLeft: 'auto' }} onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState<'agents'|'chat'|'terminal'|'settings'>('agents');
  const [gwStatus, setGwStatus] = useState<'stopped'|'starting'|'running'|'error'>('stopped');
  const [gwError, setGwError]   = useState('');

  const [showEnvCheck,   setShowEnvCheck]   = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [envReady,       setEnvReady]       = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input,    setInput]    = useState('');
  const [sending,  setSending]  = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const [termLines, setTermLines] = useState<TermLine[]>([]);
  const [termInput, setTermInput] = useState('');
  const termBottomRef = useRef<HTMLDivElement>(null);

  const [agents,        setAgents]        = useState<Agent[]>(loadAgents);
  const [agentView,     setAgentView]     = useState<'list'|'create'|'edit'>('list');
  const [editingAgent,  setEditingAgent]  = useState<Agent | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(() => loadAgents()[0]?.id ?? null);

  const activeAgent = agents.find(a => a.id === activeAgentId) ?? null;
  const running = gwStatus === 'running';

  // Init: check env first, then maybe onboarding
  useEffect(() => {
    const onboarded = !!localStorage.getItem(ONBOARDED_KEY);
    if (!onboarded) {
      setShowEnvCheck(true);
    } else {
      setEnvReady(true);
    }
  }, []);

  useEffect(() => { persistAgents(agents); }, [agents]);
  useEffect(() => { if (!activeAgentId && agents.length) setActiveAgentId(agents[0].id); }, [agents]);
  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { termBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [termLines]);

  useEffect(() => {
    if (activeAgentId) setMessages(loadHistory(activeAgentId));
  }, [activeAgentId]);

  useEffect(() => {
    if (activeAgentId && messages.length) saveHistory(activeAgentId, messages);
  }, [messages]);

  // Poll gateway status
  useEffect(() => {
    let alive = true;
    async function poll() {
      if (!alive) return;
      try {
        const s = await invoke<string>('gateway_status');
        if (alive) setGwStatus(s === 'running' ? 'running' : prev => prev === 'starting' ? 'starting' : 'stopped');
      } catch {}
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
    setGwStatus('starting'); setGwError('');
    try { await invoke('start_agent'); setGwStatus('running'); }
    catch (e: any) { setGwStatus('error'); setGwError(String(e)); }
  }

  async function stopGateway() {
    try { await invoke('stop_agent'); setGwStatus('stopped'); }
    catch (e: any) { alert(`Error: ${e}`); }
  }

  async function sendMessage() {
    if (!input.trim() || !activeAgent || sending || !running) return;
    const text = input.trim();
    setInput(''); setSending(true);
    setMessages(prev => [...prev, { role: 'user', text, ts: Date.now() }]);
    try {
      const raw = await invoke<string>('gateway_call', {
        agentId: activeAgent.id, message: text, sessionKey: activeAgent.id, systemPrompt: activeAgent.systemPrompt || '',
      });
      const payload: any = JSON.parse(raw);
      const payloads = Array.isArray(payload?.result?.payloads) ? payload.result.payloads : [];
      const parts = payloads.map((p: any) => p?.text ?? '').filter((s: string) => s.trim());
      const reply = parts.join('\n\n') || payload?.result?.summary || payload?.error || '[no response]';
      setMessages(prev => [...prev, { role: 'agent', text: reply, ts: Date.now() }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'system', text: `Error: ${e}`, ts: Date.now() }]);
    } finally { setSending(false); }
  }

  async function runTermCmd() {
    if (!termInput.trim()) return;
    const cmd = termInput.trim(); setTermInput('');
    setTermLines(prev => [...prev, { text: '> ' + cmd, type: 'input' }]);
    try {
      const result = await invoke<string>('run_command', { cmd });
      setTermLines(prev => [...prev, { text: result || '(empty)', type: 'output' }]);
    } catch (e: any) {
      setTermLines(prev => [...prev, { text: `Error: ${e}`, type: 'error' }]);
    }
  }

  const statusLabel = { stopped: 'Stopped', starting: 'Starting...', running: 'Running', error: 'Error' }[gwStatus];
  const statusColor = { stopped: '#ef4444', starting: '#f59e0b', running: '#22c55e', error: '#ef4444' }[gwStatus];

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap" rel="stylesheet" />

      {showEnvCheck && (
        <EnvSetup onDone={() => {
          setShowEnvCheck(false);
          setShowOnboarding(true);
        }} />
      )}

      {showOnboarding && (
        <Onboarding onDone={() => {
          localStorage.setItem(ONBOARDED_KEY, '1');
          setShowOnboarding(false);
          setEnvReady(true);
          setTab('agents');
          setEditingAgent(blankAgent());
          setAgentView('create');
        }} />
      )}

      <div style={S.app}>
        {/* HEADER */}
        <div style={S.header}>
          <div style={S.logo}>🦞 ClawDesk</div>
          {(['agents','chat','terminal','settings'] as const).map(t => (
            <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
              {t === 'agents' ? 'Agents' : t === 'chat' ? 'Chat' : t === 'terminal' ? 'Terminal' : 'Settings'}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
            <span style={{ fontSize: 13, color: '#888' }}>{statusLabel}</span>
            {running
              ? <button style={S.btn('outline', true)} onClick={stopGateway}>Stop</button>
              : <button style={S.btn('primary', true)} onClick={startGateway} disabled={gwStatus === 'starting'}>
                  {gwStatus === 'starting' ? '...' : 'Start'}
                </button>
            }
          </div>
        </div>

        {/* Gateway error banner */}
        {gwStatus === 'error' && gwError && (
          <div style={{ padding: '10px 20px', background: '#fef2f2', borderBottom: '1px solid #fecaca', fontSize: 13, color: '#991b1b', display: 'flex', gap: 12 }}>
            <span>⚠️ {gwError}</span>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', marginLeft: 'auto' }} onClick={() => setGwError('')}>✕</button>
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
                    <div style={{ fontSize: 15, marginBottom: 20 }}>No agents yet. Create your first one!</div>
                    <button style={S.btn('primary')} onClick={() => { setEditingAgent(blankAgent()); setAgentView('create'); }}>Create Agent</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
                    {agents.map(agent => {
                      const isActive = agent.id === activeAgentId;
                      const histCount = loadHistory(agent.id).length;
                      const pLabel = PROVIDERS.find(p => p.id === agent.provider)?.label ?? agent.provider;
                      return (
                        <div key={agent.id} style={{ ...S.card, border: isActive ? '1.5px solid #111' : '1px solid #e8e8e8' }}>
                          <div style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0, background: isActive ? '#111' : '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🤖</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>{agent.name}</div>
                            <div style={{ fontSize: 12, color: '#888', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                              <span>{pLabel}</span><span>·</span><span>{agent.model}</span><span>·</span>
                              <span style={{ color: (PROVIDERS.find(p=>p.id===agent.provider)?.needsKey ? agent.apiKey : true) ? '#22c55e' : '#ef4444' }}>
                                {(PROVIDERS.find(p=>p.id===agent.provider)?.needsKey ? agent.apiKey : true) ? '🔑 Ready' : '⚠️ No key'}
                              </span>
                              <span>·</span>
                              <span style={{ color: agent.braveKey ? '#22c55e' : '#aaa' }}>{agent.braveKey ? '🌐 Search' : '🌐 No search'}</span>
                              {histCount > 0 && <><span>·</span><span>💬 {histCount} msgs</span></>}
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
                <button style={{ ...S.btn('ghost', true), marginLeft: 'auto', fontSize: 11 }} onClick={() => { if (confirm('Clear chat history?')) { setMessages([]); if (activeAgentId) saveHistory(activeAgentId, []); } }}>
                  Clear
                </button>
              )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {agents.length === 0 && (
                <div style={{ textAlign: 'center', padding: '80px 0', color: '#aaa' }}>
                  <div style={{ fontSize: 15, marginBottom: 14 }}>Create an agent in the Agents tab first</div>
                  <button style={S.btn('primary')} onClick={() => setTab('agents')}>Create Agent</button>
                </div>
              )}
              {agents.length > 0 && !running && (
                <div style={{ maxWidth: 420, margin: '20px auto', padding: '12px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, fontSize: 13, color: '#92400e', textAlign: 'center' }}>
                  ⚠️ Gateway is not running — click <b>Start</b> in the top right
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ marginBottom: 10, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <span style={{ display: 'inline-block', maxWidth: '72%', wordBreak: 'break-word', whiteSpace: 'pre-wrap', padding: '10px 14px', fontSize: 14, borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: m.role === 'user' ? '#111' : m.role === 'system' ? '#fef2f2' : '#f0f0f0', color: m.role === 'user' ? '#fff' : m.role === 'system' ? '#991b1b' : '#111' }}>
                    {m.text}
                  </span>
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
                placeholder={!activeAgent ? 'Select an agent first...' : !running ? 'Start the gateway first...' : `Message ${activeAgent.name}...`}
                value={input} disabled={!activeAgent || !running || sending}
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

            <div style={{ ...S.card, flexDirection: 'column', alignItems: 'flex-start', maxWidth: 480, gap: 10, marginBottom: 16 }}>
              <div style={{ fontWeight: 700 }}>Gateway</div>
              <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>
                Status: <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span><br />
                Requirements: Node.js + <code>npm install -g openclaw</code>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={S.btn('primary', true)} onClick={startGateway} disabled={running || gwStatus === 'starting'}>Start</button>
                <button style={S.btn('outline', true)} onClick={stopGateway} disabled={!running}>Stop</button>
              </div>
            </div>

            <div style={{ ...S.card, flexDirection: 'column', alignItems: 'flex-start', maxWidth: 480, gap: 10, marginBottom: 16 }}>
              <div style={{ fontWeight: 700 }}>Environment</div>
              <div style={{ fontSize: 13, color: '#888' }}>Check that Node.js and OpenClaw are properly installed.</div>
              <button style={S.btn('outline', true)} onClick={() => setShowEnvCheck(true)}>Check Environment</button>
            </div>

            <div style={{ ...S.card, flexDirection: 'column', alignItems: 'flex-start', maxWidth: 480, gap: 10 }}>
              <div style={{ fontWeight: 700 }}>Onboarding</div>
              <div style={{ fontSize: 13, color: '#888' }}>Show the welcome walkthrough again.</div>
              <button style={S.btn('outline', true)} onClick={() => { localStorage.removeItem(ONBOARDED_KEY); setShowEnvCheck(true); }}>Restart Setup</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}