#!/usr/bin/env node
// Proof of Life behavioral fixtures. Original work under Apache-2.0.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(testDir, "..");
const repoRoot = resolve(skillDir, "../..");
const planScript = join(skillDir, "scripts", "plan.mjs");
const gateScript = join(skillDir, "scripts", "gate-check.mjs");
const hookScript = join(skillDir, "scripts", "stop-hook.mjs");
const installerScript = join(skillDir, "scripts", "install-hooks.mjs");
const childEnv = { ...process.env };
delete childEnv.NO_COLOR;

function run(script, args, cwd, input = undefined) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: childEnv,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function gate(command = `node -e "console.log('ok')"`, expect = "ok") {
  return `# Gates: fixture

- [ ] G1: fixture passes
  CHECK: ${command}
  EXPECT: ${expect}
  EVIDENCE: pending
`;
}

function writePlan(dir, plan) {
  for (const node of plan.nodes || []) write(join(dir, node.gates), gate());
  write(join(dir, "PLAN.json"), `${JSON.stringify(plan, null, 2)}\n`);
}

function threeNodePlan(maxWorkers = 2) {
  return {
    version: 1,
    name: "fixture",
    root: "root",
    maxWorkers,
    nodes: [
      { id: "a", kind: "leaf", needs: [], owns: ["file:src/a.ts"], tier: "standard", gates: "gates/a.md" },
      { id: "b", kind: "leaf", needs: [], owns: ["file:src/b.ts"], tier: "standard", gates: "gates/b.md" },
      { id: "root", kind: "integration", needs: ["a", "b"], owns: [], tier: "strong", gates: "gates/root.md" },
    ],
  };
}

function singleLeafPlan() {
  return {
    version: 1,
    name: "single",
    root: "root",
    maxWorkers: 1,
    nodes: [
      { id: "a", kind: "leaf", needs: [], owns: ["file:src/a.ts"], tier: "standard", gates: "gates/a.md" },
      { id: "root", kind: "integration", needs: ["a"], owns: [], tier: "strong", gates: "gates/root.md" },
    ],
  };
}

function temp(name) {
  return mkdtempSync(join(tmpdir(), `proof-of-life-${name}-`));
}

function suiteSkill() {
  const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  assert.match(skill, /^name: proof-of-life$/m);
  assert.match(skill, /Leonxlnx\/unlazy/);
  assert.match(skill, /root integration node/);
  assert.match(skill, /plan\.mjs retry/);
  assert.match(skill, /gate-check\.mjs --verify --strict/);
  for (const path of [
    "ATTRIBUTION.md",
    "LICENSE.unlazy",
    "references/gates.md",
    "references/method.md",
    "references/orchestration.md",
    "references/outcome-states.md",
    "references/plan-format.md",
    "templates/PLAN.json",
    "templates/PLAN.md",
    "templates/gates-leaf.md",
    "templates/gates-node.md",
    "scripts/plan.mjs",
    "scripts/gate-check.mjs",
    "scripts/stop-hook.mjs",
    "scripts/install-hooks.mjs",
  ]) assert.doesNotThrow(() => readFileSync(join(skillDir, path)));
  const template = JSON.parse(readFileSync(join(skillDir, "templates", "PLAN.json"), "utf8"));
  assert.equal(template.nodes.find((node) => node.id === template.root).kind, "integration");
  console.log("PASS skill contract");
}

