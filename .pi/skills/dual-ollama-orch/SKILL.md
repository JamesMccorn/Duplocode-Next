---
name: dual-ollama-orch
description: Orchestrate reliable, decomposable coding, research, review, test, and audit work across two single-concurrency Ollama servers with explicit pinning, failover, recovery, and coverage reporting. Use when the user explicitly asks for a workflow using the dual Ollama workers.
compatibility: Requires configured `ollama-lan` and `ollama-lan-2` Pi model providers and the workflow tool.
---

# Dual Ollama Orchestration

Use this skill for multi-agent work on the two configured Ollama workers. It is intentionally task-agnostic: use it for audits, implementation packages, testing, research, review, migration work, or other bounded, independent work.

## Fleet contract

Both servers support **one active inference request each**. Never rely on an unqualified model name or an implicit scheduler.

| Lane | Pi model selector | Host |
|---|---|---|
| A | `ollama-lan/qwen3.8:27b-mlx` | `100.112.228.37` |
| B | `ollama-lan-2/qwen3.8:27b-mlx` | `100.107.211.60` |

Before launching a workflow, verify that both selectors exist in `~/.pi/agent/models.json` and point to the expected hosts. If the requested model differs, verify that the exact same model ID is configured on **both** providers; do not silently fall back to another model or host.

## Non-negotiable rules

1. Invoke a workflow only when the user explicitly opts in to workflow/multi-agent execution.
2. Set invocation `concurrency: 2` at most; set `maxAgents` to the actual bounded count.
3. Every `agent()` call must set `model` to a lane-qualified selector. Never use only `qwen3.8:27b-mlx`.
4. Do not place two workers on the same lane at once, including retries and synthesis.
5. Give each worker a unique, stable label and work ID. Maintain a result/failure ledger for every intended work item.
6. A null/timeout/error result means **missing coverage**, never a clean result.
7. Do not modify source files from an audit/review worker. Make allowed outputs explicit for implementation tasks.
8. Do not expose secrets found during worker execution in workflow prompts, logs, or final reports; describe their location and rotate/revoke guidance instead.

## Dispatch pattern

Use fixed two-item cohorts, rather than unconstrained fan-out. Assign cohort item 0 to lane A and item 1 to lane B, then await the full cohort before attempting any failover. This preserves each host's concurrency-of-one constraint.

```js
const laneA = 'ollama-lan/qwen3.8:27b-mlx';
const laneB = 'ollama-lan-2/qwen3.8:27b-mlx';

const initial = await parallel([
  () => agent(promptFor(a), { label: `work-${a.id}-a`, model: laneA }),
  () => agent(promptFor(b), { label: `work-${b.id}-b`, model: laneB }),
]);
// Only after both calls settle may a failed item be retried on the alternate lane.
```

For an odd final item, use one lane only. For tasks that edit code, split work by non-overlapping files/components and use isolated worktrees if available; do not have concurrent workers edit the same checkout.

## Preflight

At workflow start, launch one short, bounded probe per lane (in parallel) using its qualified selector. Each probe should confirm the model can respond and can access the requested working directory. Record the result in the ledger.

- If both probes pass, use paired cohorts.
- If only one passes, set host state to degraded and run work sequentially on the healthy lane.
- If neither passes, return `blocked` with the probe results; do not pretend work began.

## Failover and host circuit breaker

Treat a null result, provider error, malformed schema result, or timeout as a failed attempt.

1. Record `{ workId, attempt, lane, result: 'failed', reason }`.
2. After the paired cohort has settled, retry that work item **once** on the alternate lane, sequentially and only when that lane is idle.
3. If a lane has two failed attempts in a run, open a circuit breaker for it: record it as unavailable and send no further ordinary work there.
4. If the alternate retry succeeds, record `recovered: true` and preserve both attempt records.
5. If both lanes fail the item, do not repeat the same broad prompt indefinitely.

Use `agentRetries` only for brief transient transport retries. It does not replace lane failover because it retries on the same route.

## Narrow recovery

After both lanes fail a broad task, reduce scope deterministically:

- Split by files/modules, API surfaces, test groups, or independent acceptance criteria.
- Keep each recovery unit small enough to complete without extensive discovery.
- Run recovery units sequentially on a healthy lane, or mark them blocked if no lane is healthy.
- Preserve the parent work ID and give children stable IDs such as `security-auth`, `security-input-validation`, and `security-secrets`.

Do not ask a recovery worker to declare the original area clean merely because it could not finish. Recovery succeeds only when every child has a result or the final ledger explicitly marks it missing.

## Worker prompts

Prompts must be scoped and output-bounded. Include:

- repository/worktree path and a clear allowed-write policy;
- exact responsibility and important files/components;
- expected evidence (file:line, test output, reproduction, or diff);
- definition of success and explicit non-goals;
- concise output structure; and
- instruction to state limitations rather than guess.

For audit/review work, request only evidence-based findings plus verified-clean checks. For implementation work, require tests run, changed files, rollback notes, and a concise completion object with a schema.

## Synthesis and completion gate

Run synthesis only after all initial, failover, and recovery work has settled. Pin synthesis to a healthy lane and run it alone.

Give the synthesizer:

- every successful result, paired with its stable work ID;
- the full failure ledger, including nulls and retries;
- any pre-existing report paths it must read; and
- explicit rules to deduplicate, validate, and preserve evidence.

The workflow return value must contain:

```js
{
  status: 'complete' | 'incomplete' | 'blocked',
  hostHealth: { laneA: 'healthy' | 'degraded' | 'unavailable', laneB: 'healthy' | 'degraded' | 'unavailable' },
  completedWorkIds: [],
  missingWorkIds: [],
  failureLedger: [],
  outputPaths: []
}
```

Return `complete` only when every intended work item has a successful result. Return `incomplete` if synthesis ran with any missing coverage. The final report must name missing work items and their failure reasons prominently.

## Reuse and resume

Use the workflow run ID for status, stop, and resume. When revising a failed workflow, preserve earlier successful `agent()` calls in the same order so unchanged calls can replay from cache. Do not rerun completed work solely because another lane failed.
