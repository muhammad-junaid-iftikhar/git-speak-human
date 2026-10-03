import { ctx } from "../context";
import { fail } from "../errors";
import { git, gitAsync, out, tryOut } from "../git";
import { define } from "../registry";
import {
  currentBranch,
  ensureIdentity,
  head,
  isPushed,
  mainRemote,
  operation,
  remoteUrl,
  repoRoot,
  slugify,
} from "../repo";
import { captureWork, markRedone, markUndone, readJournal, record, restoreExact, snapshotCommit, type JournalEntry } from "../snapshot";
import { readState, readWorkspaces, writeWorkspaces } from "../state";
import { ago, c, plural, stamp, ui } from "../ui";
import { TRASH_REF, WORK_REF, uniqueSlug } from "../workspaces";

const ABORT: Record<string, string[]> = {
  merge: ["merge", "--abort"],
  rebase: ["rebase", "--abort"],
  "cherry-pick": ["cherry-pick", "--abort"],
  revert: ["revert", "--abort"],
  bisect: ["bisect", "reset"],
};

export function abortOperation(): string | null {
  const op = operation();
  if (op) git(ABORT[op], { mutates: true, allowFail: true });
  return op;
}

function pushedSince(entry: JournalEntry): boolean {
  const now = head();
  if (!entry.head || !now || entry.head === now) return false;
  const commits = tryOut(["rev-list", `${entry.head}..${now}`]);
  return Boolean(commits?.split("\n").filter(Boolean).some((sha) => isPushed(sha)));
}

define({
  name: "undo",
  aliases: ["oops", "revert-last"],
  group: "safety",
  summary: "Undo the last thing gitbuddy did, whatever it was",
  args: [{ name: "which", description: "How many steps back, or a snapshot id from --list" }],
  options: {
    list: { type: "boolean", description: "Show everything you can undo" },
    force: { type: "boolean", description: "Undo even if saves were already sent to your team" },
  },
  mutates: true,
  examples: ["gitbuddy undo", "gitbuddy undo 3", "gitbuddy undo --list"],
  run({ args, opts }) {
    const journal = readJournal();
    const live = journal.filter((e) => !e.undone);
    if (opts.list) {
      ctx.data = { entries: journal.slice().reverse() };
      if (!journal.length) return ui.say("undo", "Nothing to undo yet. gitbuddy remembers everything you do from now on.");
      ui.say("undo", c.bold("Things you can undo") + c.dim(" (newest first)"));
      ui.blank();
      const rows = live.slice().reverse().map((e, i) => [c.accent(String(i + 1)), c.dim(e.id), e.label, c.dim(`${ago(e.time)} · ${stamp(e.time)}`)]);
      ui.table(rows, ["#", "id", "what", "when"]);
      ui.blank();
      ui.next("gitbuddy undo <#>", "go back to before that");
      return;
    }
    if (!live.length) fail("Nothing to undo yet.", { code: "nothing_to_undo", hint: "gitbuddy remembers everything you do from now on." });
    let idx = live.length - 1;
    const which = args[0];
    if (which) {
      if (/^\d+$/.test(which) && Number(which) <= live.length) idx = live.length - Number(which);
      else {
        idx = live.findIndex((e) => e.id === which);
        if (idx < 0) fail(`I can't find "${which}" in your undo list.`, { hint: "See the list: gitbuddy undo --list" });
      }
    }
    const entry = live[idx];
    if (pushedSince(entry) && !opts.force) {
      fail("Some of those saves were already sent to your team, so undoing them here would get confusing.", {
        code: "already_pushed",
        hint: "Reverse a sent save safely with: gitbuddy reverse <save>   (or add --force if you're sure)",
      });
    }
    const label = entry.label.replace(/^before /, "");
    if (idx < live.length - 1 && !ui.confirm(`This goes back ${plural(live.length - idx, "step")}. Continue?`, { default: true })) return;
    const op = abortOperation();
    const redo = {
      commit: snapshotCommit("gitbuddy redo point"),
      branch: currentBranch(),
      head: head(),
      active: readState().active,
      work: captureWork(),
    };
    restoreExact(entry);
    if (!ctx.flags.dryRun) markUndone(entry.id, live.slice(idx).map((e) => e.id), redo);
    ui.say("undo", c.ok(`Undone: ${label}`) + c.dim(` · back to how things were ${ago(entry.time)}`));
    if (op) ui.hint(`(I also cancelled the ${op} that was in progress.)`);
    ui.next("gitbuddy redo", "changed your mind again?");
    ctx.data = { undone: entry.id, action: entry.action, label, restoredTo: entry.time };
  },
});

