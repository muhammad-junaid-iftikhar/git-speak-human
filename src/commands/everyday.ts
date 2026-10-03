import { ctx } from "../context";
import { EXIT, fail } from "../errors";
import { explainGitFailure, git, gitAsync, out, tryOut } from "../git";
import { shareWork } from "./team";
import { enforce, scanOutgoing, scanWorkingFiles } from "../guard";
import { suggestMessage } from "../message";
import { define } from "../registry";
import {
  aheadBehind,
  currentBranch,
  ensureIdentity,
  head,
  isDirty,
  isPushed,
  mainRemote,
  operation,
  status,
  upstream,
  type FileChange,
  type Status,
} from "../repo";
import { record } from "../snapshot";
import { readState } from "../state";
import { ago, c, plural, ui } from "../ui";
import { logEntries } from "./history";
import { ARCHIVE_REF, activeWorkspace, moveWorkspaceRef } from "../workspaces";

const KIND_LABEL: Record<FileChange["kind"], (s: string) => string> = {
  new: (s) => c.add(s),
  changed: (s) => c.warn(s),
  deleted: (s) => c.del(s),
  renamed: (s) => c.accent(s),
  conflict: (s) => c.err(s),
};

function fileRows(files: FileChange[]): string[][] {
  return files.map((f) => [KIND_LABEL[f.kind](f.kind), f.from ? `${f.from} → ${f.path}` : f.path]);
}

function statusData(st: Status) {
  const pick = (f: FileChange) => ({ path: f.path, from: f.from, kind: f.kind, staged: f.staged !== "." && f.staged !== "?" });
  return {
    branch: st.branch,
    detached: !st.branch,
    upstream: st.upstream,
    ahead: st.ahead,
    behind: st.behind,
    clean: st.clean,
    changes: st.files.map(pick),
    conflicts: st.conflicted.map((f) => f.path),
  };
}

define({
  name: "show",
  aliases: ["status", "st", "check"],
  group: "everyday",
  summary: "Show what you changed and where you are",
  gitEquivalent: "git status",
  examples: ["gitbuddy show"],
  run() {
    const st = status();
    const state = readState();
    const ws = activeWorkspace();
    const op = operation();
    ctx.data = { ...statusData(st), workspace: ws?.name ?? null, operation: op, away: state.away ?? null };

    if (state.away) ui.say("time", c.warn(`You're ${state.away.label}. Go back with: gitbuddy back`));
    const where = st.branch ? `On ${c.bold(st.branch)}` : c.warn("Looking at an old save (not on a branch)");
    const sync: string[] = [];
    if (st.upstream) {
      if (st.ahead) sync.push(`${plural(st.ahead, "save")} not sent yet`);
      if (st.behind) sync.push(`${plural(st.behind, "new save")} from your team`);
      if (!st.ahead && !st.behind) sync.push("in sync with the team");
    } else if (st.oid && mainRemote()) sync.push("not sent anywhere yet");
    ui.say("list", [where, ...sync].join(c.dim(" · ")));
    if (ws) ui.say("work", `Workspace: ${c.accent(ws.name)}`);
    if (op) ui.say("conflict", c.warn(`A ${op} is in progress. See: gitbuddy conflicts`));

    const remote = mainRemote();
    const unsentRange = st.upstream ? ["@{u}..HEAD"] : st.oid && remote ? ["HEAD", "--not", `--remotes=${remote}`] : null;
    const unsent = unsentRange ? logEntries([...unsentRange, "-n6"]) : [];
    ctx.data.unsent = unsent.map((e) => ({ id: e.id, commit: e.commit, message: e.message, date: e.date }));
    if (unsent.length) {
      ui.blank();
      ui.line(c.dim("   Saved but not sent yet:"));
      for (const e of unsent.slice(0, 5)) ui.line(`   ${c.accent(e.id)}  ${e.message}  ${c.dim(ago(e.date))}`);
      if (unsent.length > 5) ui.hint("…and more (gitbuddy compare shows everything)");
      ui.hint("Look inside one: gitbuddy view <id>");
    }

    if (st.clean) {
      ui.blank();
      ui.say("clean", "Everything is saved. Nothing new here.");
      if (st.ahead) ui.next("gitbuddy send", "share your saves");
      else if (st.behind) ui.next("gitbuddy get", "grab your team's work");
      return;
    }
    ui.blank();
    ui.table(fileRows(st.files));
    ui.blank();
    if (st.conflicted.length) ui.next("gitbuddy conflicts", "sort out the clashes");
    else ui.next('gitbuddy done "what you did"', "save these changes");
  },
});

