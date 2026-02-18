import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect } from 'react';

function App() {
  const [status, setStatus] = useState('stopped');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoke<string>('load_api_key').then(key => {
      if (key) {
        setApiKey(key);
        setSaved(true);
      }
    });
  }, []);

  async function start() {
    await invoke('start_agent');
    setStatus('running');
  }

  async function stop() {
    await invoke('stop_agent');
    setStatus('stopped');
  }

  async function saveKey() {
    await invoke('save_api_key', { key: apiKey });
    setSaved(true);
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Clapp</h2>

      <div>
        <input
          type="password"
          placeholder="Anthropic API Key"
          value={apiKey}
          onChange={e => { setApiKey(e.target.value); setSaved(false); }}
          style={{ width: 300, marginRight: 8 }}
        />
        <button onClick={saveKey}>Save</button>
        {saved && <span> ✅</span>}
      </div>

      <br />

      <p>Agent: <b>{status}</b></p>
      <button onClick={start} disabled={status === 'running'}>Start</button>
      <button onClick={stop} disabled={status === 'stopped'} style={{ marginLeft: 8 }}>Stop</button>
    </div>
  );
}

export default App;