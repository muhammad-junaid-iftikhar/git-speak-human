import { join } from "node:path";
import { config, homeDir, readJSON, writeJSON } from "./config";
import { ctx } from "./context";
import { tryOut } from "./git";
import { theme } from "./theme";
import { c, ui } from "./ui";
import { VERSION } from "./version";

export interface Profile {
  name: string;
  avatar: string;
  created: string;
}

export interface Stats {
  counts: Record<string, number>;
  days: string[];
  hours: number[];
  xp: number;
  achievements: Record<string, string>;
  workspacesCreated: number;
}

const profileFile = () => join(homeDir(), "profile.json");
const statsFile = () => join(homeDir(), "stats.json");

export const readProfile = (): Profile | null => readJSON<Profile | null>(profileFile(), null);
export const writeProfile = (p: Profile) => writeJSON(profileFile(), p);

export function readStats(): Stats {
  return {
    counts: {},
    days: [],
    hours: Array(24).fill(0),
    xp: 0,
    achievements: {},
    workspacesCreated: 0,
    ...readJSON<Partial<Stats>>(statsFile(), {}),
  };
}

export function displayName(): string {
  return readProfile()?.name || tryOut(["config", "user.name"])?.split(" ")[0] || "friend";
}

export const AVATARS = ["🐙", "🦊", "🐼", "🦄", "🐸", "🐧", "🦖", "🐝", "🤖", "👾", "🧙", "🦁", "🐢", "🚀", "🌵", "🍕"];

const XP: Record<string, number> = { done: 10, send: 15, sync: 15, get: 5, release: 50, continue: 20, work: 3, switch: 2, share: 25, rescue: 10, "when-broke": 20, undo: 2 };

const TITLES = ["Git Rookie", "Commit Cadet", "Save Scout", "Branch Buddy", "Merge Master", "History Hacker", "Conflict Crusher", "Git Wizard", "Time Lord", "Legend"];

export function level(xp: number): { level: number; title: string; next: number; progress: number } {
  const lvl = Math.floor(Math.sqrt(xp / 25)) + 1;
  const floor = 25 * (lvl - 1) ** 2;
  const next = 25 * lvl ** 2;
  return { level: lvl, title: TITLES[Math.min(lvl - 1, TITLES.length - 1)], next, progress: (xp - floor) / (next - floor) };
}

