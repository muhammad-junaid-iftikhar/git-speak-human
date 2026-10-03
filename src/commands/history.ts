import { ctx } from "../context";
import { fail } from "../errors";
import { git, out, tryOut } from "../git";
import { define } from "../registry";
import { currentBranch, head, isDirty, resolveWhen, shortId, upstream } from "../repo";
import { record } from "../snapshot";
import { readState, updateState, type Away } from "../state";
import { ago, c, plural, stamp, ui } from "../ui";

interface Entry {
  commit: string;
  id: string;
  author: string;
  date: string;
  message: string;
  refs: string;
  sent: boolean;
}

const SEP = "\x1f";

export function logEntries(args: string[]): Entry[] {
  const raw = out(["log", `--format=%H${SEP}%h${SEP}%an${SEP}%aI${SEP}%s${SEP}%D`, ...args]);
  const unsent = new Set((upstream() ? tryOut(["rev-list", "@{u}..HEAD"]) ?? "" : "").split("\n").filter(Boolean));
  const hasUp = Boolean(upstream());
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commit, id, author, date, message, refs] = line.split(SEP);
      return { commit, id, author, date, message, refs, sent: hasUp ? !unsent.has(commit) : false };
    });
}

define({
  name: "history",
  aliases: ["log", "timeline", "what-happened"],
  group: "history",
  summary: "See the timeline of saves: who did what, when",
  gitEquivalent: "git log",
  args: [{ name: "file", description: "Only saves that touched this file" }],
  options: {
    by: { type: "string", description: "Only saves by this person" },
    since: { type: "string", description: "Only saves since, e.g. yesterday, 2 weeks ago" },
    until: { type: "string", description: "Only saves before this time" },
    grep: { type: "string", description: "Only saves whose message contains this" },
    limit: { type: "string", short: "n", description: "How many to show (default 15)" },
    all: { type: "boolean", description: "Include every branch" },
  },
  examples: ["gitbuddy history", "gitbuddy history src/app.ts", "gitbuddy history --by Sara --since 'last week'"],
  run({ args, opts }) {
    if (!head()) {
      ui.say("history", "No saves yet. Your story starts with: gitbuddy done \"first save\"");
      ctx.data = { entries: [] };
      return;
    }
    const n = Number(opts.limit ?? 15) || 15;
    const logArgs = [`-n${n}`];
    if (opts.by) logArgs.push(`--author=${opts.by}`, "-i");
    if (opts.since) logArgs.push(`--since=${opts.since}`);
    if (opts.until) logArgs.push(`--until=${opts.until}`);
    if (opts.grep) logArgs.push(`--grep=${opts.grep}`, "-i", "--fixed-strings");
    if (opts.all) logArgs.push("--all");
    if (args[0]) logArgs.push("--follow", "--", args[0]);
    const entries = logEntries(logArgs);
    ctx.data = { entries };
    if (!entries.length) return ui.say("history", "No saves match that.");
    ui.say("history", c.bold(args[0] ? `History of ${args[0]}` : "Recent saves") + c.dim(" (newest first)"));
    ui.blank();
    ui.table(
      entries.map((e) => [
        c.accent(e.id),
        e.message.length > 60 ? `${e.message.slice(0, 57)}…` : e.message,
        c.dim(e.author),
        c.dim(ago(e.date)),
        upstream() && !e.sent ? c.warn("● not sent") : e.refs.includes("tag:") ? c.ok(e.refs.match(/tag: ([^,]+)/)?.[1] ?? "") : "",
      ]),
    );
  },
});

