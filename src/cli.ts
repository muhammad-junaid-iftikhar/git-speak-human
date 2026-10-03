#!/usr/bin/env bun

import { execSync } from "child_process";
import { parseArgs } from "util";

const VERSION = "0.0.1";

interface Command {
  name: string;
  aliases: string[];
  description: string;
  run: (args: string[]) => void;
}

const run = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: "utf-8" }).trim();
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
};

const commands: Command[] = [
  {
    name: "done",
    aliases: ["save", "s", "commit"],
    description: "Save your work with a message",
    run: (args) => {
      const message = args.join(" ") || "Update";
      console.log(`💾 Done: "${message}"`);
      run("git add .");
      run(`git commit -m "${message}"`);
      console.log("✅ Work saved!");
    },
  },
  {
    name: "send",
    aliases: ["push", "p"],
    description: "Send your work to the team",
    run: () => {
      console.log("📤 Sending to team...");
      const branch = run("git rev-parse --abbrev-ref HEAD");
      run(`git push origin ${branch}`);
      console.log("✅ Sent!");
    },
  },
  {
    name: "get",
    aliases: ["pull", "update"],
    description: "Get the latest work from the team",
    run: () => {
      console.log("📥 Getting latest...");
      run("git pull origin");
      console.log("✅ You're up to date!");
    },
  },
  {
    name: "show",
    aliases: ["status", "st", "check"],
    description: "Show what you changed",
    run: () => {
      const status = run("git status --short");
      if (!status) {
        console.log("✨ Everything is clean!");
        return;
      }
      console.log("\n📝 Your changes:");
      console.log(status);
      console.log();
    },
  },
  {
    name: "oops",
    aliases: ["undo", "revert"],
    description: "Undo your last action",
    run: () => {
      console.log("⏮️  Undoing last action...");
      run("git reset --soft HEAD~1");
      console.log("✅ Undone (your changes are still here)");
    },
  },
  {
    name: "what-happened",
    aliases: ["history", "log", "timeline"],
    description: "See what everyone did recently",
    run: () => {
      const log = run("git log --oneline -10");
      console.log("\n📜 Recent work:");
      console.log(log);
      console.log();
    },
  },
  {
    name: "work",
    aliases: ["start-work", "create"],
    description: "Start a new piece of work (saves current work automatically)",
    run: (args) => {
      const workName = args.join(" ");
      if (!workName) {
        console.log("❌ Give your work a name: gitbuddywork \"feature name\"");
        return;
      }

      const currentStatus = run("git status --short");
      if (currentStatus) {
        const timestamp = new Date().toLocaleString();
        console.log(`💾 Saving current work with timestamp...`);
        run("git add .");
        run(`git stash push -m "WORK: ${workName} [${timestamp}]"`);
      }

      console.log(`✨ Starting new work: "${workName}"`);
      console.log(`You're on main, ready to work on: ${workName}`);
    },
  },
  {
    name: "save",
    aliases: ["checkpoint", "progress"],
    description: "Save your progress (without committing to main)",
    run: () => {
      console.log(`💾 Saving progress...`);
      run("git add .");
      const timestamp = new Date().toLocaleString();
      run(`git stash push -m "CHECKPOINT [${timestamp}]"`);
      console.log("✅ Progress saved! Pull latest with 'gitbuddyget' if needed.");
    },
  },
  {
    name: "my-work",
    aliases: ["work-list", "list-work", "tasks"],
    description: "See all your work items with timestamps",
    run: () => {
      const stashes = run("git stash list");
      if (!stashes) {
        console.log("📭 No work saved yet! Start with: gitbuddywork \"something\"");
        return;
      }
      console.log("\n📋 Your work items:");
      const lines = stashes.split("\n").filter((l) => l.includes("WORK:"));
      if (lines.length === 0) {
        console.log("   No named work items yet");
        console.log("\n   Use: gitbuddywork \"feature name\"");
        return;
      }
      lines.forEach((line) => {
        console.log(`   ${line}`);
      });
      console.log();
    },
  },
  {
    name: "switch",
    aliases: ["switch-to", "go", "switch-work"],
    description: "Switch to another piece of work (saves current automatically)",
    run: (args) => {
      const workNamePattern = args.join(" ");
      if (!workNamePattern) {
        console.log("📋 Your work items:");
        run("git stash list");
        return;
      }

      const currentStatus = run("git status --short");
      if (currentStatus) {
        const timestamp = new Date().toLocaleString();
        console.log(`💾 Saving current work...`);
        run("git add .");
        run(`git stash push -m "WORK: auto-save [${timestamp}]"`);
      }

      console.log(`🔄 Switching to: ${workNamePattern}...`);
      const stashes = run("git stash list");
      const matching = stashes
        .split("\n")
        .find((s) => s.includes(workNamePattern));

      if (!matching) {
        console.log(`❌ No work found with: "${workNamePattern}"`);
        console.log("Use 'gitbuddymy-work' to see available work");
        return;
      }

      const stashIndex = stashes.split("\n").indexOf(matching);
      run(`git stash pop stash@{${stashIndex}}`);
      console.log(`✅ You're now on: ${workNamePattern}`);
    },
  },
  {
    name: "help",
    aliases: ["h", "-h", "--help"],
    description: "Show this help message",
    run: () => {
      console.log(`
🎤 gitbuddy
Git for humans. Just talk to your buddy.

Usage: gitbuddy <command> [args]

Commands:
`);
      commands.forEach((cmd) => {
        const aliases = cmd.aliases.length
          ? ` (${cmd.aliases.join(", ")})`
          : "";
        console.log(`  ${cmd.name.padEnd(14)} ${aliases.padEnd(25)} ${cmd.description}`);
      });
      console.log(`
Examples:
  gitbuddywork "dark-mode feature"
  gitbuddysave
  gitbuddywork "fix-button"
  gitbuddymy-work
  gitbuddyswitch "dark-mode"
  gitbuddydone "ready to merge"
  gitbuddysend
  gitbuddyget
  gitbuddyshow
  gitbuddyoops
  gitbuddywhat-happened
`);
    },
  },
];

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    const helpCmd = commands.find((c) => c.name === "help");
    helpCmd?.run([]);
    return;
  }

  const commandName = args[0].toLowerCase();
  const commandArgs = args.slice(1);

  const command = commands.find(
    (cmd) => cmd.name === commandName || cmd.aliases.includes(commandName)
  );

  if (!command) {
    console.log(`❌ Unknown command: ${commandName}`);
    console.log(`Run 'gitbuddy help' to see available commands.`);
    process.exit(1);
  }

  try {
    command.run(commandArgs);
  } catch (error) {
    console.error(`❌ Something went wrong: ${error}`);
    process.exit(1);
  }
}

main();
