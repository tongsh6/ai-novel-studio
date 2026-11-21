use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

#[derive(Debug, Default, Deserialize, Serialize)]
struct Preferences {
    #[serde(default)]
    last_opened_work_id: Option<String>,
    #[serde(default)]
    assistant_display_names: HashMap<String, String>,
    #[serde(default)]
    model_provider: ModelProviderPreferences,
    /// 用户可配置的模型上下文窗口（provider → window tokens）；由 sidecar 启动时注入
    /// NOVEL_CONTEXT_WINDOW_OVERRIDES，供安全点自动维护的压力阈值判定使用（不写死在代码里）。
    #[serde(default)]
    context_windows: HashMap<String, u32>,
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
    #[serde(default)]
    purpose_models: HashMap<String, String>,
}

/// Provider API keys，存放在与 preferences.json 同目录、但独立的受限文件里。
///
/// 这是一个单用户本机桌面工具：密钥是用户自己的 provider key，存在用户自己的机器上。
/// 我们用一个权限 0600 的本地文件持久化，而不是 macOS Keychain——Keychain 在本场景下
/// 几乎不增加安全收益（真实风险是泄进 git/日志/备份，靠 .gitignore + 不打日志解决），
/// 却带来手写 FFI、仅 macOS、依赖稳定代码签名、每次启动弹密码等沉重成本。
/// 决策与威胁模型见 docs/design/acceptance/system/SU-01-model-provider.md。
#[derive(Debug, Default, Deserialize, Serialize)]
struct ProviderSecrets {
    #[serde(default)]
    api_keys: HashMap<String, String>,
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
    #[serde(default)]
    purpose_models: Option<HashMap<String, String>>,
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
    purpose_models: HashMap<String, String>,
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
const MODEL_PROVIDER_IDS: [&str; 13] = [
    "stub",
    "lmstudio",
    "splash",
    "strata",
    "anthropic",
    "deepseek",
    "openai",
    "openai_subscription",
    "minimax",
    "minimax_cn",
    "zhipu",
    "kimi",
    "gemini",
];
const DESKTOP_PROFILE_ENV: &str = "AI_NOVEL_DESKTOP_PROFILE";
const PROVIDER_SECRETS_FILE: &str = "provider-secrets.json";

fn profiled_config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config dir: {error}"))?;

    if let Some(profile) = desktop_profile()? {
        dir = dir.join("profiles").join(profile);
    }

    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create app config dir: {error}"))?;

    Ok(dir)
}

fn preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(profiled_config_dir(app)?.join("preferences.json"))
}

/// 把用户配置的 provider → window 渲染为 sidecar env 格式（provider:window 逗号分隔）。
/// 过滤空 provider 与 0 窗口；按 provider 排序保证确定性；空映射返回 None（不注入）。
fn render_context_window_overrides(windows: &HashMap<String, u32>) -> Option<String> {
    let mut entries: Vec<(&String, &u32)> = windows
        .iter()
        .filter(|(provider, window)| !provider.trim().is_empty() && **window > 0)
        .collect();
    entries.sort_by(|left, right| left.0.cmp(right.0));

    if entries.is_empty() {
        return None;
    }

    Some(
        entries
            .iter()
            .map(|(provider, window)| format!("{}:{}", provider.trim(), window))
            .collect::<Vec<_>>()
            .join(","),
    )
}

// B85 / desktop §6.1: all Preferences commands share this in-process RMW owner.
// This is not a cross-process lock or a transaction with provider-secrets.json.
static PREFERENCES_LOCK: Mutex<()> = Mutex::new(());
static PREFERENCE_TEMP_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn preference_metadata(path: &Path) -> Result<Option<std::fs::Metadata>, String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(Some(metadata)),
        Ok(_) => Err("preferences must be a regular file, not a symlink".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("failed to inspect preferences: {error}")),
    }
}

fn read_preference_value(path: &Path) -> Result<serde_json::Value, String> {
    if preference_metadata(path)?.is_none() {
        return Ok(serde_json::json!({}));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("failed to read preferences: {e}"))?;
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("failed to parse preferences: {e}"))?;
    if !value.is_object() {
        return Err("preferences must be an object".into());
    }
    // Validate known fields without reserializing the typed projection: unknown nested fields survive.
    serde_json::from_value::<Preferences>(value.clone())
        .map_err(|e| format!("invalid preferences: {e}"))?;
    Ok(value)
}

fn read_preferences_at(path: &Path) -> Result<Preferences, String> {
    let _guard = PREFERENCES_LOCK.lock().map_err(|e| e.to_string())?;
    serde_json::from_value(read_preference_value(path)?).map_err(|e| e.to_string())
}

fn read_preferences(app: &tauri::AppHandle) -> Result<Preferences, String> {
    read_preferences_at(&preferences_path(app)?)
}