define({
  name: "who",
  aliases: ["blame", "who-wrote"],
  group: "history",
  summary: "Find out who wrote a file or a line, and when",
  gitEquivalent: "git blame",
  args: [{ name: "file", description: "The file (add :line for one line, e.g. app.ts:42)", required: true }],
  examples: ["gitbuddy who src/app.ts", "gitbuddy who src/app.ts:42"],
  run({ args }) {
    const m = args[0].match(/^(.*?):(\d+)$/);
    const file = m ? m[1] : args[0];
    if (m) {
      const line = Number(m[2]);
      const raw = out(["blame", "--porcelain", "-L", `${line},${line}`, "--", file]);
      const commit = raw.split(" ")[0];
      const get = (k: string) => raw.match(new RegExp(`^${k} (.*)$`, "m"))?.[1] ?? "";
      const when = new Date(Number(get("author-time")) * 1000).toISOString();
      const text = raw.split("\n").find((l) => l.startsWith("\t"))?.slice(1) ?? "";
      const notSaved = /^0+$/.test(commit);
      ctx.data = { file, line, author: notSaved ? null : get("author"), date: notSaved ? null : when, commit: notSaved ? null : commit, message: notSaved ? null : get("summary"), text };
      ui.say("person", `${c.bold(`${file}:${line}`)}  ${c.dim(text.trim())}`);
      if (notSaved) ui.line("   You changed this line and haven't saved it yet.");
      else ui.line(`   ${c.accent(get("author"))} wrote it ${ago(when)} in ${c.bold(`"${get("summary")}"`)} ${c.dim(commit.slice(0, 7))}`);
      return;
    }
    const raw = out(["blame", "--line-porcelain", "--", file]);
    const counts = new Map<string, number>();
    let total = 0;
    for (const l of raw.split("\n")) {
      if (l.startsWith("author ")) {
        const a = l.slice(7);
        counts.set(a, (counts.get(a) ?? 0) + 1);
        total++;
      }
    }
    const [lastWhen, lastWho, lastMsg] = out(["log", "-1", `--format=%aI${SEP}%an${SEP}%s`, "--", file]).split(SEP);
    const people = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([author, lines]) => ({ author: author === "Not Committed Yet" ? "you (not saved yet)" : author, lines, percent: Math.round((lines / total) * 100) }));
    ctx.data = { file, lines: total, people, last: lastWhen ? { date: lastWhen, author: lastWho, message: lastMsg } : null };
    ui.say("person", `${c.bold(file)} ${c.dim(`· ${plural(total, "line")}`)}`);
    ui.blank();
    ui.table(people.map((p) => [c.accent(p.author), `${p.percent}%`, c.dim(plural(p.lines, "line")), c.accent("█".repeat(Math.max(1, Math.round(p.percent / 5))))]));
    if (lastWhen) {
      ui.blank();
      ui.hint(`Last changed ${ago(lastWhen)} by ${lastWho}: "${lastMsg}"`);
    }
  },
});

define({
  name: "find",
  aliases: ["search", "grep"],
  group: "history",
  summary: "Search the code now and through all of history",
  gitEquivalent: "git grep + git log -S",
  args: [{ name: "text", description: "What to look for", required: true, variadic: true }],
  options: { regex: { type: "boolean", description: "Treat the text as a regular expression" } },
  examples: ['gitbuddy find "TODO"', 'gitbuddy find "apiKey"'],
  run({ args, opts }) {
    const text = args.join(" ");
    const now = git(["grep", "-n", "-I", opts.regex ? "-E" : "--fixed-strings", "-e", text], { allowFail: true }).stdout.split("\n").filter(Boolean);
    const past = head() ? logEntries([opts.regex ? `-G${text}` : `-S${text}`, "-n20"]) : [];
    ctx.data = {
      now: now.slice(0, 200).map((l) => {
        const [file, line, ...rest] = l.split(":");
        return { file, line: Number(line), text: rest.join(":") };
      }),
      history: past,
    };
    ui.say("search", `${c.bold(`"${text}"`)}`);
    ui.blank();
    if (now.length) {
      ui.line(c.dim(`   In your files now (${now.length}):`));
      for (const l of now.slice(0, 20)) {
        const [file, line, ...rest] = l.split(":");
        ui.line(`   ${c.accent(file)}${c.dim(`:${line}`)}  ${rest.join(":").trim().slice(0, 90)}`);
      }
      if (now.length > 20) ui.hint(`…and ${now.length - 20} more`);
    } else ui.line(c.dim("   Not in your files right now."));
    if (past.length) {
      ui.blank();
      ui.line(c.dim("   Added or removed in these saves:"));
      ui.table(past.map((e) => [c.accent(e.id), e.message.slice(0, 60), c.dim(`${e.author} · ${ago(e.date)}`)]));
    }
  },
});

