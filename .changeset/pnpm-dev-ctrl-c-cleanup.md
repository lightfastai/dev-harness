---
"@lightfastai/dev-cli": patch
"@lightfastai/dev-proxy": patch
---

Reliably terminate the entire dev process tree on Ctrl+C (use detached process groups, await main child exit, escalate to SIGKILL on second signal).

Behavioral change: when an auxiliary process crashes mid-run, `runtime.exit` now resolves with the main child's exit code (after coordinated teardown) instead of the auxiliary's exit code. Consumers branching on the integer exit code in this edge case should validate; no in-repo consumers do so today.
