import { ctx } from "../context";
import { EXIT, fail } from "../errors";
import { git, gitAsync, out, tryOut } from "../git";
import { addToGitignore } from "../guard";
import { define } from "../registry";
import { currentBranch, defaultBranch, head, isDirty, isPushed, mainRemote, operation, remoteUrl, resolveWhen, shortId, slugify, status } from "../repo";
import { cleanTree, record } from "../snapshot";
import { ago, c, plural, ui } from "../ui";
import { protectedBranches } from "./everyday";
import { logEntries } from "./history";
import { openPullRequest } from "./team";

define({
  name: "throw-away",
  aliases: ["discard", "reset-changes", "trash-changes"],
  group: "fix",
  summary: "Throw away unsaved changes (gitbuddy undo can still get them back)",
  gitEquivalent: "git restore . && git clean -fd",
  args: [{ name: "files", description: "Only these files (default: everything)", variadic: true }],
  mutates: true,
  destructive: true,
  undoable: true,
  examples: ["gitbuddy throw-away", "gitbuddy throw-away src/messy.ts"],
  run({ args }) {
    const st = status();
    if (st.conflicted.length || operation()) fail("You're in the middle of sorting out clashes.", { exit: EXIT.CONFLICT, code: "conflict", hint: "To cancel all of it: gitbuddy abort" });
    const targets = args.length ? st.files.filter((f) => args.some((a) => f.path === a || f.path.startsWith(a.replace(/\/?$/, "/")))) : st.files;
    if (!targets.length) {
      ui.say("clean", args.length ? "Those files have no unsaved changes." : "Nothing to throw away. Everything is saved.");
      ctx.data = { discarded: [] };
      return;
    }
    if (!ui.confirm(`Throw away changes in ${plural(targets.length, "file")}? (you can get them back with gitbuddy undo)`, { default: false })) return;
    record("throw-away", `before throwing away ${plural(targets.length, "change")}`);
    if (!args.length) cleanTree();
    else {
      for (const f of targets) {
        if (f.staged === "." && f.unstaged === "?") git(["clean", "-fq", "--", f.path], { mutates: true });
        else if (f.staged === "A") git(["rm", "-qf", "--", f.path], { mutates: true });
        else if (head()) git(["restore", "--source=HEAD", "--staged", "--worktree", "--", f.path], { mutates: true });
      }
    }
    ui.say("trash", c.ok(`Threw away changes in ${plural(targets.length, "file")}.`));
    ui.next("gitbuddy undo", "if you want them back");
    ctx.data = { discarded: targets.map((f) => f.path) };
  },
});

define({
  name: "unsave",
  aliases: ["uncommit", "take-back"],
  group: "fix",
  summary: "Take back your last save(s) but keep the changes in your files",
  gitEquivalent: "git reset --soft HEAD~1",
  args: [{ name: "count", description: "How many saves to take back (default 1)" }],
  options: { force: { type: "boolean", description: "Allow it even if the saves were already sent" } },
  mutates: true,
  undoable: true,
  examples: ["gitbuddy unsave", "gitbuddy unsave 2"],
  run({ args, opts }) {
    const n = Number(args[0] ?? 1);
    if (!Number.isInteger(n) || n < 1) fail("Tell me how many saves, like: gitbuddy unsave 2");
    const h = head();
    if (!h) fail("There are no saves to take back.");
    const total = Number(out(["rev-list", "--count", "HEAD"]));
    if (n > total) fail(`You only have ${plural(total, "save")}.`);
    const commits = out(["rev-list", `-n${n}`, "HEAD"]).split("\n");
    if (commits.some(isPushed) && !opts.force) {
      fail("That save was already sent to your team, so taking it back would confuse them.", {
        code: "already_pushed",
        hint: "Make a save that undoes it instead: gitbuddy revert last",
      });
    }
    const messages = out(["log", `-n${n}`, "--format=%s"]).split("\n");
    record("unsave", `before taking back ${plural(n, "save")}`);
    if (n === total) {
      git(["update-ref", "-d", "HEAD"], { mutates: true });
    } else git(["reset", "-q", "--soft", `HEAD~${n}`], { mutates: true });
    ui.say("undo", c.ok(`Took back ${n === 1 ? `"${messages[0]}"` : plural(n, "save")}.`) + c.dim(" The changes are still in your files."));
    ctx.data = { unsaved: commits, messages };
    ui.next('gitbuddy done "better message"', "save again when ready");
  },
});

