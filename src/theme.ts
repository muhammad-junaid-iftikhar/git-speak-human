import { join } from "node:path";
import { config, homeDir, readJSON } from "./config";

export type Shade = number | string;

export interface Theme {
  name: string;
  accent: Shade;
  ok: Shade;
  warn: Shade;
  err: Shade;
  dim: Shade;
  mascot: string;
  prompt: string;
}

export const THEMES: Record<string, Theme> = {
  classic: { name: "classic", accent: 75, ok: 78, warn: 214, err: 203, dim: 245, mascot: "🐙", prompt: "gitbuddy ›" },
  neon: { name: "neon", accent: 201, ok: 51, warn: 226, err: 197, dim: 99, mascot: "👾", prompt: "gitbuddy ⚡" },
  pastel: { name: "pastel", accent: 183, ok: 151, warn: 223, err: 217, dim: 250, mascot: "🦄", prompt: "gitbuddy ✿" },
  mono: { name: "mono", accent: 255, ok: 252, warn: 250, err: 255, dim: 242, mascot: "◆", prompt: "gitbuddy >" },
  pirate: { name: "pirate", accent: 179, ok: 106, warn: 208, err: 160, dim: 137, mascot: "🏴‍☠️", prompt: "gitbuddy ☠" },
};

let custom: { name: string; palette: Theme | null } | null = null;

export function theme(): Theme {
  const name = config().theme;
  if (THEMES[name]) return THEMES[name];
  if (custom?.name !== name) {
    const palette = readJSON<Theme | null>(join(homeDir(), "palette.json"), null);
    custom = { name, palette: palette?.name === name ? palette : null };
  }
  return custom.palette ?? THEMES.classic;
}

export function shadeCode(shade: Shade): string {
  if (typeof shade === "number") return `38;5;${shade}`;
  const n = parseInt(shade.replace("#", ""), 16);
  return `38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
}

const ICONS: Record<string, string> = {
  save: "💾",
  send: "📤",
  get: "📥",
  ok: "✅",
  warn: "⚠️ ",
  err: "❌",
  info: "💡",
  work: "🧩",
  switch: "🔄",
  list: "📋",
  undo: "⏪",
  redo: "⏩",
  history: "📜",
  clean: "✨",
  rescue: "🛟",
  trash: "🗑️ ",
  doctor: "🩺",
  time: "🕰️ ",
  search: "🔎",
  conflict: "🤝",
  share: "🚀",
  tag: "🏷️ ",
  party: "🎉",
  lock: "🔒",
  new: "🌱",
  person: "👤",
  fire: "🔥",
  star: "⭐",
};

export function icon(name: string): string {
  if (!config().emoji) return "";
  const glyph = ICONS[name];
  return glyph ? `${glyph} ` : "";
}
