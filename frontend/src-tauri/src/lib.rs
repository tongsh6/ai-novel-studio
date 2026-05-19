use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Default, Deserialize, Serialize)]
struct Preferences {
  #[serde(default)]
  last_opened_work_id: Option<String>,
  #[serde(default)]
  assistant_display_names: HashMap<String, String>,
}

const MAX_ASSISTANT_DISPLAY_NAME_LENGTH: usize = 20;

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

#[tauri::command]
fn get_assistant_display_name(
  app: tauri::AppHandle,
  work_id: String,
) -> Result<Option<String>, String> {
  let work_id = normalize_work_id(work_id)?;
  Ok(read_preferences(&app)?
    .assistant_display_names
    .get(&work_id)
    .cloned())
}

#[tauri::command]
fn set_assistant_display_name(
  app: tauri::AppHandle,
  work_id: String,
  display_name: String,
) -> Result<Option<String>, String> {
  let work_id = normalize_work_id(work_id)?;
  let display_name = normalize_assistant_display_name(&display_name);
  let mut preferences = read_preferences(&app)?;

  match display_name {
    Some(name) => {
      preferences
        .assistant_display_names
        .insert(work_id, name.clone());
      write_preferences(&app, &preferences)?;
      Ok(Some(name))
    }
    None => {
      preferences.assistant_display_names.remove(&work_id);
      write_preferences(&app, &preferences)?;
      Ok(None)
    }
  }
}

fn normalize_work_id(work_id: String) -> Result<String, String> {
  let trimmed = work_id.trim();
  if trimmed.is_empty() || trimmed == "lobby" {
    return Err("work id must be a real work id".into());
  }

  Ok(trimmed.to_string())
}

fn normalize_assistant_display_name(display_name: &str) -> Option<String> {
  let trimmed = display_name.trim();
  if trimmed.is_empty() {
    return None;
  }

  Some(
    trimmed
      .chars()
      .take(MAX_ASSISTANT_DISPLAY_NAME_LENGTH)
      .collect(),
  )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      get_last_opened_work_id,
      set_last_opened_work_id,
      get_assistant_display_name,
      set_assistant_display_name
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
        window.app_handle().exit(0);
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