interface RevertTarget {
  commit: string;
  id: string;
  message: string;
  merge: boolean;
}

function describeSave(commit: string): RevertTarget {
  const [id, message, parents] = out(["log", "-1", "--format=%h%x1f%s%x1f%p", commit]).split("\x1f");
  return { commit: out(["rev-parse", commit]), id, message, merge: parents.trim().split(" ").length > 1 };
}

function findPrCommit(pr: string, ref: string): string | null {
  const n = pr.replace(/^#/, "");
  const log = tryOut(["log", "--first-parent", "-n500", "--format=%H%x1f%s", ref]) ?? "";
  for (const line of log.split("\n")) {
    const [sha, subject] = line.split("\x1f");
    if (new RegExp(`(Merge pull request #${n}\\b|\\(#${n}\\)|!${n}\\b|Merge branch .* into .*#${n}\\b)`).test(subject ?? "")) return sha;
  }
  if (Bun.which("gh")) {
    const p = Bun.spawnSync(["gh", "pr", "view", n, "--json", "mergeCommit", "-q", ".mergeCommit.oid"], { stdout: "pipe", stderr: "pipe" });
    const sha = p.stdout.toString().trim();
    if (p.exitCode === 0 && /^[0-9a-f]{40}$/.test(sha)) return sha;
  }
  return null;
}

function resolveTargets(args: string[], pr: string | undefined, ref: string): RevertTarget[] {
  if (pr) {
    const sha = findPrCommit(pr, ref);
    if (!sha) fail(`I couldn't find what pull request #${pr.replace(/^#/, "")} merged.`, { code: "pr_not_found", hint: "Is it merged yet? Run gitbuddy get first, or pass the save id instead." });
    return [describeSave(sha!)];
  }
  const shas: string[] = [];
  for (const a of args) {
    if (a === "last") shas.push(out(["rev-parse", "HEAD"]));
    else if (a.includes("..")) shas.push(...out(["rev-list", "--reverse", "--no-merges", a]).split("\n").filter(Boolean));
    else shas.push(resolveWhen(a));
  }
  return [...new Set(shas)].map(describeSave);
}

function revertCommits(targets: RevertTarget[], message?: string): { conflict: boolean } {
  const newestFirst = [...targets].reverse();
  if (targets.length === 1 && !message) {
    const t = targets[0];
    const r = git(["revert", "--no-edit", ...(t.merge ? ["-m", "1"] : []), t.commit], { mutates: true, allowFail: true });
    return { conflict: !r.ok };
  }
  for (const t of newestFirst) {
    const r = git(["revert", "--no-commit", ...(t.merge ? ["-m", "1"] : []), t.commit], { mutates: true, allowFail: true });
    if (!r.ok) return { conflict: true };
  }
  const title = message ?? `Revert ${targets.length} saves`;
  const body = targets.map((t) => `- ${t.message} (${t.id})`).join("\n");
  git(["commit", "-q", "-m", title, "-m", `This reverts:\n${body}`], { mutates: true, env: { GIT_EDITOR: "true" } });
  return { conflict: false };
}

define({
  name: "revert",
  aliases: ["reverse", "cancel-save"],
  group: "fix",
  summary: "Undo saves that were already sent: a save, several, or a whole PR (opens a revert PR on main)",
  gitEquivalent: "git revert <save>  (+ branch + PR when main is protected)",
  args: [{ name: "saves", description: 'Save ids, "last", or a range like a1b2..c3d4 (leave out to pick)', variadic: true }],
  options: {
    pr: { type: "string", description: "Revert everything a merged pull request brought in, e.g. 42" },
    here: { type: "boolean", description: "Revert right here instead of opening a revert pull request" },
    share: { type: "boolean", description: "Always open a revert pull request" },
    message: { type: "string", short: "m", description: "Message for the revert save" },
  },
  mutates: true,
  undoable: true,
  network: true,
  examples: ["gitbuddy revert last", "gitbuddy revert a1b2c3d", "gitbuddy revert --pr 42", "gitbuddy revert a1b2c3d e4f5a6b", "gitbuddy revert last --here"],
  async run({ args, opts }) {
    if (operation()) fail("Finish the current clash first.", { exit: EXIT.CONFLICT, code: "conflict", hint: "gitbuddy conflicts" });
    if (!head()) fail("There are no saves to revert.");
    const branch = currentBranch();
    if (!branch) fail("Come back to the present first.", { hint: "gitbuddy back" });
    const remote = mainRemote();
    const base = defaultBranch();
    const viaPr = Boolean(remote) && !opts.here && (Boolean(opts.share) || branch === base || protectedBranches().includes(branch!));
    let ref = "HEAD";
    if (remote && viaPr) {
      await ui.spin(`${c.accent("Checking")} ${remote}…`, () => gitAsync(["fetch", "-q", remote], { mutates: true }));
      const target = protectedBranches().includes(branch!) ? branch! : base;
      if (tryOut(["rev-parse", "-q", "--verify", `refs/remotes/${remote}/${target}`])) ref = `${remote}/${target}`;
    }
    let targets: RevertTarget[];
    if (!args.length && !opts.pr) {
      const recent = logEntries(["--first-parent", "-n20", ref]);
      if (!ctx.interactive) {
        ctx.data = { choices: recent };
        fail("Which save should I revert?", { code: "needs_choice", hint: "gitbuddy revert <id> | last | --pr <number>" });
      }
      const pick = ui.pick(
        "Which save do you want to revert?",
        recent.map((e) => ({ label: `${c.accent(e.id)} ${e.message} ${c.dim(`${e.author} · ${ago(e.date)}`)}`, value: e.commit })),
      );
      targets = [describeSave(pick)];
    } else targets = resolveTargets(args, opts.pr as string | undefined, ref);

    const files = [...new Set(targets.flatMap((t) => out(["show", "--name-only", "--format=", ...(t.merge ? ["-m", "--first-parent"] : []), t.commit]).split("\n").filter(Boolean)))];
    ui.say("undo", c.bold(`Reverting ${targets.length === 1 ? `"${targets[0].message}"` : plural(targets.length, "save")}`));
    for (const t of targets) ui.line(`   ${c.accent(t.id)} ${t.message}${t.merge ? c.dim(" (a merged pull request: all of it)") : ""}`);
    ui.hint(`${plural(files.length, "file")}: ${files.slice(0, 6).join(", ")}${files.length > 6 ? "…" : ""}`);
    ui.hint(viaPr ? `This opens a revert pull request into ${ref.replace(`${remote}/`, "")}; your own work stays as it is.` : "This adds a new save that cancels it out. History stays intact.");
    if (!ui.confirm("Go ahead?", { default: true })) return;

    const title = (opts.message as string | undefined) ?? (targets.length === 1 ? `Revert "${targets[0].message}"` : undefined);
    record("revert", `before reverting ${targets.map((t) => t.id).join(", ")}`);

    if (!viaPr) {
      const { conflict } = revertCommits(targets, opts.message as string | undefined);
      if (conflict) fail("Reverting it clashes with later changes.", { exit: EXIT.CONFLICT, code: "conflict", hint: "Sort it out: gitbuddy conflicts, then gitbuddy continue   (or cancel: gitbuddy abort)" });
      ui.say("undo", c.ok(`Reverted. New save: ${shortId("HEAD")}`));
      ctx.data = { reverted: targets, commit: ctx.flags.dryRun ? "" : out(["rev-parse", "HEAD"]), viaPullRequest: false };
      if (remote) ui.next("gitbuddy send", "share the revert");
      return;
    }

    const targetBase = ref.replace(`${remote}/`, "");
    let tucked: string | undefined;
    if (isDirty()) {
      git(["stash", "push", "-u", "-q", "-m", "gitbuddy: tucked away while making a revert pull request"], { mutates: true });
      tucked = ctx.flags.dryRun ? undefined : out(["rev-parse", "stash@{0}"]);
    }
    const name = (() => {
      const stem = `revert/${slugify(targets[0].message).slice(0, 40)}`;
      if (!tryOut(["rev-parse", "-q", "--verify", `refs/heads/${stem}`])) return stem;
      for (let i = 2; ; i++) if (!tryOut(["rev-parse", "-q", "--verify", `refs/heads/${stem}-${i}`])) return `${stem}-${i}`;
    })();
    git(["switch", "-q", "-c", name, ref], { mutates: true });
    const { conflict } = revertCommits(targets, opts.message as string | undefined);
    if (conflict) {
      fail(`Reverting clashes with later changes. You're on "${name}" to sort it out.`, {
        exit: EXIT.CONFLICT,
        code: "conflict",
        hint: `gitbuddy conflicts → gitbuddy continue → gitbuddy share --base ${targetBase}   (or give up: gitbuddy abort, then gitbuddy undo)`,
      });
    }
    await ui.spin(`${c.accent("Sending")} the revert…`, () => gitAsync(["push", "-q", "-u", remote!, name], { mutates: true }));
    const prTitle = title ?? `Revert ${targets.length} saves`;
    const body = `This reverts:\n${targets.map((t) => `- ${t.message} (${t.id})`).join("\n")}${opts.pr ? `\n\nReverts #${String(opts.pr).replace(/^#/, "")}` : ""}\n\n_Made with [gitbuddy](https://github.com/muhammad-junaid-iftikhar/git-speak-human)_`;
    const link = openPullRequest({ title: prTitle, body, base: targetBase, branch: name });
    git(["switch", "-q", branch!], { mutates: true });
    if (tucked) {
      const list = (tryOut(["stash", "list", "--format=%H"]) ?? "").split("\n");
      const idx = list.indexOf(tucked);
      if (idx >= 0) git(["stash", "pop", "-q", `stash@{${idx}}`], { mutates: true, allowFail: true });
    }
    ui.say("share", c.ok(`Revert pull request ready: ${c.bold(prTitle)}`));
    if (link) ui.line(`   ${c.accent(link)}`);
    ui.hint(`Once it's merged, gitbuddy get brings the revert into your ${targetBase}.`);
    ctx.data = { reverted: targets, branch: name, base: targetBase, link, viaPullRequest: true };
  },
});

define({
  name: "ignore",
  aliases: ["hide", "never-save"],
  group: "fix",
  summary: "Tell git to never save certain files (like secrets or build junk)",
  gitEquivalent: "echo pattern >> .gitignore && git rm --cached",
  args: [{ name: "patterns", description: "Files or patterns, e.g. .env or *.log", required: true, variadic: true }],
  mutates: true,
  undoable: true,
  examples: ["gitbuddy ignore .env", 'gitbuddy ignore "*.log" dist/'],
  run({ args }) {
    record("ignore", `before ignoring ${args.join(", ")}`);
    addToGitignore(args);
    const tracked = (tryOut(["ls-files", "-ci", "--exclude-standard", "-z"]) ?? "").split("\0").filter(Boolean);
    if (tracked.length) git(["rm", "-r", "-q", "--cached", "--", ...tracked], { mutates: true });
    ui.say("lock", c.ok(`Git will ignore ${args.join(", ")} from now on.`));
    if (tracked.length) ui.hint(`${plural(tracked.length, "file")} stop being tracked (they stay on your computer).`);
    ctx.data = { patterns: args, untracked: tracked };
    ui.next('gitbuddy done "Ignore files"', "save the new rule");
  },
});

define({
  name: "forget-file",
  aliases: ["purge", "remove-from-history"],
  group: "fix",
  summary: "Erase a file from ALL history (for leaked secrets). Big hammer.",
  gitEquivalent: "git filter-repo --invert-paths --path <file>",
  args: [{ name: "path", description: "The file to erase from history", required: true }],
  mutates: true,
  destructive: true,
  examples: ["gitbuddy forget-file .env"],
  run({ args }) {
    const path = args[0];
    const has = git(["filter-repo", "--version"], { allowFail: true }).ok;
    if (!has) {
      fail("This needs the git-filter-repo tool.", {
        exit: EXIT.SETUP,
        code: "filter_repo_missing",
        hint: "Install it: brew install git-filter-repo   (or: pip install git-filter-repo), then try again.",
      });
    }
    ui.line(c.warn(`⚠️  This rewrites every save in the project to remove ${c.bold(path)}.`));
    ui.line(c.dim("   Everyone on your team will need to copy the project again afterwards."));
    ui.line(c.dim("   If it was a password or key: change it now. Assume it's already leaked."));
    if (ctx.interactive && !ctx.flags.yes) {
      const typed = ui.ask(`   Type ${c.bold(path)} to confirm ›`);
      if (typed !== path) fail("Didn't match, so I left everything alone.");
    } else if (!ctx.flags.yes) ui.confirm(`Erase ${path} from all history?`);
    const remote = mainRemote();
    const url = remote ? remoteUrl(remote) : null;
    git(["filter-repo", "--invert-paths", "--path", path, "--force"], { mutates: true });
    if (remote && url && !tryOut(["remote", "get-url", remote])) git(["remote", "add", remote, url], { mutates: true });
    ui.say("lock", c.ok(`${path} is gone from every save on this computer.`));
    if (remote) {
      ui.hint("Your remote still has the old history.");
      ui.next("gitbuddy send --force", "overwrite the remote with the cleaned history");
    }
    ctx.data = { erased: path, remote };
  },
});
