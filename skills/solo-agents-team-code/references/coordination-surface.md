# Coordination Surface

Load this when you need the full tool inventory for todos, scratchpads, locks, identity, or lifecycle — i.e. when selecting which coordination tool to call, not during routine dispatch.

| Need | Tools |
|------|-------|
| Task tracking / ownership / blockers | `todo_create`, `todo_list`, `todo_complete`, `todo_set_blockers`, `todo_lock` |
| Shared findings / plans / reports | `scratchpad_write`, `scratchpad_read`, `scratchpad_append`, `scratchpad_find` |
| Mutual exclusion on a file/resource | `lock_acquire`, `lock_release`, `lock_status` |
| Identity / scope check | `whoami` (run first in a fresh session) |
| Lifecycle | `start_process`, `restart_process`, `close_process` (agents/terminals only; commands use stop/restart) |

Write tools default to slim receipts; pass `response_mode="rich"` only when you need the hydrated payload.