define({
  name: "diff",
  aliases: ["what-changed", "changes"],
  group: "everyday",
  summary: "See exactly which lines you changed",
  gitEquivalent: "git diff HEAD",
  args: [{ name: "files", description: "Files to look at", variadic: true }],
  options: {
    words: { type: "boolean", description: "Highlight changed words instead of lines" },
    stat: { type: "boolean", description: "Only show a summary per file" },
    since: { type: "string", description: "Compare with an older point, e.g. yesterday or v1.0" },
  },
  examples: ["gitbuddy diff", "gitbuddy diff src/app.ts --words", "gitbuddy diff --since yesterday"],
  run({ args, opts }) {
    const base = opts.since ? out(["rev-list", "-1", `--before=${opts.since}`, "HEAD"]) || String(opts.since) : head() ? "HEAD" : null;
    const st = status();
    const extra = [opts.words ? "--word-diff=color" : "", opts.stat ? "--stat" : ""].filter(Boolean);
    const color = ctx.useColor ? ["--color=always"] : ["--no-color"];
    const diffArgs = base ? ["diff", ...color, ...extra, base, "--", ...args] : ["diff", "--cached", ...color, ...extra, "--", ...args];
    const text = git(diffArgs).stdout;
    const untracked = st.untracked.filter((f) => !args.length || args.some((a) => f.path.startsWith(a)));
    ctx.data = {
      base,
      patch: ctx.flags.json ? git(diffArgs.filter((a) => a !== "--color=always" && a !== "--word-diff=color")).stdout : undefined,
      newFiles: untracked.map((f) => f.path),
    };
    if (!text.trim() && !untracked.length) {
      ui.say("clean", "No changes to show.");
      return;
    }
    if (text.trim()) ui.line(text.trimEnd());
    if (untracked.length) {
      ui.blank();
      ui.say("new", `New files (not saved yet): ${untracked.map((f) => c.add(f.path)).join(", ")}`);
    }
  },
});

function parsePicks(raw: string, max: number): number[] | null {
  const text = raw.trim().toLowerCase();
  if (text === "all" || text === "a") return Array.from({ length: max }, (_, i) => i);
  const picked = new Set<number>();
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    const nums = range ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i) : [Number(part)];
    for (const n of nums) {
      if (!Number.isInteger(n) || n < 1 || n > max) return null;
      picked.add(n - 1);
    }
  }
  return picked.size ? [...picked].sort((a, b) => a - b) : null;
}

function pickFiles(files: FileChange[]): string[] {
  if (!files.length) return [];
  if (!ctx.interactive) fail("--pick needs a person to choose. Use --only <file> instead.", { code: "needs_choice", hint: 'Example: gitbuddy done "msg" --only src/app.ts' });
  ui.line(c.bold("Which files go into this save?"));
  ui.table(files.map((f, i) => [c.accent(String(i + 1).padStart(2)), KIND_LABEL[f.kind](f.kind), f.from ? `${f.from} → ${f.path}` : f.path]));
  for (;;) {
    const raw = prompt(c.dim('   numbers like "1 3" or "2-4", or "all" ›'));
    if (raw === null) fail("Cancelled.");
    const picks = parsePicks(raw!, files.length);
    if (picks) return picks.flatMap((i) => (files[i].from ? [files[i].from!, files[i].path] : [files[i].path]));
  }
}

function archiveIfFinished(): string | null {
  const ws = activeWorkspace();
  if (!ws || isDirty()) return null;
  moveWorkspaceRef(ws.slug, ARCHIVE_REF);
  return ws.name;
}

