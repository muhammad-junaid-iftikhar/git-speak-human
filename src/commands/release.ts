import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ctx } from "../context";
import { BuddyError, EXIT, fail } from "../errors";
import { git, gitAsync, gitInherit, out, tryOut } from "../git";
import { define } from "../registry";
import { currentBranch, defaultBranch, ensureIdentity, head, isDirty, mainRemote, remoteUrl, repoRoot } from "../repo";
import { record } from "../snapshot";
import { ago, c, plural, ui } from "../ui";
import { trashItems } from "./safety";

define({
  name: "release",
  aliases: ["ship", "tag-release"],
  group: "release",
  summary: "Publish a new version: changelog, version tag, and send it",
  gitEquivalent: "git tag -a v1.2.0 && git push --tags",
  args: [{ name: "version", description: "The new version, e.g. 1.2.0 or v1.2.0", required: true }],
  options: {
    "no-push": { type: "boolean", description: "Don't send it yet" },
    notes: { type: "string", description: "Extra notes to put at the top" },
    publish: { type: "boolean", description: "Also create a GitHub release page (needs gh)" },
  },
  mutates: true,
  network: true,
  undoable: true,
  examples: ["gitbuddy release 1.2.0", "gitbuddy release v2.0.0 --notes 'Big redesign' --publish"],
  async run({ args, opts }) {
    ensureIdentity();
    const tag = args[0].startsWith("v") ? args[0] : `v${args[0]}`;
    if (!/^v\d+(\.\d+){0,2}([-+][\w.]+)?$/.test(tag)) fail(`"${args[0]}" doesn't look like a version.`, { hint: "Use numbers like 1.2.0" });
    if (!head()) fail("Save something before releasing.");
    if (isDirty()) fail("Save or put away your changes before releasing.", { code: "dirty", hint: 'gitbuddy done "message"' });
    if (tryOut(["rev-parse", "-q", "--verify", `refs/tags/${tag}`])) fail(`${tag} already exists.`, { hint: "See versions: gitbuddy versions" });
    const branch = currentBranch();
    if (branch && branch !== defaultBranch()) ui.warn(`You're releasing from "${branch}", not ${defaultBranch()}.`);
    const last = tryOut(["describe", "--tags", "--abbrev=0"]);
    const lines = out(["log", "--format=- %s (%h)", ...(last ? [`${last}..HEAD`] : ["HEAD"])])
      .split("\n")
      .filter((l) => l && !/^- Release v/.test(l));
    const date = new Date().toISOString().slice(0, 10);
    const section = `## ${tag} · ${date}\n\n${opts.notes ? `${opts.notes}\n\n` : ""}${lines.join("\n") || "- Small improvements"}\n`;
    const root = repoRoot()!;
    record("release", `before releasing ${tag}`);
    if (!ctx.flags.dryRun) {
      const changelog = join(root, "CHANGELOG.md");
      const prev = existsSync(changelog) ? readFileSync(changelog, "utf-8") : "# Changelog\n";
      const [heading, ...body] = prev.split("\n");
      writeFileSync(changelog, `${heading}\n\n${section}\n${body.join("\n").replace(/^\n+/, "")}`.trimEnd() + "\n");
      const pkgPath = join(root, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = readFileSync(pkgPath, "utf-8");
        writeFileSync(pkgPath, pkg.replace(/("version"\s*:\s*")[^"]*(")/, `$1${tag.slice(1)}$2`));
      }
    }
    git(["add", "CHANGELOG.md", ...(existsSync(join(root, "package.json")) ? ["package.json"] : [])], { mutates: true });
    git(["commit", "-q", "-m", `Release ${tag}`], { mutates: true });
    git(["tag", "-a", tag, "-m", `${tag}\n\n${lines.join("\n")}`], { mutates: true });
    ui.say("tag", c.ok(`Released ${c.bold(tag)}`) + c.dim(` · ${plural(lines.length, "change")} in CHANGELOG.md`));
    const remote = mainRemote();
    let pushed = false;
    if (remote && !opts["no-push"]) {
      await ui.spin(`Sending ${tag}…`, async () => {
        await gitAsync(["push", "-q", remote, "HEAD"], { mutates: true });
        await gitAsync(["push", "-q", remote, tag], { mutates: true });
      });
      pushed = true;
      ui.say("send", c.ok(`Sent ${tag} to ${remote}`));
    }
    let page: string | null = null;
    if (opts.publish && pushed && /github\.com/.test(remoteUrl(remote) ?? "") && Bun.which("gh") && !ctx.flags.dryRun) {
      const p = Bun.spawnSync(["gh", "release", "create", tag, "--title", tag, "--notes", section], { stdout: "pipe", stderr: "pipe" });
      page = p.stdout.toString().trim() || null;
      if (page) ui.line(`   ${c.accent(page)}`);
      else ui.warn(`Couldn't create the GitHub release: ${p.stderr.toString().trim().split("\n")[0]}`);
    }
    ctx.data = { tag, changes: lines, pushed, page };
  },
});

define({
  name: "versions",
  aliases: ["tags", "releases"],
  group: "release",
  summary: "See all released versions",
  gitEquivalent: "git tag",
  examples: ["gitbuddy versions"],
  run() {
    const raw = tryOut(["for-each-ref", "--sort=-creatordate", "--format=%(refname:short)\x1f%(creatordate:iso-strict)\x1f%(contents:subject)", "refs/tags"]) ?? "";
    const tags = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [name, date, subject] = l.split("\x1f");
        return { name, date, subject };
      });
    ctx.data = { versions: tags };
    if (!tags.length) {
      ui.say("tag", "No versions yet.");
      ui.next("gitbuddy release 0.1.0", "make your first");
      return;
    }
    ui.table(tags.map((t) => [c.accent(t.name), c.dim(ago(t.date)), t.subject === t.name ? "" : t.subject]));
  },
});

define({
  name: "clean-up",
  aliases: ["cleanup", "tidy-up", "gc"],
  group: "release",
  summary: "Remove finished branches, old trash and clutter",
  gitEquivalent: "git fetch --prune && git branch -d <merged> && git gc",
  mutates: true,
  network: true,
  examples: ["gitbuddy clean-up"],
  async run() {
    const remote = mainRemote();
    if (remote) await ui.spin("Tidying remote branches…", () => gitAsync(["fetch", "-q", "--prune", remote], { mutates: true, allowFail: true }));
    const base = defaultBranch();
    const current = currentBranch();
    const merged = (tryOut(["branch", "--merged", base, "--format=%(refname:short)"]) ?? "")
      .split("\n")
      .filter((b) => b && b !== base && b !== current && !/^(main|master|develop|trunk)$/.test(b));
    let deleted: string[] = [];
    if (merged.length && ui.confirm(`Delete ${plural(merged.length, "finished branch", "finished branches")} (${merged.join(", ")})?`, { default: true })) {
      for (const b of merged) git(["branch", "-q", "-d", b], { mutates: true, allowFail: true });
      deleted = merged;
    }
    const cutoff = Date.now() - 30 * 86400_000;
    const expired = trashItems().filter((t) => new Date(t.dropped).getTime() < cutoff);
    for (const t of expired) git(["update-ref", "-d", t.ref], { mutates: true });
    await ui.spin("Packing things up…", () => gitAsync(["gc", "--quiet"], { mutates: true, allowFail: true }));
    ui.say("clean", c.ok("All tidy!") + c.dim(` · ${plural(deleted.length, "branch", "branches")} removed · ${plural(expired.length, "old trash item")} emptied`));
    ctx.data = { deletedBranches: deleted, emptiedTrash: expired.map((t) => t.name) };
  },
});

define({
  name: "git",
  aliases: ["raw"],
  group: "release",
  summary: "Run any real git command (no safety net)",
  rawArgs: true,
  needsRepo: false,
  mutates: true,
  examples: ["gitbuddy git log --graph --oneline", "gitbuddy git submodule update --init"],
  run({ args }) {
    if (!args.length) fail("Add a git command, like: gitbuddy git status");
    const code = gitInherit(args);
    ctx.data = { exit: code };
    if (code !== 0) throw new BuddyError(`git finished with exit code ${code}`, { exit: code === 1 ? EXIT.USER : code, code: "git_exit" });
  },
});
