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
    name: "start",
    aliases: ["begin", "new", "branch"],
    description: "Start a new piece of work",
    run: (args) => {
      const name = args.join("-") || "feature";
      console.log(`🌱 Starting: ${name}`);
      run(`git checkout -b ${name}`);
      console.log(`✅ You're now working on: ${name}`);
    },
  },
  {
    name: "switch",
    aliases: ["go", "move", "checkout"],
    description: "Switch to another piece of work",
    run: (args) => {
      const branch = args.join("-");
      if (!branch) {
        console.log("📋 Your work branches:");
        console.log(run("git branch -a"));
        return;
      }
      console.log(`🔄 Switching to ${branch}...`);
      run(`git checkout ${branch}`);
      console.log(`✅ You're now on: ${branch}`);
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
    name: "help",
    aliases: ["h", "-h", "--help"],
    description: "Show this help message",
    run: () => {
      console.log(`
🎤 buddy
Git for humans. Just talk to your buddy.

Usage: buddy <command> [args]

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
  buddy done "I added a button"
  buddy send
  buddy get
  buddy show
  buddy start dark-mode
  buddy switch main
  buddy oops
  buddy what-happened
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
    console.log(`Run 'speak help' to see available commands.`);
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
