# Failure and Timeout Handling

Load this reference only after a worker, coordination operation, or dispatch fails. Use the live Solo tool schemas as the source of truth.

## Classify the failure

Determine which state applies:

- Worker is idle with incomplete work
- Worker is producing output after a timer deadline
- Worker is stuck or crashed
- Coordination mutation failed
- Persisted state cannot be read back
- Todo completion did not persist
- Completed work did not unblock dependent work

Do not replace a worker until its reachable state is preserved.

## Preserve before replacement

Before restarting, replacing, or closing a worker:

1. Request a handoff when the worker can respond.
2. Persist a restart packet in the best available adapter.
3. Read the packet back when the adapter supports reads.
4. Inspect the worker's latest output and status.
5. Start the replacement only after the packet is stored.

The packet includes completed work, remaining work, touched files, evidence, blockers, selected harness and model, and the exact next action.

If persistence fails, try the next available adapter. Keep the original worker until the packet is stored or all reachable recovery paths are exhausted.

The packet includes the active task packet ID and schema version, completed work, remaining work, touched files, evidence owners and results, blockers, selected harness and model, and the exact next action.

1. **Idle with failed done-criteria:** send the specific failing criteria before waiting again. Retry at most twice. On the second failure, persist the restart packet and escalate.
2. **Still producing after a timer deadline:** extend the finite wait once, up to about twice the prior wait. Do not run done-criteria while work is still producing.
3. **Stuck with no output progress:** preserve state, then `restart_process` once. Restart restores the launch specification, not the task. Resend `agent_instructions`, the active immutable task packet, and the restart packet as a real smoke test.
4. **Crashed:** spawn once with the same harness and model, using the active task packet and saved restart packet. If that fails, escalate.
5. **Escalation:** for a harness with selectable models, close only after the handoff is stored, then spawn with the next stronger supported model. For a fixed-default harness, switch to another live harness. `restart_process` is not model escalation.

## Recover failed mutations

For an optional coordination surface:

1. Re-read the object and current revision when supported.
2. Retry with only parameters exposed by the live mutation schema.
3. Read back the result when supported.
4. Fall back to another available adapter if the surface remains unavailable.

Never add an unsupported revision or response-mode parameter. Record state as unverified when no readback exists.

## Recover todo completion

After marking a todo complete:

1. Read the todo back.
2. Confirm its completed state.
3. Find dependent todos returned or affected by completion.
4. Re-read each dependent todo.
5. Dispatch each item that Solo reports unblocked and ready.
6. Leave items blocked when another blocker remains.

If todos are unavailable, update orchestrator-owned dependency state and perform the same blocker check.

## Recover timer wakes

A timer wake is an inspection trigger.

- On `already_satisfied`, inspect immediately.
- On deadline expiry, inspect worker status and shared state before acting.
- Re-arm only after corrective input or confirmed ongoing progress.
- Use exponential backoff when re-arming, capped near ten minutes.

Without timers, wait for a new user turn or lifecycle event. Never poll.

## Escalate honestly

When recovery cannot continue, preserve the restart packet and report the failed operation, last confirmed state, adapter and readback result, remaining blocker, and exact action required to resume.
