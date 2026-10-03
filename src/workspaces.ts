import { config } from "./config";
import { ctx } from "./context";
import { fail } from "./errors";
import { git, tryOut } from "./git";
import { slugify } from "./repo";
import { applyOnto, cleanTree, snapshotCommit } from "./snapshot";
import { readState, readWorkspaces, updateState, writeWorkspaces, type WorkspaceMeta } from "./state";

export const WORK_REF = "refs/gitbuddy/work/";
export const ARCHIVE_REF = "refs/gitbuddy/archive/";
export const TRASH_REF = "refs/gitbuddy/trash/";

export interface Workspace extends WorkspaceMeta {
  slug: string;
  commit: string;
  active: boolean;
}

export function listWorkspaces(): Workspace[] {
  const meta = readWorkspaces();
  const active = readState().active;
  const refs = tryOut(["for-each-ref", "--format=%(refname)%09%(objectname)%09%(committerdate:iso-strict)", WORK_REF]) ?? "";
  return refs
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, commit, date] = line.split("\t");
      const slug = ref.slice(WORK_REF.length);
      const m = meta[slug] ?? { name: slug, created: date, updated: date };
      return { ...m, slug, commit, active: slug === active };
    })
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

export function findWorkspace(query: string): Workspace | null {
  const all = listWorkspaces();
  const q = query.trim().toLowerCase();
  return all.find((w) => w.slug === slugify(query) || w.name.toLowerCase() === q) ?? null;
}

export function suggestWorkspaces(query: string): Workspace[] {
  const q = slugify(query);
  return listWorkspaces().filter((w) => w.slug.includes(q) || q.includes(w.slug));
}

export function requireWorkspace(query: string): Workspace {
  const w = findWorkspace(query);
  if (w) return w;
  const close = suggestWorkspaces(query);
  return fail(`You don't have a workspace called "${query}".`, {
    code: "no_such_workspace",
    hint: close.length ? `Did you mean: ${close.map((c) => c.name).join(", ")}?` : "See them all with: gitbuddy list",
  });
}

export function saveWorkspace(slug: string, name?: string): string | undefined {
  if (ctx.flags.dryRun) return undefined;
  const meta = readWorkspaces();
  const now = new Date().toISOString();
  const entry = meta[slug] ?? { name: name ?? slug, created: now, updated: now };
  entry.updated = now;
  if (name) entry.name = name;
  meta[slug] = entry;
  const commit = snapshotCommit(`gitbuddy work: ${entry.name}`);
  git(["update-ref", "--create-reflog", `${WORK_REF}${slug}`, commit]);
  writeWorkspaces(meta);
  updateState((s) => (s.lastAutosave = now));
  return commit;
}

export function activeWorkspace(): Workspace | null {
  const slug = readState().active;
  if (!slug) return null;
  return listWorkspaces().find((w) => w.slug === slug) ?? null;
}

export function setActive(slug: string | undefined): void {
  if (!ctx.flags.dryRun) updateState((s) => (s.active = slug));
}

export function uniqueSlug(name: string): string {
  const base = slugify(name);
  const taken = new Set(listWorkspaces().map((w) => w.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function moveWorkspaceRef(slug: string, toPrefix: string): string {
  const w = listWorkspaces().find((x) => x.slug === slug);
  if (!w) return "";
  const target = toPrefix === TRASH_REF ? `${toPrefix}${slug}-${Date.now().toString(36)}` : `${toPrefix}${slug}`;
  git(["update-ref", "--create-reflog", target, w.commit], { mutates: true });
  git(["update-ref", "-d", `${WORK_REF}${slug}`], { mutates: true });
  if (!ctx.flags.dryRun) {
    const meta = readWorkspaces();
    delete meta[slug];
    writeWorkspaces(meta);
    if (readState().active === slug) setActive(undefined);
  }
  return target;
}

export function enterWorkspace(target: Workspace): { conflicts: boolean } {
  cleanTree();
  const r = applyOnto(target.commit);
  setActive(target.slug);
  return r;
}

export function maybeAutosave(): void {
  const minutes = config().autosave_minutes;
  if (!minutes || ctx.flags.dryRun) return;
  const s = readState();
  if (!s.active) return;
  const last = s.lastAutosave ? new Date(s.lastAutosave).getTime() : 0;
  if (Date.now() - last > minutes * 60_000) saveWorkspace(s.active);
}
