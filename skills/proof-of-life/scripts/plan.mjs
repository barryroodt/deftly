#!/usr/bin/env node
// Proof of Life plan validator and bounded rolling scheduler.
// Original Proof of Life work. Apache-2.0.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const STATES = new Set([
  "pending",
  "running",
  "awaiting-verification",
  "verified",
  "failed",
  "abandoned",
  "blocked",
]);
const TERMINAL_FAILURES = new Set(["failed", "abandoned", "blocked"]);
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const ARTIFACT_RE = /^[a-z0-9][a-z0-9._-]*$/;

function fail(message, code = 2) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function canonicalFilePath(value) {
  if (!value || value.includes("\\") || isAbsolute(value)) {
    fail(`invalid file ownership path: ${value || "(empty)"}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail(`invalid file ownership path: ${value}`);
  }
  const canonical = normalize(value).split(sep).join("/");
  if (canonical !== value) fail(`file ownership path is not canonical: ${value}`);
  return canonical;
}

function canonicalGatePath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || isAbsolute(value)) {
    fail(`invalid gate path: ${value || "(empty)"}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail(`invalid gate path: ${value}`);
  }
  return value;
}

function parseClaim(claim) {
  if (typeof claim !== "string") fail("ownership claims must be strings");
  if (claim.startsWith("file:")) {
    return { type: "file", value: canonicalFilePath(claim.slice(5)), raw: claim };
  }
  if (claim.startsWith("artifact:")) {
    const value = claim.slice(9);
    if (!ARTIFACT_RE.test(value)) fail(`invalid artifact ownership claim: ${claim}`);
    return { type: "artifact", value, raw: claim };
  }
  fail(`unsupported ownership claim: ${claim}`);
}

function claimsOverlap(left, right) {
  if (left.type !== right.type) return false;
  if (left.type === "artifact") return left.value === right.value;
  return left.value === right.value || left.value.startsWith(`${right.value}/`) || right.value.startsWith(`${left.value}/`);
}

function planHash(plan) {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export function validatePlan(plan, planPath, { requireGates = true } = {}) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) fail("plan must be a JSON object");
  if (plan.version !== 1) fail("plan version must be 1");
  if (typeof plan.name !== "string" || !plan.name.trim()) fail("plan name must be a non-empty string");
  if (!Number.isInteger(plan.maxWorkers) || plan.maxWorkers < 1) fail("maxWorkers must be a positive integer");
  if (!Array.isArray(plan.nodes) || plan.nodes.length === 0) fail("nodes must be a non-empty array");

  const ids = new Set();
  const gatePaths = new Map();
  const claims = [];

  for (const node of plan.nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) fail("every node must be an object");
    if (!ID_RE.test(node.id || "")) fail(`invalid node id: ${node.id || "(empty)"}`);
    if (ids.has(node.id)) fail(`duplicate node id: ${node.id}`);
    ids.add(node.id);
    if (!["leaf", "integration"].includes(node.kind)) fail(`node ${node.id} kind must be leaf or integration`);

    if (!Array.isArray(node.needs) || new Set(node.needs).size !== node.needs.length) {
      fail(`node ${node.id} needs must be a unique array`);
    }
    if (!Array.isArray(node.owns) || new Set(node.owns).size !== node.owns.length) {
      fail(`node ${node.id} owns must be a unique array`);
    }
    if (node.kind === "leaf" && node.owns.length === 0) fail(`leaf node ${node.id} must own at least one resource`);
    if (typeof node.tier !== "string" || !node.tier.trim()) fail(`node ${node.id} tier must be non-empty`);

    const gatePath = canonicalGatePath(node.gates);
    if (gatePaths.has(gatePath)) fail(`gate file ${gatePath} is shared by ${gatePaths.get(gatePath)} and ${node.id}`);
    gatePaths.set(gatePath, node.id);
    if (requireGates && !existsSync(resolve(dirname(planPath), gatePath))) {
      fail(`node ${node.id} gate file does not exist: ${gatePath}`);
    }

    for (const rawClaim of node.owns) claims.push({ node: node.id, claim: parseClaim(rawClaim) });
  }

  for (const node of plan.nodes) {
    for (const need of node.needs) {
      if (!ids.has(need)) fail(`node ${node.id} needs missing node ${need}`);
      if (need === node.id) fail(`node ${node.id} cannot need itself`);
    }
  }

  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      if (claims[i].node !== claims[j].node && claimsOverlap(claims[i].claim, claims[j].claim)) {
        fail(`ownership conflict: ${claims[i].node} ${claims[i].claim.raw} overlaps ${claims[j].node} ${claims[j].claim.raw}`);
      }
    }
  }

  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id, path = []) {
    if (visiting.has(id)) fail(`dependency cycle: ${[...path, id].join(" -> ")}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const need of byId.get(id).needs) visit(need, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of [...ids].sort()) visit(id);
  if (!ID_RE.test(plan.root || "") || !byId.has(plan.root)) fail("root must name an existing node");
  if (byId.get(plan.root).kind !== "integration") fail("root node must have kind integration");
  const covered = new Set();
  function cover(id) {
    if (covered.has(id)) return;
    covered.add(id);
    for (const need of byId.get(id).needs) cover(need);
  }
  cover(plan.root);
  const uncovered = [...ids].filter((id) => !covered.has(id)).sort();
  if (uncovered.length) fail(`root does not integrate nodes: ${uncovered.join(", ")}`);

  return { byId, hash: planHash(plan) };
}

function gateContractHash(planPath, gatesPath) {
  const checker = join(dirname(fileURLToPath(import.meta.url)), "gate-check.mjs");
  const target = resolve(dirname(planPath), gatesPath);
  const result = spawnSync(process.execPath, [checker, "--contract-hash", target], {
    cwd: dirname(planPath),
    encoding: "utf8",
  });
  if (result.error) fail(`cannot fingerprint gate file ${gatesPath}: ${result.error.message}`);
  const hash = result.status === 0 ? (result.stdout.trim().split(/\s+/)[0] || "") : "";
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    fail(`cannot fingerprint gate contract ${gatesPath}: ${(result.stderr || result.stdout || "").trim() || "no output"}`);
  }
  return hash;
}

function newState(plan, hash) {
  return {
    version: 1,
    plan: plan.name,
    planHash: hash,
    nodes: Object.fromEntries(
      [...plan.nodes]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((node) => [node.id, { state: "pending", reason: null, blockedBy: null, gateHash: null, retries: 0 }]),
    ),
  };
}

function validateState(state, plan, hash) {
  if (!state || typeof state !== "object" || state.version !== 1) fail("state version must be 1");
  if (state.planHash !== hash) fail("state belongs to a different plan revision");
  if (!state.nodes || typeof state.nodes !== "object" || Array.isArray(state.nodes)) fail("state nodes must be an object");
  const planIds = [...plan.nodes].map((node) => node.id).sort();
  const stateIds = Object.keys(state.nodes).sort();
  if (JSON.stringify(planIds) !== JSON.stringify(stateIds)) fail("state node IDs do not match the plan");
  for (const id of planIds) {
    const record = state.nodes[id];
    if (!record || !STATES.has(record.state)) fail(`node ${id} has invalid state`);
    if (TERMINAL_FAILURES.has(record.state) && typeof record.reason !== "string") {
      fail(`terminal node ${id} requires a reason`);
    }
  }
  return state;
}

function loadState(statePath, plan, hash) {
  if (!existsSync(statePath)) return newState(plan, hash);
  return validateState(readJson(statePath, "state"), plan, hash);
}

function writeState(statePath, state) {
  mkdirSync(dirname(statePath), { recursive: true });
  const temp = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temp, statePath);
}

function readyIds(plan, state) {
  return plan.nodes
    .filter((node) => state.nodes[node.id].state === "pending")
    .filter((node) => node.needs.every((need) => state.nodes[need].state === "verified"))
    .map((node) => node.id)
    .sort();
}

function runningCount(state) {
  return Object.values(state.nodes).filter((record) => record.state === "running").length;
}

function propagateBlocked(plan, state) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of [...plan.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
      const record = state.nodes[node.id];
      if (record.state !== "pending") continue;
      const cause = [...node.needs]
        .sort()
        .find((need) => TERMINAL_FAILURES.has(state.nodes[need].state));
      if (!cause) continue;
      record.state = "blocked";
      record.blockedBy = cause;
      record.reason = `dependency ${cause} is ${state.nodes[cause].state}`;
      changed = true;
    }
  }
}

function parseOptions(args, planPath) {
  let statePath = join(dirname(planPath), ".proof-of-life", "state.json");
  let maxWorkers = null;
  let reason = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--state") statePath = resolve(process.cwd(), args[++i] || fail("--state requires a path"));
    else if (args[i] === "--max-workers") {
      maxWorkers = Number(args[++i]);
      if (!Number.isInteger(maxWorkers) || maxWorkers < 1) fail("--max-workers requires a positive integer");
    } else if (args[i] === "--reason") reason = args[++i] || fail("--reason requires text");
    else fail(`unknown option: ${args[i]}`);
  }
  return { statePath, maxWorkers, reason };
}

function summary(plan, state) {
  const counts = {};
  for (const name of STATES) counts[name] = 0;
  for (const record of Object.values(state.nodes)) counts[record.state] += 1;
  return {
    plan: plan.name,
    counts,
    ready: readyIds(plan, state),
    nodes: state.nodes,
  };
}

function statusCode(plan, state) {
  const records = Object.values(state.nodes);
  if (records.every((record) => record.state === "verified")) return 0;
  if (
    readyIds(plan, state).length > 0 ||
    records.some((record) => ["running", "awaiting-verification"].includes(record.state))
  ) return 1;
  if (records.some((record) => TERMINAL_FAILURES.has(record.state))) return 3;
  return 2;
}

function usage() {
  console.error(`Usage:
  plan.mjs check <PLAN.json>
  plan.mjs ready|status <PLAN.json> [--state <path>] [--max-workers N]
  plan.mjs start|return|retry|verify|regate <PLAN.json> <node-id> [--state <path>] [--max-workers N]
  plan.mjs fail|abandon|block <PLAN.json> <node-id> --reason <text> [--state <path>]`);
  process.exit(2);
}

async function main() {
  const [command, planArg, leafArg, ...optionArgs] = process.argv.slice(2);
  if (!command || !planArg) usage();
  const planPath = resolve(process.cwd(), planArg);
  const plan = readJson(planPath, "plan");
  const validated = validatePlan(plan, planPath);

  if (command === "check") {
    if (leafArg || optionArgs.length) fail("check does not accept a node or options");
    console.log(`VALID ${plan.nodes.length} nodes, root ${plan.root}, maxWorkers ${plan.maxWorkers}`);
    return 0;
  }

  const hasLeaf = ["start", "return", "retry", "verify", "regate", "fail", "abandon", "block"].includes(command);
  if (hasLeaf && !leafArg) fail(`${command} requires a node ID`);
  if (!hasLeaf && leafArg?.startsWith("--")) optionArgs.unshift(leafArg);
  else if (!hasLeaf && leafArg) fail(`${command} does not accept a node ID`);
  const options = parseOptions(optionArgs, planPath);
  const state = loadState(options.statePath, plan, validated.hash);
  const limit = options.maxWorkers ?? plan.maxWorkers;

  if (command === "ready") {
    const slots = Math.max(0, limit - runningCount(state));
    console.log(JSON.stringify({ slots, ready: readyIds(plan, state).slice(0, slots) }, null, 2));
    return 0;
  }

  if (command === "status") {
    const result = summary(plan, state);
    const code = statusCode(plan, state);
    result.result = code === 0 ? "verified-complete" : code === 1 ? "actionable" : code === 3 ? "terminal-handover" : "invalid";
    console.log(JSON.stringify(result, null, 2));
    return code;
  }

  if (!validated.byId.has(leafArg)) fail(`unknown node: ${leafArg}`);
  const record = state.nodes[leafArg];

  if (command === "start") {
    if (record.state !== "pending") fail(`node ${leafArg} cannot start from ${record.state}`);
    if (!readyIds(plan, state).includes(leafArg)) fail(`node ${leafArg} is not ready`, 1);
    if (runningCount(state) >= limit) fail(`worker capacity ${limit} is full`, 1);
    record.state = "running";
    record.gateHash = gateContractHash(planPath, validated.byId.get(leafArg).gates);
  } else if (command === "return") {
    if (record.state !== "running") fail(`node ${leafArg} cannot return from ${record.state}`);
    record.state = "awaiting-verification";
  } else if (command === "retry") {
    if (record.state !== "awaiting-verification") fail(`node ${leafArg} cannot retry from ${record.state}`);
    if (runningCount(state) >= limit) fail(`worker capacity ${limit} is full`, 1);
    record.state = "running";
    record.retries = (record.retries ?? 0) + 1;
    if (record.retries >= 3) {
      console.error(`plan: node ${leafArg} retry ${record.retries}; retry twice at most, then change the approach or record fail, abandon, or block`);
    }
  } else if (command === "regate") {
    if (!["running", "awaiting-verification"].includes(record.state)) fail(`node ${leafArg} cannot regate from ${record.state}`);
    record.gateHash = gateContractHash(planPath, validated.byId.get(leafArg).gates);
  } else if (command === "verify") {
    if (record.state !== "awaiting-verification") fail(`node ${leafArg} cannot verify from ${record.state}`);
    const leaf = validated.byId.get(leafArg);
    const currentHash = gateContractHash(planPath, leaf.gates);
    if (record.gateHash && record.gateHash !== currentHash) {
      fail(`gate contract for ${leafArg} changed since dispatch; review the change, then re-pin with: plan.mjs regate ${leafArg}`);
    }
    if (!record.gateHash) {
      console.error(`plan: node ${leafArg} has no pinned gate contract; pinning the current contract`);
      record.gateHash = currentHash;
    }
    const checker = join(dirname(fileURLToPath(import.meta.url)), "gate-check.mjs");
    const gatePath = resolve(dirname(planPath), leaf.gates);
    const result = spawnSync(process.execPath, [checker, "--verify", "--strict", gatePath], {
      cwd: dirname(planPath),
      encoding: "utf8",
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) fail(`verification could not start: ${result.error.message}`);
    if (result.status !== 0) return result.status ?? 1;
    record.state = "verified";
    record.reason = null;
    record.blockedBy = null;
  } else if (command === "fail") {
    if (!["running", "awaiting-verification"].includes(record.state)) fail(`node ${leafArg} cannot fail from ${record.state}`);
    if (!options.reason) fail("fail requires --reason");
    record.state = "failed";
    record.reason = options.reason;
  } else if (command === "abandon") {
    if (!["pending", "running", "awaiting-verification"].includes(record.state)) fail(`node ${leafArg} cannot be abandoned from ${record.state}`);
    if (!options.reason) fail("abandon requires --reason");
    record.state = "abandoned";
    record.reason = options.reason;
  } else if (command === "block") {
    if (record.state !== "pending") fail(`node ${leafArg} cannot be blocked from ${record.state}`);
    if (!options.reason) fail("block requires --reason");
    record.state = "blocked";
    record.reason = options.reason;
  } else {
    usage();
  }

  propagateBlocked(plan, state);
  writeState(options.statePath, state);
  console.log(JSON.stringify({ node: leafArg, ...state.nodes[leafArg] }, null, 2));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`plan: ${error.message}`);
    process.exit(error.exitCode || 2);
  });