define({
  name: "done",
  aliases: ["commit", "save-all"],
  group: "everyday",
  summary: "Save your changes for good, with a message",
  gitEquivalent: 'git add -A && git commit -m "message"',
  args: [{ name: "message", description: "A short message about what you did", variadic: true }],
  options: {
    only: { type: "list", description: "Only save these files (repeat for more)" },
    pick: { type: "boolean", short: "p", description: "Choose which files go into this save from a list" },
    "allow-secrets": { type: "boolean", description: "Save even if it looks like a password or key is inside" },
  },
  mutates: true,
  undoable: true,
  examples: ['gitbuddy done "Fix the login button"', 'gitbuddy done "Update docs" --only README.md', 'gitbuddy done "Just the fix" --pick'],
  run({ args, opts }) {
    ensureIdentity();
    if (readState().away) fail("You're looking at the past right now, so you can't save here.", { hint: "Go back first: gitbuddy back" });
    let st = status();
    if (st.conflicted.length) fail("Some files still have clashes to sort out first.", { exit: EXIT.CONFLICT, code: "conflict", hint: "See them: gitbuddy conflicts" });
    let only = (opts.only as string[] | undefined) ?? [];
    if (opts.pick) only = pickFiles(st.files);
    const pick = (files: FileChange[]) => (only.length ? files.filter((f) => only.some((o) => f.path === o || f.path.startsWith(o.replace(/\/?$/, "/")))) : files);
    if (!pick(st.files).length) {
      ui.say("clean", only.length ? "Those files have no changes to save." : "Nothing new to save. Everything is already saved.");
      ctx.data = { saved: false };
      return;
    }
    const ignored = enforce(scanWorkingFiles(pick(st.files)), { allow: Boolean(opts["allow-secrets"]), stage: "save" });
    if (ignored.length) {
      st = status();
      if (!pick(st.files).length) {
        ui.say("clean", "Nothing left to save.");
        return;
      }
    }
    const files = pick(st.files);
    let message = args.join(" ").trim();
    if (!message) {
      const suggestion = suggestMessage(files);
      message = ctx.interactive ? ui.ask(`${c.dim("   message")} ›`, suggestion) : suggestion;
    }
    record("done", `before saving "${message}"`);
    if (only.length) {
      git(["add", "-A", "--", ...only], { mutates: true });
      git(["commit", "-q", "-m", message, "--", ...only], { mutates: true });
    } else {
      git(["add", "-A"], { mutates: true });
      git(["commit", "-q", "-m", message], { mutates: true });
    }
    const commit = ctx.flags.dryRun ? "" : out(["rev-parse", "HEAD"]);
    const short = commit.slice(0, 7);
    ui.say("save", `Saved ${c.bold(`"${message}"`)} ${c.dim(short)} · ${plural(files.length, "file")}`);
    const finished = ctx.flags.dryRun ? null : archiveIfFinished();
    if (finished) ui.say("party", `Workspace ${c.accent(finished)} is finished and tucked away.`);
    ctx.data = { saved: true, commit, message, files: files.map((f) => f.path), finishedWorkspace: finished };
    if (mainRemote()) ui.next("gitbuddy send", "share it with your team");
  },
});

function upstreamTarget(branch: string): { remote: string; ref: string } | null {
  const remote = tryOut(["config", `branch.${branch}.remote`]);
  const merge = tryOut(["config", `branch.${branch}.merge`]);
  return remote && merge ? { remote, ref: merge } : null;
}

export function requireRemote(): string {
  const remote = mainRemote();
  if (!remote) {
    fail("This project isn't connected to a remote (like GitHub) yet.", {
      exit: EXIT.SETUP,
      code: "no_remote",
      hint: "Connect it with: gitbuddy connect <url>   or create one: gitbuddy connect --github",
    });
  }
  return remote!;
}

export function requireBranch(): string {
  const branch = currentBranch();
  if (readState().away || !branch) {
    fail("You're looking at an old save right now.", { code: "detached", hint: "Go back first: gitbuddy back" });
  }
  return branch!;
}

export function protectedBranches(): string[] {
  return (tryOut(["config", "--get-all", "gitbuddy.protected"]) ?? "").split("\n").map((b) => b.trim()).filter(Boolean);
}

const PROTECTED_RE = /protected branch|GH006|pre-receive hook declined|not allowed to push|push to protected|must be made through a pull request|protected_branch|You are not allowed to (force )?push/i;
const REJECTED_RE = /\[rejected\]|non-fast-forward|fetch first|Updates were rejected/i;

