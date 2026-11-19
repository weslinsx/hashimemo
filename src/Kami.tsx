//! Mascote: 18 poses em PNG; cada pose tem uma classe de animação CSS (kami-*).
import idle from "./assets/kami/idle.png";
import rosto from "./assets/kami/rosto.png";
import espiando from "./assets/kami/espiando.png";
import dormindo from "./assets/kami/dormindo.png";
import cochilando from "./assets/kami/cochilando.png";
import acordando from "./assets/kami/acordando.png";
import feliz from "./assets/kami/feliz.png";
import surpreso from "./assets/kami/surpreso.png";
import bloqueado from "./assets/kami/bloqueado.png";
import escrevendo from "./assets/kami/escrevendo.png";
import lendo from "./assets/kami/lendo.png";
import ideia from "./assets/kami/ideia.png";
import pesquisando from "./assets/kami/pesquisando.png";
import trabalhando from "./assets/kami/trabalhando.png";
import confuso from "./assets/kami/confuso.png";
import comemorando from "./assets/kami/comemorando.png";
import favorito from "./assets/kami/favorito.png";
import descartando from "./assets/kami/descartando.png";

export type KamiPose =
  | "idle"
  | "rosto"
  | "espiando"
  | "dormindo"
  | "cochilando"
  | "acordando"
  | "feliz"
  | "surpreso"
  | "bloqueado"
  | "escrevendo"
  | "lendo"
  | "ideia"
  | "pesquisando"
  | "trabalhando"
  | "confuso"
  | "comemorando"
  | "favorito"
  | "descartando";

const SOURCE: Record<KamiPose, string> = {
  idle,
  rosto,
  espiando,
  dormindo,
  cochilando,
  acordando,
  feliz,
  surpreso,
  bloqueado,
  escrevendo,
  lendo,
  ideia,
  pesquisando,
  trabalhando,
  confuso,
  comemorando,
  favorito,
  descartando,
};

const MOTION: Record<KamiPose, string> = {
  idle: "kami-breathe",
  rosto: "",
  espiando: "kami-peek",
  dormindo: "kami-breathe",
  cochilando: "kami-breathe-slow",
  acordando: "kami-stretch",
  feliz: "kami-hop",
  surpreso: "kami-shake",
  bloqueado: "kami-sway",
  escrevendo: "kami-act",
  lendo: "kami-breathe-slow",
  ideia: "kami-idea",
  pesquisando: "kami-peek",
  trabalhando: "kami-act",
  confuso: "kami-confused",
  comemorando: "kami-hop",
  favorito: "kami-pulse",
  descartando: "kami-sad",
};

export function Kami({
  size = 20,
  pose = "rosto",
  className = "",
  animate = true,
}: {
  size?: number;
  pose?: KamiPose;
  className?: string;
  animate?: boolean;
}) {
  return (
    <img
      src={SOURCE[pose]}
      width={size}
      height={size}
      alt=""
      draggable={false}
      className={`shrink-0 object-contain select-none ${animate ? MOTION[pose] : ""} ${className}`}
    />
  );
}