function suitePlan() {
  const dir = temp("plan");
  try {
    const plan = threeNodePlan();
    writePlan(dir, plan);
    let result = run(planScript, ["check", "PLAN.json"], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /VALID 3 nodes, root root, maxWorkers 2/);

    result = run(planScript, ["ready", "PLAN.json"], dir);
    assert.deepEqual(JSON.parse(result.stdout), { slots: 2, ready: ["a", "b"] });
    assert.equal(run(planScript, ["start", "PLAN.json", "a"], dir).status, 0);
    assert.equal(run(planScript, ["start", "PLAN.json", "b"], dir).status, 0);
    result = run(planScript, ["ready", "PLAN.json"], dir);
    assert.deepEqual(JSON.parse(result.stdout), { slots: 0, ready: [] });

    assert.equal(run(planScript, ["return", "PLAN.json", "a"], dir).status, 0);
    assert.equal(run(planScript, ["verify", "PLAN.json", "a"], dir).status, 0);
    result = run(planScript, ["ready", "PLAN.json"], dir);
    assert.deepEqual(JSON.parse(result.stdout), { slots: 1, ready: [] });
    assert.equal(run(planScript, ["return", "PLAN.json", "b"], dir).status, 0);
    assert.equal(run(planScript, ["verify", "PLAN.json", "b"], dir).status, 0);
    result = run(planScript, ["ready", "PLAN.json"], dir);
    assert.deepEqual(JSON.parse(result.stdout), { slots: 2, ready: ["root"] });
    assert.equal(run(planScript, ["start", "PLAN.json", "root"], dir).status, 0);
    assert.equal(run(planScript, ["return", "PLAN.json", "root"], dir).status, 0);
    assert.equal(run(planScript, ["verify", "PLAN.json", "root"], dir).status, 0);
    result = run(planScript, ["status", "PLAN.json"], dir);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).result, "verified-complete");

    const retryDir = temp("retry");
    try {
      const retryPlan = singleLeafPlan();
      writePlan(retryDir, retryPlan);
      write(join(retryDir, "gates", "a.md"), gate(`node -e "process.exit(1)"`));
      assert.equal(run(planScript, ["start", "PLAN.json", "a"], retryDir).status, 0);
      assert.equal(run(planScript, ["return", "PLAN.json", "a"], retryDir).status, 0);
      assert.equal(run(planScript, ["verify", "PLAN.json", "a"], retryDir).status, 1);
      assert.equal(run(planScript, ["retry", "PLAN.json", "a"], retryDir).status, 0);
      result = run(planScript, ["status", "PLAN.json"], retryDir);
      assert.equal(JSON.parse(result.stdout).nodes.a.state, "running");
    } finally {
      rmSync(retryDir, { recursive: true, force: true });
    }

    const blockedDir = temp("blocked");
    try {
      writePlan(blockedDir, threeNodePlan());
      assert.equal(run(planScript, ["block", "PLAN.json", "a", "--reason", "external input"], blockedDir).status, 0);
      result = run(planScript, ["ready", "PLAN.json"], blockedDir);
      assert.deepEqual(JSON.parse(result.stdout).ready, ["b"]);
      assert.equal(run(planScript, ["start", "PLAN.json", "b"], blockedDir).status, 0);
      assert.equal(run(planScript, ["return", "PLAN.json", "b"], blockedDir).status, 0);
      assert.equal(run(planScript, ["verify", "PLAN.json", "b"], blockedDir).status, 0);
      result = run(planScript, ["status", "PLAN.json"], blockedDir);
      assert.equal(result.status, 3);
      assert.equal(JSON.parse(result.stdout).nodes.root.blockedBy, "a");
    } finally {
      rmSync(blockedDir, { recursive: true, force: true });
    }

    for (const [label, mutate, expected] of [
      ["cycle", (value) => { value.nodes[0].needs = ["root"]; }, /dependency cycle/],
      ["ownership", (value) => { value.nodes[1].owns = ["file:src/a.ts/generated"]; }, /ownership conflict/],
      ["coverage", (value) => { value.nodes.push({ id: "orphan", kind: "leaf", needs: [], owns: ["file:src/orphan.ts"], tier: "standard", gates: "gates/orphan.md" }); }, /root does not integrate/],
    ]) {
      const invalidDir = temp(label);
      try {
        const invalid = threeNodePlan();
        mutate(invalid);
        writePlan(invalidDir, invalid);
        result = run(planScript, ["check", "PLAN.json"], invalidDir);
        assert.equal(result.status, 2);
        assert.match(result.stderr, expected);
      } finally {
        rmSync(invalidDir, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("PASS plan scheduler");
}

function suiteGates() {
  const dir = temp("gates");
  try {
    write(join(dir, "counter.mjs"), `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const path = "counter.txt";
const n = existsSync(path) ? Number(readFileSync(path, "utf8")) : 0;
writeFileSync(path, String(n + 1));
console.log("alpha beta");
`);
    write(join(dir, "GATES.md"), `# Gates: shared

- [ ] G1: alpha
  CHECK: node counter.mjs
  EXPECT: alpha
  EVIDENCE: pending

- [ ] G2: beta
  CHECK: node counter.mjs
  EXPECT: beta
  EVIDENCE: pending
`);
    let result = run(gateScript, ["--verify", "--jobs", "2", "GATES.md"], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Jobs: 2/);
    assert.equal(readFileSync(join(dir, "counter.txt"), "utf8"), "1");
    const passed = readFileSync(join(dir, "GATES.md"), "utf8");
    assert.equal((passed.match(/EVIDENCE: alpha beta/g) || []).length, 2);

    write(join(dir, "counter.mjs"), `console.log("gamma");\n`);
    result = run(gateScript, ["--verify", "GATES.md"], dir);
    assert.equal(result.status, 1);
    const failed = readFileSync(join(dir, "GATES.md"), "utf8");
    assert.doesNotMatch(failed, /- \[x\]/);
    assert.match(failed, /EVIDENCE: FAIL:/);

    const statusCounter = readFileSync(join(dir, "counter.txt"), "utf8");
    result = run(gateScript, ["--status", "GATES.md"], dir);
    assert.equal(result.status, 1);
    assert.equal(readFileSync(join(dir, "counter.txt"), "utf8"), statusCounter);

    write(join(dir, "abandoned.md"), `# Gates: abandon

- [ ] G1: impossible
  EVIDENCE: pending

ABANDON: G1 upstream unavailable
`);
    assert.equal(run(gateScript, ["abandoned.md"], dir).status, 0);
    assert.equal(run(gateScript, ["--strict", "abandoned.md"], dir).status, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("PASS gate checker");
}

function hook(cwd) {
  return run(hookScript, [], cwd, JSON.stringify({ cwd }));
}

function suiteHook() {
  const unmetDir = temp("hook-unmet");
  try {
    write(join(unmetDir, "GATES.md"), gate());
    const result = hook(unmetDir);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).decision, "block");
  } finally {
    rmSync(unmetDir, { recursive: true, force: true });
  }

  const handoverDir = temp("hook-handover");
  try {
    writePlan(handoverDir, singleLeafPlan());
    assert.equal(run(planScript, ["block", "PLAN.json", "a", "--reason", "external input"], handoverDir).status, 0);
    const result = hook(handoverDir);
    const output = JSON.parse(result.stdout);
    assert.equal(output.decision, undefined);
    assert.match(output.systemMessage, /terminal non-success handover/);
  } finally {
    rmSync(handoverDir, { recursive: true, force: true });
  }

  const invalidDir = temp("hook-invalid");
  try {
    write(join(invalidDir, "PLAN.json"), "{invalid\n");
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const output = JSON.parse(hook(invalidDir).stdout);
      assert.equal(output.decision, "block");
    }
    const released = JSON.parse(hook(invalidDir).stdout);
    assert.equal(released.decision, undefined);
    assert.match(released.systemMessage, /releasing after 6 stops/);
  } finally {
    rmSync(invalidDir, { recursive: true, force: true });
  }

  const completeDir = temp("hook-complete");
  try {
    write(join(completeDir, "GATES.md"), `# Gates: complete

- [x] G1: complete
  EVIDENCE: observed
`);
    assert.equal(hook(completeDir).stdout, "");
  } finally {
    rmSync(completeDir, { recursive: true, force: true });
  }
  const installerDir = temp("hook-installer");
  try {
    let result = run(installerScript, ["--shared"], installerDir);
    assert.equal(result.status, 0);
    const settingsPath = join(installerDir, ".claude", "settings.json");
    const first = readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(first);
    assert.match(settings.hooks.Stop[0].hooks[0].command, /proof-of-life.*stop-hook\.mjs/);
    result = run(installerScript, ["--shared"], installerDir);
    assert.equal(result.status, 0);
    assert.equal(readFileSync(settingsPath, "utf8"), first);
    result = run(installerScript, ["--shared", "--uninstall"], installerDir);
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), {});
  } finally {
    rmSync(installerDir, { recursive: true, force: true });
  }

  console.log("PASS stop hook");
}

