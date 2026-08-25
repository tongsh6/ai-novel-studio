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
const MODEL_PROVIDER_IDS: [&str; 11] = [
    "stub",
    "lmstudio",
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
            purpose_models: normalize_purpose_models(input.purpose_models),
        },
    );

    write_preferences(&app, &preferences)?;
    settings_with_key_state(&app, &preferences.model_provider)
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
fn ensure_sidecar_installed(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("failed to resolve resource dir: {error}"))?;

    let install_dir = profiled_data_dir(app)?
        .join("runtime")
        .join(format!("sidecar-{}", env!("CARGO_PKG_VERSION")));

    if sidecar_bin_path(&install_dir).exists() {
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

    // 干净重解：清掉同版本残留半成品，避免坏状态。
    let _ = std::fs::remove_dir_all(&install_dir);
    std::fs::create_dir_all(&install_dir)
        .map_err(|error| format!("failed to create {}: {error}", install_dir.display()))?;

    let status = Command::new("tar")
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(&install_dir)
        .status()
        .map_err(|error| format!("failed to run tar: {error}"))?;

    if !status.success() {
        return Err(format!("tar extraction failed with status {status}"));
    }

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

    // 本机单实例 sidecar，不需要 Erlang 分布式 / epmd。
    // cwd 设为可写数据目录：GUI（LaunchServices）启动时 cwd 是只读的 "/"，
    // 任何 cwd 相对路径写入都会 erofs 崩溃。
    Command::new(&bin)
        .arg("start")
        .current_dir(&data_dir)
        .env("PATH", path)
        .env("NOVEL_DATA_DIR", &data_dir)
        .env("PHOENIX_PORT", SIDECAR_PORT)
        .env("RELEASE_DISTRIBUTION", "none")
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| format!("failed to spawn sidecar: {error}"))
}

fn shutdown_sidecar(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarChild>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[cfg(test)]
mod tests {
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

    use super::*;

    fn temp_secrets_path(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "ai-novel-secrets-{tag}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir.join(PROVIDER_SECRETS_FILE)
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
        let path = temp_secrets_path("round-trip");

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

        let _ = std::fs::remove_dir_all(path.parent().expect("temp dir"));
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
    fn openai_api_key_and_subscription_secrets_are_isolated_per_auth_method() {
        let path = temp_secrets_path("openai-auth-methods");

        let mut secrets = ProviderSecrets::default();
        secrets.api_keys.insert("openai".into(), "sk-api".into());
        secrets
            .api_keys
            .insert("openai_subscription".into(), "tok-sub".into());
        write_provider_secrets_at(&path, &secrets).expect("write secrets");

        let loaded = read_provider_secrets_at(&path).expect("read secrets");
        assert_eq!(loaded.api_keys.get("openai").map(String::as_str), Some("sk-api"));
        assert_eq!(
            loaded.api_keys.get("openai_subscription").map(String::as_str),
            Some("tok-sub")
        );
        assert!(provider_secret_present(&loaded, "openai"));
        assert!(provider_secret_present(&loaded, "openai_subscription"));

        let _ = std::fs::remove_dir_all(path.parent().expect("temp dir"));
    }

    #[cfg(unix)]
    #[test]
    fn secret_file_is_written_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let path = temp_secrets_path("perms");
        write_provider_secrets_at(&path, &ProviderSecrets::default()).expect("write secrets");

        let mode = std::fs::metadata(&path)
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);

        let _ = std::fs::remove_dir_all(path.parent().expect("temp dir"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
                // 开发态：后端由 scripts/dev.sh 的 `mix phx.server` 提供，不在此拉起 sidecar。
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            } else {
                // 打包态：拉起自包含的 Phoenix sidecar 后端。失败不阻断窗口启动——
                // 前端会显示「同步离线 / 模型未连接」，用户至少能看到界面与错误。
                match spawn_sidecar(&app.handle().clone()) {
                    Ok(child) => {
                        app.manage(SidecarChild(Mutex::new(Some(child))));
                    }
                    Err(error) => eprintln!("[sidecar] 启动失败: {error}"),
                }
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
