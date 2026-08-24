#!/usr/bin/env node
// Adapted from Leonxlnx/unlazy v2 stop-hook.mjs.
// Upstream revision: ed9e8d2b5919698cf2c54bda270d507e10b69617
// MIT License preserved in ../LICENSE.unlazy.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BLOCKS = 6;
const GATE_RE = /^- \[( |x|X)\] (.*)$/;
const EVIDENCE_RE = /^\s+EVIDENCE:\s?(.*)$/;
const ABANDON_RE = /^ABANDON:\s*(\S+)/;

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "{}";
  }
}

function gateFiles(dir) {
  const files = [];
  const top = join(dir, "GATES.md");
  if (existsSync(top)) files.push(top);
  const gatesDir = join(dir, "gates");
  if (existsSync(gatesDir)) {
    for (const file of readdirSync(gatesDir).sort()) {
      if (file.endsWith(".md")) files.push(join(gatesDir, file));
    }
  }
  return files;
}

function unmetGates(files) {
  const unmet = [];
  let combined = "";
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    combined += text;
    const lines = text.split(/\r?\n/);
    const abandoned = new Set(
      lines
        .map((line) => (line.match(ABANDON_RE) || [])[1])
        .filter(Boolean)
        .map((id) => id.replace(/:$/, "")),
    );
    let current = null;
    const flush = () => {
      if (!current || abandoned.has(current.id)) {
        current = null;
        return;
      }
      const pending = current.evidence === null || /^pending$/i.test(current.evidence);
      if (!current.checked || pending) unmet.push(current.id);
      current = null;
    };
    for (const line of lines) {
      const gate = line.match(GATE_RE);
      if (gate) {
        flush();
        current = {
          checked: gate[1].toLowerCase() === "x",
          id: (gate[2].match(/^(\S+?):/) || [null, gate[2].trim().slice(0, 24)])[1],
          evidence: null,
        };
        continue;
      }
      const evidence = current && line.match(EVIDENCE_RE);
      if (evidence) current.evidence = evidence[1].trim();
    }
    flush();
  }
  return { unmet, combined };
}

function planStatus(cwd) {
  const planPath = join(cwd, "PLAN.json");
  if (!existsSync(planPath)) return { present: false, status: 0, output: "" };
  const planScript = join(dirname(fileURLToPath(import.meta.url)), "plan.mjs");
  const result = spawnSync(process.execPath, [planScript, "status", planPath], {
    cwd,
    encoding: "utf8",
  });
  return {
    present: true,
    status: result.status ?? 2,
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

let payload = {};
try {
  payload = JSON.parse(readStdin() || "{}");
} catch {
  payload = {};
}
const cwd = payload.cwd || process.cwd();
const files = gateFiles(cwd);
const plan = planStatus(cwd);

if (!files.length && !plan.present) process.exit(0);

if (plan.present && plan.status === 3) {
  console.log(JSON.stringify({
    systemMessage: "proof-of-life: terminal non-success handover; no actionable leaves remain. Report failed, abandoned, and blocked outcomes without claiming completion.",
  }));
  process.exit(0);
}


const gates = unmetGates(files);
const planActionable = plan.present && plan.status === 1;
const planInvalid = plan.present && plan.status === 2;
if (!gates.unmet.length && !planActionable && !planInvalid) process.exit(0);

const stateDir = join(cwd, ".proof-of-life");
const statePath = join(stateDir, "hook-state.json");
const hash = createHash("sha256")
  .update(gates.combined)
  .update(plan.output)
  .digest("hex")
  .slice(0, 16);
let state = { hash: "", blocks: 0 };
try {
  state = JSON.parse(readFileSync(statePath, "utf8"));
} catch {
  state = { hash: "", blocks: 0 };
}
if (state.hash !== hash) state = { hash, blocks: 0 };
state.blocks += 1;
try {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state)}\n`);
} catch {
  // Hook state is advisory. Gate and plan state remain authoritative.
}

if (state.blocks > MAX_BLOCKS) {
  console.log(JSON.stringify({
    systemMessage: `proof-of-life: releasing after ${MAX_BLOCKS} stops without progress; ${gates.unmet.length} gates remain unmet, actionable plan state is ${planActionable}, and invalid plan state is ${planInvalid}.`,
  }));
  process.exit(0);
}

const gateList = gates.unmet.slice(0, 5).join(", ") + (gates.unmet.length > 5 ? `, +${gates.unmet.length - 5} more` : "");
const reasons = [];
if (planActionable) reasons.push("PLAN.json still has ready, running, or awaiting-verification work");
if (planInvalid) reasons.push(`PLAN.json or state is invalid: ${plan.output.trim().slice(-300)}`);
if (gates.unmet.length) reasons.push(`${gates.unmet.length} gate(s) unmet: ${gateList}`);
console.log(JSON.stringify({
  decision: "block",
  reason: `proof-of-life: ${reasons.join("; ")}. Continue the next actionable leaf, verify returned work, or record a reasoned terminal outcome.`,
}));
process.exit(0);
