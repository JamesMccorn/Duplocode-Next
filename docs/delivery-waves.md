# DuploCode Next — Delivery Wave Backlog

**Status:** active. Dependency-ordered backlog for parallel worktrees.
**Synthesis input:** `docs/reviews/phase0-foundation-review.md`, two W0 assessment
reports, `docs/implementation-plan.md`, `duplocode-next-prd.md`, and the current
source tree.
**Grounding run:** `pnpm -r test` = 42 passing, 0 failing
(contracts 1, composition 3, governance 18, event-ledger 1, proxmox 6, control-api 7,
verifier 1, dsh-control-profile 5). Static + build audit only; no worker/lease/
publication/attestation-signing path was executed.

This document is a **backlog, not a status page.** Each wave names exact package/file
ownership so tracks can run in parallel worktrees without colliding. A wave is not
"done" until every one of its **acceptance tests** passes and its **constitutional
invariants** are re-shown to hold. A wave marked *operator-gated* may be built and
tested **against fakes** today; it is not *dispatchable* until its listed real
infrastructure prerequisites are met.

---

## 0. Standing rules for every wave

### 0.1 Constitutional invariants that no wave may weaken (PRD §3, plan §Constitutional)

These are non-negotiable. Any wave that touches a boundary listed here must add, never
remove, a failing-closed test that proves the invariant still holds after the change.

1. **Kernel owns truth; plugins own behavior.** DSH and the `dsh-web-app` surface a
   profile mounts confer **no** governance authority.
2. **Workers are disposable; runs are durable.** A worker loss changes a receipt state,
   never a `Run` identity or history.
3. **GitHub is the source of truth for issue intent.** A `Card` is a projection; a `Run`
   is an attempt; a commit/PR is the delivery artifact.
4. **No secrets** in argv, child env, logs, images, model context, or durable trajectories
   (`.gitignore` excludes `*.secret`, `secrets/`, `.pi/secrets/`).
5. **No wall-clock failure gates.** Liveness signals surface a problem; elapsed time never
   decides it.
6. **Surface, never auto-kill.** A stalled/lost/inconclusive run becomes an operator-visible
   `needs-attention`/`refused` state, never a silent PASS/FAIL/termination.
7. **Absence of evidence is a third value.** `unavailable`/`not-observed`/`inconclusive`/
   `ran:false` never becomes `pass`.
8. **The artifact being judged cannot provide decisive evidence for itself.** A decisive
   verifier runs on a separate plane/composition from the producer
   (`checkDecisivePass` enforces `verifierCompositionDigest !== run.compositionDigest`).
9. **Capture is not promotion.** Best-effort telemetry never becomes gate authority, a
   golden reference, a model route, or a reusable routine without an explicit promotion.
10. **Every run pins its execution composition.** No live run re-pins DSH revision, profile,
    plugin tree, model route, worker image, or policy.
11. **Policy may tighten, never loosen, automatically.**
12. **Publication gates are constitutional.** No workflow may move, remove, or bypass the
    publication floor; a producer is never a publication authority.

### 0.2 Three-valued verdict floor (in force, do not regress)

Every verdict is `pass | fail | inconclusive`
(`packages/contracts/src/index.ts`). `checkDecisivePass` already fails closed for
`fail`, `inconclusive`, `ran:false`, unbound `evidenceId`, unapproved verifier, or a
non-independent verifier composition. New waves must not add a path where a missing binary,
timeout, cap, or unavailable source manufactures a `pass` or `fail`.

### 0.3 How to read the flags below

- **Buildable-against-fakes:** the slice can be written and its acceptance tests run with
  in-memory / fake adapters today.
- **Operator-gated (real infra):** the slice is only *dispatchable* after the listed real
  infrastructure and operator approvals exist. It may still be developed and tested against
  fakes in parallel.
- **Pending operator inputs** (from the plan, all currently outstanding):
  1. Approve `duplocode-worker-base-v1` in the `builder-arms` pool (currently empty).
  2. Place the normal-operation `duplo-armctl` scoped credential in
     `~/.config/duplocode-next/secrets/proxmox-scoped.secret` (mode `0600`; dir `0700`);
     keep the admin credential only for bootstrap audits.
  3. Approve the initial NIM model-route allowlist/digests from the discovered gateway
     roster.
  4. Decide Postgres + object-store deployment before durable remote execution is enabled.

---

## 1. Current state (what exists and what it does **not** prove)

Grounded against the source tree; do not treat any item below as complete unless its
acceptance test is listed as passing.

