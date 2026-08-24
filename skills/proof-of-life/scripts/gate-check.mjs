#!/usr/bin/env node
// Adapted from Leonxlnx/unlazy v2 gate-check.mjs.
// Upstream revision: ed9e8d2b5919698cf2c54bda270d507e10b69617
// MIT License preserved in ../LICENSE.unlazy.

import { exec } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const GATE_RE = /^- \[( |x|X)\] (.*)$/;
const ATTR_RE = /^\s+(CHECK|EXPECT|EVIDENCE):\s?(.*)$/;
const ABANDON_RE = /^ABANDON:\s*(\S+)\s*(.*)$/;

function usage(message) {
  if (message) console.error(`gate-check: ${message}`);
  console.error("Usage: gate-check.mjs [--status|--verify] [--strict] [--jobs N] [--timeout N] [file ...]");
  process.exit(2);
}

function parseArgs(argv) {
  const options = { status: false, verify: false, strict: false, jobs: 1, timeout: 120, files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--status") options.status = true;
    else if (arg === "--verify") options.verify = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--jobs") {
      options.jobs = Number(argv[++i]);
      if (!Number.isInteger(options.jobs) || options.jobs < 1) usage("--jobs requires a positive integer");
    } else if (arg === "--timeout") {
      options.timeout = Number(argv[++i]);
      if (!Number.isFinite(options.timeout) || options.timeout <= 0) usage("--timeout requires positive seconds");
    } else if (arg.startsWith("--")) usage(`unknown option ${arg}`);
    else options.files.push(resolve(process.cwd(), arg));
  }
  if (options.status && options.verify) usage("--status and --verify are mutually exclusive");
  return options;
}

function defaultFiles(dir) {
  const found = [];
  const top = join(dir, "GATES.md");
  if (existsSync(top)) found.push(top);
  const gatesDir = join(dir, "gates");
  if (existsSync(gatesDir)) {
    for (const file of readdirSync(gatesDir).sort()) {
      if (file.endsWith(".md")) found.push(join(gatesDir, file));
    }
  }
  return found;
}

function parseGateFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${path}: ${error.message}`);
  }
  const lines = text.split(/\r?\n/);
  const gates = [];
  const abandoned = new Map();
  let current = null;

  lines.forEach((line, index) => {
    const gateMatch = line.match(GATE_RE);
    if (gateMatch) {
      const id = (gateMatch[2].match(/^(\S+?):/) || [null, `line${index + 1}`])[1];
      current = {
        id,
        line: index,
        checked: gateMatch[1].toLowerCase() === "x",
        title: gateMatch[2].trim().replace(/^\S+?:\s*/, ""),
        check: null,
        expect: null,
        evidence: null,
        evidenceLine: -1,
      };
      gates.push(current);
      return;
    }
    const attribute = current && line.match(ATTR_RE);
    if (attribute) {
      const key = attribute[1].toLowerCase();
      current[key] = attribute[2].trim();
      if (key === "evidence") current.evidenceLine = index;
      return;
    }
    const abandon = line.match(ABANDON_RE);
    if (abandon) abandoned.set(abandon[1].replace(/:$/, ""), abandon[2] || "(no reason)");
    if (/^#|^- /.test(line)) current = null;
  });

  if (!gates.length) throw new Error(`no gates found in ${path}`);
  const seen = new Set();
  for (const gate of gates) {
    if (seen.has(gate.id)) throw new Error(`duplicate gate ID ${gate.id} in ${path}`);
    seen.add(gate.id);
    if (!gate.evidence && gate.evidenceLine === -1) throw new Error(`gate ${gate.id} has no EVIDENCE line in ${path}`);
  }
  for (const id of abandoned.keys()) {
    if (!seen.has(id)) throw new Error(`ABANDON names unknown gate ${id} in ${path}`);
  }

  return { path, lines, gates, abandoned, changed: false };
}

function expectMatches(expect, output) {
  if (!expect) return null;
  const match = expect.match(/^\/(.*)\/([a-z]*)$/);
  if (match) {
    try {
      return new RegExp(match[1], match[2]).test(output);
    } catch (error) {
      throw new Error(`invalid EXPECT regex ${expect}: ${error.message}`);
    }
  }
  return output.includes(expect);
}

function evidenceTail(output, max = 240) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (lines.slice(-2).join(" | ") || "(no output)").slice(0, max);
}

function decidingEvidence(expect, output) {
  if (!expect) return evidenceTail(output);
  const regex = expect.match(/^\/(.*)\/([a-z]*)$/);
  if (regex) {
    const match = output.match(new RegExp(regex[1], regex[2]));
    return (match?.[0] || evidenceTail(output)).trim().slice(0, 240);
  }
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.includes(expect))
    .at(-1);
  return (line || expect).slice(0, 240);
}

function runCommand(command, timeoutSeconds) {
  return new Promise((resolveResult) => {
    exec(command, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: timeoutSeconds * 1000,
      maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const output = `${stdout || ""}\n${stderr || ""}`;
      resolveResult({
        command,
        output,
        status: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
        error: error?.killed ? `timed out after ${timeoutSeconds}s` : null,
      });
    });
  });
}

async function runPool(commands, jobs, timeout) {
  const results = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < commands.length) {
      const command = commands[cursor++];
      results.set(command, await runCommand(command, timeout));
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, commands.length) }, () => worker()));
  return results;
}

function setGateResult(file, gate, ok, evidence) {
  const marker = ok ? "- [x]" : "- [ ]";
  file.lines[gate.line] = file.lines[gate.line].replace(/^- \[( |x|X)\]/, marker);
  if (gate.evidenceLine !== -1) {
    const indent = file.lines[gate.evidenceLine].match(/^\s*/)[0];
    file.lines[gate.evidenceLine] = `${indent}EVIDENCE: ${evidence}`;
  }
  gate.checked = ok;
  gate.evidence = evidence;
  file.changed = true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const paths = options.files.length ? options.files : defaultFiles(process.cwd());
  if (!paths.length) usage("no gate files found");

  let files;
  try {
    files = paths.map(parseGateFile);
  } catch (error) {
    console.error(`gate-check: ${error.message}`);
    return 2;
  }

  const commands = [];
  if (!options.status) {
    for (const file of files) {
      for (const gate of file.gates) {
        if (file.abandoned.has(gate.id) || !gate.check) continue;
        const evidencePending = !gate.evidence || /^pending$/i.test(gate.evidence);
        if (options.verify || !gate.checked || evidencePending) commands.push(gate.check);
      }
    }
  }
  const uniqueCommands = [...new Set(commands)];
  const results = await runPool(uniqueCommands, options.jobs, options.timeout);
  if (!options.status) console.log(`Jobs: ${options.jobs}`);

  let met = 0;
  let unmet = 0;
  let abandoned = 0;

  for (const file of files) {
    for (const gate of file.gates) {
      if (file.abandoned.has(gate.id)) {
        abandoned += 1;
        console.log(`  ABANDONED ${gate.id}: ${file.abandoned.get(gate.id)}`);
        continue;
      }

      const result = gate.check ? results.get(gate.check) : null;
      if (result) {
        let ok;
        try {
          ok = gate.expect ? expectMatches(gate.expect, result.output) : result.status === 0;
        } catch (error) {
          console.error(`gate-check: ${gate.id}: ${error.message}`);
          return 2;
        }
        const deciding = result.error || (ok ? decidingEvidence(gate.expect, result.output) : evidenceTail(result.output));
        if (ok) {
          setGateResult(file, gate, true, deciding);
          console.log(`  PASS ${gate.id}: ${gate.title}`);
        } else {
          setGateResult(file, gate, false, `FAIL: ${deciding}`);
          console.log(`  FAIL ${gate.id}: ${gate.title}\n       ${deciding}`);
        }
      }

      const evidencePresent = Boolean(gate.evidence) && !/^pending$/i.test(gate.evidence);
      if (gate.checked && evidencePresent) met += 1;
      else {
        unmet += 1;
        if (options.status) {
          const reason = !gate.checked ? "unchecked" : "evidence pending";
          console.log(`  UNMET ${gate.id} (${reason}): ${gate.title}`);
        }
      }
    }

    if (file.changed) writeFileSync(file.path, file.lines.join("\n"));
    console.log(`${file.path}: ${file.gates.length} gates`);
  }

  if (unmet > 0) {
    console.log(`UNMET: ${unmet} (met: ${met}${abandoned ? `, abandoned: ${abandoned}` : ""})`);
    return 1;
  }
  if (options.strict && abandoned > 0) {
    console.log(`TERMINAL HANDOVER (${met} met, ${abandoned} abandoned)`);
    return 3;
  }
  console.log(`ALL MET (${met} met${abandoned ? `, ${abandoned} abandoned` : ""})`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`gate-check: ${error.message}`);
    process.exit(2);
  });
