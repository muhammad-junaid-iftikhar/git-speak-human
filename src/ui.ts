import { writeSync } from "node:fs";
import { ctx } from "./context";
import { BuddyError, fail } from "./errors";
import { icon, theme } from "./theme";

const ESC = "\x1b[";

function writeFd(fd: 1 | 2, text: string): void {
  let buf = Buffer.from(text);
  try {
    while (buf.length) buf = buf.subarray(writeSync(fd, buf));
  } catch {
    (fd === 1 ? process.stdout : process.stderr).write(buf);
  }
}

export const writeOut = (text: string) => writeFd(1, text);
export const writeErr = (text: string) => writeFd(2, text);

function paint(code: string, s: string): string {
  return ctx.useColor ? `${ESC}${code}m${s}${ESC}0m` : s;
}

export const c = {
  bold: (s: string) => paint("1", s),
  dim: (s: string) => paint(`38;5;${theme().dim}`, s),
  accent: (s: string) => paint(`38;5;${theme().accent}`, s),
  ok: (s: string) => paint(`38;5;${theme().ok}`, s),
  warn: (s: string) => paint(`38;5;${theme().warn}`, s),
  err: (s: string) => paint(`38;5;${theme().err}`, s),
  add: (s: string) => paint("32", s),
  del: (s: string) => paint("31", s),
};

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function width(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xfe0f || cp === 0x200d) continue;
    w += cp > 0x1f000 || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ? 2 : 1;
  }
  return w;
}

function pad(s: string, n: number): string {
  return s + " ".repeat(Math.max(0, n - width(s)));
}

const human = () => !ctx.flags.json && !ctx.flags.quiet;

function out(s = ""): void {
  if (human()) writeOut(s + "\n");
}

export const ui = {
  line: out,
  blank: () => out(),
  title: (s: string) => out(c.bold(s)),
  say: (iconName: string, msg: string) => out(`${icon(iconName)}${msg}`),
  ok: (msg: string) => out(`${icon("ok")}${c.ok(msg)}`),
  info: (msg: string) => out(`${icon("info")}${msg}`),
  hint: (msg: string) => out(c.dim(`   ${msg}`)),
  warn(msg: string): void {
    ctx.warnings.push(stripAnsi(msg));
    if (!ctx.flags.json) writeErr(`${icon("warn")}${c.warn(msg)}\n`);
  },
  next(cmd: string, why = ""): void {
    ctx.next.push(cmd);
    out(`   ${c.dim("next →")} ${c.accent(cmd)}${why ? c.dim(`  ${why}`) : ""}`);
  },
  table(rows: string[][], header?: string[], indent = "   "): void {
    const all = header ? [header, ...rows] : rows;
    const cols = Math.max(0, ...all.map((r) => r.length));
    const widths = Array.from({ length: cols }, (_, i) => Math.max(...all.map((r) => width(r[i] ?? ""))));
    if (header) out(indent + header.map((h, i) => c.dim(pad(h, widths[i]))).join("  "));
    for (const r of rows) out(indent + r.map((cell, i) => (i === r.length - 1 ? cell : pad(cell, widths[i]))).join("  "));
  },
  explain(cmd: string, dry: boolean): void {
    if (ctx.flags.json && !dry) return;
    writeErr(c.dim(`   ${dry ? "would run" : "→"} ${cmd}\n`));
  },
  error(err: BuddyError): void {
    writeErr(`${icon("err")}${c.err(err.message)}\n`);
    if (err.hint) writeErr(c.dim(`   ${err.hint}\n`));
    if (err.details && process.env.GITBUDDY_DEBUG) writeErr(c.dim(err.details + "\n"));
  },

  confirm(question: string, opts: { default?: boolean } = {}): boolean {
    if (ctx.flags.yes) return true;
    if (!ctx.interactive) {
      fail(`I need a yes before doing this: ${question}`, {
        code: "needs_confirmation",
        hint: "Run it again with --yes if you're sure.",
      });
    }
    const def = opts.default ?? false;
    const answer = prompt(`${icon("info")}${question} ${c.dim(def ? "[Y/n]" : "[y/N]")}`);
    if (answer === null || answer.trim() === "") return def;
    return /^y(es)?$/i.test(answer.trim());
  },

  ask(question: string, def = ""): string {
    if (!ctx.interactive) return def;
    const answer = prompt(`${question}${def ? c.dim(` (${def})`) : ""}`);
    return answer === null || answer.trim() === "" ? def : answer.trim();
  },

  pick<T>(question: string, items: { label: string; value: T }[]): T {
    if (!ctx.interactive) fail(question, { code: "needs_choice", hint: "Pass the choice as an argument." });
    out(c.bold(question));
    items.forEach((it, i) => out(`   ${c.accent(String(i + 1).padStart(2))}  ${it.label}`));
    for (;;) {
      const raw = prompt(c.dim("   pick a number:"));
      if (raw === null) fail("Cancelled.");
      const n = Number(raw.trim());
      if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1].value;
      const byLabel = items.find((it) => stripAnsi(it.label).toLowerCase().startsWith(raw.trim().toLowerCase()));
      if (raw.trim() && byLabel) return byLabel.value;
    }
  },

  async spin<T>(label: string, task: () => Promise<T>): Promise<T> {
    if (!ctx.useColor || ctx.flags.quiet || !process.stderr.isTTY) {
      out(label);
      return task();
    }
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;
    const timer = setInterval(() => {
      writeErr(`\r${c.accent(frames[i++ % frames.length])} ${label}`);
    }, 80);
    try {
      return await task();
    } finally {
      clearInterval(timer);
      writeErr(`\r${" ".repeat(width(label) + 4)}\r`);
    }
  },
};

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

export function ago(dateIso: string | number | Date): string {
  const then = new Date(dateIso).getTime();
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${plural(h, "hour")} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return d === 1 ? "yesterday" : `${d} days ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${plural(mo, "month")} ago`;
  return `${plural(Math.round(mo / 12), "year")} ago`;
}

export function stamp(dateIso: string | number | Date): string {
  return new Date(dateIso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