| Package | What exists | What it does **not** yet do |
|---|---|---|
| `contracts` | Canonical types; `checkDecisivePass` binds evidence↔verdict↔run, requires approved verifier + independence + `ran`; `PublicationDecision` carries an attestation `ArtifactReference`. | No **signature** verification of that attestation; no issuer-trust model; `Run` lifecycle not tied to a lease service. |
| `composition` | `canonicalJson` with **code-point** ordering (locale-dependent `localeCompare` gap from the P0 review is *fixed in current source*); closed `RunCompositionManifest` (`schemaVersion:1`, `repositoryCommit`, `executionComposition`) rejecting unknown/missing keys; `digestRunComposition` validates before hashing. | No fixed digest **vectors** / cross-host interop fixtures yet (P1 test-expansion). |
| `governance` | Legal, fail-closed `RunState` transitions; `createRunService` admission with closed-manifest digest binding; three-valued publication with a denial sentinel attestation; in-memory `Run/Evidence/Verdict` repos + closed `ApprovalRepository`. | Repositories are **in-memory only**; no lease issuance/expiry service; no durable persistence; no real verifier dispatch. |
| `verifier` | `verify()` derives `Evidence`+`Verdict` from an **injected** `CleanRoomExecutor`, three-valued. | The executor is injected and **never provided by a clean-room implementation**; no runtime/backend wiring; no provenance capture of pre-producer control. |
| `event-ledger` | `InMemoryEventLedger`: append-only, per-run monotonic sequence, dedup, envelope shape. | No durable backend; no ingest auth/scrubbing pipeline; no classification of untrusted worker claims. |
| `control-api` | `createControlServer`: `/health`, `POST /work-proposals` via injected `AdmissionHandler`; inert (fail-closed) default; malformed→400; **no** worker/lease/dispatch/publish route. | No durable storage behind ports; no run/lease/evidence/attestation surfaces; a real admission handler not yet wired. |
| `proxmox` | `ProxmoxHttpAdapter`: request-construction + execute, terminal-receipt gate on `destroy`; `FakeProxmoxLauncher`; `WorkerProfile` validation (`builder-arms`, pinned digests); `ScopedTokenSupplier` keeps the token out of requests. | No real Proxmox dispatch; pool is empty; no lifecycle→`RunService` integration; no boot-time template existence check. |
| `dsh-control-profile` | Source-controlled profile template (`bundle` order, empty `cordis.patch.yml`, inert `pnpm-workspace.yaml`); offline `node --test` structural checks. | Profile claims **not re-verified** by a fresh `dsh --profile duplocode-control --dump-config`; **no non-authoritative plugin seam declared yet** (deliberately). |

**Constitutional note carried forward:** the phase-0 review's P0 items are *largely
addressed in source* (evidence-id binding, approved-verifier set, producer independence,
closed manifest + admission-time digest). They were **not** re-adjudicated by a fresh
review run. The review's P1 test-expansion items (canonical JSON vectors, three-valued
exhaustiveness) remain open as acceptance work.

---

## 2. Real-infrastructure prerequisites (distinct from code)

These are **outside the source tree** and gate dispatch, not development. Track them as a
separate lane so a worktree is never blocked writing code.

| ID | Prerequisite | Kind | Currently | Blocks |
|---|---|---|---|---|
| **PR-1** | `duplocode-worker-base-v1` golden template approved in `builder-arms` | operator | not created | W2 dispatch |
| **PR-2** | `duplo-armctl` scoped credential in `~/.config/duplocode-next/secrets/proxmox-scoped.secret` (0600/0700); admin kept only for bootstrap | operator | not placed | W2 dispatch |
| **PR-3** | NIM model-route allowlist/digests approved from gateway roster | operator | not approved | W3 routing |
| **PR-4** | Postgres + object-store deployment decided/provisioned | operator+infra | not provisioned | W1.4 durability, W1 dispatch |
| **PR-5** | DSH Web control UI panels (Briefing/Inbox/Timeline/Evidence/Fleet) | code+UI | not started | W4 |
| **PR-6** | Re-run `dsh --profile duplocode-control --dump-config` against pinned DSH `47f943859` | verification | recorded once, not re-run | W1 exit gate |
| **PR-7** | Clean-room verifier runtime/backend (`verify-node-web-v1` class) | infra | not started | W1 publish path |

**Note on NIM:** the gateway (`http://docker-container-tyler.tailfce72b.ts.net:8742`,
MagicDNS hostname required) is reachable and discovered; the first coding route
`z-ai/glm-5.2` passed a minimal probe but is **flaky/testing-only** — do not treat a green
probe as durable fleet capacity. No worker may allocate a slot by observing fleet state
only.

---

## 3. Wave backlog (dependency-ordered, not calendar-ordered)

