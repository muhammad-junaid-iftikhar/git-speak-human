#!/usr/bin/env bun
import "./commands";
import { ctx } from "./context";
import { execute } from "./main";

const result = await execute(process.argv.slice(2));
if (ctx.flags.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
process.exitCode = result.exit_code;
