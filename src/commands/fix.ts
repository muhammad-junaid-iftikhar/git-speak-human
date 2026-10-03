import { ctx } from "../context";
import { EXIT, fail } from "../errors";
import { git, out, tryOut } from "../git";
import { addToGitignore } from "../guard";
import { define } from "../registry";
import { head, isPushed, mainRemote, operation, remoteUrl, resolveWhen, status } from "../repo";
import { cleanTree, record } from "../snapshot";
import { c, plural, ui } from "../ui";

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
        hint: "Make a save that undoes it instead: gitbuddy reverse last",
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

define({
  name: "reverse",
  aliases: ["revert", "cancel-save"],
  group: "fix",
  summary: "Cancel out an old save with a new one (safe for sent saves)",
  gitEquivalent: "git revert <save>",
  args: [{ name: "save", description: 'Which save: an id from gitbuddy history, or "last"', required: true }],
  mutates: true,
  undoable: true,
  examples: ["gitbuddy reverse last", "gitbuddy reverse a1b2c3d"],
  run({ args }) {
    if (operation()) fail("Finish the current clash first.", { exit: EXIT.CONFLICT, code: "conflict", hint: "gitbuddy conflicts" });
    const target = args[0] === "last" ? out(["rev-parse", "HEAD"]) : resolveWhen(args[0]);
    const msg = out(["log", "-1", "--format=%s", target]);
    const parents = out(["rev-list", "--parents", "-n1", target]).split(" ").length - 1;
    record("reverse", `before reversing "${msg}"`);
    const r = git(["revert", "--no-edit", ...(parents > 1 ? ["-m", "1"] : []), target], { mutates: true, allowFail: true });
    if (!r.ok) {
      if (operation() === "revert") fail("Reversing it clashes with later changes.", { exit: EXIT.CONFLICT, code: "conflict", hint: "Sort it out: gitbuddy conflicts   (or cancel: gitbuddy abort)" });
      fail(`I couldn't reverse "${msg}".`, { details: r.stderr });
    }
    ui.say("undo", c.ok(`Made a new save that cancels "${msg}".`));
    ctx.data = { reversed: target, message: msg, commit: ctx.flags.dryRun ? "" : out(["rev-parse", "HEAD"]) };
    if (mainRemote()) ui.next("gitbuddy send", "share the fix");
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