define({
  name: "redo",
  group: "safety",
  summary: "Bring back what you just undid",
  mutates: true,
  examples: ["gitbuddy redo"],
  run() {
    const entry = readJournal()
      .filter((e) => e.redo)
      .pop();
    if (!entry?.redo) fail("There's nothing to redo.", { code: "nothing_to_redo" });
    const r = entry!.redo!;
    abortOperation();
    restoreExact({ branch: r.branch, head: r.head, commit: r.commit, active: r.active, work: r.work });
    if (!ctx.flags.dryRun) markRedone(entry!.id);
    ui.say("redo", c.ok(`Redone: ${entry!.label.replace(/^before /, "")}`));
    ctx.data = { redone: entry!.id };
  },
});

interface Lost {
  id: string;
  commit: string;
  kind: "stash" | "lost save" | "snapshot";
  when: string;
  title: string;
  files: number;
}

function describeCommit(sha: string): { when: string; title: string } {
  const [when, ...rest] = out(["log", "-1", "--format=%cI%x1f%s", sha]).split("\x1f");
  return { when, title: rest.join(" ") };
}

function filesIn(sha: string): number {
  const parent = tryOut(["rev-parse", "-q", "--verify", `${sha}^1`]);
  const list = parent ? out(["diff", "--name-only", parent, sha]) : out(["ls-tree", "-r", "--name-only", sha]);
  const untracked = tryOut(["rev-parse", "-q", "--verify", `${sha}^3`]) ? out(["ls-tree", "-r", "--name-only", `${sha}^3`]) : "";
  return new Set([...list.split("\n"), ...untracked.split("\n")].filter(Boolean)).size;
}

function findLost(): Lost[] {
  const found: Lost[] = [];
  const seen = new Set<string>();
  const stashes = tryOut(["stash", "list", "--format=%H"]) ?? "";
  for (const sha of stashes.split("\n").filter(Boolean)) {
    seen.add(sha);
    const d = describeCommit(sha);
    found.push({ id: sha.slice(0, 7), commit: sha, kind: "stash", when: d.when, title: d.title.replace(/^(WIP on|On) [^:]+: ?/, "") || "tucked-away changes", files: filesIn(sha) });
  }
  const offBranch = tryOut(["rev-list", "--reflog", "--no-walk=unsorted", "--not", "--branches", "--tags", "--remotes"]) ?? "";
  for (const sha of offBranch.split("\n").filter(Boolean)) {
    if (seen.has(sha)) continue;
    seen.add(sha);
    const d = describeCommit(sha);
    if (/^(index|untracked files) on |^index: |^gitbuddy (snapshot|work|redo)/.test(d.title)) continue;
    found.push({ id: sha.slice(0, 7), commit: sha, kind: "lost save", when: d.when, title: d.title, files: filesIn(sha) });
  }
  const dangling = git(["fsck", "--unreachable", "--no-reflogs", "--no-progress"], { allowFail: true }).stdout;
  for (const line of dangling.split("\n")) {
    const m = line.match(/^unreachable commit ([0-9a-f]+)/);
    if (!m || seen.has(m[1])) continue;
    const d = describeCommit(m[1]);
    if (/^(index|untracked files) on |^index: |^gitbuddy redo point/.test(d.title)) continue;
    const kind = /^(WIP on|On \S+:|gitbuddy )/.test(d.title) ? "snapshot" : "lost save";
    found.push({ id: m[1].slice(0, 7), commit: m[1], kind, when: d.when, title: d.title.replace(/^gitbuddy (snapshot|work): /, ""), files: filesIn(m[1]) });
  }
  return found.filter((f) => f.files > 0).sort((a, b) => b.when.localeCompare(a.when));
}

