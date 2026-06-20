use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[cfg(target_os = "macos")]
use std::ffi::c_void;
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::ptr;
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

#[derive(Debug, Serialize)]
struct ModelProviderSecretStorageStatus {
    available: bool,
    kind: &'static str,
    platform: &'static str,
}

const MAX_ASSISTANT_DISPLAY_NAME_LENGTH: usize = 20;
const MAX_PROVIDER_FIELD_LENGTH: usize = 200;
const MAX_DESKTOP_PROFILE_LENGTH: usize = 40;
const MODEL_PROVIDER_IDS: [&str; 4] = ["stub", "lmstudio", "anthropic", "deepseek"];
const MODEL_PROVIDER_KEYCHAIN_SERVICE: &str = "com.ai-novel-studio.app.model-provider";
const DESKTOP_PROFILE_ENV: &str = "AI_NOVEL_DESKTOP_PROFILE";

#[cfg(target_os = "macos")]
type OsStatus = i32;

#[cfg(target_os = "macos")]
type SecKeychainItemRef = *mut c_void;

#[cfg(target_os = "macos")]
const ERR_SEC_SUCCESS: OsStatus = 0;
#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: OsStatus = -25300;
#[cfg(target_os = "macos")]
const ERR_SEC_DUPLICATE_ITEM: OsStatus = -25299;

#[cfg(target_os = "macos")]
#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecKeychainAddGenericPassword(
        keychain: *mut c_void,
        service_name_length: u32,
        service_name: *const i8,
        account_name_length: u32,
        account_name: *const i8,
        password_length: u32,
        password_data: *const c_void,
        item_ref: *mut SecKeychainItemRef,
    ) -> OsStatus;

    fn SecKeychainFindGenericPassword(
        keychain_or_array: *mut c_void,
        service_name_length: u32,
        service_name: *const i8,
        account_name_length: u32,
        account_name: *const i8,
        password_length: *mut u32,
        password_data: *mut *mut c_void,
        item_ref: *mut SecKeychainItemRef,
    ) -> OsStatus;

    fn SecKeychainItemModifyAttributesAndData(
        item_ref: SecKeychainItemRef,
        attr_list: *const c_void,
        length: u32,
        data: *const c_void,
    ) -> OsStatus;

    fn SecKeychainItemDelete(item_ref: SecKeychainItemRef) -> OsStatus;
    fn SecKeychainItemFreeContent(attr_list: *mut c_void, data: *mut c_void) -> OsStatus;
}

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
}

#[cfg(target_os = "macos")]
struct FoundKeychainItem {
    item: SecKeychainItemRef,
    password: Option<String>,
}

#[cfg(target_os = "macos")]
impl Drop for FoundKeychainItem {
    fn drop(&mut self) {
        if !self.item.is_null() {
            unsafe { CFRelease(self.item.cast()) };
        }
    }
}

fn preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config dir: {error}"))?;

    if let Some(profile) = desktop_profile()? {
        dir = dir.join("profiles").join(profile);
    }

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
            reasoning_effort: normalize_optional_text(
                input.reasoning_effort,
                MAX_PROVIDER_FIELD_LENGTH,
            ),
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

#[tauri::command]
fn get_model_provider_secret_storage_status() -> ModelProviderSecretStorageStatus {
    model_provider_secret_storage_status()
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

fn desktop_profile() -> Result<Option<String>, String> {
    match std::env::var(DESKTOP_PROFILE_ENV) {
        Ok(value) => normalize_desktop_profile(&value),
        Err(std::env::VarError::NotPresent) => {
            if cfg!(debug_assertions) {
                Ok(Some("dev".into()))
            } else {
                Ok(None)
            }
        }
        Err(error) => Err(format!("failed to read desktop profile: {error}")),
    }
}

fn normalize_desktop_profile(value: &str) -> Result<Option<String>, String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Ok(None);
    }

    let valid = trimmed.len() <= MAX_DESKTOP_PROFILE_LENGTH
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');

    if valid {
        Ok(Some(trimmed.to_string()))
    } else {
        Err("desktop profile must use only ASCII letters, numbers, '-' or '_'".into())
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
        let stored = preferences
            .providers
            .get(provider)
            .cloned()
            .unwrap_or_default();
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
        self.selected_provider
            .as_deref()
            .filter(|provider| MODEL_PROVIDER_IDS.contains(provider))
            .map(ToString::to_string)
    }
}

#[cfg(target_os = "macos")]
fn get_provider_api_key(provider: &str) -> Result<Option<String>, String> {
    Ok(find_provider_keychain_item(provider, true)?.and_then(|item| item.password.clone()))
}

