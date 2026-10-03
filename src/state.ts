import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { readJSON, writeJSON } from "./config";
import { gitDir } from "./repo";

export function stateDir(): string {
  const dir = join(gitDir(), "gitbuddy");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface Away {
  kind: "time-travel" | "review" | "try";
  returnTo: string;
  returnDetached: boolean;
  tuckedRef?: string;
  tempBranch?: string;
  label: string;
}

export interface RepoState {
  active?: string;
  away?: Away;
  lastAutosave?: string;
  tryFolders?: string[];
}

export interface WorkspaceMeta {
  name: string;
  created: string;
  updated: string;
}

export const readState = (): RepoState => readJSON<RepoState>(join(stateDir(), "state.json"), {});
export const writeState = (s: RepoState) => writeJSON(join(stateDir(), "state.json"), s);
export function updateState(patch: (s: RepoState) => void): RepoState {
  const s = readState();
  patch(s);
  writeState(s);
  return s;
}

export const readWorkspaces = (): Record<string, WorkspaceMeta> =>
  readJSON<Record<string, WorkspaceMeta>>(join(stateDir(), "workspaces.json"), {});
export const writeWorkspaces = (w: Record<string, WorkspaceMeta>) => writeJSON(join(stateDir(), "workspaces.json"), w);
