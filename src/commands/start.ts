import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ctx } from "../context";
import { EXIT, fail } from "../errors";
import { git, gitAsync } from "../git";
import { define } from "../registry";
import { ensureIdentity, head, mainRemote, remoteUrl, repoRoot } from "../repo";
import { c, ui } from "../ui";

const IGNORE: Record<string, string[]> = {
  common: [".DS_Store", "Thumbs.db", "*.log", ".idea/", ".vscode/*", "!.vscode/extensions.json", "*.swp", ".env", ".env.*", "!.env.example"],
  node: ["node_modules/", "dist/", "build/", "coverage/", ".next/", ".turbo/", "*.tsbuildinfo"],
  python: ["__pycache__/", "*.py[cod]", ".venv/", "venv/", ".pytest_cache/", "*.egg-info/", "dist/", "build/"],
  go: ["/bin/", "*.exe", "*.test", "*.out"],
  rust: ["target/"],
  java: ["target/", "build/", ".gradle/", "*.class"],
  ruby: [".bundle/", "vendor/bundle/", "log/", "tmp/"],
  php: ["vendor/"],
  dotnet: ["bin/", "obj/", "*.user"],
};

function detect(dir: string): string[] {
  const has = (f: string) => existsSync(join(dir, f));
  const files = readdirSync(dir);
  const kinds: string[] = [];
  if (has("package.json") || has("bun.lockb") || has("bun.lock")) kinds.push("node");
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) kinds.push("python");
  if (has("go.mod")) kinds.push("go");
  if (has("Cargo.toml")) kinds.push("rust");
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) kinds.push("java");
  if (has("Gemfile")) kinds.push("ruby");
  if (has("composer.json")) kinds.push("php");
  if (files.some((f) => f.endsWith(".csproj") || f.endsWith(".sln"))) kinds.push("dotnet");
  return kinds;
}

define({
  name: "new",
  aliases: ["init", "create"],
  group: "start",
  summary: "Turn this folder (or a new one) into a git project",
  gitEquivalent: "git init -b main",
  args: [{ name: "folder", description: "A new folder to create (optional)" }],
  options: { save: { type: "boolean", description: "Make the first save right away" } },
  needsRepo: false,
  mutates: true,
  examples: ["gitbuddy new", "gitbuddy new my-app"],
  run({ args, opts }) {
    if (args[0]) {
      const dir = resolve(args[0]);
      if (!ctx.flags.dryRun) mkdirSync(dir, { recursive: true });
      process.chdir(dir);
    }
    const dir = process.cwd();
    const existing = repoRoot();
    if (existing && resolve(existing) === resolve(dir)) {
      ui.say("ok", `This is already a git project. ${c.dim(existing)}`);
      ctx.data = { created: false, path: existing };
      return;
    }
    const r = git(["init", "-q", "-b", "main"], { mutates: true, allowFail: true });
    if (!r.ok) {
      git(["init", "-q"], { mutates: true });
      git(["symbolic-ref", "HEAD", "refs/heads/main"], { mutates: true });
    }
    const kinds = detect(dir);
    const ignorePath = join(dir, ".gitignore");
    let wroteIgnore = false;
    if (!existsSync(ignorePath) && !ctx.flags.dryRun) {
      const lines = [...new Set([...IGNORE.common, ...kinds.flatMap((k) => IGNORE[k])])];
      writeFileSync(ignorePath, `# Files git should never save\n${lines.join("\n")}\n`);
      wroteIgnore = true;
    }
    ui.say("new", c.ok(`New git project in ${c.bold(basename(dir))}`));
    if (wroteIgnore) ui.hint(`Added a .gitignore${kinds.length ? ` for ${kinds.join(", ")}` : ""} so junk and secrets stay out.`);
    const hasFiles = readdirSync(dir).some((f) => f !== ".git" && f !== ".gitignore");
    let saved = false;
    if (hasFiles && (opts.save || (ctx.interactive && ui.confirm("Make the first save of everything here now?", { default: true })))) {
      ensureIdentity();
      git(["add", "-A"], { mutates: true });
      git(["commit", "-q", "-m", "First save"], { mutates: true });
      saved = true;
      ui.say("save", "Made your first save.");
    }
    ctx.data = { created: true, path: dir, detected: kinds, gitignore: wroteIgnore, firstSave: saved };
    if (!saved) ui.next('gitbuddy done "First save"', "save what's here");
    ui.next("gitbuddy connect --github", "put it on GitHub");
  },
});

