import { basename } from "node:path";
import { config } from "./config";
import { git } from "./git";
import { head, type FileChange } from "./repo";

function names(files: FileChange[]): string {
  const list = files.map((f) => basename(f.path));
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`;
}

export function heuristicMessage(files: FileChange[]): string {
  if (!files.length) return "Update";
  const added = files.filter((f) => f.kind === "new");
  const deleted = files.filter((f) => f.kind === "deleted");
  const renamed = files.filter((f) => f.kind === "renamed");
  const changed = files.filter((f) => f.kind === "changed" || f.kind === "conflict");
  const parts: string[] = [];
  if (added.length) parts.push(`add ${names(added)}`);
  if (changed.length) parts.push(`update ${names(changed)}`);
  if (deleted.length) parts.push(`remove ${names(deleted)}`);
  if (renamed.length) parts.push(`rename ${names(renamed)}`);
  const text = parts.length > 2 ? `Update ${files.length} files` : parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function aiMessage(files: FileChange[]): string | null {
  const cmd = process.env.GITBUDDY_AI_COMMAND || config().ai_command;
  if (!cmd) return null;
  const diff = head() ? git(["diff", "HEAD", "--stat", "--patch", "--no-ext-diff"], { allowFail: true }).stdout : "";
  const untracked = files.filter((f) => f.kind === "new").map((f) => `new file: ${f.path}`).join("\n");
  const input =
    "Write one short git commit message (max 72 chars, imperative mood, no quotes) for these changes:\n\n" +
    `${untracked}\n${diff}`.slice(0, 60_000);
  try {
    const shell = process.platform === "win32" ? ["cmd", "/c", cmd] : ["sh", "-c", cmd];
    const p = Bun.spawnSync(shell, { stdin: new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) return null;
    const line = (p.stdout?.toString() ?? "").split("\n").map((l) => l.trim().replace(/^["'`]|["'`]$/g, "")).find(Boolean);
    return line ? line.slice(0, 100) : null;
  } catch {
    return null;
  }
}

export function suggestMessage(files: FileChange[]): string {
  return aiMessage(files) ?? heuristicMessage(files);
}