export function streak(days: string[]): number {
  const set = new Set(days);
  let n = 0;
  const d = new Date();
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (set.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Achievement {
  id: string;
  title: string;
  icon: string;
  how: string;
  check: (s: Stats, cmd: string) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_save", title: "First Save", icon: "🌱", how: "Save something with gitbuddy done", check: (s) => (s.counts.done ?? 0) >= 1 },
  { id: "first_send", title: "Shipped It", icon: "📤", how: "Send your work with gitbuddy send", check: (s) => (s.counts.send ?? 0) + (s.counts.sync ?? 0) >= 1 },
  { id: "saves_10", title: "Getting the Hang of It", icon: "💪", how: "Make 10 saves", check: (s) => (s.counts.done ?? 0) >= 10 },
  { id: "saves_100", title: "Centurion", icon: "💯", how: "Make 100 saves", check: (s) => (s.counts.done ?? 0) >= 100 },
  { id: "streak_3", title: "On a Roll", icon: "🔥", how: "Use gitbuddy 3 days in a row", check: (s) => streak(s.days) >= 3 },
  { id: "streak_7", title: "Week Warrior", icon: "⚡", how: "Use gitbuddy 7 days in a row", check: (s) => streak(s.days) >= 7 },
  { id: "streak_30", title: "Unstoppable", icon: "🏆", how: "Use gitbuddy 30 days in a row", check: (s) => streak(s.days) >= 30 },
  { id: "juggler", title: "Juggler", icon: "🤹", how: "Start 3 workspaces", check: (s) => s.workspacesCreated >= 3 },
  { id: "time_lord", title: "Time Lord", icon: "⏪", how: "Use undo 5 times", check: (s) => (s.counts.undo ?? 0) >= 5 },
  { id: "clash_tamer", title: "Clash Tamer", icon: "🤝", how: "Sort out a conflict", check: (s) => (s.counts.continue ?? 0) >= 1 },
  { id: "lifeguard", title: "Lifeguard", icon: "🛟", how: "Rescue lost work", check: (s) => (s.counts.rescue ?? 0) >= 1 },
  { id: "time_traveler", title: "Time Traveler", icon: "🕰️", how: "Visit the past with time-travel", check: (s) => (s.counts["time-travel"] ?? 0) >= 1 },
  { id: "detective", title: "Detective", icon: "🔍", how: "Find a bad save with when-broke", check: (s) => (s.counts["when-broke"] ?? 0) >= 1 },
  { id: "shipper", title: "Shipper", icon: "🚢", how: "Release a version", check: (s) => (s.counts.release ?? 0) >= 1 },
  { id: "team_player", title: "Team Player", icon: "🙌", how: "Open a pull request with share", check: (s) => (s.counts.share ?? 0) >= 1 },
  { id: "night_owl", title: "Night Owl", icon: "🦉", how: "Save something between midnight and 4am", check: (_s, cmd) => cmd === "done" && new Date().getHours() < 4 },
  { id: "early_bird", title: "Early Bird", icon: "🐦", how: "Save something between 5 and 7am", check: (_s, cmd) => cmd === "done" && [5, 6].includes(new Date().getHours()) },
  { id: "graduate", title: "Graduate", icon: "🎓", how: "Finish gitbuddy learn", check: (s) => (s.counts.learn ?? 0) >= 1 },
];

export function track(cmd: string, data: Record<string, unknown>): Achievement[] {
  const s = readStats();
  s.counts[cmd] = (s.counts[cmd] ?? 0) + 1;
  const today = dayKey(new Date());
  if (!s.days.includes(today)) s.days = [...s.days, today].slice(-400);
  s.hours[new Date().getHours()]++;
  s.xp += XP[cmd] ?? 1;
  if (cmd === "work" && data.created) s.workspacesCreated++;
  const unlocked: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!s.achievements[a.id] && a.check(s, cmd)) {
      s.achievements[a.id] = new Date().toISOString();
      unlocked.push(a);
    }
  }
  writeJSON(statsFile(), s);
  return unlocked;
}

const TIPS = [
  "Made a mess? `gitbuddy undo` reverses the last thing gitbuddy did.",
  "Juggling tasks? `gitbuddy work \"name\"` and `gitbuddy switch` keep them apart.",
  "`gitbuddy go-back file.txt to yesterday` brings back an old version of one file.",
  "`gitbuddy time-travel \"last week\"` lets you look at the past safely. `gitbuddy back` to return.",
  "`gitbuddy who file.ts:42` tells you who wrote that line.",
  "`gitbuddy find \"text\"` searches your files AND all of history.",
  "Add `--explain` to any command to see the real git underneath.",
  "Add `--dry-run` to see what would happen without doing it.",
  "Something broke? `gitbuddy when-broke` finds the exact save, by asking yes/no.",
  "`gitbuddy sync` gets your team's work and sends yours in one go.",
  "Lost something? `gitbuddy rescue` digs through everything git remembers.",
  "`gitbuddy share` opens a pull request, even if you never made a branch.",
  "`gitbuddy save` keeps a checkpoint without making it permanent.",
  "`gitbuddy ignore .env` keeps secrets out of git for good.",
  "`gitbuddy doctor` checks your login, remote and setup.",
  "`gitbuddy me` shows your profile, streak and achievements.",
  "Try a new look: `gitbuddy config set theme neon` (or pastel, pirate, mono).",
  "`gitbuddy tidy` lets you squash or rename saves before you send them.",
  "`gitbuddy peek \"name\"` shows a workspace's changes without switching.",
  "Want AI commit messages? `gitbuddy config set ai_command \"claude -p\"`.",
  "`gitbuddy history --by Sam --since \"last week\"` filters the timeline.",
  "Shell tab-completion: `gitbuddy completion zsh >> ~/.zshrc`.",
  "AI agents can drive gitbuddy too: `claude mcp add gitbuddy -- gitbuddy mcp`.",
];

export function randomTip(): string {
  return TIPS[Math.floor(Math.random() * TIPS.length)];
}

