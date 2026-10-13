//! Desktop notifications. Best-effort: runs on a detached thread and silently
//! no-ops if the OS tool is missing. macOS uses osascript, Linux notify-send.

/// Notify that a spend window hit its cap. `title`/`body` come from the caller
/// so each binary can phrase its own message.
pub fn cap(title: &str, body: &str) {
    let title = title.to_string();
    let body = body.to_string();
    std::thread::spawn(move || {
        if cfg!(target_os = "macos") {
            let script = format!(
                "display notification \"{}\" with title \"{}\"",
                body.replace('\\', "\\\\").replace('"', "\\\""),
                title
            );
            let _ = std::process::Command::new("osascript")
                .arg("-e")
                .arg(script)
                .status();
        } else if cfg!(target_os = "linux") {
            let _ = std::process::Command::new("notify-send")
                .arg(&title)
                .arg(&body)
                .status();
        }
    });
}