// Atomic visibility of a complete file, not a power-loss transaction or external-editor coordination.
fn write_preference_value(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    use std::io::Write;
    let metadata = preference_metadata(path)?;
    if metadata
        .as_ref()
        .is_some_and(|metadata| metadata.permissions().readonly())
    {
        return Err("preferences file is read-only".into());
    }
    let parent = path.parent().ok_or("preferences parent missing")?;
    let id = PREFERENCE_TEMP_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temp = parent.join(format!(".preferences-{}-{id}.tmp", std::process::id()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp)
        .map_err(|e| format!("failed to stage preferences: {e}"))?;
    let result = (|| {
        let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .map_err(|e| format!("failed to write preferences: {e}"))?;
        if let Some(metadata) = metadata {
            file.set_permissions(metadata.permissions())
                .map_err(|e| format!("failed to preserve preferences permissions: {e}"))?;
        }
        file.sync_all()
            .map_err(|e| format!("failed to sync preferences: {e}"))?;
        drop(file);
        preference_metadata(path)?;
        std::fs::rename(&temp, path).map_err(|e| format!("failed to replace preferences: {e}"))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

fn update_preferences_at(
    path: &Path,
    patch: impl FnOnce(&mut serde_json::Value) -> Result<(), String>,
) -> Result<Preferences, String> {
    let _guard = PREFERENCES_LOCK.lock().map_err(|e| e.to_string())?;
    let mut value = read_preference_value(path)?;
    patch(&mut value)?;
    let preferences = serde_json::from_value(value.clone())
        .map_err(|e| format!("invalid preferences update: {e}"))?;
    write_preference_value(path, &value)?;
    Ok(preferences)
}

fn preference_object<'a>(
    value: &'a mut serde_json::Value,
    key: &str,
) -> Result<&'a mut serde_json::Map<String, serde_json::Value>, String> {
    let object = value
        .as_object_mut()
        .ok_or("preferences must be an object")?;
    object
        .entry(key)
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| format!("invalid preferences object: {key}"))
}

#[derive(Debug, Serialize)]
struct SavedModelContextWindow {
    provider: String,
    saved_window: Option<u32>,
}

fn saved_context_window_at(
    path: &Path,
    provider: String,
) -> Result<SavedModelContextWindow, String> {
    let provider = normalize_provider_id(provider)?;
    let preferences = read_preferences_at(path)?;
    let saved_window = preferences.context_windows.get(&provider).copied();
    if saved_window == Some(0) {
        return Err("saved context window must be positive; preferences were not modified".into());
    }
    Ok(SavedModelContextWindow {
        saved_window,
        provider,
    })
}

fn set_context_window_at(
    path: &Path,
    provider: String,
    window: serde_json::Value,
) -> Result<SavedModelContextWindow, String> {
    let provider = normalize_provider_id(provider)?;
    let saved_window = if window.is_null() {
        None
    } else {
        Some(
            window
                .as_u64()
                .filter(|value| *value > 0 && *value <= u32::MAX as u64)
                .ok_or("context window must be an integer between 1 and 4294967295, or null")?
                as u32,
        )
    };
    update_preferences_at(path, |value| {
        let windows = preference_object(value, "context_windows")?;
        match saved_window {
            Some(window) => {
                windows.insert(provider.clone(), serde_json::json!(window));
            }
            None => {
                windows.remove(&provider);
            }
        }
        Ok(())
    })?;
    Ok(SavedModelContextWindow {
        provider,
        saved_window,
    })
}

#[tauri::command]
fn get_model_context_window(
    app: tauri::AppHandle,
    provider: String,
) -> Result<SavedModelContextWindow, String> {
    saved_context_window_at(&preferences_path(&app)?, provider)
}

#[tauri::command]
fn set_model_context_window(
    app: tauri::AppHandle,
    provider: String,
    window: serde_json::Value,
) -> Result<SavedModelContextWindow, String> {
    set_context_window_at(&preferences_path(&app)?, provider, window)
}

// ADR-0027：不可变的待投递消息按作品/会话/身份独立保存，崩溃或刷新不丢原文。
static OUTBOX_LOCK: Mutex<()> = Mutex::new(());

fn submission_component(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid message scope or identity".into());
    }
    Ok(value)
}

fn submission_dir(
    app: &tauri::AppHandle,
    work_id: &str,
    session_id: &str,
) -> Result<PathBuf, String> {
    Ok(profiled_config_dir(app)?
        .join("message-outbox")
        .join(submission_component(work_id)?)
        .join(submission_component(session_id)?))
}

fn write_submission(dir: &Path, message: &serde_json::Value) -> Result<(), String> {
    let turn_id = submission_component(message["turn_id"].as_str().ok_or("missing turn_id")?)?;
    let path = dir.join(format!("{turn_id}.json"));
    if path.exists() {
        let mut previous: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let mut proposed = message.clone();
        for key in ["delivery_status", "rejection_reason"] {
            previous
                .as_object_mut()
                .ok_or("invalid stored message")?
                .remove(key);
            proposed
                .as_object_mut()
                .ok_or("invalid message")?
                .remove(key);
        }
        if previous != proposed {
            return Err("message identity conflict".into());
        }
        if message["delivery_status"] != "rejected" {
            return Ok(());
        }
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let temporary = dir.join(format!("{turn_id}.tmp"));
    let contents = serde_json::to_vec(message).map_err(|e| e.to_string())?;
    std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
    restrict_secret_file_permissions(&temporary)?;
    std::fs::write(&temporary, contents).map_err(|e| e.to_string())?;
    std::fs::File::open(&temporary)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_user_message(app: tauri::AppHandle, message: serde_json::Value) -> Result<(), String> {
    let _guard = OUTBOX_LOCK.lock().map_err(|e| e.to_string())?;
    let work = message["work_id"].as_str().ok_or("missing work_id")?;
    let session = message["session_id"].as_str().ok_or("missing session_id")?;
    if message["text"]
        .as_str()
        .map_or(true, |text| text.trim().is_empty())
    {
        return Err("empty message".into());
    }
    write_submission(&submission_dir(&app, work, session)?, &message)
}

#[tauri::command]
fn list_user_messages(
    app: tauri::AppHandle,
    work_id: String,
    session_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let _guard = OUTBOX_LOCK.lock().map_err(|e| e.to_string())?;
    let dir = submission_dir(&app, &work_id, &session_id)?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut messages = vec![];
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().is_some_and(|ext| ext == "json") {
            messages.push(
                serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?,
            );
        }
    }
    Ok(messages)
}

#[tauri::command]
fn remove_user_message(
    app: tauri::AppHandle,
    work_id: String,
    session_id: String,
    turn_id: String,
) -> Result<(), String> {
    let _guard = OUTBOX_LOCK.lock().map_err(|e| e.to_string())?;
    let path = submission_dir(&app, &work_id, &session_id)?
        .join(format!("{}.json", submission_component(&turn_id)?));
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
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

    update_preferences_at(&preferences_path(&app)?, |value| {
        value["last_opened_work_id"] = serde_json::json!(id);
        Ok(())
    })?;
    Ok(())
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
    update_preferences_at(&preferences_path(&app)?, |value| {
        let names = preference_object(value, "assistant_display_names")?;
        match &display_name {
            Some(name) => {
                names.insert(work_id.clone(), serde_json::json!(name));
            }
            None => {
                names.remove(&work_id);
            }
        }
        Ok(())
    })?;
    Ok(display_name)
}

#[tauri::command]
fn get_model_provider_settings(app: tauri::AppHandle) -> Result<ModelProviderSettings, String> {
    let preferences = read_preferences(&app)?;
    settings_with_key_state(&app, &preferences.model_provider)
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
        delete_provider_api_key(&app, &provider)?;
    } else if let Some(key) = api_key {
        set_provider_api_key(&app, &provider, &key)?;
    }

    let updated = ModelProviderPreference {
        model: normalize_optional_text(input.model, MAX_PROVIDER_FIELD_LENGTH),
        endpoint: normalize_optional_text(input.endpoint, MAX_PROVIDER_FIELD_LENGTH),
        thinking: normalize_provider_thinking(input.thinking),
        reasoning_effort: normalize_optional_text(
            input.reasoning_effort,
            MAX_PROVIDER_FIELD_LENGTH,
        ),
        purpose_models: normalize_purpose_models(input.purpose_models),
    };
    let preferences = set_provider_preferences_at(
        &preferences_path(&app)?,
        &selected_provider,
        &provider,
        &updated,
    )?;
    settings_with_key_state(&app, &preferences.model_provider)
}