function rebaseOnto(up: string, label: string): void {
  record("get", label);
  const r = git(["rebase", "--autostash", "-q", up], { allowFail: true, mutates: true });
  if (!r.ok || operation() === "rebase") {
    fail("Your saves and your team's saves changed the same lines.", {
      exit: EXIT.CONFLICT,
      code: "conflict",
      hint: "Let's sort it out: gitbuddy conflicts, then gitbuddy send again   (or cancel: gitbuddy abort)",
    });
  }
  if (/autostash resulted in conflicts/i.test(r.stdout + r.stderr)) ui.warn("Your unsaved changes clash with the new work. They're safe; see: gitbuddy conflicts");
}

async function protectedFallback(branch: string, why: string): Promise<void> {
  ui.warn(`${branch} is protected, so changes have to go in through a pull request. Doing that for you…`);
  await shareWork({ base: branch, reason: why });
}

export async function sendWork(opts: { allowSecrets?: boolean; force?: boolean; toBranch?: string } = {}): Promise<void> {
  const remote = requireRemote();
  const branch = requireBranch();
  if (!head()) fail("There's nothing saved yet to send.", { hint: 'Save first: gitbuddy done "first save"' });
  if (isDirty()) ui.warn("Some changes aren't saved yet, so they won't be sent.");
  const target = upstreamTarget(branch);
  if (!opts.force && !opts.toBranch && protectedBranches().includes(branch)) {
    await protectedFallback(branch, `${branch} is marked as protected`);
    return;
  }
  if (target && !opts.force && !opts.toBranch) {
    await ui.spin(`${c.accent("Checking")} for new saves from your team…`, () => gitAsync(["fetch", "-q", target.remote], { mutates: true }));
    const ab = aheadBehind();
    if (ab && ab.behind > 0) {
      ui.info(`Your team sent ${plural(ab.behind, "save")} to ${branch} since you last got them. Getting them first, yours go on top…`);
      rebaseOnto("@{u}", `before putting your saves on top of your team's`);
      ctx.data.caughtUp = ab.behind;
    }
  }
  let ahead = target
    ? aheadBehind()?.ahead ?? 0
    : Number(out(["rev-list", "--count", "HEAD", "--not", `--remotes=${remote}`]));
  if (opts.toBranch) {
    const name = opts.toBranch.replace(/^refs\/heads\//, "");
    if (!git(["check-ref-format", "--branch", name], { allowFail: true }).ok) {
      fail(`"${name}" isn't a valid branch name.`, { code: "bad_branch", hint: "Use letters, numbers, - and /, e.g. feature/login" });
    }
    const remoteRef = `refs/remotes/${remote}/${name}`;
    const exists = Boolean(tryOut(["rev-parse", "-q", "--verify", remoteRef]));
    const range = exists ? [`${remoteRef}..HEAD`] : ["HEAD", "--not", `--remotes=${remote}`];
    const count = Number(out(["rev-list", "--count", ...range]));
    if (exists && count === 0) {
      ui.say("clean", `${remote}/${name} already has all your saves.`);
      ctx.data = { sent: 0, remote, branch: name };
      return;
    }
    enforce(scanOutgoing(range), { allow: Boolean(opts.allowSecrets), stage: "send" });
    await ui.spin(`${c.accent("Sending")} ${plural(count, "save")} to ${remote}/${name}…`, () => gitAsync(["push", remote, `HEAD:refs/heads/${name}`], { mutates: true }));
    ui.say("send", c.ok(`Sent ${plural(count, "save")} to ${remote}/${name}`) + c.dim(` · you're still on ${branch}`));
    ui.next(`gitbuddy share --branch ${name}`, "ask your team to review it");
    ctx.data = { sent: count, remote, branch: name, from: branch };
    return;
  }
  if (opts.force) {
    if (!ui.confirm("Overwrite the remote with your history? Saves only on the remote will be lost.", { default: false })) return;
    const args = target ? ["push", "--force-with-lease", target.remote, `HEAD:${target.ref}`] : ["push", "--force-with-lease", "-u", remote, branch];
    await ui.spin(`${c.accent("Overwriting")} ${remote}…`, () => gitAsync(args, { mutates: true }));
    ui.say("send", c.ok(`Overwrote ${remote} with your history.`));
    ctx.data = { sent: ahead, remote, branch, forced: true };
    return;
  }
  if (target && ahead === 0) {
    ui.say("clean", "Nothing new to send. Your team already has all your saves.");
    ctx.data = { sent: 0 };
    return;
  }
  const range = target ? ["@{u}..HEAD"] : ["HEAD", "--not", `--remotes=${remote}`];
  enforce(scanOutgoing(range), { allow: Boolean(opts.allowSecrets), stage: "send" });
  const pushArgs = target ? ["push", target.remote, `HEAD:${target.ref}`] : ["push", "-u", remote, branch];
  let r = await ui.spin(`${c.accent("Sending")} ${plural(ahead, "save")} to ${remote}…`, () => gitAsync(pushArgs, { mutates: true, allowFail: true }));
  if (!r.ok && REJECTED_RE.test(r.stderr) && !PROTECTED_RE.test(r.stderr) && target) {
    ui.info("Someone sent new saves at the same moment. Getting them and trying again…");
    await gitAsync(["fetch", "-q", target.remote], { mutates: true });
    rebaseOnto("@{u}", "before retrying the send");
    ahead = aheadBehind()?.ahead ?? ahead;
    r = await ui.spin(`${c.accent("Sending")} again…`, () => gitAsync(pushArgs, { mutates: true, allowFail: true }));
  }
  if (!r.ok && PROTECTED_RE.test(r.stderr)) {
    git(["config", "--add", "gitbuddy.protected", branch], { mutates: true });
    await protectedFallback(branch, `${remote} refused direct pushes to ${branch}`);
    return;
  }
  if (!r.ok) throw explainGitFailure(pushArgs, r);
  ui.say("send", c.ok(`Sent ${plural(ahead, "save")} to ${remote}/${target ? target.ref.replace("refs/heads/", "") : branch}`));
  ctx.data = { ...ctx.data, sent: ahead, remote, branch };
}

export async function getWork(): Promise<number> {
  const remote = requireRemote();
  const branch = requireBranch();
  if (operation()) fail("Finish sorting out the current clash first.", { exit: EXIT.CONFLICT, code: "conflict", hint: "See: gitbuddy conflicts" });
  await ui.spin(`${c.accent("Checking")} for new work…`, () => gitAsync(["fetch", "--prune", remote], { mutates: true }));
  let up = upstream();
  if (!up && tryOut(["rev-parse", "-q", "--verify", `refs/remotes/${remote}/${branch}`])) {
    git(["branch", "-q", `--set-upstream-to=${remote}/${branch}`], { mutates: true });
    up = `${remote}/${branch}`;
  }
  if (!up) {
    ui.say("clean", "Nothing to get. This branch isn't on the remote yet.");
    ui.next("gitbuddy send", "put it there");
    ctx.data = { received: 0 };
    return 0;
  }
  const ab = aheadBehind();
  if (!ab || ab.behind === 0) {
    ui.say("clean", "You're already up to date.");
    ctx.data = { received: 0 };
    return 0;
  }
  const before = head();
  const authors = [...new Set(out(["log", "--format=%an", before ? `${before}..${up}` : up]).split("\n").filter(Boolean))];
  record("get", "before getting your team's work");
  const r = git(["rebase", "--autostash", "-q", up], { allowFail: true, mutates: true });
  const said = r.stdout + r.stderr;
  if (!r.ok || operation() === "rebase") {
    fail("Your work and your team's work changed the same lines.", {
      exit: EXIT.CONFLICT,
      code: "conflict",
      hint: "Let's sort it out: gitbuddy conflicts   (or cancel with: gitbuddy abort)",
    });
  }
  if (/autostash resulted in conflicts/i.test(said)) {
    ui.warn("Your unsaved changes clash with the new work. They're safe; see: gitbuddy conflicts");
  }
  ui.say("get", c.ok(`Got ${plural(ab.behind, "new save")}${authors.length ? ` from ${authors.join(", ")}` : ""}`));
  ctx.data = { received: ab.behind, authors };
  return ab.behind;
}

define({
  name: "send",
  aliases: ["push", "upload"],
  group: "everyday",
  summary: "Send your saves to your team (GitHub, GitLab…)",
  gitEquivalent: "git push",
  options: {
    branch: { type: "string", short: "b", description: "Send to this branch on the remote (created if new), e.g. feature/login" },
    "allow-secrets": { type: "boolean", description: "Send even if a save looks like it contains a secret" },
    force: { type: "boolean", description: "Overwrite the remote with your history (after forget-file or tidy)" },
  },
  mutates: true,
  network: true,
  examples: ["gitbuddy send", "gitbuddy send --branch feature/login"],
  run: ({ opts }) => sendWork({ allowSecrets: Boolean(opts["allow-secrets"]), force: Boolean(opts.force), toBranch: opts.branch as string | undefined }),
});

define({
  name: "get",
  aliases: ["pull", "download", "fetch"],
  group: "everyday",
  summary: "Get the latest work from your team",
  gitEquivalent: "git pull --rebase --autostash",
  mutates: true,
  undoable: true,
  network: true,
  examples: ["gitbuddy get"],
  run: async () => {
    await getWork();
  },
});

define({
  name: "sync",
  group: "everyday",
  summary: "Get your team's work, then send yours. One step.",
  gitEquivalent: "git pull --rebase && git push",
  options: { "allow-secrets": { type: "boolean", description: "Send even if a save looks like it contains a secret" } },
  mutates: true,
  network: true,
  examples: ["gitbuddy sync"],
  run: async ({ opts }) => {
    const received = await getWork();
    const got = { ...ctx.data };
    await sendWork({ allowSecrets: Boolean(opts["allow-secrets"]) });
    ctx.data = { received, ...got, ...ctx.data };
  },
});

define({
  name: "fix-last",
  aliases: ["amend"],
  group: "everyday",
  summary: "Change the message of your last save or add forgotten files",
  gitEquivalent: "git commit --amend",
  args: [{ name: "message", description: "The new message", variadic: true }],
  options: {
    add: { type: "list", description: "Add a forgotten file to the last save" },
    all: { type: "boolean", description: "Add all current changes to the last save" },
    force: { type: "boolean", description: "Allow it even if the save was already sent" },
  },
  mutates: true,
  undoable: true,
  examples: ['gitbuddy fix-last "Better message"', "gitbuddy fix-last --add forgotten.ts"],
  run({ args, opts }) {
    const h = head();
    if (!h) fail("There's no save to fix yet.");
    if (isPushed(h!) && !opts.force) {
      fail("Your last save was already sent to your team, so changing it would confuse them.", {
        code: "already_pushed",
        hint: 'Make a new save instead (gitbuddy done "fix"), or add --force if you really know what you\'re doing.',
      });
    }
    const message = args.join(" ").trim();
    const add = (opts.add as string[] | undefined) ?? [];
    if (!message && !add.length && !opts.all) fail("Tell me what to fix: a new message, --add <file>, or --all.", { hint: 'Example: gitbuddy fix-last "Better message"' });
    record("fix-last", "before fixing the last save");
    if (opts.all) git(["add", "-A"], { mutates: true });
    if (add.length) git(["add", "-A", "--", ...add], { mutates: true });
    git(["commit", "-q", "--amend", ...(message ? ["-m", message] : ["--no-edit"])], { mutates: true });
    ui.ok(message ? `Last save is now called "${message}".` : "Added to your last save.");
    ctx.data = { commit: ctx.flags.dryRun ? "" : out(["rev-parse", "HEAD"]), message: message || null, added: add };
  },
});

define({
  name: "protect",
  aliases: ["protected"],
  group: "team",
  summary: "Mark branches (like main) that only accept pull requests",
  args: [{ name: "branch", description: "Branch to protect (leave out to see the list)" }],
  options: { remove: { type: "boolean", description: "Stop treating it as protected" } },
  mutates: true,
  examples: ["gitbuddy protect main", "gitbuddy protect", "gitbuddy protect develop --remove"],
  run({ args, opts }) {
    const list = protectedBranches();
    const name = args[0];
    if (!name) {
      ctx.data = { protected: list };
      if (!list.length) ui.say("lock", "No protected branches yet. gitbuddy also learns them when the remote refuses a push.");
      else ui.say("lock", `Protected: ${list.map((b) => c.bold(b)).join(", ")}. ${c.dim("gitbuddy send turns your saves into a pull request for these.")}`);
      return;
    }
    if (opts.remove) {
      git(["config", "--unset-all", "gitbuddy.protected", `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`], { mutates: true, allowFail: true });
      ui.ok(`${name} is no longer treated as protected.`);
    } else if (!list.includes(name)) {
      git(["config", "--add", "gitbuddy.protected", name], { mutates: true });
      ui.say("lock", c.ok(`${name} is protected. gitbuddy send will open a pull request instead of pushing to it.`));
    } else ui.say("lock", `${name} is already protected.`);
    ctx.data = { protected: protectedBranches() };
  },
});
