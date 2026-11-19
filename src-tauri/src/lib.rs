mod capture;
mod bubble;
mod settings;
pub mod notes;
mod window;

use tauri::{
    AppHandle, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn toggle_rail(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    if visible {
        let mode = app.state::<settings::SettingsState>().snapshot().minimize_mode;
        if mode == "bubble" {
            let _ = bubble::minimize(app);
        } else {
            window::release_area(&window);
            let _ = window.hide();
        }
    } else {
        if let Some(ball) = app.get_webview_window("bubble") {
            let _ = ball.hide();
        }
        let _ = window.show();
        window::reapply(app);
        let _ = window.set_focus();
    }
}

fn tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Mostrar/ocultar", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("HashiMemo — Ctrl+Alt+N")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "show" => toggle_rail(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_rail(tray.app_handle());
            }
        });

    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")) {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

fn hotkey(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);
    app.global_shortcut().on_shortcut(shortcut, |app, _, event| {
        if event.state == ShortcutState::Pressed {
            toggle_rail(app);
        }
    })?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    unsafe {
        let _ = windows::Win32::System::Console::FreeConsole();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(window::AppState::default())
        .setup(|app| {
            let handle = app.handle();
            let settings = settings::SettingsState::new(handle);
            settings::apply_autostart(handle, settings.snapshot().autostart);
            app.manage(settings);

            window::init(handle)?;
            window::watch_monitors(handle.clone());
            notes::init(handle)?;
            notes::start_reminders(handle.clone());
            tray(handle)?;
            hotkey(handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window::window_state,
            window::set_level,
            window::toggle_dock,
            bubble::minimize_to_bubble,
            bubble::bubble_restore,
            bubble::bubble_reset,
            bubble::bubble_position,
            bubble::bubble_move,
            bubble::bubble_drag_start,
            bubble::bubble_snap,
            bubble::bubble_locked,
            bubble::bubble_menu_open,
            bubble::bubble_menu_close,
            window::cycle_monitor,
            settings::get_settings,
            settings::update_settings,
            notes::notes_dir,
            notes::list_notes,
            notes::fetch_note,
            notes::create_note,
            notes::update_note,
            notes::delete_note,
            notes::search_notes,
            capture::capture_window
        ])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o HashiMemo")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(window) = app.get_webview_window("main") {
                    window::release_area(&window);
                }
            }
        });
}
