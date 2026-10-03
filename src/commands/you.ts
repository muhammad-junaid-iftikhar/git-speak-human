import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, config, setConfig, type Config } from "../config";
import { ctx } from "../context";
import { fail } from "../errors";
import { ACHIEVEMENTS, AVATARS, bar, displayName, fmtTip, level, randomTip, readProfile, readStats, streak, track, writeProfile } from "../fun";
import { git, tryOut } from "../git";
import { execute } from "../main";
import { define } from "../registry";
import { THEMES, theme } from "../theme";
import { c, plural, ui } from "../ui";
import { VERSION } from "../version";

export function setupProfile(): void {
  ui.line(`${theme().mascot}  ${c.bold("Hi! I'm gitbuddy.")} Two quick questions and we're off.`);
  ui.blank();
  const name = ui.ask(`   What should I call you? ›`, tryOut(["config", "user.name"])?.split(" ")[0] ?? "");
  ui.line(`   Pick an avatar: ${AVATARS.map((a, i) => `${c.dim(String(i + 1))}${a}`).join(" ")}`);
  const pick = ui.ask("   Number ›", "1");
  const avatar = AVATARS[Number(pick) - 1] ?? AVATARS[0];
  writeProfile({ name: name || "friend", avatar, created: new Date().toISOString() });
  ui.blank();
  ui.ok(`Nice to meet you, ${name || "friend"} ${avatar}`);
  ui.hint(`Change the look any time: gitbuddy config set theme ${Object.keys(THEMES).join("|")}`);
  ui.blank();
}

define({
  name: "me",
  aliases: ["profile", "stats", "whoami"],
  group: "you",
  summary: "Your profile card: level, streak, achievements",
  needsRepo: false,
  examples: ["gitbuddy me"],
  run() {
    const p = readProfile();
    const s = readStats();
    const lv = level(s.xp);
    const st = streak(s.days);
    const fav = s.hours.indexOf(Math.max(...s.hours));
    const unlocked = ACHIEVEMENTS.filter((a) => s.achievements[a.id]);
    ctx.data = { profile: p, level: lv, streak: st, xp: s.xp, counts: s.counts, achievements: unlocked.map((a) => a.id), activeDays: s.days.length };
    const avatar = p?.avatar ?? theme().mascot;
    ui.line(c.dim("   ╭──────────────────────────────────────────╮"));
    ui.line(`     ${avatar}  ${c.bold(displayName())}  ${c.dim(`· Lv ${lv.level}`)} ${c.accent(lv.title)}`);
    ui.line(`     ${bar(lv.progress, 20)} ${c.dim(`${s.xp}/${lv.next} xp`)}`);
    ui.line(c.dim("   ╰──────────────────────────────────────────╯"));
    ui.blank();
    ui.table([
      ["🔥", "streak", st ? `${plural(st, "day")} in a row` : c.dim("start one today")],
      ["💾", "saves", String(s.counts.done ?? 0)],
      ["📤", "sends", String((s.counts.send ?? 0) + (s.counts.sync ?? 0))],
      ["⏪", "undos", String(s.counts.undo ?? 0)],
      ["📅", "active days", String(s.days.length)],
      ["🕐", "favourite hour", s.xp ? `${String(fav).padStart(2, "0")}:00` : c.dim("—")],
    ]);
    ui.blank();
    ui.line(c.bold(`   Achievements ${c.dim(`${unlocked.length}/${ACHIEVEMENTS.length}`)}`));
    ui.line(`   ${ACHIEVEMENTS.map((a) => (s.achievements[a.id] ? a.icon : c.dim("·"))).join(" ")}`);
    const nextUp = ACHIEVEMENTS.find((a) => !s.achievements[a.id]);
    if (nextUp) ui.hint(`Next: ${nextUp.title} (${nextUp.how})`);
    if (!p && ctx.interactive) ui.next("gitbuddy setup", "make it yours");
  },
});

define({
  name: "setup",
  aliases: ["onboard", "welcome"],
  group: "you",
  summary: "Set your name, avatar and look",
  needsRepo: false,
  interactiveOnly: true,
  run() {
    setupProfile();
  },
});

