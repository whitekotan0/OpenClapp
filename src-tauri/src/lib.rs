use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use std::sync::Mutex;
use std::fs;
use std::path::PathBuf;

struct AgentProcess(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

fn config_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("clapp");
    fs::create_dir_all(&path).ok();
    path.push("config.json");
    path
}

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
    child.kill().map_err(|e: tauri_plugin_shell::Error| e.to_string())?;
        Ok("Agent stopped".to_string())
    } else {
        Ok("Agent not running".to_string())
    }
}

#[tauri::command]
fn save_api_key(key: String) -> Result<String, String> {
    let path = config_path();
    let json = format!("{{\"api_key\": \"{}\"}}", key);
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok("Key saved".to_string())
}

#[tauri::command]
fn load_api_key() -> Result<String, String> {
    let path = config_path();
    if !path.exists() {
        return Ok("".to_string());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(v["api_key"].as_str().unwrap_or("").to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AgentProcess(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet, run_openclaw, start_agent, stop_agent, save_api_key, load_api_key])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}