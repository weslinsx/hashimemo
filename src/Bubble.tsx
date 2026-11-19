//! Conteúdo da janela bolinha: Kami dormindo, arrasto nativo, snap e menu de contexto.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Kami } from "./Kami";

export function Bubble() {
  const drag = useRef<{ sx: number; sy: number; moved: boolean } | null>(null);
  const [pressed, setPressed] = useState(false);
  const [waking, setWaking] = useState(false);
  const [menu, setMenu] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const off = listen("bubble:show", () => {
      setWaking(false);
      setMenu(false);
    });
    invoke<boolean>("bubble_locked").then(setLocked).catch(() => {});
    return () => {
      void off.then((unlisten) => unlisten());
    };
  }, []);

  const down = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    drag.current = { sx: event.screenX, sy: event.screenY, moved: false };
    setPressed(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || state.moved) return;
    const dx = event.screenX - state.sx;
    const dy = event.screenY - state.sy;
    if (Math.abs(dx) + Math.abs(dy) > 6) {
      state.moved = true;
      void invoke("bubble_drag_start").catch(() => {});
    }
  };

  const up = () => {
    const state = drag.current;
    drag.current = null;
    setPressed(false);
    if (!state) return;
    if (state.moved) {
      void invoke("bubble_snap");
    } else {
      setWaking(true);
      window.setTimeout(() => void invoke("bubble_restore"), 220);
    }
  };

  const closeMenu = () => {
    setMenu(false);
    void invoke("bubble_menu_close").catch(() => {});
  };

  const openMenu = () => {
    setMenu(true);
    invoke<boolean>("bubble_locked").then(setLocked).catch(() => {});
    void invoke("bubble_menu_open").catch(() => {});
  };

  return (
    <div
      className={`flex h-full w-full ${menu ? "items-start justify-start p-1.5" : "items-center justify-center"}`}
    >
      {menu ? (
        <div className="w-full rounded-lg border border-surface1/70 bg-mantle/95 p-1 text-xs shadow-xl">
          <button
            onClick={() => {
              closeMenu();
              void invoke("bubble_restore");
            }}
            className="block w-full rounded px-2 py-1.5 text-left text-subtext1 transition hover:bg-surface0 hover:text-text"
          >
            Restaurar
          </button>
          <button
            onClick={() => {
              closeMenu();
              void invoke("bubble_reset");
            }}
            className="block w-full rounded px-2 py-1.5 text-left text-subtext1 transition hover:bg-surface0 hover:text-text"
          >
            Resetar posição
          </button>
          <button
            onClick={() => {
              void invoke<boolean>("bubble_toggle_lock")
                .then((value) => setLocked(value))
                .catch(() => {});
              closeMenu();
            }}
            className="block w-full rounded px-2 py-1.5 text-left text-subtext1 transition hover:bg-surface0 hover:text-text"
          >
            {locked ? "Desbloquear posição" : "Bloquear posição"}
          </button>
          <button
            onClick={closeMenu}
            className="block w-full rounded px-2 py-1.5 text-left text-overlay0 transition hover:bg-surface0 hover:text-text"
          >
            fechar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onContextMenu={(event) => {
            event.preventDefault();
            openMenu();
          }}
          title="Abrir HashiMemo (botão direito: opções)"
          className={`soap-bubble relative flex h-[64px] w-[64px] items-center justify-center rounded-full transition-transform active:scale-95 ${
            locked ? "cursor-pointer" : "cursor-grab hover:scale-[1.03]"
          } ${pressed ? "scale-95" : ""}`}
        >
          <Kami
            pose={waking ? "acordando" : "dormindo"}
            size={50}
            className={waking ? "" : "kami-breathe"}
          />
          {!waking && (
            <>
              <span className="kami-z kami-z-1 text-[0.6rem]">z</span>
              <span className="kami-z kami-z-2 text-[0.5rem]">z</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
