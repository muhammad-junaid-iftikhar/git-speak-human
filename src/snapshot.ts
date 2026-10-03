import { rmSync } from "node:fs";
import { join } from "node:path";
import { readJSON, writeJSON } from "./config";
import { ctx } from "./context";
import { git, internalEnv, out, tryOut } from "./git";
import { currentBranch, head } from "./repo";
import { readState, readWorkspaces, stateDir, updateState, writeWorkspaces, type WorkspaceMeta } from "./state";

export interface WorkState {
  refs: Record<string, string>;
  meta: Record<string, WorkspaceMeta>;
}

export function captureWork(): WorkState {
  const raw = tryOut(["for-each-ref", "--format=%(refname) %(objectname)", "refs/gitbuddy/work/"]) ?? "";
  const refs: Record<string, string> = {};
  for (const line of raw.split("\n").filter(Boolean)) {
    const [ref, sha] = line.split(" ");
    refs[ref.slice("refs/gitbuddy/work/".length)] = sha;
  }
  return { refs, meta: readWorkspaces() };
}

function restoreWork(w: WorkState): void {
  const current = captureWork().refs;
  for (const [slug, sha] of Object.entries(current)) {
    if (w.refs[slug]) continue;
    git(["update-ref", "--create-reflog", `refs/gitbuddy/trash/${slug}-${Date.now().toString(36)}`, sha], { mutates: true });
    git(["update-ref", "-d", `refs/gitbuddy/work/${slug}`], { mutates: true });
  }
  for (const [slug, sha] of Object.entries(w.refs)) {
    if (current[slug] !== sha) git(["update-ref", "--create-reflog", `refs/gitbuddy/work/${slug}`, sha], { mutates: true });
  }
  if (!ctx.flags.dryRun) writeWorkspaces(w.meta);
}

export interface Captured {
  head: string | null;
  indexTree: string | null;
  workTree: string;
}

