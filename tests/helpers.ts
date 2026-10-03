import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
  json: any;
}

export class Sandbox {
  root: string;
  home: string;
  env: Record<string, string>;
  cwd: string;

  constructor() {
    this.root = mkdtempSync(join(tmpdir(), "gitbuddy-test-"));
    this.home = join(this.root, "home");
    mkdirSync(this.home, { recursive: true });
    const gitconfig = join(this.root, "gitconfig");
    writeFileSync(gitconfig, "[user]\n\tname = Tess Ter\n\temail = tess@example.com\n[init]\n\tdefaultBranch = main\n");
    this.env = {
      ...(process.env as Record<string, string>),
      GITBUDDY_HOME: this.home,
      GIT_CONFIG_GLOBAL: gitconfig,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_PAGER: "cat",
      GITBUDDY_AGENT: "1",
      NO_COLOR: "1",
    };
    this.cwd = join(this.root, "repo");
    mkdirSync(this.cwd);
  }

  git(...args: string[]): string {
    const p = Bun.spawnSync(["git", ...args], { cwd: this.cwd, env: this.env, stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${p.stderr}`);
    return p.stdout.toString().trim();
  }

  run(...args: string[]): Run {
    const p = Bun.spawnSync(["bun", CLI, ...args, "--json"], { cwd: this.cwd, env: this.env, stdout: "pipe", stderr: "pipe" });
    const stdout = p.stdout.toString();
    let json: any = null;
    try {
      json = JSON.parse(stdout);
    } catch {
      json = null;
    }
    return { code: p.exitCode ?? 1, stdout, stderr: p.stderr.toString(), json };
  }

  human(...args: string[]): Run {
    const p = Bun.spawnSync(["bun", CLI, ...args], { cwd: this.cwd, env: this.env, stdout: "pipe", stderr: "pipe" });
    return { code: p.exitCode ?? 1, stdout: p.stdout.toString(), stderr: p.stderr.toString(), json: null };
  }

  write(path: string, content: string): void {
    const abs = join(this.cwd, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  read(path: string): string {
    return readFileSync(join(this.cwd, path), "utf-8");
  }

  exists(path: string): boolean {
    return existsSync(join(this.cwd, path));
  }

  init(): this {
    this.git("init", "-q");
    this.write("readme.md", "hello\n");
    this.git("add", "-A");
    this.git("commit", "-q", "-m", "start");
    return this;
  }

  withRemote(): string {
    const bare = join(this.root, "remote.git");
    Bun.spawnSync(["git", "init", "-q", "--bare", "-b", "main", bare], { env: this.env });
    this.git("remote", "add", "origin", bare);
    this.git("push", "-q", "-u", "origin", "main");
    return bare;
  }

  clone(bare: string): Sandbox {
    const other = new Sandbox();
    other.env = { ...this.env, GITBUDDY_HOME: other.home };
    Bun.spawnSync(["git", "clone", "-q", bare, other.cwd], { env: other.env });
    return other;
  }
}
