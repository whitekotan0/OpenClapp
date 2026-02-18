import { invoke } from '@tauri-apps/api/core';

function App() {
  async function runOpenClaw() {
    const result = await invoke<string>('run_openclaw');
    alert(result);
  }

  return (
    <div>
      <button onClick={runOpenClaw}>Test OpenClaw</button>
    </div>
  );
}

export default App;