define({
  name: "config",
  aliases: ["settings", "prefs"],
  group: "you",
  summary: "See or change settings (theme, fun, emoji, AI messages…)",
  args: [
    { name: "action", description: "set or get (leave out to see all)" },
    { name: "key", description: "Which setting" },
    { name: "value", description: "New value", variadic: true },
  ],
  needsRepo: false,
  examples: ["gitbuddy config", "gitbuddy config set theme neon", "gitbuddy config set fun false", 'gitbuddy config set ai_command "claude -p"'],
  run({ args }) {
    const [action, key, ...rest] = args;
    const keys = Object.keys(DEFAULT_CONFIG) as (keyof Config)[];
    if (!action) {
      ctx.data = { ...config() };
      const help: Record<string, string> = {
        theme: Object.keys(THEMES).join(" | "),
        fun: "greetings, tips, achievements",
        emoji: "icons in output",
        ai_command: "command that writes commit messages from a diff on stdin",
        autosave_minutes: "auto-save the active workspace (0 = off)",
        update_check: "tell me when a new version is out",
      };
      ui.table(keys.map((k) => [c.accent(k), JSON.stringify(config()[k]), c.dim(help[k] ?? "")]));
      ui.blank();
      ui.next("gitbuddy config set <key> <value>");
      return;
    }
    if (!key || !keys.includes(key as keyof Config)) fail(`Pick a setting: ${keys.join(", ")}`, { code: "bad_setting" });
    if (action === "get") {
      ctx.data = { [key]: config()[key as keyof Config] };
      ui.line(String(config()[key as keyof Config]));
      return;
    }
    if (action !== "set") fail('Use "set" or "get".', { hint: "gitbuddy config set theme neon" });
    const value = rest.join(" ");
    if (key === "theme" && !THEMES[value]) fail(`Themes: ${Object.keys(THEMES).join(", ")}`, { code: "bad_setting" });
    const next = setConfig(key as keyof Config, value);
    ctx.data = { [key]: next[key as keyof Config] };
    ui.ok(`${key} = ${JSON.stringify(next[key as keyof Config])}`);
    if (key === "theme") ui.line(`   ${theme().mascot}  ${c.accent("Looking good!")} ${c.ok("●")} ${c.warn("●")} ${c.err("●")}`);
  },
});

const COMPLETIONS: Record<string, string> = {
  bash: `_gitbuddy() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local IFS=$'\\n'
  COMPREPLY=($(compgen -W "$(gitbuddy __complete "\${COMP_WORDS[@]:1:COMP_CWORD-1}" 2>/dev/null)" -- "$cur"))
}
complete -F _gitbuddy gitbuddy`,
  zsh: `#compdef gitbuddy
_gitbuddy() {
  local -a opts
  opts=(\${(f)"$(gitbuddy __complete \${words[2,CURRENT-1]} 2>/dev/null)"})
  compadd -a opts
}
if (( $+functions[compdef] )); then compdef _gitbuddy gitbuddy; fi`,
  fish: `complete -c gitbuddy -f -a '(gitbuddy __complete (commandline -opc)[2..-1] 2>/dev/null)'`,
  powershell: `Register-ArgumentCompleter -Native -CommandName gitbuddy -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $words = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.ToString() })
  if ($wordToComplete) { $words = @($words | Select-Object -SkipLast 1) }
  gitbuddy __complete @words 2>$null | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}`,
};

define({
  name: "completion",
  aliases: ["completions"],
  group: "you",
  summary: "Tab-completion for your shell (bash, zsh, fish, powershell)",
  args: [{ name: "shell", description: "bash, zsh, fish or powershell", required: true }],
  needsRepo: false,
  examples: ["gitbuddy completion zsh >> ~/.zshrc", "gitbuddy completion bash >> ~/.bashrc", "gitbuddy completion fish > ~/.config/fish/completions/gitbuddy.fish"],
  run({ args }) {
    const script = COMPLETIONS[args[0]];
    if (!script) fail(`Shells I know: ${Object.keys(COMPLETIONS).join(", ")}`);
    ctx.data = { shell: args[0], script };
    if (!ctx.flags.json) process.stdout.write(script + "\n");
  },
});

define({
  name: "prompt",
  aliases: ["ps1"],
  group: "you",
  summary: "A tiny status for your shell prompt (workspace + unsaved count)",
  needsRepo: false,
  examples: ["PROMPT='$(gitbuddy prompt) '$PROMPT"],
  run() {
    const dir = tryOut(["rev-parse", "--absolute-git-dir"]);
    if (!dir) return;
    let active = "";
    try {
      active = JSON.parse(readFileSync(join(dir, "gitbuddy", "state.json"), "utf-8")).active ?? "";
    } catch {
      active = "";
    }
    const dirty = (tryOut(["status", "--porcelain", "-uno"]) ?? "").split("\n").filter(Boolean).length;
    const branch = tryOut(["symbolic-ref", "--short", "-q", "HEAD"]) ?? "⏳";
    const text = `${theme().mascot} ${active || branch}${dirty ? ` ●${dirty}` : ""}`;
    ctx.data = { workspace: active || null, branch, unsaved: dirty };
    if (!ctx.flags.json) process.stdout.write(text);
  },
});