fn set_provider_preferences_at(
    path: &Path,
    selected_provider: &str,
    provider: &str,
    updated: &ModelProviderPreference,
) -> Result<Preferences, String> {
    update_preferences_at(path, |value| {
        let settings = preference_object(value, "model_provider")?;
        settings.insert(
            "selected_provider".into(),
            serde_json::json!(selected_provider),
        );
        let providers = settings
            .entry("providers")
            .or_insert_with(|| serde_json::json!({}));
        let current = preference_object(providers, provider)?;
        let fields = serde_json::to_value(updated).map_err(|e| e.to_string())?;
        for (key, value) in fields.as_object().ok_or("invalid provider update")? {
            current.insert(key.clone(), value.clone());
        }
        Ok(())
    })
}

#[tauri::command]
fn get_model_provider_api_key(
    app: tauri::AppHandle,
    provider: String,
) -> Result<Option<String>, String> {
    let provider = normalize_provider_id(provider)?;
    get_provider_api_key(&app, &provider)
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

/// D6 按用途分模型（tasks/slices/D6-purpose-model-routing.md）：只收白名单用途键与
/// 非空模型名，未知键/空值一律丢弃（跟随全局）。
const PURPOSE_ROUTE_KEYS: [&str; 4] = ["writer", "planner", "evaluator", "fact_inventory"];

fn normalize_purpose_models(value: Option<HashMap<String, String>>) -> HashMap<String, String> {
    let mut result = HashMap::new();
    if let Some(map) = value {
        for key in PURPOSE_ROUTE_KEYS {
            if let Some(model) =
                normalize_optional_text(map.get(key).cloned(), MAX_PROVIDER_FIELD_LENGTH)
            {
                result.insert(key.to_string(), model);
            }
        }
    }
    result
}

fn normalize_provider_thinking(value: Option<String>) -> Option<String> {
    match value.as_deref() {
        Some("enabled") => Some("enabled".into()),
        Some("disabled") => Some("disabled".into()),
        _ => None,
    }
}

fn settings_with_key_state(
    app: &tauri::AppHandle,
    preferences: &ModelProviderPreferences,
) -> Result<ModelProviderSettings, String> {
    let secrets = read_provider_secrets(app)?;
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
                purpose_models: stored.purpose_models,
                api_key_configured: provider_secret_present(&secrets, provider),
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

// ── provider API key 本地文件存储（替代 macOS Keychain）──────────────────

fn provider_secrets_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(profiled_config_dir(app)?.join(PROVIDER_SECRETS_FILE))
}

fn read_provider_secrets(app: &tauri::AppHandle) -> Result<ProviderSecrets, String> {
    read_provider_secrets_at(&provider_secrets_path(app)?)
}

fn write_provider_secrets(app: &tauri::AppHandle, secrets: &ProviderSecrets) -> Result<(), String> {
    write_provider_secrets_at(&provider_secrets_path(app)?, secrets)
}

fn get_provider_api_key(app: &tauri::AppHandle, provider: &str) -> Result<Option<String>, String> {
    let secrets = read_provider_secrets(app)?;
    Ok(secrets
        .api_keys
        .get(provider)
        .filter(|value| !value.is_empty())
        .cloned())
}

fn set_provider_api_key(
    app: &tauri::AppHandle,
    provider: &str,
    api_key: &str,
) -> Result<(), String> {
    let mut secrets = read_provider_secrets(app)?;
    secrets
        .api_keys
        .insert(provider.to_string(), api_key.to_string());
    write_provider_secrets(app, &secrets)
}

fn delete_provider_api_key(app: &tauri::AppHandle, provider: &str) -> Result<(), String> {
    let mut secrets = read_provider_secrets(app)?;
    if secrets.api_keys.remove(provider).is_some() {
        write_provider_secrets(app, &secrets)?;
    }
    Ok(())
}

fn read_provider_secrets_at(path: &Path) -> Result<ProviderSecrets, String> {
    match std::fs::read_to_string(path) {
        Ok(contents) if contents.trim().is_empty() => Ok(ProviderSecrets::default()),
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|error| format!("failed to parse provider secrets: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(ProviderSecrets::default())
        }
        Err(error) => Err(format!("failed to read provider secrets: {error}")),
    }
}

fn write_provider_secrets_at(path: &Path, secrets: &ProviderSecrets) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(secrets)
        .map_err(|error| format!("failed to encode provider secrets: {error}"))?;

    std::fs::write(path, contents)
        .map_err(|error| format!("failed to write provider secrets: {error}"))?;

    restrict_secret_file_permissions(path)
}