function suiteAttribution() {
  const attribution = readFileSync(join(skillDir, "ATTRIBUTION.md"), "utf8");
  const license = readFileSync(join(skillDir, "LICENSE.unlazy"), "utf8");
  assert.match(attribution, /Leonxlnx\/unlazy/);
  assert.match(attribution, /ed9e8d2b5919698cf2c54bda270d507e10b69617/);
  assert.match(attribution, /Inherited concepts/);
  assert.match(attribution, /Proof of Life changes/);
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Leonxlnx/);
  for (const file of ["gate-check.mjs", "stop-hook.mjs", "install-hooks.mjs"]) {
    const source = readFileSync(join(skillDir, "scripts", file), "utf8");
    assert.match(source, /Leonxlnx\/unlazy v2/);
    assert.match(source, /LICENSE\.unlazy/);
  }
  console.log("PASS attribution");
}

function suiteRepository() {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const marketplace = JSON.parse(readFileSync(join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.match(readme, /\[`proof-of-life`\]\(\.\/skills\/proof-of-life\/\)/);
  assert.match(readme, /Inspired by Leonxlnx\/unlazy/);
  assert.equal(marketplace.plugins[0].skills, "./skills");
  console.log("PASS repository integration");
}

const suites = {
  skill: suiteSkill,
  plan: suitePlan,
  gates: suiteGates,
  hook: suiteHook,
  attribution: suiteAttribution,
  repository: suiteRepository,
};
const selected = process.argv[2];
if (selected && !suites[selected]) {
  console.error(`Unknown suite: ${selected}`);
  process.exit(2);
}

try {
  if (selected) suites[selected]();
  else for (const suite of Object.values(suites)) suite();
} catch (error) {
  console.error(`FAIL ${selected || "all"}: ${error.stack || error.message}`);
  process.exit(1);
}