function tuck(label: string): string | undefined {
  if (!isDirty()) return undefined;
  git(["stash", "push", "-u", "-q", "-m", `gitbuddy: ${label}`], { mutates: true });
  return ctx.flags.dryRun ? undefined : out(["rev-parse", "stash@{0}"]);
}

function untuck(sha?: string): void {
  if (!sha) return;
  const list = (tryOut(["stash", "list", "--format=%H"]) ?? "").split("\n");
  const idx = list.indexOf(sha);
  const r = idx >= 0 ? git(["stash", "pop", "-q", `stash@{${idx}}`], { mutates: true, allowFail: true }) : git(["stash", "apply", "-q", sha], { mutates: true, allowFail: true });
  if (!r.ok) ui.warn("Your tucked-away changes clash with what's here. They're safe; see: gitbuddy conflicts (or gitbuddy rescue)");
}

define({
  name: "go-back",
  aliases: ["restore-file", "file-from"],
  group: "history",
  summary: 'Put files back to how they were ("yesterday", "3 saves ago"…)',
  gitEquivalent: "git restore --source=<when> <file>",
  args: [{ name: "files", description: "Which files (then optionally: to <when>)", required: true, variadic: true }],
  options: { to: { type: "string", description: 'When to go back to (default: your last save). e.g. "yesterday", "2 saves ago", v1.0' } },
  mutates: true,
  undoable: true,
  examples: ["gitbuddy go-back src/app.ts", "gitbuddy go-back src/app.ts to yesterday", "gitbuddy go-back notes.md --to '3 saves ago'"],
  run({ args, opts }) {
    let files = args;
    let when = opts.to ? String(opts.to) : "";
    const toIdx = args.indexOf("to");
    if (toIdx > 0 && !when) {
      files = args.slice(0, toIdx);
      when = args.slice(toIdx + 1).join(" ");
    }
    if (!head()) fail("There are no saves to go back to yet.");
    const commit = when ? resolveWhen(when) : out(["rev-parse", "HEAD"]);
    const missing = files.filter((f) => !git(["cat-file", "-e", `${commit}:./${f}`], { allowFail: true }).ok);
    if (missing.length) fail(`${missing.join(", ")} didn't exist back then.`, { code: "bad_path", hint: "See a file's history: gitbuddy history <file>" });
    record("go-back", `before putting ${files.join(", ")} back`);
    git(["restore", `--source=${commit}`, "--staged", "--worktree", "--", ...files], { mutates: true });
    git(["reset", "-q", "--", ...files], { mutates: true, allowFail: true });
    const [date, msg] = out(["log", "-1", `--format=%aI${SEP}%s`, commit]).split(SEP);
    ui.say("undo", c.ok(`${files.join(", ")} ${files.length === 1 ? "is" : "are"} back to ${when ? `how ${files.length === 1 ? "it was" : "they were"} ${when}` : "your last save"}`) + c.dim(` · "${msg}", ${stamp(date)}`));
    ui.hint("This isn't saved yet. Changed your mind? gitbuddy undo");
    ctx.data = { files, commit, when: when || "last save" };
    ui.next('gitbuddy done "Bring back old version"', "keep it");
  },
});