fn provider_secret_present(secrets: &ProviderSecrets, provider: &str) -> bool {
    secrets
        .api_keys
        .get(provider)
        .map(|value| !value.is_empty())
        .unwrap_or(false)
}

#[cfg(unix)]
fn restrict_secret_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("failed to restrict provider secrets permissions: {error}"))
}

#[cfg(not(unix))]
fn restrict_secret_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn model_provider_secret_storage_status() -> ModelProviderSecretStorageStatus {
    ModelProviderSecretStorageStatus {
        available: true,
        kind: "local_file",
        platform: std::env::consts::OS,
    }
}

// ── Phoenix sidecar 后端进程管理 ───────────────────────────────────────────
//
// 打包后端是一个完整的 Mix release（目录树，非单文件），随应用以 Tauri resource
// 形式分发。首启时把它从只读 bundle 拷到可写的用户数据目录并补可执行位，再以
// 子进程方式 `bin/sidecar start` 拉起；应用退出时杀掉该子进程。
// 端口 / 数据目录与 config/runtime.exs、tauri.conf.json CSP 对齐。
// 详见 docs/design/tech-stack/05-desktop.md。

const SIDECAR_PORT: &str = "4658";

struct SidecarChild(Mutex<Option<Child>>);

// 桌面启动状态：author-visible 失败分类只暴露有限状态词，不把原始错误/路径塞进 UI。
struct SidecarStatus(Mutex<String>);

fn set_sidecar_status(app: &tauri::AppHandle, value: &str) {
    if let Some(state) = app.try_state::<SidecarStatus>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = value.to_string();
        }
    }
}

#[tauri::command]
fn get_sidecar_startup_status(app: tauri::AppHandle) -> String {
    app.try_state::<SidecarStatus>()
        .and_then(|state| state.0.lock().ok().map(|guard| guard.clone()))
        .unwrap_or_else(|| "unknown".to_string())
}

fn profiled_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?;

    if let Some(profile) = desktop_profile()? {
        dir = dir.join("profiles").join(profile);
    }

    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create app data dir: {error}"))?;

    Ok(dir)
}

fn sidecar_bin_path(install_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        install_dir.join("bin").join("sidecar.bat")
    } else {
        install_dir.join("bin").join("sidecar")
    }
}

// 首启把 release tarball 从只读 resource 目录解包到可写数据目录（按版本隔离，
// 升级自动重解），返回安装目录；已安装则直接复用。tar 保留权限与可执行位。
//
// CP1（SU04 生命周期）：安装完成以 `.install-complete` marker 为准，且 bin 必须同时
// 存在才复用；tar 失败只污染 staging 目录，成功后才原子替换正式目录，避免半解包
// 被下一次启动误判为已安装。
fn sidecar_install_complete(install_dir: &Path) -> bool {
    install_dir.join(".install-complete").is_file() && sidecar_bin_path(install_dir).exists()
}

