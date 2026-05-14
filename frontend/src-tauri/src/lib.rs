use std::process::Command;
use tauri::Manager;

fn kill_phoenix_backend() {
  // 尝试通过端口查找并关闭 Phoenix 后端进程
  let port = std::env::var("PHOENIX_PORT").unwrap_or_else(|_| "4657".into());
  if let Ok(output) = Command::new("lsof")
    .args(["-ti", &format!(":{}", port)])
    .output()
  {
    let pids = String::from_utf8_lossy(&output.stdout);
    for pid in pids.lines() {
      if !pid.is_empty() {
        let _ = Command::new("kill").arg(pid).output();
      }
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