Waves are ordered by dependency, not by date. A later wave starts when its dependency wave
is *complete on fakes*; operator-gated dispatch waits additionally for its
`PR-*` prerequisites. Each wave lists owner worktrees so tracks can move in parallel.

### W0 — Foundation (Phase 0). **Status: built against fakes; exit gate not fully re-verified.**

**Goal:** prove DSH composition without weakening the trust boundary.

| Track (worktree) | Owner package / files | Dependency |
|---|---|---|
| T0.1 | `contracts`, `composition` — canonical types + closed manifest/digest + `checkDecisivePass` | none |
| T0.2 | `dsh-control-profile` — profile template + offline structural tests | none |
| T0.3 | `control-api` — inert admission HTTP boundary | T0.1 |
| T0.4 | P1 test expansion (see §4) | T0.1, T0.2, T0.3 |

- **Buildable-against-fakes:** yes. **Operator-gated dispatch:** no (none required).
- **Constitutional invariants:** 1, 4, 7, 8, 9, 10, 12.
- **Prerequisites:** PR-6 (re-run `--dump-config`); re-run the recorded composition
  assertion (no `@duplocode/*` row present).
- **Acceptance:**
  1. Removing the `duplocode-control` profile directory leaves `contracts`/`composition`
     untouched (a test that deletes the template and re-runs governance tests).
  2. A sample `Run` records its exact composition digest; admission rejects a mismatched
     `expectedCompositionDigest` (present in `RunService` today).
  3. No out-of-tree plugin row loads in the control profile (`validate.test.js`
     allowlist/empty-patch assertions; re-confirmed by PR-6).
  4. `pnpm -r test` stays green (>= 42), and the new P1 tests in §4 are added and pass.

### W1 — One governed remote coding slice (Phase 1). **Status: contracts/proxmx skeleton exists; not integrated; dispatch operator-gated.**

**Goal:** one admitted `WorkProposal` becomes one bounded worker attempt and one
independently verified outcome, with durable state.

| Track (worktree) | Owner package / files | Dependency |
|---|---|---|
| T1.1 **Attestation signing** | new `packages/attestation/` (or `governance/attestation.ts`) — sign + verify `PublicationDecision.attestation`; issuer-trust model; integrate verifier into `RunService` so a *well-formed* ref is not enough | T0.1; **first concrete W1 code item** |
| T1.2 **Durable ports** | `governance/src/ports.ts` + new `packages/store/` — Postgres/object-store behind `Run/Evidence/Verdict/Approval` repos; keep in-memory as a test backend | PR-4 |
| T1.3 **Lease service** | new `packages/lease/` (or `governance/lease.ts`) — bounded worker/model/event-ingest lease issuance + expiry; lease-gated `RunState` moves (`leased`/`dispatching`); lease-gated worker lifecycle | T0.1; PR-4 |
| T1.4 **Clean-room verifier executor** | `verifier/src/index.ts` — provide a real `CleanRoomExecutor` (`verify-node-web-v1` class) that captures pre-producer control + provenance; bind to a separate verifier composition | PR-7; T1.2 |
| T1.5 **Proxmox dispatch** | `proxmox/src/index.ts` + `http-adapter.ts` — boot-time template-existence check; lifecycle receipts → `RunService` transition wiring; run-scoped token from PR-2 via `ScopedTokenSupplier` | T0.1; PR-1, PR-2 |
| T1.6 **Worker observation gateway** | new `packages/worker-gateway/` — authenticated, **scrubbed** observation ingest into `event-ledger`; classify untrusted claims (never a PASS) | T0.1; T1.2 |
| T1.7 **Wire admission handler** | `control-api/src/index.ts` — replace inert handler with a `RunService`-backed `AdmissionHandler`; keep all fail-closed 400/no-surface tests green | T0.3, T1.1 |

- **Buildable-against-fakes:** T1.1, T1.3, T1.6, T1.7 against fakes; T1.2, T1.4, T1.5 need
  real infra for *dispatch* but develop against fakes. **Operator-gated dispatch:** PR-1,
  PR-2, PR-4, PR-7.
- **Constitutional invariants:** 2, 4, 5, 6, 7, 8, 9, 10 (worker loss preserves the run;
  no wall-clock kill; scrubbing; no self-evidence).