#[cfg(target_os = "macos")]
fn set_provider_api_key(provider: &str, api_key: &str) -> Result<(), String> {
    let service = model_provider_keychain_service()?;
    let service_bytes = service.as_bytes();
    let provider_bytes = provider.as_bytes();
    let key_bytes = api_key.as_bytes();
    let key_len = keychain_len(key_bytes)?;

    if let Some(item) = find_provider_keychain_item(provider, false)? {
        let status = unsafe {
            SecKeychainItemModifyAttributesAndData(
                item.item,
                ptr::null(),
                key_len,
                key_bytes.as_ptr().cast(),
            )
        };

        return if status == ERR_SEC_SUCCESS {
            Ok(())
        } else {
            Err(keychain_error("update", status))
        };
    }

    let mut item_ref: SecKeychainItemRef = ptr::null_mut();
    let status = unsafe {
        SecKeychainAddGenericPassword(
            ptr::null_mut(),
            keychain_len(service_bytes)?,
            service_bytes.as_ptr().cast(),
            keychain_len(provider_bytes)?,
            provider_bytes.as_ptr().cast(),
            key_len,
            key_bytes.as_ptr().cast(),
            &mut item_ref,
        )
    };

    if !item_ref.is_null() {
        unsafe { CFRelease(item_ref.cast()) };
    }

    if status == ERR_SEC_SUCCESS {
        Ok(())
    } else if status == ERR_SEC_DUPLICATE_ITEM {
        set_provider_api_key(provider, api_key)
    } else {
        Err(keychain_error("write", status))
    }
}

#[cfg(target_os = "macos")]
fn delete_provider_api_key(provider: &str) -> Result<(), String> {
    let Some(item) = find_provider_keychain_item(provider, false)? else {
        return Ok(());
    };

    let status = unsafe { SecKeychainItemDelete(item.item) };
    if status == ERR_SEC_SUCCESS || status == ERR_SEC_ITEM_NOT_FOUND {
        Ok(())
    } else {
        Err(keychain_error("delete", status))
    }
}

#[cfg(target_os = "macos")]
fn find_provider_keychain_item(
    provider: &str,
    read_password: bool,
) -> Result<Option<FoundKeychainItem>, String> {
    let service = model_provider_keychain_service()?;
    let service_bytes = service.as_bytes();
    let provider_bytes = provider.as_bytes();
    let mut password_length = 0;
    let mut password_data: *mut c_void = ptr::null_mut();
    let mut item_ref: SecKeychainItemRef = ptr::null_mut();

    let status = unsafe {
        SecKeychainFindGenericPassword(
            ptr::null_mut(),
            keychain_len(service_bytes)?,
            service_bytes.as_ptr().cast(),
            keychain_len(provider_bytes)?,
            provider_bytes.as_ptr().cast(),
            if read_password {
                &mut password_length
            } else {
                ptr::null_mut()
            },
            if read_password {
                &mut password_data
            } else {
                ptr::null_mut()
            },
            &mut item_ref,
        )
    };

    if status == ERR_SEC_ITEM_NOT_FOUND {
        return Ok(None);
    }

    if status != ERR_SEC_SUCCESS {
        return Err(keychain_error("read", status));
    }

    let password = if read_password && !password_data.is_null() {
        let bytes = unsafe {
            std::slice::from_raw_parts(password_data.cast::<u8>(), password_length as usize)
        };
        let value = String::from_utf8(bytes.to_vec())
            .map_err(|_| "provider API key in macOS Keychain is not valid UTF-8".to_string())?;
        unsafe { SecKeychainItemFreeContent(ptr::null_mut(), password_data) };
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    } else {
        None
    };

    Ok(Some(FoundKeychainItem {
        item: item_ref,
        password,
    }))
}

#[cfg(target_os = "macos")]
fn keychain_len(bytes: &[u8]) -> Result<u32, String> {
    u32::try_from(bytes.len()).map_err(|_| "provider API key field is too large".to_string())
}

#[cfg(target_os = "macos")]
fn keychain_error(action: &str, status: OsStatus) -> String {
    format!("failed to {action} provider API key in macOS Keychain (status {status})")
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

fn model_provider_keychain_service() -> Result<String, String> {
    Ok(profiled_keychain_service(desktop_profile()?.as_deref()))
}

fn profiled_keychain_service(profile: Option<&str>) -> String {
    match profile {
        Some(profile) => format!("{MODEL_PROVIDER_KEYCHAIN_SERVICE}.{profile}"),
        None => MODEL_PROVIDER_KEYCHAIN_SERVICE.to_string(),
    }
}

fn model_provider_secret_storage_status() -> ModelProviderSecretStorageStatus {
    ModelProviderSecretStorageStatus {
        available: cfg!(target_os = "macos"),
        kind: if cfg!(target_os = "macos") {
            "macos_keychain"
        } else {
            "unsupported"
        },
        platform: std::env::consts::OS,
    }
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

    #[test]
    fn validates_desktop_profile_names() {
        assert_eq!(
            normalize_desktop_profile(" stage-1 ").expect("profile should be valid"),
            Some("stage-1".into())
        );
        assert_eq!(
            normalize_desktop_profile("  ").expect("blank profile disables scoping"),
            None
        );
        assert!(normalize_desktop_profile("../stage").is_err());
        assert!(normalize_desktop_profile("stage dev").is_err());
    }

    #[test]
    fn scopes_keychain_service_by_desktop_profile() {
        assert_eq!(
            profiled_keychain_service(Some("stage")),
            "com.ai-novel-studio.app.model-provider.stage"
        );
        assert_eq!(
            profiled_keychain_service(None),
            "com.ai-novel-studio.app.model-provider"
        );
    }

    #[test]
    fn reports_secret_storage_capability_by_platform() {
        let status = model_provider_secret_storage_status();
        if cfg!(target_os = "macos") {
            assert!(status.available);
            assert_eq!(status.kind, "macos_keychain");
        } else {
            assert!(!status.available);
            assert_eq!(status.kind, "unsupported");
        }
        assert!(!status.platform.is_empty());
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
            get_model_provider_api_key,
            get_model_provider_secret_storage_status
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