function expandUrl(raw: string): string {
  if (/^[\w.-]+\/[\w.-]+$/.test(raw) && !existsSync(raw)) return `https://github.com/${raw}.git`;
  return raw;
}

define({
  name: "copy",
  aliases: ["clone", "download-project"],
  group: "start",
  summary: "Download a project from GitHub/GitLab to your computer",
  gitEquivalent: "git clone <url>",
  args: [
    { name: "url", description: "The project's address (or owner/name for GitHub)", required: true },
    { name: "folder", description: "Folder name to put it in" },
  ],
  needsRepo: false,
  mutates: true,
  network: true,
  examples: ["gitbuddy copy https://github.com/owner/repo", "gitbuddy copy owner/repo my-folder"],
  async run({ args }) {
    const url = expandUrl(args[0]);
    const folder = args[1] ?? basename(url).replace(/\.git$/, "");
    if (existsSync(folder) && readdirSync(folder).length) fail(`The folder "${folder}" already exists and isn't empty.`, { hint: `Pick another name: gitbuddy copy ${args[0]} another-name` });
    await ui.spin(`${c.accent("Downloading")} ${url}…`, () => gitAsync(["clone", "-q", url, folder], { mutates: true }));
    ui.say("get", c.ok(`Copied into ${c.bold(folder)}`));
    ui.next(`cd ${folder}`, "jump in");
    ctx.data = { url, folder: resolve(folder) };
  },
});

define({
  name: "connect",
  aliases: ["remote", "link"],
  group: "start",
  summary: "Connect this project to GitHub/GitLab (or create a new GitHub repo)",
  gitEquivalent: "git remote add origin <url>",
  args: [{ name: "url", description: "The remote address (leave out with --github)" }],
  options: {
    github: { type: "boolean", description: "Create a new GitHub repo with the gh tool" },
    name: { type: "string", description: "Repo name for --github (defaults to the folder name)" },
    public: { type: "boolean", description: "Make the new GitHub repo public (default: private)" },
  },
  mutates: true,
  network: true,
  examples: ["gitbuddy connect git@github.com:me/app.git", "gitbuddy connect --github", "gitbuddy connect --github --public"],
  run({ args, opts }) {
    const root = repoRoot()!;
    if (opts.github) {
      const gh = Bun.which("gh");
      if (!gh) fail("The GitHub tool (gh) isn't installed.", { exit: EXIT.SETUP, code: "gh_missing", hint: "Install it from https://cli.github.com, run gh auth login, then try again." });
      const name = String(opts.name ?? basename(root));
      const visibility = opts.public ? "--public" : "--private";
      const cmd = ["repo", "create", name, visibility, "--source", root, "--remote", "origin", ...(head() ? ["--push"] : [])];
      if (ctx.flags.dryRun) {
        ui.explain(`gh ${cmd.join(" ")}`, true);
        return;
      }
      const p = Bun.spawnSync([gh!, ...cmd], { cwd: root, stdout: "pipe", stderr: "pipe" });
      if (p.exitCode !== 0) fail("GitHub said no.", { code: "gh_failed", details: p.stderr.toString(), hint: p.stderr.toString().trim().split("\n")[0] });
      const url = remoteUrl("origin");
      ui.say("share", c.ok(`Created ${opts.public ? "public" : "private"} GitHub repo ${c.bold(name)}`));
      ui.hint(p.stdout.toString().trim().split("\n").pop() ?? "");
      ctx.data = { remote: "origin", url, created: true, pushed: Boolean(head()) };
      return;
    }
    const url = args[0] ? expandUrl(args[0]) : "";
    if (!url) fail("Tell me where to connect, or use --github to create a new repo.", { hint: "Example: gitbuddy connect git@github.com:me/app.git" });
    const existing = mainRemote();
    if (existing) {
      const now = remoteUrl(existing);
      if (now === url) {
        ui.say("ok", `Already connected to ${url}`);
        ctx.data = { remote: existing, url, changed: false };
        return;
      }
      if (!ui.confirm(`Change ${existing} from ${now} to ${url}?`, { default: true })) return;
      git(["remote", "set-url", existing, url], { mutates: true });
    } else git(["remote", "add", "origin", url], { mutates: true });
    ui.say("share", c.ok(`Connected to ${url}`));
    ctx.data = { remote: existing ?? "origin", url, changed: true };
    if (head()) ui.next("gitbuddy send", "upload your saves");
  },
});

