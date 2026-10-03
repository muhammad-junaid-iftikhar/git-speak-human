import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ctx } from "./context";
import { fail } from "./errors";
import { git, tryOut } from "./git";
import { head, repoRoot } from "./repo";
import { c, ui } from "./ui";

export interface Finding {
  path: string;
  reason: string;
  kind: "name" | "content" | "size";
  bytes?: number;
}

const NAME_RULES: [RegExp, string][] = [
  [/(^|\/)\.env(\.(?!example$|sample$|template$|dist$|defaults$)[\w.-]+)?$/i, "environment file with secrets"],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, "private SSH key"],
  [/\.(pem|p12|pfx|keystore|jks|kdbx)$/i, "key or certificate file"],
  [/(^|\/)[^/]*private[-_]?key[^/]*$/i, "private key file"],
  [/(^|\/)credentials(\.json)?$/i, "credentials file"],
  [/(^|\/)\.pypirc$/, "Python package token file"],
  [/service[-_]?account[^/]*\.json$/i, "cloud service account key"],
];

const CONTENT_RULES: [RegExp, string][] = [
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/, "GitHub token"],
  [/github_pat_[A-Za-z0-9_]{60,}/, "GitHub token"],
  [/\bsk-(ant-|proj-)?[A-Za-z0-9_-]{24,}/, "AI API key"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/, "private key"],
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
  [/glpat-[A-Za-z0-9_-]{20,}/, "GitLab token"],
  [/_authToken=[^\s$]{8,}/, "npm token"],
];

const WARN_BYTES = 50 * 1024 * 1024;
const BLOCK_BYTES = 100 * 1024 * 1024;

export function scanName(path: string): string | null {
  for (const [re, why] of NAME_RULES) if (re.test(path)) return why;
  return null;
}

export function scanText(text: string): string | null {
  for (const [re, why] of CONTENT_RULES) if (re.test(text)) return why;
  return null;
}

function addedLinesByFile(patch: string): Map<string, string> {
  const map = new Map<string, string>();
  let file = "";
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.slice(4).replace(/^b\//, "");
      continue;
    }
    if (line.startsWith("+") && file && file !== "/dev/null") map.set(file, (map.get(file) ?? "") + line.slice(1) + "\n");
  }
  return map;
}

export function scanWorkingFiles(paths: { path: string; kind: string }[]): Finding[] {
  const root = repoRoot() ?? process.cwd();
  const findings: Finding[] = [];
  const tracked = paths.filter((p) => p.kind !== "new" && p.kind !== "deleted").map((p) => p.path);
  const added = head() && tracked.length
    ? addedLinesByFile(git(["diff", "-U0", "--no-ext-diff", "HEAD", "--", ...tracked], { allowFail: true }).stdout)
    : new Map<string, string>();
  for (const { path, kind } of paths) {
    if (kind === "deleted") continue;
    const name = scanName(path);
    if (name) findings.push({ path, reason: name, kind: "name" });
    const abs = join(root, path);
    if (!existsSync(abs)) continue;
    let size = 0;
    try {
      const s = statSync(abs);
      if (!s.isFile()) continue;
      size = s.size;
    } catch {
      continue;
    }
    if (size > WARN_BYTES) findings.push({ path, reason: `${Math.round(size / 1048576)} MB file`, kind: "size", bytes: size });
    let text = added.get(path);
    if (text === undefined && kind === "new" && size < 2 * 1024 * 1024) {
      const buf = readFileSync(abs);
      if (!buf.subarray(0, 8000).includes(0)) text = buf.toString("utf-8");
    }
    const secret = text ? scanText(text) : null;
    if (secret) findings.push({ path, reason: secret, kind: "content" });
  }
  return findings;
}

export function scanOutgoing(range: string[]): Finding[] {
  const patch = git(["log", "-p", "-U0", "--format=", "--no-ext-diff", ...range], { allowFail: true }).stdout;
  const findings: Finding[] = [];
  for (const [path, text] of addedLinesByFile(patch)) {
    const name = scanName(path);
    if (name) findings.push({ path, reason: name, kind: "name" });
    const secret = scanText(text);
    if (secret) findings.push({ path, reason: secret, kind: "content" });
  }
  return findings;
}

export function enforce(findings: Finding[], opts: { allow: boolean; stage: "save" | "send" }): string[] {
  const blocking = findings.filter((f) => f.kind !== "size" || (f.bytes ?? 0) > BLOCK_BYTES);
  for (const f of findings.filter((x) => !blocking.includes(x))) ui.warn(`${f.path} is big (${f.reason}). Big files make the project slow for everyone.`);
  if (!blocking.length) return [];
  if (opts.allow) {
    for (const f of blocking) ui.warn(`Sending ${f.path} anyway (${f.reason}) because you said --allow-secrets.`);
    return [];
  }
  ui.line(`${c.err("🔒 Hold on! This looks like something you shouldn't share:")}`);
  for (const f of blocking) ui.line(`   ${c.bold(f.path)}  ${c.dim(f.reason)}`);
  const nameOnly = blocking.every((f) => f.kind === "name") && opts.stage === "save";
  if (nameOnly && ctx.interactive && ui.confirm("Add these files to .gitignore so they're never saved?", { default: true })) {
    addToGitignore(blocking.map((f) => f.path));
    ui.ok("Added to .gitignore. They stay on your computer only.");
    return blocking.map((f) => f.path);
  }
  return fail(opts.stage === "save" ? "I didn't save, to keep your secrets safe." : "I didn't send, to keep your secrets safe.", {
    code: "secrets_found",
    hint:
      opts.stage === "save"
        ? "Hide them with: gitbuddy ignore <file>   (false alarm? add --allow-secrets)"
        : "Take the last save back with: gitbuddy unsave   (false alarm? add --allow-secrets)",
  });
}

export function addToGitignore(patterns: string[]): void {
  const root = repoRoot() ?? process.cwd();
  const file = join(root, ".gitignore");
  const existing = existsSync(file) ? readFileSync(file, "utf-8") : "";
  const lines = new Set(existing.split("\n").map((l) => l.trim()));
  const missing = patterns.filter((p) => !lines.has(p) && !lines.has(`/${p}`));
  if (!missing.length || ctx.flags.dryRun) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  appendFileSync(file, prefix + missing.join("\n") + "\n");
}

export function isIgnored(path: string): boolean {
  return tryOut(["check-ignore", "-q", path]) !== null;
}
