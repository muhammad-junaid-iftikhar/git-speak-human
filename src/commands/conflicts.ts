import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ctx } from "../context";
import { EXIT, fail } from "../errors";
import { git, tryOut } from "../git";
import { define } from "../registry";
import { operation, repoRoot, status, type Operation } from "../repo";
import { c, plural, ui } from "../ui";
import { abortOperation } from "./safety";

const mineIsOurs = (op: Operation) => op === "merge" || op === "cherry-pick" || op === "revert";

const opLabel: Record<string, string> = {
  merge: "combining work",
  rebase: "getting your team's work",
  "cherry-pick": "grabbing a save",
  revert: "reversing a save",
};

interface Block {
  line: number;
  ours: string[];
  theirs: string[];
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let cur: Block | null = null;
  let side: "ours" | "base" | "theirs" = "ours";
  lines.forEach((l, i) => {
    if (l.startsWith("<<<<<<<")) {
      cur = { line: i + 1, ours: [], theirs: [] };
      side = "ours";
    } else if (cur && l.startsWith("|||||||")) side = "base";
    else if (cur && l.startsWith("=======")) side = "theirs";
    else if (cur && l.startsWith(">>>>>>>")) {
      blocks.push(cur);
      cur = null;
    } else if (cur && side !== "base") cur[side].push(l);
  });
  return blocks;
}

function readRepoFile(path: string): string | null {
  const abs = join(repoRoot() ?? process.cwd(), path);
  return existsSync(abs) ? readFileSync(abs, "utf-8") : null;
}

function conflicted(): string[] {
  return status().conflicted.map((f) => f.path);
}

define({
  name: "conflicts",
  aliases: ["clashes", "conflict"],
  group: "team",
  summary: "See clashing changes side by side and decide what to keep",
  args: [{ name: "file", description: "Show the clashes in one file" }],
  options: { edit: { type: "boolean", description: "Open the clashing files in your editor" } },
  examples: ["gitbuddy conflicts", "gitbuddy conflicts src/app.ts", "gitbuddy conflicts --edit"],
  run({ args, opts }) {
    const op = operation();
    const files = conflicted();
    const mineSide = mineIsOurs(op) ? "ours" : "theirs";
    const data = files.map((f) => ({ path: f, clashes: parseBlocks(readRepoFile(f) ?? "").length }));
    ctx.data = { operation: op, files: data };
    if (!files.length) {
      if (op) {
        ui.say("conflict", `No clashes left. Finish ${opLabel[op] ?? op} with:`);
        ui.next("gitbuddy continue");
      } else ui.say("clean", "No clashes. All good!");
      return;
    }
    if (opts.edit) {
      const editor = tryOut(["var", "GIT_EDITOR"]) ?? "vi";
      const sh = process.platform === "win32" ? ["cmd", "/c"] : ["sh", "-c"];
      Bun.spawnSync([...sh, `${editor} ${files.map((f) => `"${f.replace(/"/g, '\\"')}"`).join(" ")}`], { stdin: "inherit", stdout: "inherit", stderr: "inherit", cwd: repoRoot() ?? undefined });
      ui.next("gitbuddy continue", "when you're happy with the files");
      return;
    }
    if (args[0]) {
      const text = readRepoFile(args[0]);
      if (text === null) fail(`I can't find ${args[0]}.`);
      const blocks = parseBlocks(text!);
      ui.say("conflict", `${c.bold(args[0])}: ${plural(blocks.length, "clash", "clashes")}`);
      blocks.forEach((b, i) => {
        const yours = mineSide === "ours" ? b.ours : b.theirs;
        const theirs = mineSide === "ours" ? b.theirs : b.ours;
        ui.blank();
        ui.line(c.dim(`── clash ${i + 1} of ${blocks.length} · line ${b.line} ──`));
        ui.line(c.ok("   YOURS"));
        for (const l of yours) ui.line(c.ok(`   │ ${l}`));
        ui.line(c.accent("   THEIRS"));
        for (const l of theirs) ui.line(c.accent(`   │ ${l}`));
      });
      ui.blank();
      ui.next(`gitbuddy keep mine ${args[0]}`, "or: keep theirs / keep both / edit the file yourself");
      return;
    }
    ui.say("conflict", c.bold(`${plural(files.length, "file")} need${files.length === 1 ? "s" : ""} your decision`) + (op ? c.dim(` (while ${opLabel[op] ?? op})`) : ""));
    ui.hint("Don't worry, nothing is lost. You decide which version to keep.");
    ui.blank();
    ui.table(data.map((d) => [c.err("✖"), d.path, c.dim(plural(d.clashes, "clash", "clashes"))]));
    ui.blank();
    ui.line(c.dim("   For each file, pick one:"));
    ui.line(`   ${c.accent("gitbuddy conflicts <file>")}     see yours vs theirs`);
    ui.line(`   ${c.accent("gitbuddy keep mine <file>")}     keep your version`);
    ui.line(`   ${c.accent("gitbuddy keep theirs <file>")}   keep their version`);
    ui.line(`   ${c.accent("gitbuddy keep both <file>")}     keep both, yours first`);
    ui.line(`   ${c.accent("gitbuddy conflicts --edit")}     fix them by hand in your editor`);
    ui.line(c.dim("   Then: gitbuddy continue    ·    Give up: gitbuddy abort"));
  },
});

