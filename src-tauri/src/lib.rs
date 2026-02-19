use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use std::sync::Mutex;
use std::fs;
use std::path::PathBuf;

struct AgentProcess(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

// ─── Paths ────────────────────────────────────────────────────────────────────

fn config_path() -> PathBuf {
    let mut p = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("clapp");
    fs::create_dir_all(&p).ok();
    p.push("config.json");
    p
}

fn openclaw_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_default().join(".openclaw")
}

fn openclaw_config_path() -> PathBuf {
    openclaw_dir().join("openclaw.json")
}

fn openclaw_agents_root() -> PathBuf {
    openclaw_dir().join("agents")
}

// ─── API key ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn save_api_key(key: String) -> Result<(), String> {
    let json = serde_json::json!({ "api_key": key });
    fs::write(config_path(), serde_json::to_string_pretty(&json).unwrap())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_api_key() -> Result<String, String> {
    let p = config_path();
    if !p.exists() { return Ok("".into()); }
    let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(p).unwrap_or_default())
        .unwrap_or_default();
    Ok(v["api_key"].as_str().unwrap_or("").to_string())
}

// ─── Auth profile ─────────────────────────────────────────────────────────────

fn write_auth_profile(agent_id: &str, api_key: &str) -> Result<(), String> {
    let mut dir = openclaw_agents_root();
    dir.push(agent_id);
    dir.push("agent");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    dir.push("auth-profiles.json");

    let profile = serde_json::json!({
        "version": 1,
        "profiles": {
            "anthropic:default": {
                "type": "api_key",
                "provider": "anthropic",
                "key": api_key
            }
        },
        "lastGood": { "anthropic": "anthropic:default" },
        "usageStats": {}
    });
    fs::write(&dir, serde_json::to_string_pretty(&profile).unwrap())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn sync_agent_auth(agent_id: String, api_key: String) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API ключ пустой".into());
    }
    write_auth_profile(&agent_id, &api_key)
}

// ─── openclaw.json ────────────────────────────────────────────────────────────

fn generate_token() -> String {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("local-{:x}-{:x}", t, std::process::id())
}

fn ensure_openclaw_config() -> Result<String, String> {
    let dir = openclaw_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let config_file = openclaw_config_path();

    if config_file.exists() {
        if let Ok(content) = fs::read_to_string(&config_file) {
            if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&content) {
                // Убираем ключи которые openclaw не принимает
                if let Some(obj) = v.as_object_mut() {
                    obj.remove("providers");
                    obj.remove("version");
                }
                let token = v["gateway"]["auth"]["token"].as_str().unwrap_or("").to_string();
                if !token.is_empty() {
                    // Перезаписываем без мусора
                    fs::write(&config_file, serde_json::to_string_pretty(&v).unwrap())
                        .map_err(|e| e.to_string())?;
                    return Ok(token);
                }
            }
        }
    }

    // Создаём минимальный валидный конфиг
    let token = generate_token();
    let config = serde_json::json!({
        "gateway": {
            "mode": "local",
            "port": 18789,
            "bind": "loopback",
            "auth": {
                "token": token
            }
        }
    });

    fs::write(&config_file, serde_json::to_string_pretty(&config).unwrap())
        .map_err(|e| e.to_string())?;

    Ok(token)
}

// ─── Pairing: читаем токен из конфига и вызываем pair ────────────────────────

async fn do_pairing(app: &tauri::AppHandle, token: &str) -> Result<(), String> {
    // Gateway auto-approves pairing при loopback — просто вызываем pair без --url
    let out = app.shell()
        .command("cmd")
        .args(["/C", "npx", "openclaw", "gateway", "pair", "--token", token])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    println!("[PAIR] {}", combined.trim());
    Ok(()) // Не фатально в любом случае
}

// ─── Gateway token ────────────────────────────────────────────────────────────

fn read_gateway_token() -> Result<String, String> {
    let p = openclaw_config_path();
    if !p.exists() { return Err("openclaw.json не найден".into()); }
    let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(p).unwrap_or_default())
        .map_err(|_| "openclaw.json повреждён".to_string())?;
    let token = v["gateway"]["auth"]["token"].as_str().unwrap_or("").to_string();
    if token.is_empty() { return Err("Токен пустой".into()); }
    Ok(token)
}

// ─── Gateway start/stop/status ────────────────────────────────────────────────

