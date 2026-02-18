use tauri_plugin_shell::ShellExt;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet, run_openclaw])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}