define({
  name: "rescue",
  aliases: ["lost", "find-lost"],
  group: "safety",
  summary: "Find work you thought was lost and bring it back",
  args: [{ name: "id", description: "Which lost item to bring back" }],
  mutates: true,
  undoable: true,
  examples: ["gitbuddy rescue", "gitbuddy rescue a1b2c3d"],
  run({ args }) {
    const lost = findLost();
    if (!args.length) {
      ctx.data = { items: lost };
      if (!lost.length) return ui.say("rescue", "Good news: I couldn't find any lost work. Everything is where it should be.");
      ui.say("rescue", c.bold(`I found ${plural(lost.length, "thing")} that might be lost work`));
      ui.blank();
      ui.table(
        lost.slice(0, 30).map((l) => [c.accent(l.id), l.kind, l.title.slice(0, 50), c.dim(`${plural(l.files, "file")} · ${ago(l.when)}`)]),
        ["id", "what", "", "when"],
      );
      ui.blank();
      ui.next("gitbuddy rescue <id>", "bring it back into your files");
      return;
    }
    const item = lost.find((l) => l.commit.startsWith(args[0]));
    if (!item) fail(`I can't find "${args[0]}" among lost work.`, { hint: "See the list: gitbuddy rescue" });
    record("rescue", `before rescuing ${item!.id}`);
    const parents = out(["rev-list", "--parents", "-n1", item!.commit]).split(" ").length - 1;
    const r =
      parents >= 2
        ? git(["stash", "apply", item!.commit], { allowFail: true, mutates: true })
        : git(["cherry-pick", "--no-commit", item!.commit], { allowFail: true, mutates: true });
    if (!r.ok && !/CONFLICT/.test(r.stdout + r.stderr)) {
      fail("I couldn't bring it back on top of your current changes.", {
        hint: "Save your current work first (gitbuddy work \"something\"), then try again.",
        details: r.stderr,
      });
    }
    if (operation() === "cherry-pick") git(["cherry-pick", "--quit"], { mutates: true, allowFail: true });
    ui.say("rescue", c.ok(`Brought back "${item!.title}" into your files.`));
    if (!r.ok) ui.next("gitbuddy conflicts", "some of it clashes with what you have now");
    else ui.next("gitbuddy show", "see what came back");
    ctx.data = { rescued: item };
  },
});

interface TrashItem {
  ref: string;
  name: string;
  dropped: string;
  commit: string;
}

export function trashItems(): TrashItem[] {
  const raw = tryOut(["for-each-ref", "--format=%(refname)%09%(objectname)%09%(contents:subject)", TRASH_REF]) ?? "";
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, commit, subject] = line.split("\t");
      const stampPart = ref.split("-").pop() ?? "";
      const ms = parseInt(stampPart, 36);
      return {
        ref,
        commit,
        name: subject.replace(/^gitbuddy work: /, ""),
        dropped: Number.isFinite(ms) && ms > 1e12 ? new Date(ms).toISOString() : new Date().toISOString(),
      };
    })
    .sort((a, b) => b.dropped.localeCompare(a.dropped));
}

define({
  name: "trash",
  group: "safety",
  summary: "See workspaces you threw away (kept for 30 days)",
  examples: ["gitbuddy trash"],
  run() {
    const items = trashItems();
    ctx.data = { items };
    if (!items.length) return ui.say("trash", "The trash is empty.");
    ui.say("trash", c.bold("In the trash"));
    ui.blank();
    ui.table(items.map((t, i) => [c.accent(String(i + 1)), t.name, c.dim(`thrown away ${ago(t.dropped)}`)]));
    ui.blank();
    ui.next('gitbuddy restore "name"', "bring one back");
  },
});

define({
  name: "restore",
  aliases: ["untrash"],
  group: "safety",
  summary: "Bring a workspace back from the trash",
  args: [{ name: "name", description: "Name or number from gitbuddy trash", required: true, variadic: true }],
  mutates: true,
  examples: ['gitbuddy restore "old idea"', "gitbuddy restore 1"],
  run({ args }) {
    const items = trashItems();
    const q = args.join(" ");
    const item = /^\d+$/.test(q) ? items[Number(q) - 1] : items.find((t) => t.name.toLowerCase() === q.toLowerCase() || slugify(t.name) === slugify(q));
    if (!item) fail(`There's nothing called "${q}" in the trash.`, { hint: "See it: gitbuddy trash" });
    const slug = uniqueSlug(item!.name);
    git(["update-ref", "--create-reflog", `${WORK_REF}${slug}`, item!.commit], { mutates: true });
    git(["update-ref", "-d", item!.ref], { mutates: true });
    if (!ctx.flags.dryRun) {
      const meta = readWorkspaces();
      const now = new Date().toISOString();
      meta[slug] = { name: item!.name, created: now, updated: now };
      writeWorkspaces(meta);
    }
    ui.say("work", c.ok(`${item!.name} is back in your workspaces.`));
    ui.next(`gitbuddy switch "${item!.name}"`, "jump into it");
    ctx.data = { restored: item!.name, slug };
  },
});

interface Check {
  name: string;
  ok: boolean | "warn";
  message: string;
  fix?: string;
}

