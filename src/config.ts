import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function homeDir(): string {
  if (process.env.GITBUDDY_HOME) return process.env.GITBUDDY_HOME;
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "gitbuddy");
}

export function readJSON<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, file);
}

export interface Config {
  theme: string;
  fun: boolean;
  emoji: boolean;
  ai_command: string;
  autosave_minutes: number;
  update_check: boolean;
}

export const DEFAULT_CONFIG: Config = {
  theme: "classic",
  fun: true,
  emoji: true,
  ai_command: "",
  autosave_minutes: 0,
  update_check: true,
};

let cached: Config | null = null;

export function config(): Config {
  if (!cached) {
    cached = { ...DEFAULT_CONFIG, ...readJSON<Partial<Config>>(join(homeDir(), "config.json"), {}) };
  }
  return cached;
}

export function setConfig(key: keyof Config, raw: string): Config {
  const current = config();
  const def = DEFAULT_CONFIG[key];
  let value: unknown = raw;
  if (typeof def === "boolean") value = ["1", "true", "yes", "on"].includes(raw.toLowerCase());
  if (typeof def === "number") value = Number(raw) || 0;
  const next = { ...current, [key]: value } as Config;
  writeJSON(join(homeDir(), "config.json"), next);
  cached = next;
  return next;
}

export function resetConfigCache(): void {
  cached = null;
}