define({
  name: "update",
  aliases: ["upgrade", "self-update"],
  group: "you",
  summary: "Get the newest gitbuddy",
  needsRepo: false,
  network: true,
  examples: ["gitbuddy update"],
  run() {
    const source = "github:muhammad-junaid-iftikhar/git-speak-human";
    const binary = !process.argv[1]?.endsWith(".ts");
    if (binary) {
      ui.info("You're using the standalone gitbuddy. Re-run the installer to update:");
      ui.line(`   ${c.accent("curl -fsSL https://raw.githubusercontent.com/muhammad-junaid-iftikhar/git-speak-human/main/install.sh | sh")}`);
      ctx.data = { method: "installer" };
      return;
    }
    ui.say("get", `Updating gitbuddy (you have ${VERSION})…`);
    const p = Bun.spawnSync(["bun", "install", "-g", source], { stdout: "inherit", stderr: "inherit" });
    if (p.exitCode !== 0) fail("The update didn't work.", { hint: `Try it yourself: bun install -g ${source}` });
    ui.ok("Updated! Run gitbuddy version to check.");
    ctx.data = { method: "bun", from: VERSION };
  },
});

interface Step {
  say: string;
  type: string;
  before?: (dir: string) => void;
}

define({
  name: "learn",
  aliases: ["tutorial", "teach-me"],
  group: "you",
  summary: "A 5-minute hands-on tutorial in a safe practice project",
  needsRepo: false,
  interactiveOnly: true,
  async run() {
    const dir = mkdtempSync(join(tmpdir(), "gitbuddy-learn-"));
    const home = process.cwd();
    const steps: Step[] = [
      { say: "This is a practice project. Let's see what's in it.", type: "show", before: (d) => writeFileSync(join(d, "hello.txt"), "Hello world!\n") },
      { say: "There's a new file. Save it for good, with a message.", type: 'done "My first save"' },
      { say: "I just changed hello.txt for you. See exactly what changed:", type: "diff", before: (d) => writeFileSync(join(d, "hello.txt"), "Hello world!\nOops, a mistake.\n") },
      { say: "That was a mistake. Throw the change away:", type: "throw-away" },
      { say: "Wait, you actually wanted it! Every action can be undone:", type: "undo" },
      { say: "Let's juggle two tasks. Start a workspace for an idea:", type: 'work "big idea"' },
      { say: "I added idea.txt. Now start a second task (the idea is kept safe):", type: 'work "quick fix"', before: (d) => writeFileSync(join(d, "idea.txt"), "World domination\n") },
      { say: "See everything you're working on:", type: "list" },
      { say: "Jump back to your idea:", type: 'switch "big idea"' },
      { say: "Finally, look at the timeline of saves:", type: "history" },
    ];
    try {
      process.chdir(dir);
      git(["init", "-q", "-b", "main"]);
      if (!tryOut(["config", "user.name"])) git(["config", "user.name", displayName()]);
      if (!tryOut(["config", "user.email"])) git(["config", "user.email", "learner@gitbuddy.local"]);
      ui.line(`${theme().mascot}  ${c.bold("Welcome to gitbuddy school!")} ${c.dim(`(practice folder: ${dir})`)}`);
      ui.hint("Type the commands shown (the gitbuddy part is optional). Type q to quit.");
      for (const [i, step] of steps.entries()) {
        step.before?.(dir);
        ui.blank();
        ui.line(`${c.accent(`Step ${i + 1}/${steps.length}`)}  ${step.say}`);
        ui.line(`   ${c.dim("type:")} ${c.bold(`gitbuddy ${step.type}`)}`);
        for (;;) {
          const input = prompt(`${c.accent("   ›")}`);
          if (input === null || /^(q|quit|exit)$/i.test(input.trim())) {
            ui.info("See you next time! Run gitbuddy learn to start again.");
            return;
          }
          const typed = input.trim().replace(/^gitbuddy\s+/, "");
          const argv = splitArgs(typed);
          const want = splitArgs(step.type);
          if (argv[0] !== want[0]) {
            ui.hint(`Almost! Try: gitbuddy ${step.type}`);
            continue;
          }
          await execute(argv);
          break;
        }
      }
      ui.blank();
      ui.say("party", c.bold("You graduated! 🎓 You now know more git than most people."));
      ui.hint(fmtTip(randomTip()));
      const unlocked = track("learn", {});
      for (const a of unlocked) ui.line(`   ${c.warn("🏅 Achievement unlocked:")} ${a.icon} ${c.bold(a.title)}`);
    } finally {
      process.chdir(home);
      rmSync(dir, { recursive: true, force: true });
    }
  },
});

export function splitArgs(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}
