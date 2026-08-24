#!/usr/bin/env node
// Adapted from Leonxlnx/unlazy v2 install-hooks.mjs.
// Upstream revision: ed9e8d2b5919698cf2c54bda270d507e10b69617
// MIT License preserved in ../LICENSE.unlazy.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const uninstall = args.includes("--uninstall");
const globalTarget = args.includes("--global");
const shared = args.includes("--shared");
const known = new Set(["--uninstall", "--global", "--shared"]);
for (const arg of args) {
  if (!known.has(arg)) {
    console.error(`Unknown option: ${arg}`);
    process.exit(2);
  }
}
if (globalTarget && shared) {
  console.error("--global and --shared are mutually exclusive");
  process.exit(2);
}

const ownPath = fileURLToPath(import.meta.url);
const hookScript = join(dirname(ownPath), "stop-hook.mjs");
const marker = "proof-of-life";
const target = globalTarget
  ? join(homedir(), ".claude", "settings.json")
  : join(process.cwd(), ".claude", shared ? "settings.json" : "settings.local.json");

let settings = {};
if (existsSync(target)) {
  try {
    settings = JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    console.error(`Refusing to touch ${target}: invalid JSON (${error.message}).`);
    process.exit(1);
  }
}

settings.hooks ||= {};
const stopHooks = Array.isArray(settings.hooks.Stop) ? settings.hooks.Stop : [];
const isOurs = (entry) => Array.isArray(entry?.hooks) && entry.hooks.some(
  (hook) => typeof hook?.command === "string" && hook.command.includes("stop-hook.mjs") && hook.command.toLowerCase().includes(marker),
);
const kept = stopHooks.filter((entry) => !isOurs(entry));

if (uninstall) {
  if (kept.length === stopHooks.length) {
    console.log(`Nothing to remove: no Proof of Life Stop hook found in ${target}`);
    process.exit(0);
  }
  settings.hooks.Stop = kept;
  if (!settings.hooks.Stop.length) delete settings.hooks.Stop;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  writeFileSync(target, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`Removed Proof of Life Stop hook from ${target}`);
  process.exit(0);
}

if (stopHooks.some(isOurs)) {
  console.log(`Already installed in ${target}`);
  process.exit(0);
}

const entry = {
  hooks: [{
    type: "command",
    command: `node "${hookScript}"`,
    timeout: 20,
  }],
};
settings.hooks.Stop = [...kept, entry];
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(settings, null, 2)}\n`);

console.log(`Installed Proof of Life Stop hook into ${target}
  command: node "${hookScript}"
  effect: blocks exit while actionable plan work or unmet gates remain
  handover: allows exit when no action remains and root success is impossible
  remove: node "${ownPath}"${globalTarget ? " --global" : shared ? " --shared" : ""} --uninstall
  note: add .proof-of-life/ to .gitignore`);