- **Acceptance (exit gate):**
  1. An operator can submit a bounded coding task from the DSH surface (T1.7 → `RunService`).
  2. A worker loss preserves durable run identity/history; `declareLost` → `needs-attention`,
     never a terminal verdict.
  3. A successful worker claim alone **cannot** publish; publication requires
     `checkDecisivePass` **and** a *verified* attestation signature (T1.1 closes the current
     "ref-only" gap) with a non-independent verifier composition refused.
  4. Unavailable fleet/verification evidence surfaces an explicit `inconclusive`/
     `needs-attention` (three-valued floor holds).
  5. `pnpm -r test` green with the new T1.* tests; no regression of the 42 existing.
  6. Re-run PR-6 and re-record the profile composition assertion.

### W2 — NIM fleet intelligence (Phase 2). **Status: not started; buildable against a fake fleet service; routing operator-gated.**

**Goal:** turn NIM operational knowledge into a reusable, freshness-aware capability
that never grants capacity to a worker.

| Track (worktree) | Owner package / files | Dependency |
|---|---|---|
| T2.1 Fleet snapshot service + freshness | new `packages/fleet/` — `FleetSnapshot` (as PRD §7.1), `fresh/stale/unavailable`; authoritative origin outside the worker | T1.3 (lease service) |
| T2.2 Route/slot leases | extend `packages/lease/` — scheduler-issued route/slot/budget lease; worker may only observe | T1.3, T2.1 |
| T2.3 Route/model provenance on receipts | `proxmox` + `contracts`/`verifier` — stamp route+model digest on worker & verifier receipts | T1.4 |
| T2.4 Fleet UI + NIM context/routing plugins | DSH plugin suite (PR-5) — context/routing clients consume T2.1 via `inject` | T2.1, PR-5 |

- **Prerequisites:** PR-3 (route allowlist); PR-1 (worker capacity).
- **Constitutional invariants:** 5, 7, 9, 10, 11 (stale never = capacity; capture≠promotion;
  no auto-loosening).
- **Acceptance:**
  1. Agents see a bounded, logged fleet context; a worker cannot allocate a slot merely by
     observing fleet state (T2.2 asserts it).
  2. `stale`/`unavailable` never becomes `fresh`/capacity (exhaustive test over the three
     freshness values).
  3. Provider/model swap occurs through **pinned configuration**, not a code fork
     (reconstructable-composition test over a swapped route).

### W3 — Control-surface migration (Phase 3). **Status: not started; UI panels not implemented (PR-5); buildable against in-memory.**

**Goal:** DSH-derived Briefing/Studio/Inbox becomes the primary operator surface, without
any view owning project truth.

| Track (worktree) | Owner package / files | Dependency |
|---|---|---|
| T3.1 Run/Evidence/Timeline panels | DSH plugins (PR-5) read from `event-ledger` + `RunService`, read-only | T1.6, T1.2 |
| T3.2 Briefing + Needs-Attention inbox | operator-attention queue from `needs-attention`/`refused` states; evidence linked to every decision | T3.1 |
| T3.3 Studio crystallization | `WorkProposal` creation from a thread with provenance → `RunService.admit` | T1.7 |
| T3.4 GitHub issue/card/run projections | card-as-projection; never mutates GitHub truth | T3.1, T3.3 |
| T3.5 Optional Kanban/graph | one projection; disenable-able | T3.1 |

- **Prerequisites:** PR-5; depends on W1 durable state.
- **Constitutional invariants:** 1, 3 (no view owns truth; GitHub is source of truth), 6, 12.
- **Acceptance:**
  1. Disabling Kanban does **not** alter work identity, dispatch, or publication behavior.
  2. Every operator-decision action carries linked evidence (Inbox item → verdict/receipt).
  3. Raw DSH session timeline and DuploCode run timeline remain navigable together.

### W4 — More execution/verification profiles (Phase 4). **Status: not started; buildable per-profile against fakes.**

**Goal:** prove replaceability, not assume it. At least two real implementations before
any interface is generalized ("not architecture theater", PRD §16).

| Track (worktree) | Owner package / files | Dependency |
|---|---|---|
| T4.1 Second engine/model family profile | new `@duplocode/` profile(s); same `Run` contract, new composition digest | W2 |
| T4.2 Second clean-room verifier backend | extend `verifier` via `CleanRoomExecutor`; still separate plane | T1.4 |
| T4.3 Browser/GUI capability profile | `gui.interact` backend(s); authorized-workspace lease | T1.3 |
| T4.4 Profile qualification + promotion | held-out qualification suite; explicit attributable promotion (T5 feed) | T4.1-T4.3 |

- **Constitutional invariants:** 8, 10, 11, 12 (no profile change weakens the floor).
- **Acceptance:**
  1. The same governance `Run` contract dispatches to **≥ 2** different profiles.
  2. Each profile has evidence-backed capability qualification.
  3. No profile change weakens the publication floor (a guard test asserts
     `checkDecisivePass` + verified attestation still gate publication for every profile).

