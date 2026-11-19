mod bubble;
mod capture;
mod pin;
mod secure;
mod settings;
pub mod notes;
mod window;

use tauri::{
    AppHandle, Emitter, Manager,
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
        let mode = app
            .state::<settings::SettingsState>()
            .snapshot()
            .minimize_mode;
        if mode == "bubble" {
            let _ = app.emit_to("main", "app:collapse", ());
            std::thread::sleep(std::time::Duration::from_millis(230));
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
    use tauri::menu::CheckMenuItem;

    let show = MenuItem::with_id(app, "show", "Mostrar/ocultar", true, None::<&str>)?;
    let reset = MenuItem::with_id(app, "reset", "Resetar janelas", true, None::<&str>)?;
    let bubble_mode = app
        .state::<settings::SettingsState>()
        .snapshot()
        .minimize_mode
        == "bubble";
    let check = CheckMenuItem::with_id(
        app,
        "mode",
        "Minimizar em bolinha",
        true,
        bubble_mode,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &check, &reset, &quit])?;
    let toggler = check.clone();

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("HashiMemo — Ctrl+Alt+N")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "show" => toggle_rail(app),
            "reset" => window::reset_windows(app),
            "mode" => {
                let state = app.state::<settings::SettingsState>();
                let mut next = state.snapshot();
                next.minimize_mode = if next.minimize_mode == "bubble" {
                    "hide".into()
                } else {
                    "bubble".into()
                };
                let bubble = next.minimize_mode == "bubble";
                state.update(next.clone());
                settings::save(app, &next);
                let _ = toggler.set_checked(bubble);
            }
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
            if let Some(ball) = app.get_webview_window("bubble") {
                let _ = ball.hide();
            }
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
        .manage(secure::Vault::default())
        .setup(|app| {
            let handle = app.handle();
            let settings = settings::SettingsState::new(handle);
            settings::apply_autostart(handle, settings.snapshot().autostart);
            app.manage(settings);

            window::init(handle)?;
            window::watch_monitors(handle.clone());
            bubble::init(handle);
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
            notes::set_protected,
            notes::open_notes_dir,
            notes::save_pasted_image,
            bubble::minimize_to_bubble,
            bubble::bubble_snap,
            bubble::bubble_restore,
            bubble::bubble_reset,
            bubble::bubble_position,
            bubble::bubble_move,
            bubble::bubble_drag_start,
            bubble::bubble_locked,
            bubble::bubble_toggle_lock,
            bubble::bubble_menu_open,
            bubble::bubble_menu_close,
            pin::pin_status,
            pin::pin_create,
            pin::pin_unlock,
            pin::pin_lock,
            pin::pin_change,
            pin::pin_remove,
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
