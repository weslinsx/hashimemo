//! Conteúdo da janela bolinha: Kami dormindo, arrasto com física, snap magnético e menu.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Kami } from "./Kami";

type Sample = { t: number; x: number; y: number };

export function Bubble() {
  const drag = useRef<{
    sx: number;
    sy: number;
    moved: boolean;
    ox: number;
    oy: number;
    ready: boolean;
  } | null>(null);
  const samples = useRef<Sample[]>([]);
  const frame = useRef<number | null>(null);
  const pending = useRef<[number, number] | null>(null);
  const [pressed, setPressed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [landing, setLanding] = useState(false);
  const [waking, setWaking] = useState(false);
  const [menu, setMenu] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const off = listen("bubble:show", () => {
      setWaking(false);
      setMenu(false);
      setLanding(false);
    });
    const land = listen("bubble:land", () => {
      setLanding(true);
      window.setTimeout(() => setLanding(false), 380);
    });
    invoke<boolean>("bubble_locked").then(setLocked).catch(() => {});
    return () => {
      void off.then((unlisten) => unlisten());
      void land.then((unlisten) => unlisten());
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, []);

  const flush = () => {
    frame.current = null;
    const target = pending.current;
    if (target) void invoke("bubble_move", { x: target[0], y: target[1] }).catch(() => {});
  };

  const schedule = (x: number, y: number) => {
    pending.current = [x, y];
    if (frame.current === null) frame.current = window.requestAnimationFrame(flush);
  };

  const down = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || locked) return;
    const element = event.currentTarget;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      /* captura indisponível */
    }
    drag.current = {
      sx: event.screenX,
      sy: event.screenY,
      moved: false,
      ox: 0,
      oy: 0,
      ready: false,
    };
    setPressed(true);
    void invoke<[number, number] | null>("bubble_position")
      .then((position) => {
        if (!drag.current || !position) return;
        drag.current.ox = position[0];
        drag.current.oy = position[1];
        drag.current.ready = true;
        samples.current = [{ t: performance.now(), x: position[0], y: position[1] }];
      })
      .catch(() => {});
  };

  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || !state.ready) return;
    const dx = event.screenX - state.sx;
    const dy = event.screenY - state.sy;
    if (!state.moved && Math.abs(dx) + Math.abs(dy) <= 4) return;
    state.moved = true;
    setDragging(true);
    const x = Math.round(state.ox + dx);
    const y = Math.round(state.oy + dy);
    schedule(x, y);
    samples.current.push({ t: performance.now(), x, y });
    if (samples.current.length > 10) samples.current.shift();
  };

  const velocity = () => {
    const list = samples.current;
    if (list.length < 2) return [0, 0];
    const last = list[list.length - 1];
    const first = list[0];
    const dt = Math.max(last.t - first.t, 16);
    const vx = (last.x - first.x) / dt;
    const vy = (last.y - first.y) / dt;
    return [Math.max(-2.2, Math.min(2.2, vx)), Math.max(-2.2, Math.min(2.2, vy))];
  };

  const up = () => {
    const state = drag.current;
    drag.current = null;
    setPressed(false);
    setDragging(false);
    if (!state) return;
    if (state.moved) {
      const [vx, vy] = velocity();
      void invoke("bubble_throw", { vx, vy }).catch(() => void invoke("bubble_snap"));
    } else {
      setWaking(true);
      window.setTimeout(() => void invoke("bubble_restore"), 220);
    }
  };

  const closeMenu = () => {
    setMenu(false);
    void invoke("bubble_menu_close").catch(() => {});
  };

  const openMenu = async () => {
    invoke<boolean>("bubble_locked").then(setLocked).catch(() => {});
    try {
      await invoke("bubble_menu_open");
      setMenu(true);
    } catch {
      setMenu(false);
    }
  };

  return (
    <div
      className={`flex h-full w-full ${menu ? "items-center justify-start p-1" : "items-center justify-center"}`}
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
          title={locked ? "Abrir HashiMemo (posição bloqueada)" : "Arraste para jogar; clique para abrir"}
          className={`soap-bubble relative flex h-[64px] w-[64px] items-center justify-center rounded-full ${
            locked ? "cursor-pointer" : "cursor-grab hover:scale-[1.03]"
          } ${dragging ? "bubble-drag" : ""} ${landing ? "bubble-land" : ""} ${pressed ? "scale-95" : ""}`}
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
