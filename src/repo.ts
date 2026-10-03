import { existsSync } from "node:fs";
import { join } from "node:path";
import { ctx } from "./context";
import { EXIT, fail } from "./errors";
import { git, out, tryOut } from "./git";
import { ui } from "./ui";

export function ensureGit(): void {
  let version = "";
  try {
    const p = Bun.spawnSync(["git", "--version"], { stdout: "pipe", stderr: "pipe" });
    version = p.stdout?.toString() ?? "";
  } catch {
    version = "";
  }
  const m = version.match(/(\d+)\.(\d+)/);
  if (!m) {
    fail("Git isn't installed on this computer yet.", {
      exit: EXIT.SETUP,
      code: "git_missing",
      hint: "Install it from https://git-scm.com/downloads, then try again.",
    });
  }
  const [maj, min] = [Number(m![1]), Number(m![2])];
  if (maj < 2 || (maj === 2 && min < 28)) {
    ui.warn(`Your git is old (${maj}.${min}). Some things may not work; please update to 2.30 or newer.`);
  }
}

export function repoRoot(): string | null {
  return tryOut(["rev-parse", "--show-toplevel"]);
}

export function ensureRepo(): string {
  const root = repoRoot();
  if (!root) {
    fail("This folder isn't a git project yet.", {
      exit: EXIT.SETUP,
      code: "not_a_repo",
      hint: "Start one here with: gitbuddy new   or copy one: gitbuddy copy <url>",
    });
  }
  return root!;
}

let gitDirCache: { cwd: string; dir: string } | null = null;

export function gitDir(): string {
  const cwd = process.cwd();
  if (gitDirCache?.cwd === cwd) return gitDirCache.dir;
  const dir = out(["rev-parse", "--absolute-git-dir"]);
  gitDirCache = { cwd, dir };
  return dir;
}

export function head(): string | null {
  return tryOut(["rev-parse", "-q", "--verify", "HEAD^{commit}"]);
}

export function currentBranch(): string | null {
  return tryOut(["symbolic-ref", "--short", "-q", "HEAD"]);
}

export function remotes(): string[] {
  return out(["remote"]).split("\n").filter(Boolean);
}

export function mainRemote(): string | null {
  const all = remotes();
  if (all.includes("origin")) return "origin";
  return all[0] ?? null;
}

export function remoteUrl(remote = mainRemote()): string | null {
  return remote ? tryOut(["remote", "get-url", remote]) : null;
}

export function defaultBranch(): string {
  const remote = mainRemote();
  if (remote) {
    const sym = tryOut(["symbolic-ref", "--short", "-q", `refs/remotes/${remote}/HEAD`]);
    if (sym) return sym.slice(remote.length + 1);
  }
  for (const b of ["main", "master", "trunk", "develop"]) {
    if (tryOut(["rev-parse", "-q", "--verify", `refs/heads/${b}`])) return b;
  }
  return currentBranch() ?? "main";
}

export function upstream(): string | null {
  return tryOut(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
}

export function aheadBehind(ref = "@{u}"): { ahead: number; behind: number } | null {
  const r = tryOut(["rev-list", "--left-right", "--count", `${ref}...HEAD`]);
  if (!r) return null;
  const [behind, ahead] = r.split(/\s+/).map(Number);
  return { ahead, behind };
}

export interface FileChange {
  path: string;
  from?: string;
  staged: string;
  unstaged: string;
  kind: "new" | "changed" | "deleted" | "renamed" | "conflict";
}

export interface Status {
  branch: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: FileChange[];
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
  conflicted: FileChange[];
  clean: boolean;
}

function kindOf(x: string, y: string): FileChange["kind"] {
  const both = x + y;
  if (both.includes("D")) return "deleted";
  if (both.includes("R") || both.includes("C")) return "renamed";
  if (both.includes("A")) return "new";
  return "changed";
}

export function status(): Status {
  const raw = git(["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"]).stdout;
  const parts = raw.split("\0");
  const st: Status = {
    branch: null,
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    clean: true,
  };
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith("# ")) {
      const [, key, ...rest] = line.split(" ");
      const val = rest.join(" ");
      if (key === "branch.head") st.branch = val === "(detached)" ? null : val;
      if (key === "branch.oid") st.oid = val === "(initial)" ? null : val;
      if (key === "branch.upstream") st.upstream = val;
      if (key === "branch.ab") {
        const m = val.match(/\+(\d+) -(\d+)/);
        if (m) {
          st.ahead = Number(m[1]);
          st.behind = Number(m[2]);
        }
      }
      continue;
    }
    const type = line[0];
    if (type === "?") {
      const f: FileChange = { path: line.slice(2), staged: ".", unstaged: "?", kind: "new" };
      st.untracked.push(f);
      st.files.push(f);
      continue;
    }
    if (type === "!") continue;
    const fields = line.split(" ");
    const xy = fields[1];
    const [x, y] = [xy[0], xy[1]];
    let f: FileChange;
    if (type === "1") {
      f = { path: fields.slice(8).join(" "), staged: x, unstaged: y, kind: kindOf(x, y) };
    } else if (type === "2") {
      f = { path: fields.slice(9).join(" "), from: parts[++i], staged: x, unstaged: y, kind: "renamed" };
    } else if (type === "u") {
      f = { path: fields.slice(10).join(" "), staged: x, unstaged: y, kind: "conflict" };
      st.conflicted.push(f);
      st.files.push(f);
      continue;
    } else continue;
    if (x !== ".") st.staged.push(f);
    if (y !== ".") st.unstaged.push(f);
    st.files.push(f);
  }
  st.clean = st.files.length === 0;
  return st;
}

