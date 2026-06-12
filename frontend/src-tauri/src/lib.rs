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
  #[serde(default)]
  model_provider: ModelProviderPreferences,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct ModelProviderPreferences {
  #[serde(default)]
  selected_provider: Option<String>,
  #[serde(default)]
  providers: HashMap<String, ModelProviderPreference>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct ModelProviderPreference {
  #[serde(default)]
  model: Option<String>,
  #[serde(default)]
  endpoint: Option<String>,
  #[serde(default)]
  thinking: Option<String>,
  #[serde(default)]
  reasoning_effort: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetModelProviderSettingsInput {
  selected_provider: String,
  provider: String,
  model: Option<String>,
  endpoint: Option<String>,
  thinking: Option<String>,
  reasoning_effort: Option<String>,
  api_key: Option<String>,
  #[serde(default)]
  clear_api_key: bool,
}

#[derive(Debug, Serialize)]
struct ModelProviderSettings {
  selected_provider: Option<String>,
  providers: HashMap<String, ModelProviderPreferenceStatus>,
}

#[derive(Debug, Serialize)]
struct ModelProviderPreferenceStatus {
  model: Option<String>,
  endpoint: Option<String>,
  thinking: Option<String>,
  reasoning_effort: Option<String>,
  api_key_configured: bool,
}

const MAX_ASSISTANT_DISPLAY_NAME_LENGTH: usize = 20;
const MAX_PROVIDER_FIELD_LENGTH: usize = 200;
const MODEL_PROVIDER_IDS: [&str; 4] = ["stub", "lmstudio", "anthropic", "deepseek"];
const MODEL_PROVIDER_KEYCHAIN_SERVICE: &str = "com.ai-novel-studio.app.model-provider";

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

#[tauri::command]
fn get_model_provider_settings(app: tauri::AppHandle) -> Result<ModelProviderSettings, String> {
  let preferences = read_preferences(&app)?;
  settings_with_key_state(&preferences.model_provider)
}

#[tauri::command]
fn set_model_provider_settings(
  app: tauri::AppHandle,
  input: SetModelProviderSettingsInput,
) -> Result<ModelProviderSettings, String> {
  let selected_provider = normalize_provider_id(input.selected_provider)?;
  let provider = normalize_provider_id(input.provider)?;
  let api_key = normalize_optional_text(input.api_key, usize::MAX);

  if input.clear_api_key {
    delete_provider_api_key(&provider)?;
  } else if let Some(key) = api_key {
    set_provider_api_key(&provider, &key)?;
  }

  let mut preferences = read_preferences(&app)?;
  preferences.model_provider.selected_provider = Some(selected_provider);
  preferences.model_provider.providers.insert(
    provider,
    ModelProviderPreference {
      model: normalize_optional_text(input.model, MAX_PROVIDER_FIELD_LENGTH),
      endpoint: normalize_optional_text(input.endpoint, MAX_PROVIDER_FIELD_LENGTH),
      thinking: normalize_provider_thinking(input.thinking),
      reasoning_effort: normalize_optional_text(input.reasoning_effort, MAX_PROVIDER_FIELD_LENGTH),
    },
  );

  write_preferences(&app, &preferences)?;
  settings_with_key_state(&preferences.model_provider)
}

#[tauri::command]
fn get_model_provider_api_key(provider: String) -> Result<Option<String>, String> {
  let provider = normalize_provider_id(provider)?;
  get_provider_api_key(&provider)
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

fn normalize_provider_id(provider: String) -> Result<String, String> {
  let trimmed = provider.trim();

  if MODEL_PROVIDER_IDS.contains(&trimmed) {
    Ok(trimmed.to_string())
  } else {
    Err("unknown provider".into())
  }
}

fn normalize_optional_text(value: Option<String>, max_len: usize) -> Option<String> {
  let trimmed = value?.trim().to_string();
  if trimmed.is_empty() {
    return None;
  }

  Some(trimmed.chars().take(max_len).collect())
}

fn normalize_provider_thinking(value: Option<String>) -> Option<String> {
  match value.as_deref() {
    Some("enabled") => Some("enabled".into()),
    Some("disabled") => Some("disabled".into()),
    _ => None,
  }
}

fn settings_with_key_state(
  preferences: &ModelProviderPreferences,
) -> Result<ModelProviderSettings, String> {
  let mut providers = HashMap::new();

  for provider in MODEL_PROVIDER_IDS {
    let stored = preferences.providers.get(provider).cloned().unwrap_or_default();
    providers.insert(
      provider.to_string(),
      ModelProviderPreferenceStatus {
        model: stored.model,
        endpoint: stored.endpoint,
        thinking: stored.thinking,
        reasoning_effort: stored.reasoning_effort,
        api_key_configured: get_provider_api_key(provider)?.is_some(),
      },
    );
  }

  Ok(ModelProviderSettings {
    selected_provider: preferences.model_provider_selected(),
    providers,
  })
}

trait ModelProviderSelection {
  fn model_provider_selected(&self) -> Option<String>;
}

impl ModelProviderSelection for ModelProviderPreferences {
  fn model_provider_selected(&self) -> Option<String> {
    self
      .selected_provider
      .as_deref()
      .filter(|provider| MODEL_PROVIDER_IDS.contains(provider))
      .map(ToString::to_string)
  }
}

#[cfg(target_os = "macos")]
fn get_provider_api_key(provider: &str) -> Result<Option<String>, String> {
  let output = std::process::Command::new("security")
    .args([
      "find-generic-password",
      "-s",
      MODEL_PROVIDER_KEYCHAIN_SERVICE,
      "-a",
      provider,
      "-w",
    ])
    .output()
    .map_err(|error| format!("failed to read keychain: {error}"))?;

  if output.status.success() {
    let value = String::from_utf8_lossy(&output.stdout)
      .trim_end_matches(['\r', '\n'])
      .to_string();
    return Ok(if value.is_empty() { None } else { Some(value) });
  }

  let stderr = String::from_utf8_lossy(&output.stderr);
  if stderr.contains("could not be found") || stderr.contains("The specified item could not be found") {
    Ok(None)
  } else {
    Err("failed to read provider API key from keychain".into())
  }
}

#[cfg(target_os = "macos")]
fn set_provider_api_key(provider: &str, api_key: &str) -> Result<(), String> {
  let status = std::process::Command::new("security")
    .args([
      "add-generic-password",
      "-s",
      MODEL_PROVIDER_KEYCHAIN_SERVICE,
      "-a",
      provider,
      "-w",
      api_key,
      "-U",
    ])
    .status()
    .map_err(|error| format!("failed to write keychain: {error}"))?;

  if status.success() {
    Ok(())
  } else {
    Err("failed to write provider API key to keychain".into())
  }
}

#[cfg(target_os = "macos")]
fn delete_provider_api_key(provider: &str) -> Result<(), String> {
  let output = std::process::Command::new("security")
    .args([
      "delete-generic-password",
      "-s",
      MODEL_PROVIDER_KEYCHAIN_SERVICE,
      "-a",
      provider,
    ])
    .output()
    .map_err(|error| format!("failed to delete keychain item: {error}"))?;

  if output.status.success() {
    return Ok(());
  }

  let stderr = String::from_utf8_lossy(&output.stderr);
  if stderr.contains("could not be found") || stderr.contains("The specified item could not be found") {
    Ok(())
  } else {
    Err("failed to delete provider API key from keychain".into())
  }
}

#[cfg(not(target_os = "macos"))]
fn get_provider_api_key(_provider: &str) -> Result<Option<String>, String> {
  Ok(None)
}

#[cfg(not(target_os = "macos"))]
fn set_provider_api_key(_provider: &str, _api_key: &str) -> Result<(), String> {
  Err("provider API key storage is only available through macOS Keychain".into())
}

#[cfg(not(target_os = "macos"))]
fn delete_provider_api_key(_provider: &str) -> Result<(), String> {
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn decodes_model_provider_settings_from_frontend_camel_case_payload() {
    let input: SetModelProviderSettingsInput = serde_json::from_value(serde_json::json!({
      "selectedProvider": "deepseek",
      "provider": "deepseek",
      "model": "deepseek-chat",
      "endpoint": "https://api.deepseek.com",
      "thinking": "enabled",
      "reasoningEffort": "medium",
      "apiKey": "secret",
      "clearApiKey": false
    }))
    .expect("frontend payload should decode");

    assert_eq!(input.selected_provider, "deepseek");
    assert_eq!(input.reasoning_effort.as_deref(), Some("medium"));
    assert_eq!(input.api_key.as_deref(), Some("secret"));
    assert!(!input.clear_api_key);
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      get_last_opened_work_id,
      set_last_opened_work_id,
      get_assistant_display_name,
      set_assistant_display_name,
      get_model_provider_settings,
      set_model_provider_settings,
      get_model_provider_api_key
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
