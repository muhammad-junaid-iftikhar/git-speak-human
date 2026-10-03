import { afterCommand, fmtTip, headerLine, randomTip, readProfile, setInMenu } from "./fun";
import { tryOut } from "./git";
import { execute, hooks } from "./main";
import { operation, repoRoot, status } from "./repo";
import { readState } from "./state";
import { theme } from "./theme";
import { c, plural, ui } from "./ui";
import { setupProfile, splitArgs } from "./commands/you";
import { activeWorkspace, listWorkspaces } from "./workspaces";

interface Choice {
  icon: string;
  label: string;
  argv: () => string[] | null;
}

function ask(question: string): string | null {
  const answer = prompt(`   ${question} ${c.dim("›")}`);
  return answer === null || !answer.trim() ? null : answer.trim();
}

function asking(question: string, build: (answer: string) => string[], optional = false): () => string[] | null {
  return () => {
    const answer = ask(question);
    if (!answer) return optional ? build("") : null;
    return build(answer);
  };
}

function choices(): { summary: string; items: Choice[] } {
  if (!repoRoot()) {
    return {
      summary: c.dim("This folder isn't a git project yet."),
      items: [
        { icon: "🌱", label: "Make this folder a git project", argv: () => ["new"] },
        { icon: "📥", label: "Download a project from GitHub", argv: asking("Project address (or owner/name)", (a) => ["copy", a]) },
        { icon: "🎓", label: "Learn gitbuddy in 5 minutes", argv: () => ["learn"] },
        { icon: "👤", label: "My profile", argv: () => ["me"] },
        { icon: "❓", label: "See all commands", argv: () => ["help"] },
      ],
    };
  }
  const st = status();
  const ws = activeWorkspace();
  const others = listWorkspaces().filter((w) => !w.active);
  const away = readState().away;
  const op = operation();
  const parts = [st.branch ? `📍 ${c.bold(st.branch)}` : c.warn("📍 looking at an old save")];
  if (ws) parts.push(`🧩 ${c.accent(ws.name)}`);
  if (st.files.length) parts.push(c.warn(plural(st.files.length, "unsaved change")));
  if (st.ahead) parts.push(`${plural(st.ahead, "save")} to send`);
  if (st.behind) parts.push(`${plural(st.behind, "new save")} from team`);
  if (!st.files.length && !st.ahead && !st.behind) parts.push(c.ok("all saved ✨"));
  const items: Choice[] = [];
  if (away) items.push({ icon: "🕰️", label: `Come back (${away.label})`, argv: () => ["back"] });
  if (st.conflicted.length || op) {
    items.push({ icon: "🤝", label: "Sort out clashing changes", argv: () => ["conflicts"] });
    items.push({ icon: "🛑", label: "Cancel and go back to before", argv: () => ["abort"] });
  }
  if (st.files.length && !st.conflicted.length) {
    items.push({ icon: "💾", label: "Save my changes for good", argv: asking(`What did you do? ${c.dim("(empty = I'll suggest)")}`, (a) => (a ? ["done", a] : ["done"]), true) });
    items.push({ icon: "👀", label: "See what I changed", argv: () => ["diff"] });
    items.push({ icon: "📌", label: "Keep a checkpoint (not permanent)", argv: () => ["save"] });
  }
  if (st.ahead) items.push({ icon: "📤", label: "Send my saves to the team", argv: () => ["send"] });
  if (st.behind || tryOut(["remote"])) items.push({ icon: "📥", label: "Get the team's latest work", argv: () => ["get"] });
  items.push({ icon: "🧩", label: "Start something new", argv: asking("What are you working on?", (a) => ["work", a]) });
  if (others.length) items.push({ icon: "🔄", label: `Switch to another task (${others.length})`, argv: () => ["switch"] });
  items.push({ icon: "📜", label: "What happened recently", argv: () => ["history"] });
  items.push({ icon: "⏪", label: "Undo the last thing", argv: () => ["undo"] });
  items.push({ icon: "👤", label: "My profile & achievements", argv: () => ["me"] });
  items.push({ icon: "❓", label: "Everything else", argv: () => ["help"] });
  return { summary: parts.join(c.dim("  ·  ")), items };
}

async function menu(): Promise<void> {
  setInMenu(true);
  if (!readProfile()) setupProfile();
  ui.line(headerLine());
  ui.line(c.dim(`   💡 ${fmtTip(randomTip())}`));
  for (;;) {
    ui.blank();
    const { summary, items } = choices();
    ui.line(`   ${summary}`);
    ui.blank();
    items.forEach((it, i) => ui.line(`   ${c.accent(String(i + 1).padStart(2))}  ${it.icon} ${it.label}`));
    ui.line(c.dim(`\n   Pick a number, type any command (like "history" or "find TODO"), or q to quit.`));
    const input = prompt(`${readProfile()?.avatar ?? theme().mascot} ${c.accent(theme().prompt)}`);
    if (input === null || /^(q|quit|exit|bye)$/i.test(input.trim())) {
      ui.line(c.dim(`   ${["See you later! 👋", "Happy shipping! 🚀", "Bye! Your work is safe with me. 🔒"][Math.floor(Math.random() * 3)]}`));
      return;
    }
    const text = input.trim();
    if (!text) continue;
    let argv: string[] | null;
    const n = Number(text);
    if (Number.isInteger(n) && n >= 1 && n <= items.length) argv = items[n - 1].argv();
    else argv = splitArgs(text.replace(/^gitbuddy\s+/, ""));
    if (!argv) continue;
    ui.blank();
    await execute(argv);
  }
}

hooks.noCommand = menu;

hooks.after.push((def, result) => afterCommand(def.name, result.ok, result.data));

