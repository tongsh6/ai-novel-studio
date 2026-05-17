use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command as ProcessCommand;
use tauri::Manager;

fn kill_phoenix_backend() {
  // 尝试通过端口查找并关闭 Phoenix 后端进程
  let port = std::env::var("PHOENIX_PORT").unwrap_or_else(|_| "4657".into());
  if let Ok(output) = ProcessCommand::new("lsof")
    .args(["-ti", &format!(":{}", port)])
    .output()
  {
    let pids = String::from_utf8_lossy(&output.stdout);
    for pid in pids.lines() {
      if !pid.is_empty() {
        let _ = ProcessCommand::new("kill").arg(pid).output();
      }
    }
  }
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct Preferences {
  last_opened_work_id: Option<String>,
}

fn preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_config_dir()
    .map_err(|error| format!("failed to resolve app config dir: {error}"))?;

  std::fs::create_dir_all(&dir)
    .map_err(|error| format!("failed to create app config dir: {error}"))?;

  Ok(dir.join("preferences.json"))
}

fn read_preferences(app: &tauri::AppHandle) -> Result<Preferences, String> {
  let path = preferences_path(app)?;

  match std::fs::read_to_string(&path) {
    Ok(contents) if contents.trim().is_empty() => Ok(Preferences::default()),
    Ok(contents) => serde_json::from_str(&contents)
      .map_err(|error| format!("failed to parse preferences: {error}")),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
    Err(error) => Err(format!("failed to read preferences: {error}")),
  }
}

fn write_preferences(app: &tauri::AppHandle, preferences: &Preferences) -> Result<(), String> {
  let path = preferences_path(app)?;
  let contents = serde_json::to_string_pretty(preferences)
    .map_err(|error| format!("failed to encode preferences: {error}"))?;

  std::fs::write(path, contents).map_err(|error| format!("failed to write preferences: {error}"))
}

#[tauri::command]
fn get_last_opened_work_id(app: tauri::AppHandle) -> Result<Option<String>, String> {
  read_preferences(&app).map(|preferences| preferences.last_opened_work_id)
}

#[tauri::command]
fn set_last_opened_work_id(app: tauri::AppHandle, id: String) -> Result<(), String> {
  let id = id.trim();
  if id.is_empty() {
    return Err("last opened work id cannot be empty".into());
  }

  let mut preferences = read_preferences(&app)?;
  preferences.last_opened_work_id = Some(id.to_string());
  write_preferences(&app, &preferences)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      get_last_opened_work_id,
      set_last_opened_work_id
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { .. } = event {
        kill_phoenix_backend();
        window.app_handle().exit(0);
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