define({
  name: "doctor",
  aliases: ["checkup", "health"],
  group: "safety",
  summary: "Check that git, your login and this project are healthy",
  needsRepo: false,
  network: true,
  examples: ["gitbuddy doctor"],
  async run() {
    const checks: Check[] = [];
    const v = Bun.spawnSync(["git", "--version"], { stdout: "pipe" }).stdout?.toString().trim() ?? "";
    const m = v.match(/(\d+)\.(\d+)/);
    const okVersion = m ? Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 30) : false;
    checks.push({ name: "git", ok: m ? (okVersion ? true : "warn") : false, message: v || "not installed", fix: m ? (okVersion ? undefined : "Update git to 2.30 or newer") : "Install from https://git-scm.com/downloads" });
    if (!m) return report(checks);

    const name = tryOut(["config", "user.name"]);
    const email = tryOut(["config", "user.email"]);
    if ((!name || !email) && ctx.interactive) {
      try {
        ensureIdentity();
      } catch {
        /* reported below */
      }
    }
    const n2 = tryOut(["config", "user.name"]);
    const e2 = tryOut(["config", "user.email"]);
    checks.push({ name: "your name", ok: Boolean(n2 && e2), message: n2 && e2 ? `${n2} <${e2}>` : "not set", fix: 'git config --global user.name "You" && git config --global user.email you@example.com' });

    const root = repoRoot();
    checks.push({ name: "project", ok: root ? true : "warn", message: root ?? "this folder isn't a git project", fix: root ? undefined : "gitbuddy new" });
    if (root) {
      const op = operation();
      checks.push({ name: "in progress", ok: op ? "warn" : true, message: op ? `a ${op} is unfinished` : "nothing half-done", fix: op ? "gitbuddy conflicts / gitbuddy abort" : undefined });
      const remote = mainRemote();
      if (!remote) checks.push({ name: "remote", ok: "warn", message: "not connected to GitHub/GitLab", fix: "gitbuddy connect <url>" });
      else {
        const url = remoteUrl(remote) ?? "";
        const r = await ui.spin(`Checking ${remote}…`, () => gitAsync(["ls-remote", "--heads", remote], { allowFail: true, env: { GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=8" } }));
        const auth = /Permission denied|Authentication failed|could not read Username|terminal prompts disabled/i.test(r.stderr);
        checks.push({
          name: "remote login",
          ok: r.ok,
          message: r.ok ? `${remote} → ${url}` : auth ? "can't log in" : "can't reach the server",
          fix: r.ok ? undefined : auth ? (url.startsWith("git@") || url.startsWith("ssh:") ? "Add your SSH key to the host: ssh-keygen -t ed25519, then paste ~/.ssh/id_ed25519.pub into your account's SSH settings" : "Log in with: gh auth login   (or use a personal access token)") : "Check your internet connection and the URL",
        });
      }
      const big = (tryOut(["ls-files", "-z"]) ?? "").split("\0").filter(Boolean);
      let largest = 0;
      for (const f of big.slice(0, 20000)) {
        try {
          const s = Bun.file(`${root}/${f}`).size;
          if (s > largest) largest = s;
        } catch {
          /* ignore */
        }
      }
      checks.push({ name: "file sizes", ok: largest > 50 * 1048576 ? "warn" : true, message: largest > 50 * 1048576 ? `a ${Math.round(largest / 1048576)} MB file is tracked` : "no huge files", fix: largest > 50 * 1048576 ? "Consider git LFS for big files" : undefined });
      if (process.platform === "win32") {
        const crlf = tryOut(["config", "core.autocrlf"]);
        checks.push({ name: "line endings", ok: crlf ? true : "warn", message: crlf ? `autocrlf=${crlf}` : "not configured", fix: crlf ? undefined : "git config --global core.autocrlf true" });
      }
    }
    const gh = Bun.which("gh");
    checks.push({ name: "GitHub CLI", ok: gh ? true : "warn", message: gh ? "installed (gitbuddy share works)" : "not installed (optional)", fix: gh ? undefined : "https://cli.github.com" });
    report(checks);
  },
});

function report(checks: Check[]): void {
  ctx.data = { checks, healthy: checks.every((x) => x.ok !== false) };
  ui.say("doctor", c.bold("gitbuddy checkup"));
  ui.blank();
  ui.table(checks.map((x) => [x.ok === true ? "✅" : x.ok === "warn" ? "⚠️ " : "❌", c.bold(x.name), x.message]));
  const fixes = checks.filter((x) => x.fix && x.ok !== true);
  if (fixes.length) {
    ui.blank();
    ui.line(c.dim("   To fix:"));
    for (const f of fixes) ui.line(`   ${c.accent("•")} ${f.name}: ${f.fix}`);
  } else {
    ui.blank();
    ui.ok("All good. You're ready to go!");
  }
  if (checks.some((x) => x.ok === false)) ctx.warnings.push("Some checks failed.");
}