#[tauri::command]
async fn start_agent(app: tauri::AppHandle) -> Result<String, String> {
    let api_key = load_api_key()?;

    if api_key.trim().is_empty() {
        return Err("Сначала добавь API ключ в настройках агента".into());
    }

    let token = ensure_openclaw_config()?;
    write_auth_profile("main", &api_key)?;

    let shell = app.shell();

    // Уже запущен?
    let health_ok = shell
        .command("cmd")
        .args(["/C", "npx", "openclaw", "gateway", "health"])
        .output()
        .await
        .map(|out| {
            let s = String::from_utf8_lossy(&out.stdout).to_lowercase();
            let e = String::from_utf8_lossy(&out.stderr).to_lowercase();
            s.contains("ok") || e.contains("ok")
        })
        .unwrap_or(false);

    if health_ok {
        return Ok("running".into());
    }

    // Запускаем gateway
    let (mut rx, child) = shell
        .command("cmd")
        .args([
            "/C", "npx", "openclaw", "gateway", "run",
            "--port", "18789",
            "--bind", "loopback",
        ])
        .env("ANTHROPIC_API_KEY", &api_key)
        .env("OPENAI_API_KEY", &api_key)
        .spawn()
        .map_err(|e| format!("Не удалось запустить gateway: {}", e))?;

    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(b) => print!("[GW] {}", String::from_utf8_lossy(&b)),
                CommandEvent::Stderr(b) => eprint!("[GW ERR] {}", String::from_utf8_lossy(&b)),
                _ => {}
            }
        }
    });

    *app.state::<AgentProcess>().0.lock().unwrap() = Some(child);

    // Ждём пока gateway поднимется (до 10 сек)
    let mut gateway_up = false;
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let alive = app.shell()
            .command("cmd")
            .args(["/C", "npx", "openclaw", "gateway", "health"])
            .output()
            .await
            .map(|out| {
                let s = String::from_utf8_lossy(&out.stdout).to_lowercase();
                let e = String::from_utf8_lossy(&out.stderr).to_lowercase();
                s.contains("ok") || e.contains("ok")
            })
            .unwrap_or(false);

        if alive {
            gateway_up = true;
            break;
        }
    }

    if !gateway_up {
        return Err("Gateway не запустился за 10 сек. Проверь: npm install -g openclaw".into());
    }

    // Делаем pairing чтобы этот клиент мог делать call
    // Ошибку pairing не считаем фатальной — может уже спарен
    if let Err(e) = do_pairing(&app, &token).await {
        eprintln!("[PAIR ERR] {}", e);
    }

    Ok("running".into())
}

#[tauri::command]
fn stop_agent(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(child) = app.state::<AgentProcess>().0.lock().unwrap().take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok("stopped".into())
}

#[tauri::command]
async fn gateway_status(app: tauri::AppHandle) -> Result<String, String> {
    let out = app.shell()
        .command("cmd")
        .args(["/C", "npx", "openclaw", "gateway", "health"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let s = String::from_utf8_lossy(&out.stdout).to_lowercase();
    let e = String::from_utf8_lossy(&out.stderr).to_lowercase();

    if s.contains("ok") || e.contains("ok") {
        Ok("running".into())
    } else {
        Ok("stopped".into())
    }
}

// ─── Gateway call ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn gateway_call(
    app: tauri::AppHandle,
    agent_id: String,
    message: String,
    session_key: String,
) -> Result<String, String> {
    let token = read_gateway_token().unwrap_or_default();

    let params = serde_json::json!({
        "message": message,
        "sessionKey": "main",
        "idempotencyKey": format!("{}-{}", session_key,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()),
        "deliver": false
    });

    let params_str = params.to_string();

    let mut args: Vec<&str> = vec![
        "/C", "npx", "openclaw", "gateway", "call",
        "agent",
        "--json",
        "--expect-final",
        "--timeout", "130000",
        "--params", &params_str,
    ];

    if !token.is_empty() {
        args.push("--token");
        args.push(&token);
    }

    let output = app.shell()
        .command("cmd")
        .args(&args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stdout.is_empty() {
        Err(if stderr.is_empty() { "Пустой ответ от gateway".into() } else { stderr })
    } else {
        Ok(stdout)
    }
}

// ─── Terminal ─────────────────────────────────────────────────────────────────

#[tauri::command]
async fn run_command(app: tauri::AppHandle, cmd: String) -> Result<String, String> {
    let out = app.shell()
        .command("cmd")
        .args(["/C", &format!("chcp 65001 >nul && {}", cmd)])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    Ok(if stdout.is_empty() { stderr } else { stdout })
}

// ─── Entry ────────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AgentProcess(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            start_agent,
            stop_agent,
            gateway_status,
            gateway_call,
            sync_agent_auth,
            save_api_key,
            load_api_key,
            run_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}