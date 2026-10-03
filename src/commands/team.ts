import { ctx } from "../context";
import { EXIT, fail } from "../errors";
import { git, gitAsync, gitInherit, out, tryOut } from "../git";
import { define } from "../registry";
import { currentBranch, defaultBranch, head, isDirty, isPushed, mainRemote, operation, remoteUrl, resolveWhen, shortId, slugify } from "../repo";
import { record } from "../snapshot";
import { readState, updateState } from "../state";
import { ago, c, plural, ui } from "../ui";
import { logEntries } from "./history";

function host(url: string): "github" | "gitlab" | "other" {
  if (/github\.com[:/]/.test(url)) return "github";
  if (/gitlab/.test(url)) return "gitlab";
  return "other";
}

function webBase(url: string): string | null {
  const m = url.match(/^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/);
  return m ? `https://${m[1]}/${m[2]}` : null;
}

function uniqueBranch(base: string): string {
  if (!tryOut(["rev-parse", "-q", "--verify", `refs/heads/${base}`])) return base;
  for (let i = 2; ; i++) if (!tryOut(["rev-parse", "-q", "--verify", `refs/heads/${base}-${i}`])) return `${base}-${i}`;
}

export function openPullRequest(o: { title: string; body: string; base: string; branch: string; draft?: boolean }): string | null {
  const remote = mainRemote();
  const url = remote ? remoteUrl(remote) ?? "" : "";
  const kind = host(url);
  let link: string | null = null;
  const tool = kind === "github" ? Bun.which("gh") : kind === "gitlab" ? Bun.which("glab") : null;
  if (tool && !ctx.flags.dryRun) {
    const cmd =
      kind === "github"
        ? ["pr", "create", "--title", o.title, "--body", o.body, "--base", o.base, "--head", o.branch, ...(o.draft ? ["--draft"] : [])]
        : ["mr", "create", "--title", o.title, "--description", o.body, "--target-branch", o.base, "--source-branch", o.branch, "--yes", ...(o.draft ? ["--draft"] : [])];
    const p = Bun.spawnSync([tool, ...cmd], { stdout: "pipe", stderr: "pipe" });
    const said = `${p.stdout}${p.stderr}`;
    link = said.match(/https?:\/\/\S+/)?.[0] ?? null;
    if (p.exitCode !== 0 && !link) ui.warn(`Couldn't open the request automatically: ${said.trim().split("\n")[0]}`);
  }
  if (!link) {
    const web = webBase(url);
    if (web) link = kind === "gitlab" ? `${web}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(o.branch)}` : `${web}/compare/${o.base}...${encodeURIComponent(o.branch)}?expand=1`;
  }
  return link;
}

