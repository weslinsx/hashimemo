import idle from "./assets/kami/idle.png";
import rosto from "./assets/kami/rosto.png";
import espiando from "./assets/kami/espiando.png";
import dormindo from "./assets/kami/dormindo.png";
import cochilando from "./assets/kami/cochilando.png";
import acordando from "./assets/kami/acordando.png";
import feliz from "./assets/kami/feliz.png";
import surpreso from "./assets/kami/surpreso.png";
import bloqueado from "./assets/kami/bloqueado.png";

export type KamiPose =
  | "idle"
  | "rosto"
  | "espiando"
  | "dormindo"
  | "cochilando"
  | "acordando"
  | "feliz"
  | "surpreso"
  | "bloqueado";

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
