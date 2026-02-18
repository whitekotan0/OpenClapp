import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';

function App() {
  const [status, setStatus] = useState('stopped');

  async function start() {
    await invoke('start_agent');
    setStatus('running');
  }

  async function stop() {
    await invoke('stop_agent');
    setStatus('stopped');
  }

  return (
    <div>
      <p>Agent: {status}</p>
      <button onClick={start} disabled={status === 'running'}>Start</button>
      <button onClick={stop} disabled={status === 'stopped'}>Stop</button>
    </div>
  );
}

export default App;