function keepBoth(path: string): void {
  const text = readRepoFile(path);
  if (text === null) fail(`I can't find ${path}.`);
  const op = operation();
  const mineFirst = !mineIsOurs(op);
  const out: string[] = [];
  let cur: { ours: string[]; theirs: string[] } | null = null;
  let side: "ours" | "base" | "theirs" = "ours";
  for (const l of text!.split("\n")) {
    if (l.startsWith("<<<<<<<")) {
      cur = { ours: [], theirs: [] };
      side = "ours";
    } else if (cur && l.startsWith("|||||||")) side = "base";
    else if (cur && l.startsWith("=======")) side = "theirs";
    else if (cur && l.startsWith(">>>>>>>")) {
      out.push(...(mineFirst ? [...cur.theirs, ...cur.ours] : [...cur.ours, ...cur.theirs]));
      cur = null;
    } else if (cur) {
      if (side !== "base") cur[side].push(l);
    } else out.push(l);
  }
  if (!ctx.flags.dryRun) writeFileSync(join(repoRoot() ?? process.cwd(), path), out.join("\n"));
}

function markResolved(path: string): void {
  git(["add", "--", path], { mutates: true });
  if (!operation()) git(["reset", "-q", "--", path], { mutates: true, allowFail: true });
}

define({
  name: "keep",
  aliases: ["resolve", "take"],
  group: "team",
  summary: "Settle a clash: keep mine, theirs, or both",
  args: [
    { name: "side", description: "Which version: mine, theirs or both", required: true },
    { name: "files", description: "Which files (or --all)", variadic: true },
  ],
  options: { all: { type: "boolean", description: "Do it for every clashing file" } },
  mutates: true,
  examples: ["gitbuddy keep mine src/app.ts", "gitbuddy keep theirs --all", "gitbuddy keep both notes.md"],
  run({ args, opts }) {
    const side = args[0]?.toLowerCase();
    if (!["mine", "theirs", "both", "yours", "ours"].includes(side)) fail('Say which version to keep: "mine", "theirs" or "both".', { hint: "Example: gitbuddy keep mine src/app.ts" });
    const want = side === "yours" || side === "ours" ? "mine" : side;
    const all = conflicted();
    const files = opts.all ? all : args.slice(1);
    if (!files.length) fail("Which file? Name it, or use --all.", { hint: "See them: gitbuddy conflicts" });
    const unknown = files.filter((f) => !all.includes(f));
    if (unknown.length) fail(`No clash in: ${unknown.join(", ")}`, { hint: "See them: gitbuddy conflicts" });
    const op = operation();
    for (const f of files) {
      if (want === "both") keepBoth(f);
      else {
        const flag = (want === "mine") === mineIsOurs(op) ? "--ours" : "--theirs";
        const r = git(["checkout", flag, "--", f], { mutates: true, allowFail: true });
        if (!r.ok) git(["rm", "-q", "--", f], { mutates: true, allowFail: true });
      }
      if (existsSync(join(repoRoot() ?? process.cwd(), f))) markResolved(f);
    }
    const left = conflicted();
    ui.ok(`Kept ${want === "both" ? "both versions" : want === "mine" ? "your version" : "their version"} of ${plural(files.length, "file")}.`);
    ctx.data = { kept: want, files, remaining: left };
    if (left.length) ui.next("gitbuddy conflicts", `${plural(left.length, "file")} still to decide`);
    else if (op) ui.next("gitbuddy continue", "all settled, let's finish");
    else ui.say("party", "All clashes settled!");
  },
});