export function capture(): Captured {
  const h = head();
  const indexTree = tryOut(["write-tree"]);
  const tmpIndex = join(stateDir(), `index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    if (h) git(["read-tree", h], { env });
    else git(["read-tree", "--empty"], { env });
    git(["add", "-A"], { env });
    const workTree = out(["write-tree"], { env });
    return { head: h, indexTree, workTree };
  } finally {
    rmSync(tmpIndex, { force: true });
  }
}

export function snapshotCommit(label: string, cap = capture()): string {
  const env = internalEnv();
  const parents = cap.head ? ["-p", cap.head] : [];
  const idx = out(["commit-tree", cap.indexTree ?? cap.workTree, ...parents, "-m", `index: ${label}`], { env });
  return out(["commit-tree", cap.workTree, ...parents, "-p", idx, "-m", label], { env });
}

export interface SnapshotParts {
  commit: string;
  base: string | null;
  workTree: string;
  indexTree: string;
}

export function parts(commit: string): SnapshotParts {
  const parents = out(["rev-list", "--parents", "-n1", commit]).split(" ").slice(1);
  const workTree = out(["rev-parse", `${commit}^{tree}`]);
  const idx = parents[parents.length - 1];
  const indexTree = out(["rev-parse", `${idx}^{tree}`]);
  return { commit, base: parents.length >= 2 ? parents[0] : null, workTree, indexTree };
}

export interface JournalEntry {
  id: string;
  time: string;
  action: string;
  label: string;
  branch: string | null;
  head: string | null;
  commit: string;
  active?: string;
  work?: WorkState;
  undone?: boolean;
  redo?: { commit: string; branch: string | null; head: string | null; active?: string; work?: WorkState; batch: string[] };
}

const journalFile = () => join(stateDir(), "journal.json");
export const readJournal = (): JournalEntry[] => readJSON<JournalEntry[]>(journalFile(), []);
const writeJournal = (j: JournalEntry[]) => writeJSON(journalFile(), j);

const KEEP_ENTRIES = 300;
const KEEP_DAYS = 30;

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export function record(action: string, label = action): string | undefined {
  if (ctx.flags.dryRun) return undefined;
  const cap = capture();
  const commit = snapshotCommit(`gitbuddy snapshot: ${label}`, cap);
  const id = newId();
  git(["update-ref", "--create-reflog", `refs/gitbuddy/snapshots/${id}`, commit]);
  let journal = readJournal();
  for (const e of journal) {
    if (e.redo) git(["update-ref", "-d", `refs/gitbuddy/redo/${e.id}`], { allowFail: true });
    if (e.undone) git(["update-ref", "-d", `refs/gitbuddy/snapshots/${e.id}`], { allowFail: true });
  }
  journal = journal.filter((e) => !e.undone).map(({ redo, ...e }) => e);
  journal.push({
    id,
    time: new Date().toISOString(),
    action,
    label,
    branch: currentBranch(),
    head: cap.head,
    commit,
    active: readState().active,
    work: captureWork(),
  });
  writeJournal(prune(journal));
  ctx.snapshotId = id;
  return id;
}

function prune(journal: JournalEntry[]): JournalEntry[] {
  const cutoff = Date.now() - KEEP_DAYS * 86400_000;
  const keep: JournalEntry[] = [];
  journal.forEach((e, i) => {
    const old = new Date(e.time).getTime() < cutoff || i < journal.length - KEEP_ENTRIES;
    if (old) git(["update-ref", "-d", `refs/gitbuddy/snapshots/${e.id}`], { allowFail: true });
    else keep.push(e);
  });
  return keep;
}

export function markUndone(chosen: string, batch: string[], redo: Omit<NonNullable<JournalEntry["redo"]>, "batch">): void {
  const j = readJournal();
  for (const e of j) if (batch.includes(e.id)) e.undone = true;
  const e = j.find((x) => x.id === chosen);
  if (e) {
    e.redo = { ...redo, batch };
    git(["update-ref", `refs/gitbuddy/redo/${chosen}`, redo.commit]);
  }
  writeJournal(j);
}

export function markRedone(chosen: string): void {
  const j = readJournal();
  const e = j.find((x) => x.id === chosen);
  if (e?.redo) {
    for (const x of j) if (e.redo.batch.includes(x.id)) x.undone = false;
    delete e.redo;
    git(["update-ref", "-d", `refs/gitbuddy/redo/${chosen}`], { allowFail: true });
  }
  writeJournal(j);
}

export function cleanTree(): void {
  if (head()) git(["reset", "-q", "--hard", "HEAD"], { mutates: true, quietExplain: true });
  else git(["read-tree", "--empty"], { mutates: true, quietExplain: true });
  git(["clean", "-fdq"], { mutates: true, quietExplain: true });
}

function fillTree(workTree: string, indexTree: string): void {
  git(["read-tree", "--reset", "-u", workTree], { mutates: true, quietExplain: true });
  git(["read-tree", indexTree], { mutates: true, quietExplain: true });
  git(["update-index", "-q", "--refresh"], { allowFail: true, mutates: true, quietExplain: true });
}

export function restoreExact(target: { branch: string | null; head: string | null; commit: string; active?: string; work?: WorkState }): void {
  const p = parts(target.commit);
  if (target.branch && tryOut(["rev-parse", "-q", "--verify", `refs/heads/${target.branch}`])) {
    if (currentBranch() !== target.branch) git(["switch", "-q", "-f", target.branch], { mutates: true });
  } else if (!target.branch && target.head) {
    git(["switch", "-q", "-f", "--detach", target.head], { mutates: true });
  }
  if (target.head) {
    git(["reset", "-q", "--hard", target.head], { mutates: true });
  } else {
    if (head()) git(["update-ref", "-d", "HEAD"], { mutates: true });
    git(["read-tree", "--empty"], { mutates: true });
  }
  git(["clean", "-fdq"], { mutates: true });
  fillTree(p.workTree, p.indexTree);
  if (target.work) restoreWork(target.work);
  if (!ctx.flags.dryRun) updateState((s) => (s.active = target.active));
}

export function applyOnto(commit: string): { conflicts: boolean } {
  const p = parts(commit);
  const current = head();
  if (!p.base || p.base === current) {
    fillTree(p.workTree, p.indexTree);
    return { conflicts: false };
  }
  let r = git(["stash", "apply", "--index", "-q", commit], { allowFail: true, mutates: true });
  if (!r.ok && !/CONFLICT/.test(r.stdout + r.stderr)) {
    cleanTree();
    r = git(["stash", "apply", "-q", commit], { allowFail: true, mutates: true });
  }
  const conflicts = !r.ok;
  if (!conflicts) {
    const wasUntracked = out(["diff", "--name-only", "-z", "--diff-filter=A", p.indexTree, p.workTree]).split("\0").filter(Boolean);
    if (wasUntracked.length && head()) git(["reset", "-q", "--", ...wasUntracked], { mutates: true, allowFail: true });
  }
  return { conflicts };
}

export function changedFiles(commit: string): number {
  const p = parts(commit);
  const from = p.base ?? "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  const names = out(["diff", "--name-only", "-z", from, p.workTree]);
  return names.split("\0").filter(Boolean).length;
}
