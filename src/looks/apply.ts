import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { homeDir, setConfig, writeJSON } from "../config";
import { ANSI_NAMES, shellScript, starshipFor, type Look } from "./model";

export const BLOCK_START = "# >>> gitbuddy theme >>>";
export const BLOCK_END = "# <<< gitbuddy theme <<<";

const shellDir = () => join(homeDir(), "shell");
const userHome = () => process.env.HOME || homedir();
export const rcFile = () => join(process.env.ZDOTDIR || userHome(), ".zshrc");

export function canStyleTerminal(): boolean {
  return process.platform === "darwin" && !process.env.GITBUDDY_NO_TERMINAL;
}

function osascript(lang: "JavaScript" | "AppleScript", script: string, args: string[] = []): { ok: boolean; out: string; err: string } {
  const file = join(tmpdir(), `gitbuddy-${process.pid}-${Date.now()}.${lang === "JavaScript" ? "js" : "applescript"}`);
  writeFileSync(file, script);
  try {
    const p = Bun.spawnSync(["osascript", ...(lang === "JavaScript" ? ["-l", "JavaScript"] : []), file, ...args], { stdout: "pipe", stderr: "pipe" });
    return { ok: p.exitCode === 0, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
  } finally {
    rmSync(file, { force: true });
  }
}

async function tellTerminal(script: string, timeoutMs = 6000): Promise<{ ok: boolean; out: string; timedOut: boolean }> {
  const proc = Bun.spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  clearTimeout(timer);
  return { ok: code === 0 && !timedOut, out: out.trim(), timedOut };
}

const BUILD_JS = `
ObjC.import('AppKit');
function run(argv) {
  const spec = JSON.parse(argv[0]);
  const t = spec.terminal;
  const d = $.NSMutableDictionary.alloc.init;
  const archive = (o) => $.NSKeyedArchiver.archivedDataWithRootObjectRequiringSecureCodingError(o, true, null);
  const color = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return $.NSColor.colorWithSRGBRedGreenBlueAlpha(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a === undefined ? 1 : a);
  };
  const setColor = (key, hex, a) => { if (hex) d.setObjectForKey(archive(color(hex, a)), $(key)); };
  const num = (key, v) => { if (v !== undefined && v !== null) d.setObjectForKey($.NSNumber.numberWithDouble(v), $(key)); };
  const bool = (key, v) => d.setObjectForKey($.NSNumber.numberWithBool(!!v), $(key));
  setColor('BackgroundColor', t.background, t.opacity);
  setColor('TextColor', t.foreground);
  setColor('TextBoldColor', t.bold || t.foreground);
  setColor('CursorColor', t.cursor);
  setColor('SelectionColor', t.selection);
  spec.ansiNames.forEach((n, i) => setColor('ANSI' + n + 'Color', t.ansi[i]));
  let found = true;
  if (t.font) {
    let f = $.NSFont.fontWithNameSize($(t.font.name), t.font.size);
    if (f.isNil()) { found = false; if (t.font.fallback) f = $.NSFont.fontWithNameSize($(t.font.fallback), t.font.size); }
    if (f.isNil()) f = $.NSFont.userFixedPitchFontOfSize(t.font.size);
    d.setObjectForKey(archive(f), $('Font'));
  }
  num('BackgroundBlur', t.blur);
  num('FontWidthSpacing', t.spacing && t.spacing.width);
  num('FontHeightSpacing', t.spacing && t.spacing.height);
  num('columnCount', t.columns);
  num('rowCount', t.rows);
  num('CursorType', { block: 0, underline: 1, bar: 2 }[t.cursorShape || 'block']);
  bool('CursorBlink', t.blink);
  bool('FontAntialias', true);
  bool('UseBrightBold', true);
  bool('DisableANSIColor', false);
  d.setObjectForKey($(spec.profile), $('name'));
  d.setObjectForKey($('Window Settings'), $('type'));
  num('ProfileCurrentVersion', 2.09);
  d.writeToFileAtomically($(spec.out), true);
  return JSON.stringify({ fontFound: found });
}`;

const CAPTURE_JS = `
ObjC.import('AppKit');
function run(argv) {
  const defs = $.NSUserDefaults.alloc.initWithSuiteName($('com.apple.Terminal'));
  const name = argv[0] || ObjC.unwrap(defs.stringForKey($('Default Window Settings'))) || 'Basic';
  const all = defs.dictionaryForKey($('Window Settings'));
  const p = all.isNil() ? $() : all.objectForKey($(name));
  const result = { profile: name, colors: {}, font: null, numbers: {} };
  if (!p || p.isNil()) return JSON.stringify(result);
  const toHex = (data) => {
    const c = $.NSKeyedUnarchiver.unarchivedObjectOfClassFromDataError($.NSColor, data, null);
    if (!c || c.isNil()) return null;
    const s = c.colorUsingColorSpace($.NSColorSpace.sRGBColorSpace);
    const h = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return { hex: '#' + h(s.redComponent) + h(s.greenComponent) + h(s.blueComponent), alpha: s.alphaComponent };
  };
  JSON.parse(argv[1]).forEach((k) => { const v = p.objectForKey($(k)); if (v && !v.isNil()) result.colors[k] = toHex(v); });
  const fd = p.objectForKey($('Font'));
  if (fd && !fd.isNil()) {
    const f = $.NSKeyedUnarchiver.unarchivedObjectOfClassFromDataError($.NSFont, fd, null);
    if (f && !f.isNil()) result.font = { name: ObjC.unwrap(f.fontName), size: f.pointSize };
  }
  ['BackgroundBlur', 'FontWidthSpacing', 'FontHeightSpacing', 'columnCount', 'rowCount', 'CursorType', 'CursorBlink'].forEach((k) => {
    const v = p.objectForKey($(k));
    if (v && !v.isNil()) result.numbers[k] = ObjC.unwrap(v);
  });
  return JSON.stringify(result);
}`;

export interface TerminalResult {
  applied: boolean;
  profile?: string;
  fontFound?: boolean;
  note?: string;
}

export function profileName(look: Look): string {
  return look.terminal.baseProfile && !look.terminal.background ? look.terminal.baseProfile : `gitbuddy ${look.title}`;
}

export function fontInstalled(name: string): boolean {
  const r = osascript("JavaScript", `ObjC.import('AppKit'); function run(a){ return $.NSFont.fontWithNameSize($(a[0]), 12).isNil() ? "no" : "yes"; }`, [name]);
  return r.out === "yes";
}

export function buildProfileFile(look: Look, out: string): { fontFound: boolean } {
  const r = osascript("JavaScript", BUILD_JS, [JSON.stringify({ terminal: look.terminal, profile: profileName(look), ansiNames: ANSI_NAMES, out })]);
  if (!r.ok) throw new Error(`Couldn't build the Terminal profile: ${r.err}`);
  return JSON.parse(r.out);
}

function setDefaultProfile(name: string): void {
  Bun.spawnSync(["defaults", "write", "com.apple.Terminal", "Default Window Settings", "-string", name]);
  Bun.spawnSync(["defaults", "write", "com.apple.Terminal", "Startup Window Settings", "-string", name]);
}

export async function applyTerminal(look: Look): Promise<TerminalResult> {
  if (!canStyleTerminal()) return { applied: false, note: "Terminal colors are only supported in macOS Terminal.app for now." };
  const name = profileName(look);
  let fontFound = true;
  let automation = true;
  if (look.terminal.background) {
    const file = join(tmpdir(), `${name.replace(/[^\w -]/g, "")}.terminal`);
    fontFound = buildProfileFile(look, file).fontFound;
    const before = await tellTerminal(`tell application "Terminal" to count windows`);
    automation = before.ok;
    Bun.spawnSync(["open", "-g", file]);
    if (automation) {
      for (let i = 0; i < 30; i++) {
        const now = await tellTerminal(`tell application "Terminal" to count windows`, 2000);
        if (Number(now.out) > Number(before.out)) break;
        Bun.sleepSync(100);
      }
      await tellTerminal(`tell application "Terminal"
  try
    if name of current settings of selected tab of front window is "${name}" and (count windows) > ${Number(before.out) || 0} then close front window
  end try
end tell`);
    } else Bun.sleepSync(1500);
    rmSync(file, { force: true });
  }
  setDefaultProfile(name);
  if (automation) {
    const r = await tellTerminal(`tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      try
        set current settings of t to settings set "${name}"
      end try
    end repeat
  end repeat
end tell`);
    automation = r.ok;
  }
  return {
    applied: true,
    profile: name,
    fontFound,
    note: automation ? undefined : "New windows use the theme. To restyle open windows too, allow gitbuddy's terminal to control Terminal in System Settings → Privacy & Security → Automation.",
  };
}

export function captureTerminal(profile?: string): { profile: string; terminal: Look["terminal"] } {
  const keys = ["BackgroundColor", "TextColor", "TextBoldColor", "CursorColor", "SelectionColor", ...ANSI_NAMES.map((n) => `ANSI${n}Color`)];
  const name = profile || Bun.spawnSync(["defaults", "read", "com.apple.Terminal", "Default Window Settings"], { stdout: "pipe", stderr: "pipe" }).stdout.toString().trim() || "Basic";
  const r = osascript("JavaScript", CAPTURE_JS, [name, JSON.stringify(keys)]);
  if (!r.ok) return { profile: profile ?? "Basic", terminal: { baseProfile: profile ?? "Basic" } };
  const data = JSON.parse(r.out) as { profile: string; colors: Record<string, { hex: string; alpha: number } | null>; font: { name: string; size: number } | null; numbers: Record<string, number> };
  const col = (k: string) => data.colors[k]?.hex;
  const terminal: Look["terminal"] = {};
  const ansi = ANSI_NAMES.map((n) => col(`ANSI${n}Color`));
  if (col("BackgroundColor") && col("TextColor") && ansi.every(Boolean)) {
    Object.assign(terminal, {
      background: col("BackgroundColor"),
      foreground: col("TextColor"),
      bold: col("TextBoldColor") ?? col("TextColor"),
      cursor: col("CursorColor") ?? col("TextColor"),
      selection: col("SelectionColor") ?? "#555555",
      ansi,
      opacity: Math.round((data.colors.BackgroundColor?.alpha ?? 1) * 100) / 100,
    });
  } else terminal.baseProfile = data.profile;
  if (data.font) terminal.font = { name: data.font.name, size: data.font.size };
  const n = data.numbers;
  if (n.BackgroundBlur !== undefined) terminal.blur = n.BackgroundBlur;
  if (n.FontWidthSpacing !== undefined || n.FontHeightSpacing !== undefined) terminal.spacing = { width: n.FontWidthSpacing, height: n.FontHeightSpacing };
  if (n.columnCount) terminal.columns = n.columnCount;
  if (n.rowCount) terminal.rows = n.rowCount;
  if (n.CursorType !== undefined) terminal.cursorShape = (["block", "underline", "bar"] as const)[n.CursorType] ?? "block";
  if (n.CursorBlink !== undefined) terminal.blink = Boolean(n.CursorBlink);
  return { profile: data.profile, terminal };
}

export function currentStarship(): string | null {
  const file = process.env.STARSHIP_CONFIG && !process.env.STARSHIP_CONFIG.includes("/gitbuddy/shell/") ? process.env.STARSHIP_CONFIG : join(userHome(), ".config", "starship.toml");
  return existsSync(file) ? readFileSync(file, "utf-8") : null;
}

export function ensureRcBlock(): { changed: boolean; backup?: string } {
  const rc = rcFile();
  const existing = existsSync(rc) ? readFileSync(rc, "utf-8") : "";
  if (existing.includes(BLOCK_START)) return { changed: false };
  let backup: string | undefined;
  if (existing) {
    const dir = join(homeDir(), "backups");
    mkdirSync(dir, { recursive: true });
    backup = join(dir, `zshrc-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    copyFileSync(rc, backup);
  }
  const block = `\n${BLOCK_START}\n[ -f "${join(shellDir(), "theme.zsh")}" ] && source "${join(shellDir(), "theme.zsh")}"\n${BLOCK_END}\n`;
  writeFileSync(rc, existing.replace(/\n*$/, "\n") + block);
  return { changed: true, backup };
}

export function removeRcBlock(): boolean {
  const rc = rcFile();
  if (!existsSync(rc)) return false;
  const text = readFileSync(rc, "utf-8");
  const re = new RegExp(`\\n?${BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`);
  if (!re.test(text)) return false;
  writeFileSync(rc, text.replace(re, "\n"));
  return true;
}

export function applyShell(look: Look): { starship: string | null; script: string } {
  const dir = shellDir();
  mkdirSync(dir, { recursive: true });
  const starship = starshipFor(look);
  let starshipPath: string | null = null;
  if (starship) {
    starshipPath = join(dir, "starship.toml");
    writeFileSync(starshipPath, starship);
  }
  const script = join(dir, "theme.zsh");
  writeFileSync(script, shellScript(look, starshipPath));
  return { starship: starshipPath, script };
}

export function applyPalette(look: Look): void {
  if (!look.gitbuddy) return;
  const g = look.gitbuddy;
  writeJSON(join(homeDir(), "palette.json"), {
    name: look.name,
    accent: g.accent,
    ok: g.ok,
    warn: g.warn,
    err: g.err,
    dim: g.dim,
    mascot: g.mascot ?? "🐙",
    prompt: "gitbuddy ›",
  });
  setConfig("theme", look.name);
}

export const TOOL_CHECK: Record<string, { check: () => boolean; brew: string }> = {
  starship: { check: () => Boolean(Bun.which("starship")), brew: "starship" },
  eza: { check: () => Boolean(Bun.which("eza")), brew: "eza" },
  atuin: { check: () => Boolean(Bun.which("atuin")), brew: "atuin" },
  bat: { check: () => Boolean(Bun.which("bat")), brew: "bat" },
  fzf: { check: () => Boolean(Bun.which("fzf")), brew: "fzf" },
  zoxide: { check: () => Boolean(Bun.which("zoxide")), brew: "zoxide" },
  "zsh-autosuggestions": { check: () => ["/opt/homebrew/share/zsh-autosuggestions", "/usr/local/share/zsh-autosuggestions", join(userHome(), ".oh-my-zsh/custom/plugins/zsh-autosuggestions")].some(existsSync), brew: "zsh-autosuggestions" },
  "zsh-syntax-highlighting": { check: () => ["/opt/homebrew/share/zsh-syntax-highlighting", "/usr/local/share/zsh-syntax-highlighting", join(userHome(), ".oh-my-zsh/custom/plugins/zsh-syntax-highlighting")].some(existsSync), brew: "zsh-syntax-highlighting" },
};

export function missingTools(look: Look): string[] {
  return (look.tools ?? []).filter((t) => TOOL_CHECK[t] && !TOOL_CHECK[t].check());
}

export function captureShell(): Look["shell"] & { tools: string[] } {
  const rc = rcFile();
  const text = existsSync(rc) ? readFileSync(rc, "utf-8").split(BLOCK_START)[0] : "";
  const shell: Look["shell"] = {};
  const sugg = text.match(/ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE=['"]?fg=(#[0-9a-fA-F]{6})/);
  if (sugg) shell.autosuggestColor = sugg[1];
  const syntax: Record<string, string> = {};
  for (const m of text.matchAll(/ZSH_HIGHLIGHT_STYLES\[([\w-]+)\]=['"]?([^'"\n]+)['"]?/g)) syntax[m[1]] = m[2];
  if (Object.keys(syntax).length) shell.syntax = syntax;
  const size = text.match(/^\s*HISTSIZE=(\d+)/m);
  if (size || /SHARE_HISTORY|HIST_IGNORE/i.test(text)) shell.history = { size: size ? Number(size[1]) : undefined, share: /setopt\s+SHARE_HISTORY/i.test(text), ignoreDups: /HIST_IGNORE_(ALL_)?DUPS/i.test(text) };
  const aliases: Record<string, string> = {};
  for (const m of text.matchAll(/^\s*alias\s+(ls|ll|la|lt|l|tree|cat)=['"]([^'"]+)['"]/gm)) aliases[m[1]] = m[2];
  if (Object.keys(aliases).length) shell.aliases = aliases;
  const tools = Object.keys(TOOL_CHECK).filter((t) => TOOL_CHECK[t].check() && new RegExp(t.replace("zsh-", ""), "i").test(text));
  if (/starship init/.test(text)) tools.unshift("starship");
  return { ...shell, tools: [...new Set(tools)] };
}
