use std::process::Command;

use super::anim::Rect;

const TITLES: [&str; 2] = ["HashiMemo", "hashimemo"];

pub fn available() -> bool {
    std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some()
}

fn hyprctl(args: &[&str]) -> Option<String> {
    let out = Command::new("hyprctl").args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

fn selector() -> Option<String> {
    let clients = hyprctl(&["clients", "-j"])?;
    let parsed: serde_json::Value = serde_json::from_str(&clients).ok()?;
    let list = parsed.as_array()?;

    list.iter().find_map(|client| {
        let class = client.get("class").and_then(|v| v.as_str()).unwrap_or("");
        let title = client.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let hit = TITLES.contains(&title) || class.to_ascii_lowercase().contains("hashimemo");
        hit.then(|| {
            client
                .get("address")
                .and_then(|v| v.as_str())
                .map(|address| format!("address:{address}"))
        })
        .flatten()
    })
}

fn dispatch(cmd: &str, selector: &str, value: Option<&str>) -> bool {
    let mut args = vec![cmd, value.unwrap_or(selector)];
    if value.is_some() {
        args.push(selector);
    }
    hyprctl(&["dispatch", &args.join(" ")]).is_some()
}

fn place_with(selector: &str, rect: Rect) {
    let size = format!("exact {} {}", rect.w, rect.h);
    let corner = format!("exact {} {}", rect.x, rect.y);

    dispatch("setfloating", selector, None);
    dispatch("pin", selector, None);
    dispatch("resizewindowpixel", selector, Some(&size));
    dispatch("movewindowpixel", selector, Some(&corner));
}

pub fn place(rect: Rect) {
    if let Some(selector) = selector() {
        place_with(&selector, rect);
    }
}

pub fn release() {
    if let Some(selector) = selector() {
        dispatch("unpin", &selector, None);
        dispatch("togglefloating", &selector, None);
    }
}
