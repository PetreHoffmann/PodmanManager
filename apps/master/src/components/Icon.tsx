import { ICONS, type IconName } from "./icons-data";

export type { IconName };
export type IconTone = "sky" | "ok" | "bad" | "warn" | "muted";

/** Secondary (translucent) color of each icon: it follows the meaning of the action. */
const TONE: Record<IconName, IconTone> = {
  gauge: "sky", "hard-drives": "sky", cube: "sky", stack: "sky", "squares-four": "sky", package: "sky", "gear-six": "sky", question: "sky", info: "sky",
  "sign-out": "sky", "sign-in": "sky", play: "ok", stop: "bad", "arrows-clockwise": "sky", "arrow-clockwise": "sky", "terminal-window": "sky",
  "plugs-connected": "sky", "shield-check": "ok", "floppy-disk": "sky", "arrow-counter-clockwise": "warn", trash: "bad", broom: "warn", check: "ok", x: "muted",
  funnel: "sky", key: "sky", "user-circle": "sky", "download-simple": "sky", "plus-circle": "ok", "arrow-circle-up": "ok", prohibit: "warn", power: "ok",
  "check-circle": "ok", warning: "warn", "x-circle": "bad", "user-gear": "sky",
};

/**
 * Duotone icon (Phosphor, MIT): the line takes the text color, the translucent layer behind it the accent color.
 * Decorative (the text stays); hidden on phones, where buttons show text only (`always` keeps it, e.g. in illustrations).
 */
export default function Icon({ name, tone, always = false, className = "" }: { name: IconName; tone?: IconTone; always?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      fill="currentColor"
      width="1.2em"
      height="1.2em"
      aria-hidden="true"
      focusable="false"
      className={`icon icon-${tone ?? TONE[name]} shrink-0 ${always ? "inline-block" : "hidden md:inline-block"} ${className}`}
      // trusted constant markup generated from the icon package (no user input)
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
