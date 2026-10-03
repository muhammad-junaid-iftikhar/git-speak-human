import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homeDir } from "../config";

export interface LookTerminal {
  baseProfile?: string;
  background?: string;
  foreground?: string;
  cursor?: string;
  selection?: string;
  bold?: string;
  ansi?: string[];
  font?: { name: string; size: number; fallback?: string; brew?: string };
  opacity?: number;
  blur?: number;
  cursorShape?: "block" | "underline" | "bar";
  blink?: boolean;
  spacing?: { width?: number; height?: number };
  columns?: number;
  rows?: number;
}

export interface LookShell {
  autosuggestColor?: string;
  syntax?: Record<string, string>;
  history?: { size?: number; share?: boolean; ignoreDups?: boolean };
  aliases?: Record<string, string>;
  extra?: string;
}

export interface Look {
  name: string;
  title: string;
  author: string;
  description: string;
  terminal: LookTerminal;
  prompt?: { starship?: string } | null;
  shell?: LookShell;
  tools?: string[];
  gitbuddy?: { accent: string; ok: string; warn: string; err: string; dim: string; mascot?: string };
  source?: "built-in" | "yours" | "online";
}

export const ANSI_NAMES = [
  "Black",
  "Red",
  "Green",
  "Yellow",
  "Blue",
  "Magenta",
  "Cyan",
  "White",
  "BrightBlack",
  "BrightRed",
  "BrightGreen",
  "BrightYellow",
  "BrightBlue",
  "BrightMagenta",
  "BrightCyan",
  "BrightWhite",
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const RESERVED = new Set(["list", "save", "random", "daily", "preview", "current", "path", "online"]);

export function validateLook(raw: unknown): string[] {
  const errors: string[] = [];
  const t = raw as Look;
  if (!t || typeof t !== "object") return ["not an object"];
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(t.name ?? "")) errors.push("name: lowercase letters, numbers and dashes");
  if (RESERVED.has(t.name)) errors.push(`name: "${t.name}" is reserved`);
  for (const k of ["title", "author", "description"] as const) if (typeof t[k] !== "string" || !t[k]) errors.push(`${k}: required text`);
  const term = t.terminal;
  if (!term || typeof term !== "object") errors.push("terminal: required");
  else {
    const hasColors = Boolean(term.background || term.foreground || term.ansi);
    if (!hasColors && !term.baseProfile) errors.push("terminal: needs colors or a baseProfile");
    if (hasColors) {
      for (const k of ["background", "foreground", "cursor", "selection"] as const) if (!HEX.test(term[k] ?? "")) errors.push(`terminal.${k}: #rrggbb`);
      if (term.bold && !HEX.test(term.bold)) errors.push("terminal.bold: #rrggbb");
      if (!Array.isArray(term.ansi) || term.ansi.length !== 16 || term.ansi.some((c) => !HEX.test(c))) errors.push("terminal.ansi: 16 #rrggbb colors");
    }
    if (term.font && (typeof term.font.name !== "string" || !(term.font.size > 5 && term.font.size < 72))) errors.push("terminal.font: name and size (6-71)");
    if (term.opacity !== undefined && !(term.opacity > 0.1 && term.opacity <= 1)) errors.push("terminal.opacity: 0.1-1");
    if (term.cursorShape && !["block", "underline", "bar"].includes(term.cursorShape)) errors.push("terminal.cursorShape: block | underline | bar");
  }
  if (t.gitbuddy) for (const k of ["accent", "ok", "warn", "err", "dim"] as const) if (!HEX.test(t.gitbuddy[k] ?? "")) errors.push(`gitbuddy.${k}: #rrggbb`);
  if (t.shell?.autosuggestColor && !HEX.test(t.shell.autosuggestColor)) errors.push("shell.autosuggestColor: #rrggbb");
  return errors;
}

export function builtInDir(): string {
  return join(import.meta.dir, "..", "..", "themes");
}

