import { ctx } from "../context";
import { EXIT, fail } from "../errors";
import { git, gitAsync, out, tryOut } from "../git";
import { define } from "../registry";
import { defaultBranch, head, isDirty, isPushed, operation, resolveWhen, status } from "../repo";
import { record } from "../snapshot";
import { ago, c, plural, stamp, ui } from "../ui";
import { activeWorkspace, saveWorkspace, setActive, uniqueSlug } from "../workspaces";
import { requireBranch, requireRemote } from "./everyday";
import { logEntries } from "./history";

const refExists = (ref: string) => Boolean(tryOut(["rev-parse", "-q", "--verify", ref]));

async function fetchQuietly(remote: string): Promise<void> {
  await ui.spin(`${c.accent("Checking")} ${remote}…`, () => gitAsync(["fetch", "--prune", "-q", remote], { mutates: true }));
}

function remoteTarget(remote: string, branch: string): string | null {
  const up = tryOut(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (up) return up;
  return refExists(`refs/remotes/${remote}/${branch}`) ? `${remote}/${branch}` : null;
}

define({
  name: "compare",
  aliases: ["vs-remote", "check-remote", "in-sync"],
  group: "everyday",
  summary: "Check with GitHub: what's only on your computer, what's only there",
  gitEquivalent: "git fetch && git log origin/main..HEAD / HEAD..origin/main",
  network: true,
  examples: ["gitbuddy compare"],
  async run() {
    const remote = requireRemote();
    const branch = requireBranch();
    await fetchQuietly(remote);
    const target = remoteTarget(remote, branch);
    const st = status();
    const base = defaultBranch();
    const baseRef = refExists(`refs/remotes/${remote}/${base}`) ? `${remote}/${base}` : null;
    if (!target) {
      const local = head() ? logEntries(["HEAD", "--not", `--remotes=${remote}`, "-n20"]) : [];
      ctx.data = { branch, remote: null, onlyHere: local, onlyThere: [], unsaved: st.files.length, inSync: false };
      ui.say("list", `${c.bold(branch)} isn't on ${remote} yet.`);
      if (local.length) {
        ui.line(c.dim(`   ${plural(local.length, "save")} only on your computer:`));
        for (const e of local.slice(0, 10)) ui.line(`   ${c.accent(e.id)}  ${e.message}  ${c.dim(ago(e.date))}`);
      }
      ui.next("gitbuddy send", "put it there");
      return;
    }
    const mine = head() ? logEntries([`${target}..HEAD`]) : [];
    const theirs = logEntries([`HEAD..${target}`]);
    const mainNew = baseRef && baseRef !== target ? Number(out(["rev-list", "--count", `HEAD..${baseRef}`])) : 0;
    const inSync = !mine.length && !theirs.length && st.clean;
    ctx.data = {
      branch,
      remote: target,
      onlyHere: mine,
      onlyThere: theirs,
      unsaved: st.files.map((f) => f.path),
      mainHasNew: mainNew,
      inSync,
    };
    ui.say("list", `${c.bold(branch)} ${c.dim("vs")} ${c.bold(target)}`);
    ui.blank();
    const section = (title: string, list: typeof mine, empty: string) => {
      if (!list.length) return ui.line(`   ${c.ok("✓")} ${empty}`);
      ui.line(`   ${c.warn("●")} ${title} ${c.dim(`(${list.length})`)}`);
      for (const e of list.slice(0, 10)) ui.line(`      ${c.accent(e.id)}  ${e.message}  ${c.dim(`${e.author} · ${ago(e.date)}`)}`);
      if (list.length > 10) ui.hint(`   …and ${list.length - 10} more`);
    };
    section("Only on your computer (not sent):", mine, "Nothing waiting to be sent");
    section(`Only on ${remote} (not on your computer yet):`, theirs, `You have everything from ${remote}`);
    if (st.files.length) ui.line(`   ${c.warn("●")} ${plural(st.files.length, "unsaved change")} in your files`);
    else ui.line(`   ${c.ok("✓")} No unsaved changes`);
    if (mainNew) ui.line(`   ${c.warn("●")} ${base} on ${remote} has ${plural(mainNew, "save")} you don't have`);
    ui.blank();
    if (inSync && !mainNew) ui.say("ok", c.ok(`100% in sync with ${target}.`));
    else {
      if (theirs.length && mine.length) ui.next("gitbuddy sync", "get theirs, then send yours");
      else if (theirs.length) ui.next("gitbuddy get", "bring their saves in");
      else if (mine.length) ui.next("gitbuddy send", "send your saves");
      if (mainNew) ui.next("gitbuddy catch-up", `bring the latest ${base} into ${branch}`);
      if (st.files.length) ui.next('gitbuddy done "message"', "save your changes");
      ui.hint(`Want your copy to be exactly ${target}? gitbuddy match-remote`);
    }
  },
});

define({
  name: "catch-up",
  aliases: ["update-from-main", "latest-main", "rebase-main"],
  group: "everyday",
  summary: "Bring the latest main from GitHub into what you're working on",
  gitEquivalent: "git fetch && git rebase origin/main (or merge if already sent)",
  options: { merge: { type: "boolean", description: "Combine with a merge save instead of replaying your saves on top" } },
  mutates: true,
  undoable: true,
  network: true,
  examples: ["gitbuddy catch-up"],
  async run({ opts }) {
    const remote = requireRemote();
    const branch = requireBranch();
    if (operation()) fail("Finish sorting out the current clash first.", { exit: EXIT.CONFLICT, code: "conflict", hint: "gitbuddy conflicts" });
    await fetchQuietly(remote);
    const base = defaultBranch();
    const baseRef = `${remote}/${base}`;
    if (!refExists(`refs/remotes/${baseRef}`)) fail(`${remote} has no ${base} branch.`, { code: "no_main" });
    const behind = Number(out(["rev-list", "--count", `HEAD..${baseRef}`]));
    if (!behind) {
      ui.say("clean", `You already have the latest ${base}.`);
      ctx.data = { received: 0, base: baseRef };
      return;
    }
    const mine = Number(out(["rev-list", "--count", `${baseRef}..HEAD`]));
    const sentAlready = mine > 0 && out(["rev-list", `${baseRef}..HEAD`]).split("\n").some(isPushed) && branch !== base;
    const useMerge = Boolean(opts.merge) || sentAlready;
    record("catch-up", `before bringing in the latest ${base}`);
    const r = useMerge
      ? git(["merge", "--no-edit", "--autostash", baseRef], { mutates: true, allowFail: true })
      : git(["rebase", "--autostash", "-q", baseRef], { mutates: true, allowFail: true });
    if (!r.ok || operation()) {
      fail(`The latest ${base} clashes with your work.`, { exit: EXIT.CONFLICT, code: "conflict", hint: "Sort it out: gitbuddy conflicts   (or cancel: gitbuddy abort)" });
    }
    ui.say("get", c.ok(`Brought in ${plural(behind, "new save")} from ${baseRef}`) + c.dim(useMerge ? " (with a merge save, because your saves were already sent)" : mine ? ` · your ${plural(mine, "save")} now sit on top` : ""));
    ctx.data = { received: behind, base: baseRef, method: useMerge ? "merge" : "rebase" };
  },
});

define({
  name: "match-remote",
  aliases: ["reset-to-remote", "same-as-github", "hard-sync"],
  group: "everyday",
  summary: "Make your branch exactly like GitHub (your extra work is kept aside)",
  gitEquivalent: "git fetch && git reset --hard origin/<branch>",
  mutates: true,
  destructive: true,
  undoable: true,
  network: true,
  examples: ["gitbuddy match-remote"],
  async run() {
    const remote = requireRemote();
    const branch = requireBranch();
    if (operation()) fail("Finish or cancel the current clash first.", { exit: EXIT.CONFLICT, code: "conflict", hint: "gitbuddy abort" });
    await fetchQuietly(remote);
    const target = remoteTarget(remote, branch);
    if (!target) fail(`${branch} isn't on ${remote}, so there's nothing to match.`, { hint: "gitbuddy send" });
    const mine = head() ? Number(out(["rev-list", "--count", `${target}..HEAD`])) : 0;
    const dirty = isDirty();
    if (!mine && !dirty && head() === out(["rev-parse", target!])) {
      ui.say("ok", c.ok(`Already exactly the same as ${target}.`));
      ctx.data = { changed: false, target };
      return;
    }
    const parts = [mine ? plural(mine, "unsent save") : "", dirty ? "your unsaved changes" : ""].filter(Boolean).join(" and ");
    if (!ui.confirm(`Make ${branch} exactly like ${target}?${parts ? ` ${parts} will be kept aside, not lost.` : ""}`, { default: false })) return;
    record("match-remote", `before matching ${target}`);
    let parked: string | null = null;
    if (dirty) {
      const active = activeWorkspace();
      if (active) {
        saveWorkspace(active.slug);
        parked = active.name;
      } else {
        parked = `before matching ${remote} ${stamp(Date.now())}`;
        saveWorkspace(uniqueSlug(parked), parked);
      }
    }
    let backup: string | null = null;
    if (mine) {
      const date = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      backup = `backup/${branch}-${date}`;
      git(["branch", "-q", backup, "HEAD"], { mutates: true });
    }
    git(["reset", "-q", "--hard", target!], { mutates: true });
    git(["clean", "-fdq"], { mutates: true });
    setActive(undefined);
    ui.say("ok", c.ok(`${branch} is now exactly ${target}.`));
    if (parked) ui.hint(`Your unsaved changes are in the workspace "${parked}" (gitbuddy switch "${parked}").`);
    if (backup) ui.hint(`Your ${plural(mine, "unsent save")} ${mine === 1 ? "is" : "are"} on the branch ${backup}.`);
    ui.hint("Changed your mind? gitbuddy undo");
    ctx.data = { changed: true, target, parkedWorkspace: parked, backupBranch: backup };
  },
});

define({
  name: "view",
  aliases: ["inspect", "open-save", "show-save"],
  group: "history",
  summary: "Look inside one save: message, files and changes",
  gitEquivalent: "git show <save>",
  args: [{ name: "save", description: 'Which save: an id from history, "last", or "2 saves ago"' }],
  options: { full: { type: "boolean", description: "Show every changed line" } },
  examples: ["gitbuddy view", "gitbuddy view a1b2c3d --full", 'gitbuddy view "2 saves ago"'],
  run({ args, opts }) {
    if (!head()) fail("There are no saves yet.");
    const which = args.join(" ").trim() || "last";
    const commit = which === "last" ? out(["rev-parse", "HEAD"]) : resolveWhen(which);
    const [id, author, date, subject, body] = out(["log", "-1", "--format=%h%x1f%an%x1f%aI%x1f%s%x1f%b", commit]).split("\x1f");
    const files = out(["show", "--name-status", "--format=", "-M", commit])
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [code, ...paths] = l.split("\t");
        const kind = code.startsWith("A") ? "new" : code.startsWith("D") ? "deleted" : code.startsWith("R") ? "renamed" : "changed";
        return { kind, path: paths[paths.length - 1], from: paths.length > 1 ? paths[0] : undefined };
      });
    const sent = isPushed(commit);
    const isLast = commit === head();
    ctx.data = { commit, id, author, date, message: subject, body: body.trim(), files, sent };
    ui.say("search", `${c.bold(`"${subject}"`)} ${c.dim(id)}`);
    ui.line(`   ${c.dim("by")} ${author} ${c.dim(`· ${ago(date)} (${stamp(date)}) ·`)} ${sent ? c.ok("sent") : c.warn("not sent yet")}`);
    if (body.trim()) ui.line(c.dim(`   ${body.trim().split("\n").join("\n   ")}`));
    ui.blank();
    const color: Record<string, (s: string) => string> = { new: c.add, deleted: c.del, renamed: c.accent, changed: c.warn };
    ui.table(files.map((f) => [color[f.kind](f.kind), f.from ? `${f.from} → ${f.path}` : f.path]));
    if (opts.full) {
      ui.blank();
      ui.line(git(["show", "--format=", ctx.useColor ? "--color=always" : "--no-color", commit]).stdout.trimEnd());
    }
    ui.blank();
    if (sent) ui.next(`gitbuddy reverse ${id}`, "cancel it with a new save (safe, it was already sent)");
    else if (isLast) {
      ui.next("gitbuddy unsave", "take it back, keep the changes in your files");
      ui.next('gitbuddy fix-last "new message"', "rename it");
    } else ui.next(`gitbuddy tidy drop ${id}`, "remove it (it wasn't sent yet)");
    if (!opts.full) ui.hint(`Every changed line: gitbuddy view ${id} --full`);
  },
});