export function validBranchName(name: string): string {
  const clean = name.replace(/^refs\/heads\//, "");
  if (!git(["check-ref-format", "--branch", clean], { allowFail: true }).ok) {
    fail(`"${clean}" isn't a valid branch name.`, { code: "bad_branch", hint: "Use letters, numbers, - and /, e.g. feature/login" });
  }
  return clean;
}

export async function shareWork(o: { title?: string; branch?: string; base?: string; draft?: boolean; reason?: string } = {}): Promise<void> {
  const remote = mainRemote();
  if (!remote) fail("Connect this project to GitHub/GitLab first.", { exit: EXIT.SETUP, code: "no_remote", hint: "gitbuddy connect --github" });
  const base = o.base ?? defaultBranch();
  let branch = currentBranch();
  if (!branch || readState().away) fail("Come back to the present first.", { hint: "gitbuddy back" });
  await ui.spin("Checking with your team…", () => gitAsync(["fetch", "-q", remote!], { mutates: true }));
  const baseRef = tryOut(["rev-parse", "-q", "--verify", `refs/remotes/${remote}/${base}`]) ? `${remote}/${base}` : base;
  const commits = logEntries([`${baseRef}..HEAD`]);
  if (!commits.length) fail("You have no saves that your team doesn't already have.", { hint: 'Save something first: gitbuddy done "what you did"' });
  if (isDirty()) ui.warn("Unsaved changes won't be included.");
  const title = o.title?.trim() || (commits.length === 1 ? commits[0].message : commits[commits.length - 1].message);
  record("share", `before sharing "${title}"`);
  let movedFromBase = false;
  const wanted = o.branch ? validBranchName(o.branch) : null;
  if (wanted && branch !== base && wanted !== branch) {
    git(["branch", "-q", "-m", wanted], { mutates: true });
    branch = wanted;
  }
  if (branch === base) {
    if (wanted && tryOut(["rev-parse", "-q", "--verify", `refs/heads/${wanted}`])) fail(`You already have a branch called "${wanted}".`, { code: "bad_branch" });
    const newBranch = wanted ?? uniqueBranch(`share/${slugify(title).slice(0, 40)}`);
    git(["switch", "-q", "-c", newBranch], { mutates: true });
    if (baseRef !== base) git(["branch", "-f", base, baseRef], { mutates: true });
    branch = newBranch;
    movedFromBase = true;
  }
  await ui.spin(`${c.accent("Sending")} ${plural(commits.length, "save")}…`, () => gitAsync(["push", "-q", "-u", remote!, branch!], { mutates: true }));
  const body = `${commits.map((e) => `- ${e.message}`).reverse().join("\n")}\n\n_Shared with [gitbuddy](https://github.com/muhammad-junaid-iftikhar/git-speak-human)_`;
  const link = openPullRequest({ title, body, base, branch: branch!, draft: o.draft });
  if (movedFromBase) git(["switch", "-q", base], { mutates: true });
  ui.say("share", c.ok(`Shared ${c.bold(`"${title}"`)} for review`) + (o.reason ? c.dim(` · ${o.reason}`) : ""));
  if (link) ui.line(`   ${c.accent(link)}`);
  if (movedFromBase) ui.hint(`Your saves went on "${branch}". You're back on ${base} (matching ${remote}); gitbuddy get brings them in once they're accepted.`);
  ctx.data = { ...ctx.data, title, branch, base, link, commits: commits.map((e) => e.commit), viaPullRequest: true };
}

define({
  name: "share",
  aliases: ["pr", "propose", "mr"],
  group: "team",
  summary: "Ask your team to review your saves (opens a pull request)",
  gitEquivalent: "git push -u origin <branch> && gh pr create",
  args: [{ name: "title", description: "A title for the request (default: from your saves)", variadic: true }],
  options: {
    draft: { type: "boolean", description: "Open it as a draft" },
    branch: { type: "string", short: "b", description: "Name of the branch to put your saves on (default: made from the title)" },
    base: { type: "string", description: "Which branch it should go into (default: main)" },
  },
  mutates: true,
  network: true,
  examples: ['gitbuddy share "Add dark mode"', "gitbuddy share --branch feature/dark-mode", "gitbuddy share --draft"],
  run: ({ args, opts }) =>
    shareWork({ title: args.join(" "), branch: opts.branch as string | undefined, base: opts.base as string | undefined, draft: Boolean(opts.draft) }),
});

define({
  name: "review",
  aliases: ["checkout-pr", "try-pr"],
  group: "team",
  summary: "Try out someone's pull request on your computer",
  gitEquivalent: "git fetch origin pull/<n>/head && git switch",
  args: [{ name: "number", description: "The pull/merge request number", required: true }],
  mutates: true,
  network: true,
  undoable: true,
  examples: ["gitbuddy review 42", "gitbuddy back"],
  async run({ args }) {
    const n = args[0].replace(/^#/, "");
    if (!/^\d+$/.test(n)) fail("Give me the request number, like: gitbuddy review 42");
    const remote = mainRemote();
    if (!remote) fail("Connect this project first.", { exit: EXIT.SETUP, code: "no_remote", hint: "gitbuddy connect <url>" });
    if (readState().away) fail(`You're already ${readState().away!.label}.`, { hint: "gitbuddy back" });
    const url = remoteUrl(remote!) ?? "";
    const temp = uniqueBranch(`gitbuddy-review-${n}`);
    const ref = host(url) === "gitlab" ? `merge-requests/${n}/head` : `pull/${n}/head`;
    await ui.spin(`Downloading request #${n}…`, () => gitAsync(["fetch", "-q", remote!, `${ref}:${temp}`], { mutates: true }));
    record("review", `before reviewing #${n}`);
    const branch = currentBranch();
    const prior = head();
    let tucked: string | undefined;
    if (isDirty()) {
      git(["stash", "push", "-u", "-q", "-m", `gitbuddy: tucked away while reviewing #${n}`], { mutates: true });
      tucked = ctx.flags.dryRun ? undefined : out(["rev-parse", "stash@{0}"]);
    }
    git(["switch", "-q", temp], { mutates: true });
    if (!ctx.flags.dryRun) updateState((s) => (s.away = { kind: "review", label: `reviewing request #${n}`, returnTo: branch ?? prior ?? "", returnDetached: !branch, tuckedRef: tucked, tempBranch: temp }));
    const base = defaultBranch();
    const baseRef = tryOut(["rev-parse", "-q", "--verify", `refs/remotes/${remote}/${base}`]) ? `${remote}/${base}` : base;
    const commits = logEntries([`${baseRef}..HEAD`, "-n20"]);
    ui.say("search", c.ok(`You're now looking at request #${n}`) + c.dim(` · ${plural(commits.length, "save")}`));
    for (const e of commits.slice(0, 8)) ui.line(`   ${c.accent(e.id)} ${e.message} ${c.dim(`${e.author} · ${ago(e.date)}`)}`);
    ui.hint("Run it, test it, look around. Nothing here touches your own work.");
    ui.next("gitbuddy back", "return to your work");
    ctx.data = { number: Number(n), branch: temp, commits: commits.map((e) => e.commit) };
  },
});

function conflictFail(what: string): never {
  return fail(`${what} clashes with your work.`, { exit: EXIT.CONFLICT, code: "conflict", hint: "Sort it out: gitbuddy conflicts   (or cancel: gitbuddy abort)" });
}

define({
  name: "combine",
  aliases: ["merge", "bring-in"],
  group: "team",
  summary: "Bring another branch's work into yours",
  gitEquivalent: "git merge <branch>",
  args: [{ name: "branch", description: "Which branch to bring in", required: true }],
  options: { squash: { type: "boolean", description: "Bring it in as one single save" } },
  mutates: true,
  undoable: true,
  examples: ["gitbuddy combine feature-x", "gitbuddy combine feature-x --squash"],
  run({ args, opts }) {
    if (operation()) fail("Finish the current clash first.", { exit: EXIT.CONFLICT, code: "conflict", hint: "gitbuddy conflicts" });
    const other = args[0];
    if (!tryOut(["rev-parse", "-q", "--verify", `${other}^{commit}`])) fail(`There's no branch called "${other}".`, { hint: "See them: gitbuddy branches" });
    record("combine", `before combining ${other}`);
    const r = git(["merge", "--no-edit", ...(opts.squash ? ["--squash"] : []), other], { mutates: true, allowFail: true });
    if (!r.ok) {
      if (operation() === "merge" || /CONFLICT/.test(r.stdout)) conflictFail(`"${other}"`);
      if (/up to date/i.test(r.stdout)) return ui.say("clean", `You already have everything from ${other}.`);
      fail(`I couldn't combine ${other}.`, { details: r.stderr + r.stdout });
    }
    if (/Already up to date/i.test(r.stdout)) {
      ui.say("clean", `You already have everything from ${other}.`);
      ctx.data = { combined: other, changed: false };
      return;
    }
    if (opts.squash) git(["commit", "-q", "-m", `Combine ${other}`], { mutates: true, allowFail: true });
    ui.say("party", c.ok(`Combined ${c.bold(other)} into ${currentBranch() ?? "your work"}.`));
    ctx.data = { combined: other, changed: true, squash: Boolean(opts.squash) };
  },
});

define({
  name: "grab",
  aliases: ["cherry-pick", "pick"],
  group: "team",
  summary: "Copy one save from somewhere else into your work",
  gitEquivalent: "git cherry-pick <save>",
  args: [{ name: "save", description: "The save id to copy", required: true }],
  mutates: true,
  undoable: true,
  examples: ["gitbuddy grab a1b2c3d"],
  run({ args }) {
    if (operation()) fail("Finish the current clash first.", { exit: EXIT.CONFLICT, code: "conflict", hint: "gitbuddy conflicts" });
    const commit = resolveWhen(args[0]);
    const msg = out(["log", "-1", "--format=%s", commit]);
    record("grab", `before grabbing "${msg}"`);
    const r = git(["cherry-pick", commit], { mutates: true, allowFail: true });
    if (!r.ok) {
      if (operation() === "cherry-pick" && /empty/i.test(r.stderr + r.stdout)) {
        git(["cherry-pick", "--skip"], { mutates: true, allowFail: true });
        return ui.say("clean", "You already have those changes.");
      }
      if (operation() === "cherry-pick") conflictFail(`"${msg}"`);
      fail(`I couldn't grab "${msg}".`, { details: r.stderr });
    }
    ui.say("save", c.ok(`Grabbed "${msg}"`) + c.dim(` → ${shortId("HEAD")}`));
    ctx.data = { grabbed: commit, message: msg };
  },
});

function unpushedCount(): number {
  const up = tryOut(["rev-parse", "--abbrev-ref", "@{u}"]);
  const remote = mainRemote();
  if (up) return Number(out(["rev-list", "--count", "@{u}..HEAD"]));
  if (remote) return Number(out(["rev-list", "--count", "HEAD", "--not", `--remotes=${remote}`]));
  return Number(out(["rev-list", "--count", "HEAD"]));
}

function rebaseEdit(commit: string, action: "edit" | "drop" | "reword", message?: string): void {
  const short = out(["rev-parse", "--short", commit]);
  const parent = tryOut(["rev-parse", "-q", "--verify", `${commit}^`]);
  const seq = `sed -i.gitbuddy-bak -e 's/^pick ${short} /${action === "reword" ? "edit" : action} ${short} /'`;
  const r = git(["rebase", "-q", "-i", ...(parent ? [parent] : ["--root"])], { mutates: true, allowFail: true, env: { GIT_SEQUENCE_EDITOR: seq, GIT_EDITOR: "true" } });
  if (action === "reword" && operation() === "rebase") {
    git(["commit", "-q", "--amend", "-m", message!], { mutates: true });
    git(["rebase", "--continue"], { mutates: true, allowFail: true, env: { GIT_EDITOR: "true" } });
  }
  if (operation() === "rebase") {
    git(["rebase", "--abort"], { mutates: true, allowFail: true });
    fail("That change clashes with later saves, so I put everything back.", { details: r.stderr });
  }
}

define({
  name: "tidy",
  aliases: ["clean-history", "squash"],
  group: "team",
  summary: "Tidy up saves you haven't sent yet: squash, reword or drop",
  gitEquivalent: "git rebase -i",
  args: [
    { name: "action", description: "squash | reword | drop | edit (leave out to see your saves)" },
    { name: "target", description: "How many (squash) or which save id (reword/drop)" },
    { name: "message", description: "A message for squash/reword", variadic: true },
  ],
  mutates: true,
  undoable: true,
  examples: ["gitbuddy tidy", 'gitbuddy tidy squash 3 "Add dark mode"', 'gitbuddy tidy reword a1b2c3d "Better message"', "gitbuddy tidy drop a1b2c3d"],
  run({ args }) {
    if (operation()) fail("Finish the current clash first.", { exit: EXIT.CONFLICT, code: "conflict", hint: "gitbuddy conflicts" });
    const count = head() ? unpushedCount() : 0;
    const entries = count ? logEntries([`-n${count}`]) : [];
    const [action, target, ...rest] = args;
    if (!action) {
      ctx.data = { unsent: entries };
      if (!entries.length) return ui.say("clean", "No unsent saves to tidy. (Sent saves stay as they are, so your team isn't confused.)");
      ui.say("history", c.bold(`${plural(entries.length, "save")} you can still tidy`));
      ui.blank();
      ui.table(entries.map((e) => [c.accent(e.id), e.message, c.dim(ago(e.date))]));
      ui.blank();
      ui.line(`   ${c.accent(`gitbuddy tidy squash ${entries.length} "message"`)}   ${c.dim("turn them into one save")}`);
      ui.line(`   ${c.accent("gitbuddy tidy reword <id> \"message\"")}  ${c.dim("change a message")}`);
      ui.line(`   ${c.accent("gitbuddy tidy drop <id>")}              ${c.dim("remove a save")}`);
      ui.line(`   ${c.accent("gitbuddy tidy edit")}                   ${c.dim("full control in your editor")}`);
      return;
    }
    if (isDirty() && action !== "squash") fail("Save or put away your current changes first.", { code: "dirty", hint: 'gitbuddy save, or gitbuddy work "something"' });
    if (action === "squash") {
      const n = Number(target ?? entries.length);
      if (!Number.isInteger(n) || n < 2) fail("Tell me how many saves to squash (at least 2).", { hint: 'gitbuddy tidy squash 3 "message"' });
      if (n > count) fail(`Only ${plural(count, "save")} haven't been sent yet. Sent saves can't be tidied.`, { code: "already_pushed" });
      const message = rest.join(" ").trim() || entries[n - 1].message;
      record("tidy", `before squashing ${n} saves`);
      const total = Number(out(["rev-list", "--count", "HEAD"]));
      if (n === total) {
        git(["update-ref", "-d", "HEAD"], { mutates: true });
      } else git(["reset", "-q", "--soft", `HEAD~${n}`], { mutates: true });
      git(["commit", "-q", "-m", message], { mutates: true });
      ui.say("clean", c.ok(`Squashed ${n} saves into "${message}".`));
      ctx.data = { squashed: n, message };
      return;
    }
    if (action === "edit") {
      if (!ctx.interactive) fail("tidy edit opens your editor, so it needs a person.", { code: "interactive_only" });
      record("tidy", "before editing saves");
      const code = gitInherit(["rebase", "-i", count ? `HEAD~${count}` : "--root"], { mutates: true });
      if (code !== 0 || operation()) ui.warn("Not finished yet. See: gitbuddy conflicts / gitbuddy abort");
      return;
    }
    if (action !== "reword" && action !== "drop") fail(`I don't know how to "${action}". Try squash, reword, drop or edit.`);
    if (!target) fail(`Which save? Give its id: gitbuddy tidy ${action} <id>`);
    const commit = resolveWhen(target);
    if (isPushed(commit)) fail("That save was already sent, so I won't change it.", { code: "already_pushed", hint: "Use gitbuddy reverse <id> to cancel it with a new save." });
    const message = rest.join(" ").trim();
    if (action === "reword" && !message) fail('Give the new message: gitbuddy tidy reword <id> "new message"');
    const old = out(["log", "-1", "--format=%s", commit]);
    record("tidy", `before ${action === "drop" ? "dropping" : "rewording"} "${old}"`);
    if (action === "reword" && commit === head()) git(["commit", "-q", "--amend", "-m", message], { mutates: true });
    else rebaseEdit(commit, action, message);
    ui.say("clean", c.ok(action === "drop" ? `Dropped "${old}".` : `Renamed "${old}" → "${message}".`));
    ctx.data = { action, commit, old, message: message || null };
  },
});

define({
  name: "branches",
  aliases: ["branch-list"],
  group: "team",
  summary: "See all branches (for people who like branches)",
  gitEquivalent: "git branch -vv",
  examples: ["gitbuddy branches"],
  run() {
    const raw = out(["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)\x1f%(committerdate:iso-strict)\x1f%(subject)\x1f%(upstream:short)\x1f%(upstream:track)", "refs/heads"]);
    const current = currentBranch();
    const list = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [name, date, subject, upstream, track] = l.split("\x1f");
        return { name, date, subject, upstream: upstream || null, track: track || "", current: name === current };
      });
    ctx.data = { branches: list };
    ui.table(list.map((b) => [b.current ? c.accent("▶") : " ", b.current ? c.bold(b.name) : b.name, c.dim(ago(b.date)), b.subject.slice(0, 50), c.dim(b.track)]));
  },
});