export function isDirty(): boolean {
  return git(["status", "--porcelain", "-z", "--untracked-files=normal"]).stdout.length > 0;
}

export type Operation = "merge" | "rebase" | "cherry-pick" | "revert" | "bisect" | null;

export function operation(): Operation {
  const dir = gitDir();
  if (existsSync(join(dir, "rebase-merge")) || existsSync(join(dir, "rebase-apply"))) return "rebase";
  if (existsSync(join(dir, "MERGE_HEAD"))) return "merge";
  if (existsSync(join(dir, "CHERRY_PICK_HEAD"))) return "cherry-pick";
  if (existsSync(join(dir, "REVERT_HEAD"))) return "revert";
  if (existsSync(join(dir, "BISECT_LOG"))) return "bisect";
  return null;
}

export function ensureIdentity(): void {
  const name = tryOut(["config", "user.name"]);
  const email = tryOut(["config", "user.email"]);
  if (name && email) return;
  if (!ctx.interactive) {
    fail("Git needs your name and email before saving.", {
      exit: EXIT.SETUP,
      code: "no_identity",
      hint: 'Run: git config --global user.name "Your Name" && git config --global user.email you@example.com',
    });
  }
  ui.info("Quick one-time setup: git puts your name on every save.");
  const n = name || ui.ask("   Your name:");
  const e = email || ui.ask("   Your email:");
  if (!n || !e) fail("I need both a name and an email.", { exit: EXIT.SETUP, code: "no_identity" });
  git(["config", "--global", "user.name", n], { mutates: true });
  git(["config", "--global", "user.email", e], { mutates: true });
  ui.ok(`Nice to meet you, ${n}!`);
}

export function isPushed(commit: string): boolean {
  const r = tryOut(["for-each-ref", "--contains", commit, "--format=%(refname)", "refs/remotes"]);
  return Boolean(r);
}

export function resolveWhen(when: string, base = "HEAD"): string {
  const s = when.trim();
  const savesAgo = s.match(/^(\d+)\s+saves?\s+ago$/i);
  if (savesAgo) return out(["rev-parse", "--verify", `${base}~${savesAgo[1]}^{commit}`]);
  if (/^(last|previous) save$/i.test(s)) return out(["rev-parse", "--verify", `${base}~1^{commit}`]);
  if (/^(now|latest|last saved|this save)$/i.test(s)) return out(["rev-parse", "--verify", `${base}^{commit}`]);
  const direct = tryOut(["rev-parse", "-q", "--verify", `${s}^{commit}`]);
  if (direct) return direct;
  const byDate = tryOut(["rev-list", "-1", `--before=${s}`, base]);
  if (byDate) return byDate;
  return fail(`I don't understand "${when}" as a point in time.`, {
    code: "bad_when",
    hint: 'Try: "yesterday", "3 days ago", "2 saves ago", "last tuesday", a tag like v1.0, or a save id from gitbuddy history.',
  });
}

export function shortId(commit: string): string {
  return out(["rev-parse", "--short", commit]);
}

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "work";
}
