# Plataformas — alvo: CachyOS (KDE Plasma Wayland)

Desenvolvimento atual no Windows. Fora dele, **só CachyOS com KDE Plasma em Wayland** é alvo.

## 1. Docking / janela

| Peça | Windows (hoje) | CachyOS / KWin Wayland |
|---|---|---|
| Reservar borda | `window/appbar.rs` (`SHAppBarMessage`) | não existe — `wlr-layer-shell` com `layer=overlay`, ancorado na borda |
| Posicionar/redimensionar | `win.rs` `SetWindowPos` | protocolo não permite posicionar; layer-shell define âncora + margem |
| Sempre no topo | `set_always_on_top` | layer `overlay` |
| Fora da barra de tarefas | `skipTaskbar` | layer-shell / regra de janela do KWin |
| Cantos/borda escura | DWM | CSS + `set_decorations(false)` |
| Multi-monitor | `available_monitors` | `wl_output` via Tauri/Winit — revisar work area (não há noção de work area em Wayland) |

Consequência: o comportamento "empurrar janelas" é o que mais muda. No CachyOS o rail provavelmente vira painel flutuante ancorado, sem reservar espaço.

## 2. Captura de tela (`capture.rs`)

- Windows: GDI/BitBlt + `QueryFullProcessImageNameW` + DWM.
- CachyOS: `org.freedesktop.portal.Screenshot` (funciona com KWin, pede consentimento) ou `grim`; janela ativa via portal `org.freedesktop.portal.RemoteDesktop`/KWin script.

## 3. Sistema

- Atalho global `Ctrl+Alt+N`: checar conflito com KDE (atalhos de janela usam Alt/Ctrl) e permitir trocar.
- Tray: StatusNotifierItem exige `libappindicator3`.
- Autostart: `~/.config/autostart/*.desktop` (plugin cobre).
- Notificações: daemon do Plasma (plugin cobre).
- Abrir pasta: `xdg-open`.

## 4. Build

```sh
sudo pacman -S --needed base-devel webkit2gtk-4.1 libappindicator3 librsvg patchelf
npm run tauri build      # gera .deb, .rpm e .AppImage em src-tauri/target/release/bundle/
```

Não cross-compila do Windows. O AppImage depende de `linuxdeploy` (o tauri já baixa).

## 5. UI

- Fonte: `Noto Sans` (fallback já existe).
- Emoji: instalar `noto-fonts-emoji`.
- Transparência/fundo de imagem: KWin compõe, mas WebKitGTK é o renderer (não WebView2) — validar blur/alpha.
- `convertFileSrc`/asset protocol é igual.

## 6. CLI e agentes

- `hashimemo` em `~/.local/bin` (ou `/usr/local/bin`), permissão de execução.
- Skill do OpenCode aponta para o binário; caminho de notas continua `~/HashiMemo/notes`.
