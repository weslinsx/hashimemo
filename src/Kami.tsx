import head from "./assets/kami/head.png";
import neutral from "./assets/kami/neutral.png";
import peeking from "./assets/kami/peeking.png";
import sleeping from "./assets/kami/sleeping.png";
import waking from "./assets/kami/waking.png";
import happy from "./assets/kami/happy.png";
import surprised from "./assets/kami/surprised.png";
import locked from "./assets/kami/locked.png";

export type KamiPose =
  | "head"
  | "neutral"
  | "peeking"
  | "sleeping"
  | "waking"
  | "happy"
  | "surprised"
  | "locked";

const SOURCE: Record<KamiPose, string> = {
  head,
  neutral,
  peeking,
  sleeping,
  waking,
  happy,
  surprised,
  locked,
};

export function Kami({
  size = 20,
  pose = "head",
  className = "",
}: {
  size?: number;
  pose?: KamiPose;
  className?: string;
}) {
  return (
    <img
      src={SOURCE[pose]}
      width={size}
      height={size}
      alt=""
      draggable={false}
      className={`shrink-0 object-contain select-none ${className}`}
    />
  );
}