define({
  name: "continue",
  aliases: ["resume-op"],
  group: "team",
  summary: "Carry on after you settled all clashes",
  mutates: true,
  examples: ["gitbuddy continue"],
  run() {
    let op = operation();
    const root = repoRoot() ?? process.cwd();
    for (const f of conflicted()) {
      const text = existsSync(join(root, f)) ? readFileSync(join(root, f), "utf-8") : "";
      if (!/^<<<<<<< |^>>>>>>> /m.test(text)) markResolved(f);
    }
    const left = conflicted();
    if (left.length) {
      fail(`${plural(left.length, "file")} still ${left.length === 1 ? "has" : "have"} clashes: ${left.join(", ")}`, {
        exit: EXIT.CONFLICT,
        code: "conflict",
        hint: "Settle them with: gitbuddy keep mine|theirs|both <file>",
      });
    }
    if (!op) {
      ui.ok("Nothing left to finish. You're good!");
      ctx.data = { finished: null };
      return;
    }
    const env = { GIT_EDITOR: "true" };
    const cmd: Record<string, string[]> = {
      merge: ["commit", "--no-edit"],
      rebase: ["rebase", "--continue"],
      "cherry-pick": ["cherry-pick", "--continue"],
      revert: ["revert", "--continue"],
      bisect: ["bisect", "reset"],
    };
    const r = git(cmd[op!], { mutates: true, allowFail: true, env });
    if (!r.ok && /nothing to commit|empty/i.test(r.stdout + r.stderr) && op === "rebase") {
      git(["rebase", "--skip"], { mutates: true, allowFail: true, env });
    } else if (!r.ok && op === "cherry-pick" && /empty/i.test(r.stdout + r.stderr)) {
      git(["cherry-pick", "--skip"], { mutates: true, allowFail: true, env });
    }
    const still = operation();
    if (still && conflicted().length) {
      fail("Finished one step, but the next save has clashes too.", { exit: EXIT.CONFLICT, code: "conflict", hint: "See them: gitbuddy conflicts" });
    }
    if (still) fail(`I couldn't finish ${opLabel[op!] ?? op}.`, { details: r.stderr, hint: "Try: gitbuddy abort   (goes back to before)" });
    ui.say("party", c.ok(`Done ${opLabel[op!] ?? op}. Nice work sorting that out!`));
    ctx.data = { finished: op };
  },
});

define({
  name: "abort",
  aliases: ["cancel", "give-up"],
  group: "team",
  summary: "Cancel the combine/get that clashed and go back to before",
  mutates: true,
  examples: ["gitbuddy abort"],
  run() {
    const op = abortOperation();
    if (op) {
      ui.say("undo", c.ok(`Cancelled ${opLabel[op] ?? op}. Everything is back to how it was.`));
      ctx.data = { aborted: op };
      return;
    }
    if (conflicted().length) {
      ui.info("These clashes came from bringing back saved work. To go back to before:");
      ui.next("gitbuddy undo");
      ctx.data = { aborted: null };
      return;
    }
    ui.say("clean", "There's nothing to cancel.");
    ctx.data = { aborted: null };
  },
});

