---
name: solo-agents-team-code
description: "Use when spawning sub-agents, coordinating multi-agent coding workflows, handling worker restarts, model-fallback escalation, or preventing deadlocks via lock ordering. Also covers idle-fire dispatch loops, sharing state across agents, and stalled-worker recovery. Harness-agnostic; the hard dependency is Solo MCP (works with whatever agent harness Solo can spawn). Triggers: spawn agent, orchestrate workers, sub-agent coordination, idle timer, multi-agent, dispatch loop, restart worker, model fallback, lock ordering, deadlock, timeout escalation."
---

# Solo Agents Team Code

## Overview

Solo MCP lets one orchestrator agent spawn worker sub-agents, hand them tasks, track shared todos, and wake itself when a worker goes idle. This skill captures the spawn defaults and the dispatch/verify loop.

**Hard dependency: Solo MCP** (and a selected project). Everything else is harness-agnostic — the orchestrator drives whatever agent harness Solo can spawn, keying launch, model, and escalation to that harness's own contract. Stop only if Solo MCP is unavailable or Solo can spawn no agent harness at all.

**Core principle:** spawn a worker, arm an idle-fire timer for it, and let Solo wake you when it stops. Never busy-poll process output.

## Spawn Defaults

- **Pick the harness without name bias.** Resolve at spawn time via `list_agent_tools`: use the **caller-specified** harness if one was given (match by `name` or `id`); otherwise any harness `list_agent_tools` returns — every returned entry is a spawnable agent runtime, so do not filter by name or `tool_type`. If several are returned and the caller named none, pick one and note which (or ask). If a caller named a harness that is not in the list, **halt and report the available names** rather than substituting a different one. Never hardcode the id, it shifts per machine. Halt too if `list_agent_tools` returns nothing — Solo MCP is the hard dependency, not any particular harness.
- **Model handling follows the selected harness's contract.** Pass the model in the chosen harness's own form: e.g. the `Omp` harness uses a per-launch `extra_args=["--model", "<provider>/<model>"]` (never mutating saved defaults), slugs from `omp models`; a harness with its own model flag uses that flag/slug format. A caller-supplied model wins and is tried first — but only a harness with a documented model mechanism can honor it: if a model is explicitly requested and the selected harness has no known way to pass it, **halt and report (or pick a harness that supports it)** rather than silently running an unrelated saved default. Only when no model is requested may a harness run its saved default. Never assume one harness's flag works for another.
- **"Available" means it actually runs**, not that it appears in a model list or that `spawn_agent` succeeds. Traps: (1) a provider can be listed but unauthenticated; (2) an authenticated account can still reject a specific slug at runtime (e.g. ChatGPT-OAuth accounts rejecting certain `*-codex` slugs with "model is not supported when using Codex with a ChatGPT account"). Treat any selected model/harness as worth a smoke test. A worker that boots can still refuse the first turn.
- **Verify with a send-input smoke test, never spawn acceptance alone.** After spawning, `send_input` a real first prompt — with the worker's `agent_instructions` prepended and crisp done-criteria included (e.g. "clean tree + one new commit, `cargo test` green") — and read the output: a working worker prints its boot banner and begins the task; a broken one prints an auth/model error banner ("No API key" / "not supported ..."). Only then arm the idle timer. The `wait_ms` below (10000) is a starting window, not a hard limit: slow boots (cold starts, large models, congested endpoints) can exceed it. Empty output with no error banner is a slow boot, not a broken worker — extend the wait and re-read before concluding. For a harness on a fixed default, the smoke test is how you confirm that default actually runs.
- **Choosing a model.** A caller-supplied model always wins and is tried first. For a harness whose model you can select, escalate along a fallback ladder ordered standard→strongest (see `references/model-ladder.md`; re-derive slugs from that harness's own model list). For a fixed-default harness, "escalation" means switching to another available harness, not respawning the same default (see Failure & Timeout Handling).

```
tools   = list_agent_tools()   # each entry exposes at least: id, name, tool_type
if caller_harness:  # caller named one -> honor it EXACTLY; never substitute a different harness
    harness = next((t for t in tools if t["name"] == caller_harness or t["id"] == caller_harness), None)
    if harness is None:
        halt_and_report(f"requested harness {caller_harness!r} not available; choices: {[t['name'] for t in tools]}")
else:               # none requested -> any returned harness (all entries are valid); if several, pick one and note it
    harness = tools[0] if tools else None
if harness is None:
    halt_and_report("Solo has no agent harness registered")  # Solo MCP is the hard dep, not any particular harness

# Model passing follows the SELECTED harness's documented contract. Do NOT assume one harness's flag works for another.
def launch_args(harness, model):
    if model is None:
        return []                       # no model requested -> harness runs its saved default
    if harness["name"] == "Omp":
        return ["--model", model]       # Omp's contract: --model "<provider>/<model>", slugs from `omp models`
    # <add other harnesses' documented model flag here as you learn them>
    halt_and_report(f"harness {harness['name']!r} has no known model-passing mechanism to honor "
                    f"requested model {model!r} — pick a harness that supports it, or omit the model")

w = spawn_agent(agent_tool_id=harness["id"], name="worker",
                extra_args=launch_args(harness, requested_model))  # requested_model = caller's model, else None -> saved default
# SMOKE TEST before trusting it — prepend agent_instructions (Solo process/project context):
send_input(process_id=w["process_id"],
           input=w["agent_instructions"] + "\n\n" + "<first task prompt>", wait_ms=10000)  # extend for slow boots; empty+no-error != broken
#   good  -> boot banner + worker starts the task
#   bad   -> auth/model error banner -> close + escalate (selectable model: next slug; fixed default: switch harness)
```

## The Idle-Fire Loop

Instead of polling, arm a timer that wakes the orchestrator when the worker goes quiet:

```
timer_fire_when_idle_any(
  processes=[<worker process_id>],
  max_wait_ms=600000,
  body="<worker> wake: FIRST call get_process_status; running/producing → timeout §2; exited/error → crash recovery §3; idle → verify Task N done-criteria (clean → todo_complete + dispatch next; fail → send_input the failing criteria then re-arm).",
)
```

On wake the same static `body` is injected whether the worker went idle, hit `max_wait_ms`, or exited — the body carries no wake-reason, so **inspect the worker yourself first**: call `get_process_status(process_id=<worker>)` (corroborate with `get_process_output` for output progress). Branch on the reported state:
- **`running` / producing new output** (timeout wake, work unfinished): do NOT run done-criteria. Go to Failure & Timeout Handling §2 (slow vs stuck).
- **`exited` / error** (process is dead): do NOT `send_input` or re-arm against a dead process. Go to Failure & Timeout Handling §3 (crash recovery — re-spawn).
- **`idle`** (alive but quiet): verify against the done-criteria yourself. Idle != done:
  ```
  # Verification procedure on idle wake:
  git status --porcelain          # expect empty (clean tree)
  git log --oneline -1            # expect commit matching task
  <run project tests>             # expect pass
  # All pass -> todo_complete + dispatch next
  # Any fail -> send_input the failing criteria, re-arm timer, yield (or escalate per retry count)
  ```
- **If done:** `todo_complete(todo_id, completed=true)`, then `send_input` the next task (or `close_process` if the worker is finished).
- **If not done:** `send_input` the worker the specific failing criteria (what's still expected vs what you observed) so it has something to act on, *then* re-arm the timer and yield. Re-arming without corrective input is a no-op, the idle worker has nothing new to do.

`timer_fire_when_idle_all` waits for a whole set of workers; `timer_set` schedules a plain delay. Add `delivery_process_id` only to wake a different agent.

**Decision rule:** one worker or first-finished dispatch → `timer_fire_when_idle_any`; barrier before integration (all workers must finish) → `timer_fire_when_idle_all`; plain delay unrelated to worker idleness → `timer_set`.

**Multi-worker fan-out:** create and assign todos *before* spawning any workers — one todo per worker, assigned in dependency order — so each worker's done-criteria map to a specific todo. Cap concurrency at 2–3 workers unless tasks touch disjoint files; more workers multiply lock contention and verification load faster than they add throughput.

## Failure & Timeout Handling

**MANDATORY:** when done-criteria fail, a worker never goes idle, or a worker crashes, load `references/failure-handling.md` for the full retry/escalate/abort ladder. **Do NOT load it during normal dispatch** — only on a non-clean idle wake or spawn failure.

## Coordination Surface

**MANDATORY:** when you need to pick a coordination tool (todos, scratchpads, locks, identity, lifecycle), load `references/coordination-surface.md` for the full tool inventory. **Do NOT load it during routine dispatch** — the spawn/idle-fire/verify loop above needs no coordination tools.

## Common Mistakes

- **NEVER** hardcode the harness id, assume a specific harness, or filter by name / `tool_type` — **INSTEAD** resolve at runtime via `list_agent_tools`: the caller-specified harness if given, else any returned entry (all are spawnable agent runtimes). If the caller named a harness that is not returned, **halt and report the choices — never silently substitute another.** Halt too if `list_agent_tools` returns nothing at all.
- **NEVER** assume one harness's model flag works for another, and **NEVER** silently ignore a requested model — **INSTEAD** pass a requested model in the *selected* harness's documented form (`Omp`: per-launch `--model <provider>/<model>`; others: their own flag); if the selected harness has no documented model mechanism, halt and report (or switch harnesses) rather than dropping the model. Only when no model is requested may a harness run its saved default; always smoke-test.
- **NEVER** assume idle means done (a worker going quiet only means it stopped talking) — **INSTEAD** verify done-criteria yourself before completing a todo or dispatching the next task (see the verification procedure in The Idle-Fire Loop).
- **NEVER** send a bare prompt to a worker — **INSTEAD** prepend `agent_instructions` so the worker has its Solo process/project context.
- **NEVER** busy-poll process output — **INSTEAD** use `timer_fire_when_idle_any/all` to wake on idle.
- **NEVER** wait indefinitely on a stalled worker — **INSTEAD** after 2 failed retries escalate per the selected harness: a selectable-model harness → `close_process` + `spawn_agent` with a stronger model in that harness's form; a fixed-default harness → switch to another available harness (respawning it unchanged is not an escalation); if neither is possible, mark the todo blocked. `restart_process` only relaunches the same spec.
- **NEVER** dispatch multiple workers onto the same resource without lock ordering — **INSTEAD** have each worker `lock_acquire` resources in a consistent order (e.g. alphabetical by path) to prevent deadlocks.
