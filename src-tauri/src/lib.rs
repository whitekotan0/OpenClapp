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

fn openclaw_agents_root() -> PathBuf {
    let mut path = dirs::home_dir().unwrap_or_default();
    path.push(".openclaw");
    path.push("agents");
    path
}

fn main_agent_auth_profiles_path() -> PathBuf {
    let mut path = openclaw_agents_root();
    path.push("main");
    path.push("agent");
    path.push("auth-profiles.json");
    path
}

fn auth_profiles_has_api_key(v: &serde_json::Value) -> bool {
    v.get("profiles")
        .and_then(|p| p.as_object())
        .map(|profiles| {
            profiles.values().any(|profile| {
                profile
                    .get("key")
                    .and_then(|k| k.as_str())
                    .map(|k| !k.trim().is_empty())
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn find_auth_profile_from_other_agent() -> Option<PathBuf> {
    let root = openclaw_agents_root();
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let agent_id = entry.file_name().to_string_lossy().to_string();
        if agent_id == "main" {
            continue;
        }

        let mut candidate = entry.path();
        candidate.push("agent");
        candidate.push("auth-profiles.json");
        if !candidate.exists() {
            continue;
        }

        if let Ok(content) = fs::read_to_string(&candidate) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                if auth_profiles_has_api_key(&parsed) {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn ensure_main_agent_auth_profile() -> Result<(), String> {
    let main_path = main_agent_auth_profiles_path();

    if let Ok(content) = fs::read_to_string(&main_path) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
            if auth_profiles_has_api_key(&parsed) {
                return Ok(());
            }
        }
    }

    if let Some(parent) = main_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let api_key = load_api_key().unwrap_or_default();
    if !api_key.trim().is_empty() {
        let profile = serde_json::json!({
            "version": 1,
            "profiles": {
                "anthropic:default": {
                    "type": "api_key",
                    "provider": "anthropic",
                    "key": api_key
                }
            },
            "lastGood": {
                "anthropic": "anthropic:default"
            },
            "usageStats": {}
        });
        let profile_text = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
        fs::write(&main_path, profile_text).map_err(|e| e.to_string())?;
        return Ok(());
    }

    if let Some(source) = find_auth_profile_from_other_agent() {
        fs::copy(source, &main_path).map_err(|e| e.to_string())?;
    }

    Ok(())
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
    if !path.exists() { return Ok("".to_string()); }
    let content = fs::read_to_string(&path).unwrap_or_default();
    let v: serde_json::Value = serde_json::from_str(&content).unwrap_or(serde_json::Value::Null);
    Ok(v["api_key"].as_str().unwrap_or("").to_string())
}

#[tauri::command]
async fn start_agent(app: tauri::AppHandle) -> Result<String, String> {
    // 1. Читаем ключ (без него бот слепой)
    let api_key = load_api_key()?;
    ensure_main_agent_auth_profile()?;

    let shell = app.shell();

    // 2. Проверяем жив ли gateway
    let health = shell
        .command("cmd")
        .args(["/C", "npx", "openclaw", "gateway", "health"])
        .output()
        .await;

    let gateway_alive = match health {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
            let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
            stdout.contains("gateway health") && stdout.contains("ok")
                || stderr.contains("gateway health") && stderr.contains("ok")
        }
        Err(_) => false,
    };

    if gateway_alive {
        return Ok("Gateway уже работает, подключаемся".to_string());
    }

    // 3. ЗАПУСКАЕМ ДЕМОНА ПРАВИЛЬНО: С ПОРТОМ И КЛЮЧАМИ!
    let mut gateway_cmd = shell
        .command("cmd")
        .args(["/C", "npx", "openclaw", "gateway", "run", "--port", "18789", "--bind", "lan"]); // <-- PORT

    if !api_key.trim().is_empty() {
        gateway_cmd = gateway_cmd
            .env("ANTHROPIC_API_KEY", &api_key)
            .env("OPENAI_API_KEY", &api_key);
    }

    let (mut rx, child) = gateway_cmd
        .spawn()
        .map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    print!("[GATEWAY]: {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Stderr(bytes) => {
                    eprint!("[GATEWAY ERR]: {}", String::from_utf8_lossy(&bytes));
                }
                _ => {}
            }
        }
    });

    let state = app.state::<AgentProcess>();
    *state.0.lock().unwrap() = Some(child);

    Ok("Gateway запущен на порту 18789".to_string())
}

#[tauri::command]
fn stop_agent(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<AgentProcess>();
    let mut process = state.0.lock().unwrap();

    if let Some(child) = process.take() {
        child.kill().map_err(|e| e.to_string())?;
        return Ok("Gateway stopped".to_string());
    }

    Ok("Gateway is not running".to_string())
}

#[tauri::command]
fn get_gateway_token() -> Result<String, String> {
    let mut path = dirs::home_dir().unwrap_or_default();
    path.push(".openclaw");
    path.push("openclaw.json");

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Конфиг не найден: {}", e))?;

    let v: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Конфиг битый: {}", e))?;

    let token = v["gateway"]["auth"]["token"]
        .as_str()
        .unwrap_or("")
        .to_string();

    if token.is_empty() {
        return Err("Токен пустой — запусти gateway".to_string());
    }

    Ok(token)
}

#[tauri::command]
fn get_bot_internals() -> Result<String, String> {
    let mut path = dirs::home_dir().unwrap_or_default();
    path.push(".openclaw");

    if !path.exists() {
        return Ok("Папка ~/.openclaw не найдена".to_string());
    }

    let mut output = format!("--- Ядро OpenClaw ({:?}) ---\n\n", path);

    if let Ok(entries) = fs::read_dir(&path) {
        for entry in entries.flatten() {
            output.push_str(&format!("📂 {}\n", entry.file_name().to_string_lossy()));
        }
    }
    Ok(output)
}

#[tauri::command]
async fn run_command(app: tauri::AppHandle, cmd: String) -> Result<String, String> {
    let shell = app.shell();
    let full_cmd = format!("chcp 65001 >nul && {}", cmd);
    let output = shell
        .command("cmd")
        .args(["/C", &full_cmd])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok(if stdout.is_empty() { stderr } else { stdout })
}

#[tauri::command]
async fn gateway_call(app: tauri::AppHandle, method: String, params: String) -> Result<String, String> {
    ensure_main_agent_auth_profile()?;
    let token = get_gateway_token()?;
    let parsed: serde_json::Value =
        serde_json::from_str(&params).map_err(|e| format!("Invalid JSON params: {}", e))?;
    if !parsed.is_object() {
        return Err("Params must be a JSON object".to_string());
    }

    let shell = app.shell();
    let output = shell
        .command("cmd")
        .args([
            "/C",
            "npx",
            "openclaw",
            "gateway",
            "call",
            &method,
            "--json",
            "--expect-final",
            "--timeout",
            "130000",
            "--token",
            &token,
            "--params",
            &params,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !stderr.is_empty() && stdout.is_empty() {
        return Err(stderr);
    }
    if stdout.is_empty() {
        return Err("Gateway returned empty response".to_string());
    }
    Ok(stdout)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AgentProcess(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            start_agent,
            stop_agent,
            save_api_key,
            load_api_key,
            get_gateway_token,
            get_bot_internals,
            run_command,
            gateway_call
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
