use tauri_plugin_shell::ShellExt;
use std::sync::Mutex;
use tauri::Manager;

struct AgentProcess(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn run_openclaw(app: tauri::AppHandle) -> Result<String, String> {
    let shell = app.shell();
    let output = shell
        .command("cmd")
        .args(["/C", "npx", "openclaw", "--version"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn start_agent(app: tauri::AppHandle) -> Result<String, String> {
    let shell = app.shell();
    let (_, child) = shell
        .command("cmd")
        .args(["/C", "npx", "openclaw", "start"])
        .spawn()
        .map_err(|e| e.to_string())?;
    
    let state = app.state::<AgentProcess>();
    *state.0.lock().unwrap() = Some(child);
    
    Ok("Agent started".to_string())
}

#[tauri::command]
async fn stop_agent(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<AgentProcess>();
    let mut lock = state.0.lock().unwrap();
    if let Some(child) = lock.take() {
        child.kill().map_err(|e| e.to_string())?;
        Ok("Agent stopped".to_string())
    } else {
        Ok("Agent not running".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AgentProcess(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet, run_openclaw, start_agent, stop_agent])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}