export function userDir(): string {
  const dir = join(homeDir(), "themes");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readDir(dir: string, source: Look["source"]): Look[] {
  if (!existsSync(dir)) return [];
  const out: Look[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    try {
      const t = JSON.parse(readFileSync(join(dir, f), "utf-8")) as Look;
      if (!validateLook(t).length) out.push({ ...t, source });
    } catch {
      /* skip broken files */
    }
  }
  return out;
}

export function allLooks(): Look[] {
  const mine = readDir(userDir(), "yours");
  const names = new Set(mine.map((t) => t.name));
  return [...mine, ...readDir(builtInDir(), "built-in").filter((t) => !names.has(t.name))].sort((a, b) => a.name.localeCompare(b.name));
}

export function findLook(name: string): Look | undefined {
  return allLooks().find((t) => t.name === name.toLowerCase());
}

export const INDEX_URL = "https://raw.githubusercontent.com/muhammad-junaid-iftikhar/git-speak-human/main/themes/index.json";
export const THEME_URL = (name: string) => `https://raw.githubusercontent.com/muhammad-junaid-iftikhar/git-speak-human/main/themes/${name}.json`;

export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function swatch(look: Look, color: boolean): string {
  const t = look.terminal;
  if (!color) return "";
  if (!t.ansi || !t.background) return `\x1b[2m${(t.baseProfile ?? "custom").slice(0, 18).padEnd(20)}\x1b[0m`;
  const [br, bg, bb] = rgb(t.background);
  const blocks = t.ansi
    .slice(0, 8)
    .map((h) => {
      const [r, g, b] = rgb(h);
      return `\x1b[48;2;${r};${g};${b}m  `;
    })
    .join("");
  const [fr, fg, fb] = rgb(t.foreground ?? "#ffffff");
  return `\x1b[48;2;${br};${bg};${bb}m\x1b[38;2;${fr};${fg};${fb}m Aa \x1b[0m${blocks}\x1b[0m`;
}

export function autoStarship(look: Look): string {
  const a = look.terminal.ansi ?? [];
  const pick = (i: number, fallback: string) => a[i] ?? fallback;
  return `# made by gitbuddy for the "${look.name}" theme
format = "$directory$git_branch$git_status$nodejs$python$character"
add_newline = false

[directory]
style = "bold ${pick(12, "#7aa2f7")}"
truncation_length = 3
truncate_to_repo = true

[git_branch]
symbol = " "
style = "bold ${pick(13, "#bb9af7")}"
format = "[$symbol$branch]($style) "

[git_status]
style = "${pick(11, "#e0af68")}"

[nodejs]
style = "${pick(10, "#9ece6a")}"
format = "[⬢ $version]($style) "

[python]
style = "${pick(11, "#e0af68")}"

[character]
success_symbol = "[❯](bold ${pick(10, "#9ece6a")})"
error_symbol = "[❯](bold ${pick(9, "#f7768e")})"
`;
}

export function starshipFor(look: Look): string | null {
  if (!look.prompt) return null;
  if (!look.prompt.starship || look.prompt.starship === "auto") return autoStarship(look);
  return look.prompt.starship;
}

function zq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function shellScript(look: Look, starshipPath: string | null): string {
  const sh = look.shell ?? {};
  const lines = [`# gitbuddy theme: ${look.name} (generated, edits are overwritten)`, `export GITBUDDY_LOOK=${zq(look.name)}`];
  if (starshipPath) lines.push(`export STARSHIP_CONFIG=${zq(starshipPath)}`);
  else lines.push("unset STARSHIP_CONFIG");
  if (sh.autosuggestColor) lines.push(`ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE=${zq(`fg=${sh.autosuggestColor}`)}`);
  if (sh.syntax && Object.keys(sh.syntax).length) {
    lines.push("typeset -gA ZSH_HIGHLIGHT_STYLES");
    for (const [k, v] of Object.entries(sh.syntax)) lines.push(`ZSH_HIGHLIGHT_STYLES[${k}]=${zq(v)}`);
  }
  if (sh.history) {
    if (sh.history.size) lines.push(`HISTSIZE=${sh.history.size}`, `SAVEHIST=${sh.history.size}`);
    if (sh.history.share) lines.push("setopt SHARE_HISTORY");
    if (sh.history.ignoreDups) lines.push("setopt HIST_IGNORE_ALL_DUPS");
  }
  for (const [name, cmd] of Object.entries(sh.aliases ?? {})) {
    const tool = cmd.split(" ")[0];
    lines.push(`command -v ${tool} >/dev/null 2>&1 && alias ${name}=${zq(cmd)}`);
  }
  if (sh.extra) lines.push(sh.extra);
  return lines.join("\n") + "\n";
}