fn ensure_sidecar_installed(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("failed to resolve resource dir: {error}"))?;

    let install_dir = profiled_data_dir(app)?
        .join("runtime")
        .join(format!("sidecar-{}", env!("CARGO_PKG_VERSION")));

    if sidecar_install_complete(&install_dir) {
        return Ok(install_dir);
    }

    // Tauri 资源放置位置随映射写法不同（Resources/ 或 Resources/resources/），两处都探。
    let archive = ["sidecar.tar.gz", "resources/sidecar.tar.gz"]
        .iter()
        .map(|rel| resource_dir.join(rel))
        .find(|candidate| candidate.exists())
        .ok_or_else(|| {
            format!(
                "sidecar archive not bundled under {}",
                resource_dir.display()
            )
        })?;

    let staging_dir =
        install_dir.with_file_name(format!("sidecar-{}.staging", env!("CARGO_PKG_VERSION")));

    // 失败批次保留只读：staging 残留可用于诊断，下次启动先清 staging 再重解。
    let _ = std::fs::remove_dir_all(&staging_dir);
    std::fs::create_dir_all(&staging_dir)
        .map_err(|error| format!("failed to create {}: {error}", staging_dir.display()))?;

    let status = Command::new("tar")
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(&staging_dir)
        .status()
        .map_err(|error| format!("failed to run tar: {error}"))?;

    if !status.success() {
        return Err(format!("tar extraction failed with status {status}"));
    }

    // 解包成功后才替换正式目录并写 marker；marker 缺失的旧目录按半解包处理。
    let _ = std::fs::remove_dir_all(&install_dir);
    std::fs::rename(&staging_dir, &install_dir).map_err(|error| {
        format!(
            "failed to activate sidecar install {}: {error}",
            install_dir.display()
        )
    })?;

    std::fs::write(
        install_dir.join(".install-complete"),
        env!("CARGO_PKG_VERSION"),
    )
    .map_err(|error| format!("failed to write sidecar install marker: {error}"))?;

    Ok(install_dir)
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<Child, String> {
    let install_dir = ensure_sidecar_installed(app)?;
    let data_dir = profiled_data_dir(app)?;
    let bin = sidecar_bin_path(&install_dir);

    // sidecar 输出落到数据目录日志文件——GUI（LaunchServices）启动时 stderr
    // 无处可去，否则后端启动失败将完全不可见。
    let log_dir = data_dir.join("log");
    std::fs::create_dir_all(&log_dir)
        .map_err(|error| format!("failed to create sidecar log dir: {error}"))?;
    let log_path = log_dir.join("sidecar.out");
    let stdout = std::fs::File::create(&log_path)
        .map_err(|error| format!("failed to create sidecar log: {error}"))?;
    let stderr = stdout
        .try_clone()
        .map_err(|error| format!("failed to clone sidecar log handle: {error}"))?;

    // GUI 启动的进程 PATH 被精简，bin/sidecar 引导脚本依赖 awk/cut/readlink 等，
    // 显式补上标准系统目录，保证脚本可用。
    let path = match std::env::var("PATH") {
        Ok(existing) => format!("/usr/bin:/bin:/usr/sbin:/sbin:{existing}"),
        Err(_) => "/usr/bin:/bin:/usr/sbin:/sbin".to_string(),
    };

    // 用户系统配置的模型上下文窗口：从 preferences.json 读取（profile 隔离），
    // 渲染成 provider:window,... 注入 sidecar。坏偏好/缺省时保持代码默认表。
    let context_windows = read_preferences(app)
        .map(|preferences| preferences.context_windows)
        .unwrap_or_default();
    let window_overrides = render_context_window_overrides(&context_windows);

    // 本机单实例 sidecar，不需要 Erlang 分布式 / epmd。
    // cwd 设为可写数据目录：GUI（LaunchServices）启动时 cwd 是只读的 "/"，
    // 任何 cwd 相对路径写入都会 erofs 崩溃。
    let mut command = Command::new(&bin);
    command
        .arg("start")
        .current_dir(&data_dir)
        .env("PATH", path)
        .env("NOVEL_DATA_DIR", &data_dir)
        .env("PHOENIX_PORT", SIDECAR_PORT)
        .env("RELEASE_DISTRIBUTION", "none")
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    if let Some(value) = window_overrides.as_deref() {
        command.env("NOVEL_CONTEXT_WINDOW_OVERRIDES", value);
    }

    // Unix：独立进程组，退出时杀整组，避免 release 引导脚本派生的子进程成为孤儿。
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to spawn sidecar: {error}"))?;

    // 就绪分类：端口监听成功才算 ready；进程提前退出与超时都显式报错并回收子进程。
    match wait_for_sidecar_port(
        SIDECAR_PORT.parse().expect("valid sidecar port"),
        std::time::Duration::from_secs(15),
    ) {
        Ok(()) => Ok(child),
        Err(ready_error) => {
            let early_exit = matches!(child.try_wait(), Ok(Some(_)));
            // 启动失败同样必须杀整个进程组，否则引导脚本派生的 beam 会残留。
            terminate_sidecar_group(&mut child);

            if early_exit {
                Err(format!("sidecar exited before ready: {ready_error}"))
            } else {
                Err(ready_error)
            }
        }
    }
}

// CP1：就绪探测（端口可连接）——spawn 成功不代表 Phoenix 已完成迁移并开始监听。
// 只做 std TCP 探测，避免引入新依赖；早退/超时返回分类错误，由启动路径记录。
fn wait_for_sidecar_port(port: u16, timeout: std::time::Duration) -> Result<(), String> {
    let deadline = std::time::Instant::now() + timeout;
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));

    while std::time::Instant::now() < deadline {
        if std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(200))
            .is_ok()
        {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    Err(format!(
        "sidecar port {port} was not ready within {}s",
        timeout.as_secs()
    ))
}