export function fmtTip(tip: string): string {
  return tip.replace(/`([^`]+)`/g, (_, code) => c.accent(code));
}

export function greeting(): string {
  const name = displayName();
  const h = new Date().getHours();
  const pirate = config().theme === "pirate";
  if (pirate) return ["Ahoy", "Avast", "Yo ho"][Math.floor(Math.random() * 3)] + `, Captain ${name}!`;
  const pools: string[][] = [
    h < 5 ? [`Burning the midnight oil, ${name}?`, `Still up, ${name}? Legend.`, `Night shift, ${name}? I've got your back.`] : [],
    h >= 5 && h < 12 ? [`Good morning, ${name}!`, `Rise and ship, ${name}!`, `Morning, ${name}! Coffee and commits?`] : [],
    h >= 12 && h < 17 ? [`Good afternoon, ${name}!`, `Hey ${name}, what are we building?`, `Afternoon, ${name}! Let's make progress.`] : [],
    h >= 17 ? [`Good evening, ${name}!`, `Evening, ${name}! One more thing?`, `Hey ${name}, let's wrap something up.`] : [],
    [`Hey ${name}! 👋`, `Welcome back, ${name}!`, `Yo ${name}!`],
  ];
  const all = pools.flat();
  return all[Math.floor(Math.random() * all.length)];
}

export function bar(progress: number, width = 12): string {
  const filled = Math.round(Math.max(0, Math.min(1, progress)) * width);
  return c.accent("█".repeat(filled)) + c.dim("░".repeat(width - filled));
}

export function headerLine(): string {
  const s = readStats();
  const lv = level(s.xp);
  const st = streak(s.days);
  const avatar = readProfile()?.avatar ?? theme().mascot;
  return `${avatar}  ${c.bold(greeting())}  ${c.dim(`Lv ${lv.level} ${lv.title}`)}${st > 1 ? c.warn(`  🔥 ${st}-day streak`) : ""}`;
}

const CELEBRATE: Record<string, string[]> = {
  send: ["🚀 Off it goes!", "🎉 Shipped!", "✨ Your team will love it.", "🛸 Delivered at light speed."],
  done: ["", "", "", "🌟 Nice one.", "💪 Progress!", "🧱 Brick by brick."],
  release: ["🎊🎊🎊 Release day! 🎊🎊🎊"],
  continue: ["🧘 Calm, cool, conflict-free."],
};

export function afterCommand(cmd: string, ok: boolean, data: Record<string, unknown>): void {
  if (!ok || ctx.flags.dryRun) return;
  if ((ctx.agent || ctx.flags.json) && !process.env.GITBUDDY_TRACK) return;
  const unlocked = track(cmd, data);
  if (!ctx.fun || ctx.flags.quiet) return;
  const cheers = CELEBRATE[cmd];
  if (cheers) {
    const line = cheers[Math.floor(Math.random() * cheers.length)];
    if (line) ui.line(c.dim(`   ${line}`));
  }
  for (const a of unlocked) {
    ui.line(`\n   ${c.warn("🏅 Achievement unlocked:")} ${a.icon} ${c.bold(a.title)}`);
  }
  if (["show", "done", "list", "history", "get"].includes(cmd) && Math.random() < 0.2) {
    ui.line(c.dim(`\n   💡 ${fmtTip(randomTip())}`));
  }
  updateNotice();
}

interface UpdateInfo {
  checked: string;
  latest?: string;
}

function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

export const UPDATE_URL = "https://raw.githubusercontent.com/muhammad-junaid-iftikhar/git-speak-human/main/package.json";

let inMenu = false;
export const setInMenu = (v: boolean) => (inMenu = v);

function updateNotice(): void {
  if (inMenu || !config().update_check || process.env.GITBUDDY_NO_UPDATE_CHECK) return;
  const file = join(homeDir(), "update.json");
  const info = readJSON<UpdateInfo>(file, { checked: "1970-01-01" });
  if (info.latest && newer(info.latest, VERSION)) {
    ui.line(c.dim(`\n   ✨ gitbuddy ${info.latest} is out (you have ${VERSION}). Get it: `) + c.accent("gitbuddy update"));
  }
  if (Date.now() - new Date(info.checked).getTime() < 86400_000) return;
  writeJSON(file, { ...info, checked: new Date().toISOString() });
  fetch(UPDATE_URL, { signal: AbortSignal.timeout(1500) })
    .then((r) => (r.ok ? r.json() : null))
    .then((pkg: { version?: string } | null) => {
      if (pkg?.version) writeJSON(file, { checked: new Date().toISOString(), latest: pkg.version });
    })
    .catch(() => {});
}