function goAway(away: Omit<Away, "returnTo" | "returnDetached" | "tuckedRef">, target: string): void {
  const state = readState();
  if (state.away) fail(`You're already ${state.away.label}.`, { hint: "Go back first: gitbuddy back" });
  record(away.kind, `before ${away.label}`);
  const branch = currentBranch();
  const prior = head();
  const tucked = tuck(`tucked away while ${away.label}`);
  if (away.tempBranch) git(["switch", "-q", away.tempBranch], { mutates: true });
  else git(["switch", "-q", "--detach", target], { mutates: true });
  if (!ctx.flags.dryRun) updateState((s) => (s.away = { ...away, returnTo: branch ?? prior ?? "", returnDetached: !branch, tuckedRef: tucked }));
  if (tucked) ui.hint("Your unsaved changes are tucked away safely until you come back.");
}

define({
  name: "time-travel",
  aliases: ["visit", "look-back"],
  group: "history",
  summary: "Look at the whole project as it was at some point, safely",
  gitEquivalent: "git switch --detach <when>",
  args: [{ name: "when", description: 'When to visit, e.g. "yesterday", "v1.0", "5 saves ago"', variadic: true }],
  mutates: true,
  undoable: true,
  examples: ["gitbuddy time-travel yesterday", "gitbuddy time-travel v1.0", "gitbuddy back"],
  run({ args }) {
    let when = args.join(" ");
    if (!when) {
      const entries = logEntries(["-n15"]);
      when = ui.pick("Which save do you want to visit?", entries.map((e) => ({ label: `${c.accent(e.id)} ${e.message} ${c.dim(ago(e.date))}`, value: e.commit })));
    }
    const commit = resolveWhen(when);
    const [date, msg] = out(["log", "-1", `--format=%aI${SEP}%s`, commit]).split(SEP);
    goAway({ kind: "time-travel", label: `visiting ${stamp(date)} ("${msg}")` }, commit);
    ui.say("time", c.ok(`Welcome to ${stamp(date)}!`) + c.dim(` You're looking at "${msg}" ${shortId(commit)}.`));
    ui.hint("Look around, run things, nothing here gets saved.");
    ui.next("gitbuddy back", "return to the present");
    ctx.data = { commit, date, message: msg };
  },
});

define({
  name: "back",
  aliases: ["present", "return"],
  group: "history",
  summary: "Come back from time travel or a review",
  mutates: true,
  undoable: true,
  options: { force: { type: "boolean", description: "Throw away changes you made while away" } },
  examples: ["gitbuddy back"],
  run({ opts }) {
    const away = readState().away;
    if (!away) {
      ui.say("clean", "You're already in the present.");
      ctx.data = { returned: false };
      return;
    }
    if (isDirty() && !opts.force && !ui.confirm("You changed files while away. Throw those changes away? (gitbuddy undo can still bring them back)", { default: false })) {
      fail("Staying here so you don't lose those changes.", { code: "dirty", hint: "Copy what you need, then: gitbuddy back --force" });
    }
    record("back", `before coming back from ${away.label}`);
    if (away.returnDetached) git(["switch", "-q", "-f", "--detach", away.returnTo], { mutates: true });
    else git(["switch", "-q", "-f", away.returnTo], { mutates: true });
    git(["clean", "-fdq"], { mutates: true });
    if (away.tempBranch) git(["branch", "-q", "-D", away.tempBranch], { mutates: true, allowFail: true });
    untuck(away.tuckedRef);
    if (!ctx.flags.dryRun) updateState((s) => delete s.away);
    ui.say("time", c.ok(`Back to the present${away.returnDetached ? "" : ` on ${away.returnTo}`}.`));
    ctx.data = { returned: true, from: away.kind };
  },
});

