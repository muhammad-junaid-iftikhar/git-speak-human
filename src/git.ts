import { ctx } from "./context";
import { BuddyError, EXIT } from "./errors";
import { ui } from "./ui";

export interface GitResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitOptions {
  mutates?: boolean;
  allowFail?: boolean;
  input?: string;
  env?: Record<string, string>;
  quietExplain?: boolean;
}

const BASE = ["-c", "core.quotePath=false", "-c", "color.ui=false"];

const INTERNAL_IDENTITY = {
  GIT_AUTHOR_NAME: "gitbuddy",
  GIT_AUTHOR_EMAIL: "gitbuddy@localhost",
  GIT_COMMITTER_NAME: "gitbuddy",
  GIT_COMMITTER_EMAIL: "gitbuddy@localhost",
};

export const internalEnv = () => INTERNAL_IDENTITY;

function quote(a: string): string {
  return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;
}

export const showCmd = (args: string[]) => ["git", ...args].map(quote).join(" ");

function buildEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), LC_ALL: "C", ...extra };
  if (ctx.agent) env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

function announce(args: string[], opts: GitOptions): boolean {
  const debug = Boolean(process.env.GITBUDDY_DEBUG);
  if (opts.mutates && ctx.flags.dryRun) {
    ui.explain(showCmd(args), true);
    return true;
  }
  if ((opts.mutates && ctx.flags.explain && !opts.quietExplain) || debug) ui.explain(showCmd(args), false);
  return false;
}

export function git(args: string[], opts: GitOptions = {}): GitResult {
  if (announce(args, opts)) return { ok: true, code: 0, stdout: "", stderr: "" };
  const proc = Bun.spawnSync(["git", ...BASE, ...args], {
    cwd: process.cwd(),
    env: buildEnv(opts.env),
    stdin: opts.input !== undefined ? new TextEncoder().encode(opts.input) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
  const result: GitResult = {
    ok: proc.exitCode === 0,
    code: proc.exitCode ?? 1,
    stdout: proc.stdout?.toString() ?? "",
    stderr: proc.stderr?.toString() ?? "",
  };
  if (!result.ok && !opts.allowFail) throw explainGitFailure(args, result);
  return result;
}

export function out(args: string[], opts: GitOptions = {}): string {
  return git(args, opts).stdout.trim();
}

export function tryOut(args: string[]): string | null {
  const r = git(args, { allowFail: true });
  return r.ok ? r.stdout.trim() : null;
}

export async function gitAsync(args: string[], opts: GitOptions = {}): Promise<GitResult> {
  if (announce(args, opts)) return { ok: true, code: 0, stdout: "", stderr: "" };
  const proc = Bun.spawn(["git", ...BASE, ...args], {
    cwd: process.cwd(),
    env: buildEnv(opts.env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const result = { ok: code === 0, code, stdout, stderr };
  if (!result.ok && !opts.allowFail) throw explainGitFailure(args, result);
  return result;
}

export function gitInherit(args: string[], opts: { env?: Record<string, string>; mutates?: boolean } = {}): number {
  if (announce(args, { mutates: opts.mutates })) return 0;
  const proc = Bun.spawnSync(["git", ...args], {
    cwd: process.cwd(),
    env: { ...(process.env as Record<string, string>), ...opts.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exitCode ?? 1;
}

export function explainGitFailure(args: string[], r: Pick<GitResult, "stderr" | "stdout">): BuddyError {
  const raw = `${r.stderr}\n${r.stdout}`;
  const details = `${showCmd(args)}\n${raw.trim()}`;
  const first = raw.split("\n").map((l) => l.replace(/^(fatal|error):\s*/, "").trim()).find(Boolean) ?? "unknown error";
  const rules: [RegExp, string, Partial<BuddyError>][] = [
    [/not a git repository/i, "This folder isn't a git project yet.", { exit: EXIT.SETUP, code: "not_a_repo", hint: "Start one with: gitbuddy new" }],
    [/Please tell me who you are|empty ident/i, "Git needs your name and email before saving.", { exit: EXIT.SETUP, code: "no_identity", hint: "Run: gitbuddy doctor" }],
    [/Permission denied \(publickey\)|Authentication failed|could not read Username|terminal prompts disabled|Invalid username or password/i, "Couldn't log in to the remote server.", { exit: EXIT.NETWORK, code: "auth_failed", hint: "Check your SSH key or token with: gitbuddy doctor" }],
    [/Could not resolve host|unable to access|Connection (timed out|refused)|Network is unreachable/i, "Couldn't reach the remote server. Are you online?", { exit: EXIT.NETWORK, code: "offline", hint: "Try again when you're connected." }],
    [/\[rejected\]|non-fast-forward|fetch first|Updates were rejected/i, "Your team sent new work before you, so yours can't go up yet.", { exit: EXIT.USER, code: "rejected", hint: "Run: gitbuddy sync  (gets their work, then sends yours)" }],
    [/does not appear to be a git repository|No such remote|No configured push destination/i, "This project isn't connected to a remote (like GitHub) yet.", { exit: EXIT.SETUP, code: "no_remote", hint: "Connect it with: gitbuddy connect <url>" }],
    [/CONFLICT|Merge conflict|could not apply|after resolving the conflicts/i, "Some changes clash with each other and need your decision.", { exit: EXIT.CONFLICT, code: "conflict", hint: "See them with: gitbuddy conflicts" }],
    [/would be overwritten/i, "Your unsaved changes would get overwritten.", { exit: EXIT.USER, code: "dirty", hint: "Save them first: gitbuddy save (or gitbuddy work \"name\")" }],
    [/unknown revision|bad revision|ambiguous argument|not a valid object name|invalid reference/i, `I couldn't find that point in history: ${first}`, { exit: EXIT.USER, code: "bad_revision", hint: "See saves with: gitbuddy history" }],
    [/pathspec .* did not match/i, `I couldn't find that file: ${first}`, { exit: EXIT.USER, code: "bad_path" }],
  ];
  for (const [re, message, extra] of rules) {
    if (re.test(raw)) return new BuddyError(message, { ...extra, details } as never);
  }
  return new BuddyError(`Git said: ${first}`, { code: "git_error", details, hint: "Add --explain to see the exact git commands." });
}