// CP1：统一终止 sidecar。正常退出与启动失败清理必须走同一路径——只 kill 直接
// 子进程（release 引导脚本）会留下它派生的 beam 子进程成为孤儿。
fn terminate_sidecar_group(child: &mut Child) {
    #[cfg(unix)]
    {
        // 进程组 leader 的 pid 同时是组 id；负号向整组发 TERM，wait 超时再 KILL。
        let group = format!("-{}", child.id());
        let _ = Command::new("/bin/kill").arg("-TERM").arg(&group).status();
        for _ in 0..20 {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let _ = Command::new("/bin/kill").arg("-KILL").arg(&group).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn shutdown_sidecar(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarChild>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                terminate_sidecar_group(&mut child);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试拥有的系统临时目录：作用域结束（含断言失败/panic 展开）时删除。
    /// 用 RAII 而非在断言后手动清理，避免失败路径越过清理语句。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos();
            let dir =
                std::env::temp_dir().join(format!("ai-novel-{tag}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(&dir).expect("create temp dir");
            Self(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn preference_patch_preserves_unknown_nested_fields() {
        let guard = TempDir::new("preferences-preserve");
        let path = guard.path().join("preferences.json");
        let original = serde_json::json!({
            "extension": {"future": [1, 2]},
            "model_provider": {"future": true, "providers": {
                "splash": {"endpoint": "http://example.invalid", "future": {"mode": 9}}
            }},
            "context_windows": {"strata": 32000}
        });
        std::fs::write(&path, original.to_string()).unwrap();
        update_preferences_at(&path, |value| {
            value["context_windows"]["splash"] = serde_json::json!(64000);
            Ok(())
        })
        .unwrap();
        let actual: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(actual["extension"], original["extension"]);
        assert_eq!(actual["model_provider"], original["model_provider"]);
        set_provider_preferences_at(
            &path,
            "splash",
            "splash",
            &ModelProviderPreference {
                endpoint: Some("http://new.invalid".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let patched: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(patched["model_provider"]["future"], true);
        assert_eq!(
            patched["model_provider"]["providers"]["splash"]["future"],
            serde_json::json!({"mode":9})
        );
        assert_eq!(
            patched["model_provider"]["providers"]["splash"]["endpoint"],
            "http://new.invalid"
        );
        assert_eq!(patched["context_windows"], actual["context_windows"]);

        assert_eq!(
            actual["context_windows"],
            serde_json::json!({"strata":32000,"splash":64000})
        );
    }

    #[test]
    fn context_window_patch_is_bounded_and_rejects_invalid_input() {
        let guard = TempDir::new("preferences-window");
        let path = guard.path().join("preferences.json");
        assert_eq!(
            saved_context_window_at(&path, "splash".into())
                .unwrap()
                .saved_window,
            None
        );
        for window in [serde_json::json!(1), serde_json::json!(u32::MAX)] {
            let result = set_context_window_at(&path, "splash".into(), window.clone()).unwrap();
            assert_eq!(
                serde_json::to_value(result).unwrap(),
                serde_json::json!({"provider":"splash","saved_window":window})
            );
        }
        let original = std::fs::read(&path).unwrap();
        for bad in [
            serde_json::json!(0),
            serde_json::json!(-1),
            serde_json::json!(1.5),
            serde_json::json!(4294967296u64),
            serde_json::json!("64000"),
            serde_json::json!(true),
        ] {
            assert!(set_context_window_at(&path, "splash".into(), bad).is_err());
            assert_eq!(std::fs::read(&path).unwrap(), original);
        }
        assert!(set_context_window_at(&path, "unknown".into(), serde_json::Value::Null).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        set_context_window_at(&path, "strata".into(), serde_json::json!(32000)).unwrap();
        set_context_window_at(&path, "splash".into(), serde_json::Value::Null).unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            value["context_windows"],
            serde_json::json!({"strata":32000})
        );
    }

    #[test]
    fn persisted_zero_window_is_unreadable_not_missing_and_other_provider_patch_preserves_it() {
        let guard = TempDir::new("preferences-zero");
        let path = guard.path().join("preferences.json");
        let original = r#"{"context_windows":{"splash":0},"extension":{"keep":true}}"#;
        std::fs::write(&path, original).unwrap();
        assert!(saved_context_window_at(&path, "splash".into()).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        assert_eq!(
            saved_context_window_at(&path, "strata".into())
                .unwrap()
                .saved_window,
            None
        );
        set_context_window_at(&path, "strata".into(), serde_json::json!(64000)).unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"context_windows":{"splash":0,"strata":64000},"extension":{"keep":true}})
        );
        assert!(saved_context_window_at(&path, "splash".into()).is_err());
        assert_eq!(
            saved_context_window_at(&path, "strata".into())
                .unwrap()
                .saved_window,
            Some(64000)
        );
    }

    #[test]
    fn malformed_preferences_are_never_replaced() {
        let guard = TempDir::new("preferences-invalid");
        let path = guard.path().join("preferences.json");
        for invalid in [
            "",
            "{",
            "[]",
            "null",
            r#"{"context_windows":{"splash":"64000"}}"#,
        ] {
            std::fs::write(&path, invalid).unwrap();
            assert!(
                set_context_window_at(&path, "splash".into(), serde_json::json!(64000)).is_err()
            );
            assert_eq!(std::fs::read_to_string(&path).unwrap(), invalid);
        }
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(set_context_window_at(&path, "splash".into(), serde_json::json!(64000)).is_err());
        assert!(path.is_dir());
    }

    #[test]
    fn preference_rmw_rejects_non_object_roots_before_running_patch() {
        let guard = TempDir::new("preferences-root-shape");
        let path = guard.path().join("preferences.json");
        for invalid in ["[]", "[null]", "null", "true", "17", r#""text""#] {
            let original = invalid.as_bytes().to_vec();
            std::fs::write(&path, &original).unwrap();
            // Fail before the locked patch in the red state, so the test cannot poison the owner.
            assert!(
                read_preference_value(&path).is_err(),
                "accepted non-object preferences root: {invalid}"
            );
            let mut patch_ran = false;
            let result = update_preferences_at(&path, |value| {
                patch_ran = true;
                value["last_opened_work_id"] = serde_json::json!("work");
                Ok(())
            });
            assert!(result.is_err(), "updated non-object root: {invalid}");
            assert!(!patch_ran, "ran patch for non-object root: {invalid}");
            assert_eq!(std::fs::read(&path).unwrap(), original);
        }

        std::fs::write(&path, b"{}").unwrap();
        let updated = update_preferences_at(&path, |value| {
            value["last_opened_work_id"] = serde_json::json!("work");
            Ok(())
        })
        .unwrap();
        assert_eq!(updated.last_opened_work_id.as_deref(), Some("work"));
    }

    #[test]
    fn preferences_concurrent_writers_merge_latest_and_profiles_are_isolated() {
        let guard = TempDir::new("preferences-concurrent");
        let path = guard.path().join("preferences.json");
        let gate = std::sync::Arc::new(std::sync::Barrier::new(3));
        let mut workers = Vec::new();
        for index in 0..3 {
            let path = path.clone();
            let gate = gate.clone();
            workers.push(std::thread::spawn(move || {
                gate.wait();
                if index == 0 {
                    set_context_window_at(&path, "splash".into(), serde_json::json!(64000))
                        .unwrap();
                } else if index == 1 {
                    update_preferences_at(&path, |value| {
                        value["last_opened_work_id"] = serde_json::json!("work");
                        Ok(())
                    })
                    .unwrap();
                } else {
                    set_provider_preferences_at(
                        &path,
                        "splash",
                        "splash",
                        &ModelProviderPreference {
                            endpoint: Some("http://local.invalid".into()),
                            ..Default::default()
                        },
                    )
                    .unwrap();
                }
            }));
        }
        for worker in workers {
            worker.join().unwrap();
        }
        let saved = read_preferences_at(&path).unwrap();
        assert_eq!(saved.context_windows["splash"], 64000);
        assert_eq!(saved.last_opened_work_id.as_deref(), Some("work"));
        assert_eq!(
            saved.model_provider.providers["splash"].endpoint.as_deref(),
            Some("http://local.invalid")
        );
        for profile in ["dev", "stage", "slice-verify", "release"] {
            let dir = guard.path().join(profile);
            std::fs::create_dir(&dir).unwrap();
            let separate = dir.join("preferences.json");
            assert_eq!(
                saved_context_window_at(&separate, "splash".into())
                    .unwrap()
                    .saved_window,
                None
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn preference_write_failure_keeps_old_bytes_permissions_and_rejects_links() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let guard = TempDir::new("preferences-atomic");
        let path = guard.path().join("preferences.json");
        std::fs::write(&path, r#"{"extension":{"keep":true}}"#).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        set_context_window_at(&path, "splash".into(), serde_json::json!(64000)).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let before = std::fs::read(&path).unwrap();
        std::fs::set_permissions(guard.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
        let result = set_context_window_at(&path, "splash".into(), serde_json::json!(32000));
        std::fs::set_permissions(guard.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(result.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(std::fs::read_dir(guard.path()).unwrap().count(), 1);
        let link = guard.path().join("linked.json");
        symlink(&path, &link).unwrap();
        assert!(set_context_window_at(&link, "splash".into(), serde_json::json!(32000)).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[cfg(unix)]
    #[test]
    fn readonly_preference_file_is_not_bypassed_by_rename() {
        use std::os::unix::fs::PermissionsExt;
        let guard = TempDir::new("preferences-readonly");
        let path = guard.path().join("preferences.json");
        std::fs::write(&path, "{}").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o400)).unwrap();
        let result = set_context_window_at(&path, "splash".into(), serde_json::json!(64000));
        let actual = std::fs::read(&path).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(result.is_err());
        assert_eq!(actual, b"{}");
        assert_eq!(mode, 0o400);
    }

    #[test]
    fn colliding_staged_file_is_not_deleted_or_overwritten() {
        let guard = TempDir::new("preferences-stale-stage");
        let path = guard.path().join("preferences.json");
        std::fs::write(&path, "{}").unwrap();
        let result;
        let temporary;
        {
            let _lock = PREFERENCES_LOCK.lock().unwrap();
            let id = PREFERENCE_TEMP_ID.load(std::sync::atomic::Ordering::Relaxed);
            temporary = guard
                .path()
                .join(format!(".preferences-{}-{id}.tmp", std::process::id()));
            std::fs::write(&temporary, "unowned staged bytes").unwrap();
            result = write_preference_value(
                &path,
                &serde_json::json!({"context_windows":{"splash":64000}}),
            );
        }
        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(&temporary).unwrap(),
            "unowned staged bytes"
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
    }

    #[test]
    fn sidecar_install_requires_marker_and_bin() {
        let guard = TempDir::new("sidecar-install-test");
        let dir = guard.path();
        std::fs::create_dir_all(dir.join("bin")).expect("mkdir");
        assert!(!super::sidecar_install_complete(dir));

        std::fs::write(super::sidecar_bin_path(dir), b"#!/bin/sh\n").expect("write bin");
        assert!(!super::sidecar_install_complete(dir));

        std::fs::write(dir.join(".install-complete"), "test").expect("write marker");
        assert!(super::sidecar_install_complete(dir));
    }

    #[test]
    fn context_window_overrides_render_deterministically() {
        let mut windows = std::collections::HashMap::new();
        windows.insert("strata".to_string(), 524_288u32);
        windows.insert("openai".to_string(), 128_000u32);
        windows.insert("".to_string(), 1u32);
        windows.insert("zero".to_string(), 0u32);
        assert_eq!(
            super::render_context_window_overrides(&windows).as_deref(),
            Some("openai:128000,strata:524288")
        );
        assert_eq!(
            super::render_context_window_overrides(&std::collections::HashMap::new()),
            None
        );
    }

    #[test]
    fn sidecar_readiness_probe_detects_listening_and_closed_ports() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        assert!(
            super::wait_for_sidecar_port(port, std::time::Duration::from_secs(1)).is_ok(),
            "listening port should be ready"
        );
        drop(listener);

        let closed = super::wait_for_sidecar_port(port, std::time::Duration::from_millis(300));
        assert!(closed.is_err(), "closed port must not report ready");
    }

    #[test]
    fn normalize_purpose_models_keeps_whitelisted_non_empty_entries() {
        let mut input = std::collections::HashMap::new();
        input.insert("writer".to_string(), " m-writer ".to_string());
        input.insert("planner".to_string(), "".to_string());
        input.insert("bogus".to_string(), "m-x".to_string());

        let result = super::normalize_purpose_models(Some(input));

        assert_eq!(result.get("writer"), Some(&"m-writer".to_string()));
        assert!(!result.contains_key("planner"));
        assert!(!result.contains_key("bogus"));

        assert!(super::normalize_purpose_models(None).is_empty());
    }

    fn temp_secrets_dir(tag: &str) -> TempDir {
        TempDir::new(&format!("secrets-{tag}"))
    }

    fn temp_secrets_path(tag: &str) -> (TempDir, PathBuf) {
        let guard = temp_secrets_dir(tag);
        let path = guard.path().join(PROVIDER_SECRETS_FILE);
        (guard, path)
    }

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
    fn pending_message_is_durable_immutable_and_scoped() {
        let root = temp_secrets_dir("message-outbox");
        let dir = root.path().join("work-a").join("session-a");
        let message = serde_json::json!({"turn_id":"message-1","work_id":"work-a","session_id":"session-a","text":"  原文\n不改写  "});
        write_submission(&dir, &message).expect("write before send");
        write_submission(&dir, &message).expect("same identity is idempotent");
        let restored: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("message-1.json")).unwrap())
                .unwrap();
        assert_eq!(restored, message);
        let mut rejected = message.clone();
        rejected["delivery_status"] = serde_json::json!("rejected");
        write_submission(&dir, &rejected).expect("keep rejected original");
        write_submission(&dir, &message).expect("cannot clear rejection by retransmitting");
        let retained: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("message-1.json")).unwrap())
                .unwrap();
        assert_eq!(retained["delivery_status"], "rejected");
        assert!(!root
            .path()
            .join("work-b")
            .join("session-a")
            .join("message-1.json")
            .exists());
        let mut changed = message.clone();
        changed["text"] = serde_json::json!("different");
        assert!(write_submission(&dir, &changed).is_err());
        assert!(submission_component("../other").is_err());
        assert!(submission_component("a/b").is_err());
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
    fn reports_local_file_secret_storage_capability() {
        let status = model_provider_secret_storage_status();
        assert!(status.available);
        assert_eq!(status.kind, "local_file");
        assert!(!status.platform.is_empty());
    }

    #[test]
    fn provider_secrets_round_trip_through_local_file() {
        let (_guard, path) = temp_secrets_path("round-trip");

        // 缺文件视为空：判断"是否已配置"绝不读不存在的密钥，也绝不报错。
        let empty = read_provider_secrets_at(&path).expect("missing file reads as empty");
        assert!(!provider_secret_present(&empty, "deepseek"));

        let mut secrets = ProviderSecrets::default();
        secrets.api_keys.insert("deepseek".into(), "sk-test".into());
        write_provider_secrets_at(&path, &secrets).expect("write secrets");

        let loaded = read_provider_secrets_at(&path).expect("read secrets");
        assert_eq!(
            loaded.api_keys.get("deepseek").map(String::as_str),
            Some("sk-test")
        );
        assert!(provider_secret_present(&loaded, "deepseek"));
    }

    #[test]
    fn accepts_openai_compatible_vendor_matrix_and_rejects_unknown() {
        for vendor in [
            "openai",
            "openai_subscription",
            "minimax",
            "minimax_cn",
            "zhipu",
            "kimi",
            "gemini",
        ] {
            assert_eq!(
                normalize_provider_id(vendor.to_string()).expect("vendor should be allowed"),
                vendor
            );
        }

        assert!(normalize_provider_id("not-a-vendor".to_string()).is_err());
    }

    #[test]
    fn accepts_local_provider_ids_and_rejects_unknown() {
        for provider in ["lmstudio", "splash", "strata"] {
            assert_eq!(
                normalize_provider_id(provider.to_string())
                    .expect("local provider should be allowed"),
                provider
            );
        }

        assert!(normalize_provider_id("not-a-provider".to_string()).is_err());
    }

    #[test]
    fn openai_api_key_and_subscription_secrets_are_isolated_per_auth_method() {
        let (_guard, path) = temp_secrets_path("openai-auth-methods");

        let mut secrets = ProviderSecrets::default();
        secrets.api_keys.insert("openai".into(), "sk-api".into());
        secrets
            .api_keys
            .insert("openai_subscription".into(), "tok-sub".into());
        write_provider_secrets_at(&path, &secrets).expect("write secrets");

        let loaded = read_provider_secrets_at(&path).expect("read secrets");
        assert_eq!(
            loaded.api_keys.get("openai").map(String::as_str),
            Some("sk-api")
        );
        assert_eq!(
            loaded
                .api_keys
                .get("openai_subscription")
                .map(String::as_str),
            Some("tok-sub")
        );
        assert!(provider_secret_present(&loaded, "openai"));
        assert!(provider_secret_present(&loaded, "openai_subscription"));
    }

    #[cfg(unix)]
    #[test]
    fn secret_file_is_written_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let (_guard, path) = temp_secrets_path("perms");
        write_provider_secrets_at(&path, &ProviderSecrets::default()).expect("write secrets");

        let mode = std::fs::metadata(&path)
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn temp_dir_guard_removes_directory_when_test_panics() {
        let guard = TempDir::new("guard-panic");
        let path = guard.path().to_path_buf();
        assert!(path.exists(), "guard must create the directory");

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _guard = guard;
            panic!("intentional panic to prove guard cleanup");
        }));

        assert!(result.is_err(), "intentional panic must be caught");
        assert!(
            !path.exists(),
            "guard must remove its directory while unwinding"
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_user_message,
            list_user_messages,
            remove_user_message,
            get_sidecar_startup_status,
            get_last_opened_work_id,
            set_last_opened_work_id,
            get_assistant_display_name,
            set_assistant_display_name,
            get_model_provider_settings,
            get_model_context_window,
            set_model_context_window,
            set_model_provider_settings,
            get_model_provider_api_key,
            get_model_provider_secret_storage_status
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                // 开发态：后端由 scripts/dev.sh 的 `mix phx.server` 提供，不在此拉起 sidecar。
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            } else {
                // 打包态：拉起自包含的 Phoenix sidecar 后端。启动/就绪等待放到后台线程，
                // 不让窗口被 15s 探测阻塞；状态供前端在失败后给出恢复文案。
                app.manage(SidecarStatus(Mutex::new("starting".to_string())));
                let handle = app.handle().clone();

                std::thread::spawn(move || match spawn_sidecar(&handle) {
                    Ok(child) => {
                        handle.manage(SidecarChild(Mutex::new(Some(child))));
                        set_sidecar_status(&handle, "ready");
                    }
                    Err(error) => {
                        eprintln!("[sidecar] 启动失败: {error}");
                        set_sidecar_status(&handle, "failed");
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            shutdown_sidecar(app_handle);
        }
    });
}