### W5 — Governed experimentation (Phase 5). **Status: not started; depends on W4 promotions; buildable on replay data.**

**Goal:** earn self-improvement from evidence; no optimizer may self-apply changes to
publication policy, credential authority, or the verification floor.

| Track (worktree) | Owner package / files | Dependency |
|---|---|---|
| T5.1 Scrubbed eval/replay bundle format | new `packages/experiments/`; consumes only **promoted** artifacts (capture≠promotion, inv. 9) | W4 |
| T5.2 Held-out experiment selector | admissible run-set selection under declared budget | T5.1 |
| T5.3 Comparison + recommendation inbox | report with control/candidate/population/outcome/uncertainty | T5.2 |
| T5.4 Promotion/rollback records | attributable, reversible promotion; explicit operator/policy gate | T5.3 |

- **Constitutional invariants:** 9, 11, 12 (promotion only; no auto-apply to the floor).
- **Acceptance:**
  1. An experiment never changes a live run's pinned composition.
  2. Every recommendation carries control, candidate, population, outcome, and uncertainty.
  3. Promotion is attributable and reversible; no path self-applies to publication/credential
     authority (a test asserts the optimizer has no write to those surfaces).

---

## 4. P1 test-expansion work (cross-cutting, blocks W0 exit gate)

Owned alongside T0.4 and re-checked after every wave. These close the phase-0 review's P1
items and should be fixed **fixed digest vectors** so cross-host digests are stable.

- **4.1 Canonical JSON interop** (`composition`): add fixed digest vectors covering nested
  arrays/objects, Unicode, key-order permutations, and `-0`; assert the code-point comparator
  (current source already avoids `localeCompare`). *(Buildable now.)*
- **4.2 Three-valued exhaustiveness** (`governance`/`contracts`): add tests for
  `pass`/`fail`/`inconclusive`, missing evidence, mismatched `evidenceId`, unrun evidence,
  and publication denial (deny path with sentinel attestation). *(Buildable now.)*
- **4.3 Attestation signature tests** (`T1.1`): assert a well-formed-but-unsigned or
  untrusted-issuer attestation is **refused**; only a verified signature authorizes.

---

## 5. Dependency spine (read top-down)

```text
W0 (contracts/composition/control-profile/control-api) ── complete-on-fakes
   │
   ├─ W1 (attestation, durable ports, lease service, clean-room verifier,
   │       proxmux dispatch, worker gateway, admission wiring)
   │      buildable on fakes; DISPATCH gated on PR-1, PR-2, PR-4, PR-7; EXIT gated on PR-6
   │
   ├─ W2 (fleet snapshot, route leases, route provenance, fleet UI)
   │      buildable on fake fleet; ROUTING gated on PR-3; capacity gated on PR-1
   │
   ├─ W3 (control-surface migration)  gated on W1 durable state + PR-5
   │
   ├─ W4 (≥2 execution & verification profiles)  gated on W2
   │
   └─ W5 (governed experimentation)  gated on W4 promotions
```

Wave 0's T0.1/T0.2 are independent and can open in parallel worktrees immediately. Every
operator-gated prerequisite (PR-1..PR-7) is tracked in §2 and unblocks dispatch independently
of code completion.

---

## 6. Definition of done per wave

A wave is **done** only when **all** are true:

1. Every listed acceptance test passes under `pnpm -r test` (and `pnpm -r typecheck`,
   `pnpm -r build`).
2. All constitutional invariants declared for that wave (per §0.1) have a live failing-closed
   test that still passes.
3. No real infrastructure prerequisite marked *operator-gated* is claimed satisfied unless the
   matching `PR-*` in §2 is recorded as approved/provisioned.
4. Any new profile/executor/backend carries a pinned composition digest and a qualification
   record; none weakens `checkDecisivePass` or the attestation-verified publication floor.
5. Secrets remain excluded from source control, argv, env, logs, images, and model context;
   no new path reads a credential into a model prompt, child argument, or durable event.

**Explicit non-claims carried into the next synthesis:** attestation *signing/verification*
is unimplemented (only a well-formed reference is accepted today, T1.1); lease issuance/expiry
is contract-only (T1.3); the clean-room executor is injected with no real runtime (T1.4);
repositories and the event ledger are in-memory only (T1.2, T1.6); DSH UI panels are not
implemented (PR-5); the DSH profile composition was validated once from a recorded dump and
is **not** re-verified here (PR-6); and no worker/lease/publication/real-fleet path was
executed. Absence of an executed path here is **not** evidence that an unexecuted path is clean.