define({
  name: "when-broke",
  aliases: ["bisect", "what-broke"],
  group: "history",
  summary: "Find the exact save that broke something, by answering yes/no",
  gitEquivalent: "git bisect",
  options: {
    good: { type: "string", description: 'When it last worked, e.g. "3 days ago", v1.2' },
    run: { type: "string", description: "A test command: exit 0 = works, anything else = broken" },
  },
  mutates: true,
  examples: ["gitbuddy when-broke", 'gitbuddy when-broke --good v1.2 --run "bun test"'],
  run({ opts }) {
    if (!ctx.interactive && !opts.run) fail("I need either a person to answer questions or a --run test command.", { code: "needs_choice", hint: 'Example: gitbuddy when-broke --good v1.2 --run "bun test"' });
    if (readState().away) fail("Come back to the present first.", { hint: "gitbuddy back" });
    const goodWhen = opts.good ? String(opts.good) : ui.ask(`${c.bold("When did it last work?")} ${c.dim('(e.g. "3 days ago", "v1.2", "20 saves ago")')} ›`);
    if (!goodWhen) fail("I need to know when it last worked.");
    const good = resolveWhen(goodWhen);
    record("when-broke", "before hunting for the bad save");
    const tucked = tuck("tucked away while hunting for the bad save");
    let culprit = "";
    let trail = "";
    try {
      git(["bisect", "start"], { mutates: true });
      git(["bisect", "bad", "HEAD"], { mutates: true });
      let said = git(["bisect", "good", good], { mutates: true }).stdout;
      if (opts.run) {
        const sh = process.platform === "win32" ? ["cmd", "/c"] : ["sh", "-c"];
        const r = git(["bisect", "run", ...sh, String(opts.run)], { mutates: true, allowFail: true });
        said = r.stdout + r.stderr;
      } else {
        while (!/is the first bad commit/.test(said)) {
          const left = said.match(/roughly (\d+) steps?/)?.[1];
          const [id, msg, date] = out(["log", "-1", `--format=%h${SEP}%s${SEP}%aI`]).split(SEP);
          ui.blank();
          ui.line(`${c.accent("🔍")} Checking ${c.bold(`"${msg}"`)} ${c.dim(`${id} · ${ago(date)}${left ? ` · about ${left} more` : ""}`)}`);
          const a = ui.ask(`   Does it work now? ${c.dim("[y]es / [n]o / [s]kip / [q]uit")} ›`).toLowerCase();
          if (a.startsWith("q")) fail("Stopped hunting. Everything is back to normal.");
          const verdict = a.startsWith("y") ? "good" : a.startsWith("n") ? "bad" : a.startsWith("s") ? "skip" : "";
          if (!verdict) continue;
          const r = git(["bisect", verdict], { mutates: true, allowFail: true });
          said = r.stdout + r.stderr;
        }
      }
      const log = git(["bisect", "log"], { allowFail: true }).stdout;
      trail = `${said}\n${log}`;
      culprit = log.match(/# first bad commit: \[([0-9a-f]{40})\]/)?.[1] ?? said.match(/([0-9a-f]{40}) is the first bad commit/)?.[1] ?? "";
    } finally {
      git(["bisect", "reset"], { mutates: true, allowFail: true });
      untuck(tucked);
    }
    if (!culprit) fail("I couldn't pin down one save. Maybe it broke and got fixed a few times?", { details: trail });
    const [id, msg, who, date] = out(["log", "-1", `--format=%h${SEP}%s${SEP}%an${SEP}%aI`, culprit]).split(SEP);
    const files = out(["show", "--name-only", "--format=", culprit]).split("\n").filter(Boolean);
    ui.blank();
    ui.say("search", c.bold(`Found it! It broke in "${msg}"`) + c.dim(` ${id}`));
    ui.line(`   by ${c.accent(who)}, ${ago(date)} · changed ${files.slice(0, 5).join(", ")}${files.length > 5 ? "…" : ""}`);
    ui.next(`gitbuddy reverse ${id}`, "undo just that save");
    ctx.data = { culprit, id, message: msg, author: who, date, files };
  },
});
