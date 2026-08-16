# DuploCode Next — Governed Factory on a Composable Harness

**Status:** Proposed product and architecture direction. This is a design target, not a
claim that the described system already exists.

**Primary decision:** Build the next DuploCode as a small, trusted governance/control
plane plus a DuploCode plugin suite on [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) and Cordis. DSH is the composable agent-runtime and Web UI substrate. DuploCode owns conducting, verification, governance, and accountable publication.

---

## 1. Product statement

DuploCode Next is an autonomous, self-improving software-engineering organization.
It accepts operator intent, conducts untrusted model workers through bounded work,
independently verifies resulting artifacts, and publishes only evidence-backed results.

It is **not** a code generator and is not a generic task runner. Its product is:

> governed, verified, auditable delivery from interchangeable and unreliable model labor.

The system must remain able to survive being wrong about its user interface, harness,
model, workflow, browser backend, sandbox technology, or worker infrastructure without
rewriting its trust core.

### 1.1 Why DeepSeek Harness

DSH/Cordis already supplies a substantial agent-runtime substrate:

- a Web UI, sessions, planning, tool display, and approval interaction;
- a typed append-only session log, with the model-visible context derived from that log;
- replaceable LLM, filesystem, subprocess, sandbox, subagent, tool, and UI seams;
- profiles, bundles, overlays, plugin lifecycle, dependency injection, and hot reload;
- agent loops, compaction, forks, skills, subagents, and protocol integrations.

Cordis is valuable because a plugin contribution is a reversible effect: when a plugin
unloads, registrations it owns (listeners, tool schemas, prompt sections, services,
timers, etc.) are disposed. Dependencies are declared by capability, rather than by
concrete implementation or boot order.

This removes the need to rebuild an agent harness merely to experiment with a new model,
context strategy, UI, sandbox, or worker backend.

### 1.2 What DuploCode contributes

DSH is an agent runtime. It is not the authority that can safely decide whether agent
output may be shipped. DuploCode adds:

- project, issue, card, and run identity;
- policy and admission control;
- resource, model, and credential leases;
- Proxmox/worker lifecycle control;
- independent verification and evidence provenance;
- signed attestation and publication authority;
- an operator attention queue and accountability record;
- an empirical corpus and governed experimentation loop.

The distinction is intentional:

```text
DSH worker says:       “these are the actions and outputs I observed.”
DuploCode verifier says: “this independently produced evidence supports this verdict.”
DuploCode governance:  “publication is or is not authorized.”
```

---

## 2. Product goals

### 2.1 End-state capabilities

1. **Composable control surface.** An operator uses a DSH-derived Web interface with
   Chat/Studio, Briefing, Timeline, Inbox, Fleet, Evidence, and optional Kanban/graph
   views. No view owns project truth.
2. **Worker disposability.** Coding workers can be launched from a golden VM image,
   execute a bounded run, report scrubbed observations, return artifacts, and be
   destroyed. The run and its evidence survive the worker.
3. **Replaceable execution.** A run can use a DSH worker profile with local NIM/Qwen,
   a frontier provider, another coding engine, a different browser backend, or a local
   container/remote VM backend without changing governance semantics.
4. **Provider-aware operation.** NIM health, heartbeats, model residency, queue depth,
   breaker state, and available slots can inform agent context and route selection while
   an external scheduler remains the sole allocator of scarce capacity.
5. **Evidence-backed delivery.** A producer cannot mint its own PASS. Independent
   verification, provenance checks, runtime gates where applicable, and signed
   attestation govern publication.
6. **Operator-scale UX.** The main screen is a shift-change briefing and a ranked
   needs-you queue, not an ever-growing Kanban board.
7. **Empirical improvement.** Suitable completed runs can become scrubbed, attributed,
   reproducible evaluation inputs. Changes to models, harnesses, plugins, and workflow
   shapes are evaluated through governed experiments rather than intuition alone.

### 2.2 Non-goals

- Reimplement DSH, Cordis, its Web UI, or its agent loop from scratch.
- Allow an agent to modify its live policy, verification, publication, or scheduler
  authority.
- Treat a worker’s self-authored log, test result, or claimed success as publication
  evidence.
- Build a general-purpose “everything platform” before the engineering loop is proven.
- Support arbitrary third-party plugins in the governance container.
- Bypass external site security, anti-bot systems, or account-protection controls.
  Browser continuity is for owned/authorized accounts and must honor step-up
  authentication and provider policy.

---

## 3. Foundational invariants

These are architectural constraints, not optional plugin preferences.

1. **The kernel owns truth; plugins own behavior.**
2. **Workers own no irreplaceable state; runs own attributable history.**
3. **GitHub remains the source of truth for issue intent.** A card is a local dispatch
   projection; a run is an attempt; a Git commit/PR is the delivery artifact.
4. **No secrets in child argv, child environment, logs, images, model context, or
   durable trajectory artifacts.**
5. **No wall-clock failure gates.** Liveness/progress signals may surface a problem;
   elapsed duration alone does not decide it.
6. **Surface, never auto-kill.** A stalled, interrupted, unavailable, or inconclusive
   operation creates an operator-visible state. It is never silently converted to PASS,
   FAIL, or destructive termination.
7. **Absence of evidence is a third value.** `unavailable`, `not-observed`,
   `inconclusive`, and `ran:false` cannot become a success verdict.
8. **The artifact being judged cannot provide decisive evidence for itself.**
9. **Capture is not promotion.** Best-effort observability data cannot become gate
   authority, a golden reference, a model route, or a reusable routine without an
   explicit, attributable promotion.
10. **Every run pins its execution composition.** A live run never silently changes
    DSH revision, profile, plugin tree, model route, worker image, or policy version.
11. **Policy may tighten automatically but may not loosen automatically.**
12. **Security-critical publication gates are constitutional.** A workflow may evolve
    within its envelope; it cannot move, remove, or bypass the publication floor.

---

## 4. Authority model

“Everything is a plugin” means behavior is composable. It does **not** mean all plugins
have equal authority.

### 4.1 Trusted control plane

The following remain trusted services, isolated from worker-controlled code:

```text
operator authentication and authorization
project / issue / card / run identity
policy evaluation and trust dial
admission, budgets, and scheduler leases
credential broker and revocation
Proxmox worker launcher
control-plane audit/event ingestion
trusted verifier dispatch
attestation and publication authority
```

They may expose typed clients or DSH plugins, but the authority and durable write path
remain outside workers.

### 4.2 Trusted server plugins

The governance container may mount a curated, reviewed, digest-pinned DuploCode plugin
suite. These plugins can render UI, submit structured proposals, query bounded facts, and
call trusted service APIs. They do not receive raw production secrets or unbounded host
execution power.

### 4.3 Untrusted worker plugins

A worker profile may include coding tools, model adapters, browser backends, context
providers, skills, and workflow helpers. They are untrusted producers. Their output is
observation/artifact input for verification, not governance authority.

Cordis lifecycle cleanup is a composition benefit, **not a security sandbox**: plugins in
the same process can call one another and can potentially forge in-process observations.
Untrusted or candidate plugins therefore never run in the governance container.

---

## 5. End-state architecture

```text
                              Operator browser
                                      |
                                      v
+---------------------------------------------------------------------+
| GOVERNANCE / CONTROL PLANE                                           |
|                                                                     |
|  DSH Web control profile                                            |
|  - Chat / Studio                 - Timeline / Evidence             |
|  - Briefing / Inbox              - Fleet / project views            |
|  - DuploCode Cordis plugins                                       |
|                                                                     |
|  Trusted DuploCode services                                         |
|  - identity + project registry    - policy / trust dial             |
|  - work proposal admission        - scheduler / slot leases         |
|  - credential broker              - Proxmox launcher                |
|  - audit/event ingest             - verifier dispatch               |
|  - attestation / publish          - notification queue              |
+-------------------------+-------------------------------+-----------+
                          |                               |
                          | durable facts                  | bounded launch
                          v                               v
              +----------------------+        +--------------------------+
              | Postgres + object    |        | Proxmox worker fleet     |
              | store + Git refs     |        |                          |
              |                      |        | Ephemeral DSH profile    |
              | runs / leases        |        | repo workspace           |
              | policy decisions     |        | scoped credentials        |
              | receipts / evidence  |        | NIM/provider routes      |
              +----------------------+        | tools / context plugins  |
                                              +------------+-------------+
                                                           |
                                    scrubbed observations, artifacts, receipts
                                                           v
                                              +--------------------------+
                                              | Independent verifier      |
                                              | separate trusted plane    |
                                              +--------------------------+
```

### 5.1 The two DSH profiles

#### A. `duplocode-control`

Runs in the governance container. It is deliberately constrained:

- Web UI and operator conversation;
- no arbitrary host shell or broad filesystem write access;
- no raw Proxmox credential or long-lived provider key in model-visible context;
- may inspect authorized project/run/fleet facts through typed services;
- may create a structured `WorkProposal`, never directly start infrastructure;
- can render evidence and offer operator decisions.

#### B. `duplocode-worker`

Runs in a container or Proxmox VM for one admitted run:

- pinned DSH version, profile, plugin manifest, image digest, and model route;
- one repo snapshot/workspace and explicit task descriptor;
- scoped tool, filesystem, network, and browser policy;
- short-lived model/SCM/event-ingest leases only;
- writes observations and artifacts through the worker gateway;
- cannot publish or attest; normally destroyed after receipt completion.

A third profile, `duplocode-verifier`, may be deployed on a separate worker class. It
receives the candidate artifact and immutable verification specification, not the producer’s
claims as decisive evidence.

---

## 6. DSH/Cordis composition design

### 6.1 DuploCode plugin suite

Initial plugin families:

```text
@duplocode/dsh-control-profile
@duplocode/dsh-control-ui
@duplocode/dsh-work-submission
@duplocode/dsh-operator-inbox
@duplocode/dsh-run-timeline
@duplocode/dsh-evidence-viewer
@duplocode/dsh-nim-fleet
@duplocode/dsh-nim-runtime-context
@duplocode/dsh-nim-admission-client
@duplocode/dsh-project-context
@duplocode/dsh-proxmox-dispatch-client
@duplocode/dsh-worker-telemetry
@duplocode/dsh-atlas-context
@duplocode/dsh-browser-authorized-workspace
```

Each plugin has a narrow contract, typed configuration, a declared dependency set, and a
cleanup path for every registration/effect.

### 6.2 Profiles, bundles, and updates

- Pin an upstream DSH revision and lock all package digests.
- Use a DuploCode bundle/profile and patch rows rather than carrying a deep fork.
- Keep local additions under `@duplocode/*`; upstream changes should be mergeable.
- DSH hot reload is allowed for development and non-authoritative UI composition.
- A production run receives a content-addressed `ExecutionComposition` and may not use
  a later live patch.
- Upgrades are proposed, qualified against fixtures and replay/evaluation scenarios,
  approved, and then become candidates for future runs.

### 6.3 Example control composition

```yaml
# Illustrative only; actual package names/config schemas are implementation work.
- id: duplocode-work-submission
  name: '@duplocode/dsh-work-submission'

- id: duplocode-nim-fleet
  name: '@duplocode/dsh-nim-fleet'
  config:
    endpoint: 'https://duplocode-control.internal/fleet'
    freshnessPolicy: 'require-fresh-for-admission'

- id: duplocode-inbox
  name: '@duplocode/dsh-operator-inbox'

- id: duplocode-run-timeline
  name: '@duplocode/dsh-run-timeline'
```

### 6.4 Cordis seam rules

For every new capability, define all three roles:

1. **Service definition:** stable TypeScript contract, e.g. `ctx.nimFleet`.
2. **Provider:** implementation, e.g. signed control-plane fleet API client.
3. **Consumer:** a UI panel, route adapter, prompt-context plugin, or tool.

A plugin requiring a capability declares `inject`. Optional capabilities are probed at use
and report a third-value unavailable state. No plugin assumes its dependency is present
merely because it was once present.

---

## 7. NIM fleet integration

NIM-specific operational intelligence is a first-class DuploCode capability, not an
environment-variable accident.

### 7.1 Normalized service

```ts
interface FleetSnapshot {
  snapshotId: string
  observedAt: string
  freshness: 'fresh' | 'stale' | 'unavailable'
  endpoints: Array<{
    id: string
    providerAlias: string
    models: Array<{ id: string; digest?: string; resident: boolean }>
    health: 'healthy' | 'degraded' | 'unavailable'
    breaker: 'closed' | 'open'
    activeSlots: number
    availableSlots: number
    queueDepth: number
  }>
}
```

The authoritative snapshot originates outside the worker, from the NIM/fleet control
service. A worker may observe it; it may not author it.

### 7.2 Two uses, two authorities

| Need | Authority |
|---|---|
| Show an agent current eligible routes and constraints | DSH NIM context plugin |
| Avoid dispatching a request to a known-dead route | DSH admission/route client, using a current lease |
| Allocate slots, budgets, and concurrent work | trusted scheduler only |
| Change breaker state or capacity accounting | trusted fleet service only |
| Mint provider access | credential broker only |

The scheduler issues a lease such as:

```text
run: run_123
route: nim-rig-1/qwen-coder@digest
max_requests: 12
budget: 250000 tokens
expires: recorded lease boundary
```

A DSH worker receives only that lease and an appropriate bounded context snapshot. It
cannot race other workers simply because it sees an apparently free slot.

Stale/unavailable fleet state cannot be interpreted as capacity. It yields an explicit
`unavailable`/Needs-Attention or retryable admission state according to policy.

---

## 8. Work, run, and evidence lifecycle

### 8.1 Identity model

```text
GitHub Issue  = external product intent and source of truth
Card          = local dispatch projection of the issue
WorkProposal  = requested bounded work shape, not yet admitted
Run           = one admitted execution attempt
Attempt       = one worker/model strategy execution within a run
Artifact      = commit, diff, proof, log, screenshot, report, or build output
Receipt       = signed/attributed statement about an observed action
Verdict       = conclusion derived from independent evidence
```

A run does not replace a card; cards do not replace GitHub issues. They answer different
questions.

### 8.2 Operator-to-publication flow

```text
1. Operator expresses intent in DSH Studio/Chat or an issue is ingested.
2. DSH control plugins assemble project facts and create a typed WorkProposal.
3. Governance validates schema, scope, policy, project trust dial, dependencies,
   budget, and required verification shape.
4. Governance records an admitted Run with a pinned ExecutionComposition.
5. Scheduler grants resource/model/credential leases.
6. Proxmox launcher provisions a selected worker profile from a golden image.
7. Worker hydrates the repository snapshot and launches pinned DSH worker profile.
8. Worker performs bounded work and streams scrubbed observations/artifact references.
9. Worker returns a candidate artifact and terminal receipt; it is destroyed or its
   workspace is checkpointed under an explicit retention policy.
10. Governance dispatches independent verifier(s) on a trusted/separate plane.
11. Verifiers return evidence and third-value-aware outcomes.
12. Governance evaluates constitutional publication policy.
13. PASS with required evidence -> signed attestation -> push/PR/publication.
    Otherwise -> halt/refusal/inconclusive state surfaced in the operator Inbox.
```

No worker directly merges, pushes with ambient credentials, signs an attestation, or
claims completion as publication authority.

---

## 9. Worker lifecycle and Proxmox design

### 9.1 Worker profiles

A worker profile is a versioned declaration, not a mutable VM personality.

```yaml
id: coding-nim-qwen-v1
imageDigest: sha256:...
execution:
  harnessProfile: duplocode-worker
  compositionDigest: sha256:...
capabilities:
  - scm.workspace
  - coding.agent
  - tests.node
  - atlas.context
models:
  - nim-rig-1/qwen-coder@sha256:...
resources:
  cpu: 8
  memory: 16GiB
lifecycle: ephemeral
```

Examples:

- `coding-nim-qwen-v1`: local coding/model work;
- `coding-frontier-v1`: constrained frontier model work;
- `verify-node-web-v1`: clean-room build/runtime verification;
- `browser-authorized-v1`: explicitly authorized browser workspace;
- `research-readonly-v1`: no mutation or publishing capability.

### 9.2 Provisioning contract

The Proxmox launcher receives a run id and an approved profile. It may:

1. create a VM from an approved golden/template image;
2. attach only run-specific workspace/configuration and bounded leases;
3. wait for signed/attested worker registration or surface an unavailable state;
4. record lifecycle receipts (`requested`, `ready`, `lost`, `returned`, `destroyed`);
5. destroy the worker only as an explicit post-run lifecycle action, never as silent
   stall handling.

A worker loss does not delete the run. It creates an evidence-backed interruption state
with its last durable checkpoint/receipt.

### 9.3 Persistent workspaces

Ephemeral compute is the default. Persistent state is an explicit separate abstraction:

```text
worker process/VM: disposable
workspace state: named, encrypted, versioned, lease-controlled artifact
```

A persistent authorized browser workspace may retain a browser profile, downloads, and
application state only for an account/project explicitly authorized by the operator.
Credentials remain in the broker. Session cookies/tokens are never copied into event logs
or model context. A provider’s reauthentication demand is surfaced, not circumvented.

---

## 10. Browser and GUI automation

Provide one capability, `gui.interact`, with multiple backends:

```text
DOM / Playwright
accessibility tree
OCR
screenshot / vision grounding
native desktop accessibility APIs
remote browser provider
```

The scheduler/profile chooses suitable backends; a backend may fall back when confidence
is insufficient. A consequential action requires post-action observation and, where policy
requires it, operator approval.

The system must not rely solely on DOM selectors: visual grounding protects workflows
when underlying element names or structure change without changing visible intent.
Conversely, vision alone is not sufficient evidence of a resulting state. Hybrid evidence is
preferred:

```text
visual target + accessible/DOM evidence + URL/account context + observed result
```

No anti-detection, fingerprint spoofing, behavioral deception, or evasion of third-party
account protection is in scope.

---

## 11. Data and event design

### 11.1 Data stores

| Store | Authority |
|---|---|
| PostgreSQL | projects, runs, policy decisions, leases, operator decisions, verifier outcomes, audit indexes |
| Object store | scrubbed trajectories, proof media, reports, build artifacts, screenshots, replay bundles |
| Git/GitHub | source intent, commits, PRs, upstream delivery state |
| DSH worker session log | local reconstruction of what a worker agent saw/did; exported as an observation, never sole publication authority |

### 11.2 Event classes

```text
Governance events: RUN_ADMITTED, LEASE_GRANTED, POLICY_REFUSED, PUBLISH_AUTHORIZED
Worker observations: MODEL_CALLED, TOOL_RESULT, FILE_MUTATED, ARTIFACT_UPLOADED
Fleet receipts: WORKER_READY, WORKER_LOST, WORKER_RETURNED
Verifier evidence: TEST_EXECUTED, RUNTIME_GATE_RESULT, PROVENANCE_CHECKED
Operator events: APPROVAL_GRANTED, TRUST_DIAL_CHANGED, NEEDS_ATTENTION_RESOLVED
```

The control plane stores immutable envelopes with:

```text
id, run_id, project_id, producer, producer-trust-class,
sequence/idempotency key, observed timestamp, received timestamp,
payload digest, artifact references, composition digest
```

Worker event ingestion validates envelope shape and authentication but does not turn
untrusted worker claims into a PASS. External/raw payloads are classified and scrubbed
before durable retention.

### 11.3 Reconstructability versus determinism

A run should be reconstructable, not assumed bit-for-bit reproducible. Persist or pin:

```text
repo snapshot / commit
work specification
worker image digest
DSH revision and composition digest
plugin package digests
model identity/digest and sampling settings
context inputs and their provenance
policy version
verification specification
```

Model output may vary under the same inputs. Experiments compare outcome distributions,
not a single supposedly deterministic replay.

---

## 12. Verification and publication design

### 12.1 Pluginized but constitutional gates

A verifier implementation can be a plugin/profile, but the control plane selects and pins
it. A producer cannot disable or replace the verifier required for its run.

Separate:

```text
Gate definition:    what predicate/evidence contract exists
Gate implementation: how a verifier executes it
Gate placement:     where it appears in an allowed workflow
Publication policy: which gate outcomes are mandatory before release
```

Workflow discovery may alter permitted non-constitutional placement only through an
engine-mediated, validated, pinned proposal. Secret scanning, credential containment,
required verification, provenance checks, and publication order remain mandatory.

### 12.2 Verdict algebra

Every verifier reports one of:

```text
pass        evidence supports the predicate
fail        evidence demonstrates violation
inconclusive/verdict-withheld
            evidence was unavailable, truncated, stale, or the verifier could not run
```

A bound firing (timeout, cap, missing binary, unavailable trusted source) withholds a
verdict. It must not manufacture pass or fail.

### 12.3 Independent evidence

At least one decisive verifier runs outside the producer-controlled workspace/plane where
appropriate. Evidence provenance records:

- who/what produced it;
- the image/composition used;
- candidate commit/artifact identity;
- trusted configuration captured before producer control where required;
- exact command/check identity and result;
- whether the check actually ran.

Attestation is issued only from this evidence, not a model summary.

---

## 13. Operator experience

The control UI starts from DSH’s session and tool timeline, then adds DuploCode
projections.

### 13.1 Briefing home

The default landing surface answers:

```text
What changed since I last looked?
What needs my decision now?
What is proven delivered?
What is uncertain, blocked, or degraded?
```

It carries evidence with decisions. An operator should not need to search raw logs to
understand why an approval, halt, or refusal exists.

### 13.2 Studio

The operator forms intent through an evidence-aware conversation. A crystallization action
turns a thread into an issue, design artifact, WorkProposal, or project directive with
provenance.

### 13.3 Engine Room

Timeline, raw run forensics, fleet health, event ledger, graph, cost, and Kanban remain
available but are not the default operator workload. Kanban is one projection and can be
disabled or replaced without changing issue/card/run truth.

### 13.4 Needs-Attention

The Inbox is a queue of real operator decisions. It includes verification refusals,
authentication requests, unavailable capacity, scope ambiguity, policy decisions, and
interrupted workers. It does not silently retry until a problem disappears, auto-kill work,
or bury the operator in duplicate noise.

---

## 14. Experimentation and self-improvement

A future optimizer consumes only promoted evaluation artifacts. It may:

1. select a held-out, admissible run set;
2. run a candidate profile/harness/context strategy under a declared budget;
3. compare against a control using predefined outcomes;
4. produce an attributed recommendation with uncertainty;
5. require an operator/policy promotion before the candidate becomes default.

Candidate experiments may include:

```text
DSH version/profile changes
context-compaction strategies
ATLAS context variants
NIM route/provider selection
single worker vs best-of-N strategy
browser backend selection
worker image/profile changes
```

No optimizer may self-apply changes to publication policy, credential authority, or the
verification floor.

---

## 15. Delivery plan

The sequence is dependency-based, not calendar-based.

### Phase 0 — Architecture proof

**Goal:** prove that DSH can serve as the agent runtime without weakening DuploCode’s trust
posture.

Deliverables:

- pinned DSH upstream revision and compatibility adapter;
- `duplocode-control` profile that launches the DSH Web UI;
- one custom UI/conversation plugin and one typed DuploCode service client;
- run composition manifest/digest model;
- threat model documenting trusted server vs untrusted worker plugin boundaries.

Acceptance:

- a local profile patch adds/removes a non-authoritative DuploCode UI component without
  changing the control service;
- a run records its exact DSH/plugin composition;
- no unreviewed/out-of-tree plugin can load in the governance container.

### Phase 1 — One governed remote coding slice

**Goal:** one operator request becomes one bounded Proxmox worker run.

Deliverables:

- typed WorkProposal and admission API;
- scheduler lease for one worker/model route;
- Proxmox launcher with worker lifecycle receipts;
- pinned `duplocode-worker` DSH profile;
- authenticated, scrubbed worker observation gateway;
- clean-room verifier profile;
- evidence-driven terminal UI timeline and Needs-Attention state.

Acceptance:

- an operator can submit a bounded coding task from the DSH interface;
- a worker can be lost without losing run identity/history;
- a successful worker claim alone cannot produce publication;
- independent verifier PASS is required for a test publication path;
- unavailable fleet/verification evidence produces an explicit third-value surface.

### Phase 2 — NIM fleet intelligence

**Goal:** turn existing NIM operational knowledge into a reusable capability.

Deliverables:

- fleet snapshot service and freshness semantics;
- slot/budget leases;
- DSH NIM context and routing plugins;
- route/model provenance on worker and verifier receipts;
- operator Fleet view.

Acceptance:

- agents see bounded, logged fleet context;
- workers cannot allocate a slot merely by observing fleet state;
- stale/unknown status never becomes available capacity;
- provider/model swap occurs through pinned configuration, not code forks.

### Phase 3 — Control-surface migration

**Goal:** DSH-derived Briefing/Studio/Inbox becomes the primary operator surface.

Deliverables:

- Briefing, Studio crystallization, Inbox, evidence/timeline panels;
- GitHub issue/card/run projections;
- optional Kanban/graph compatibility views.

Acceptance:

- disabling Kanban does not alter work identity, dispatch, or publication behavior;
- every action that requires an operator decision has linked evidence;
- raw DSH session timeline and DuploCode run timeline remain navigable together.

### Phase 4 — More execution and verification profiles

**Goal:** prove replaceability rather than assume it.

Deliverables:

- second engine/model family profile;
- second sandbox/worker backend or clean-room verifier backend;
- browser/GUI capability profile for authorized workflows;
- profile qualification suite and promotion mechanism.

Acceptance:

- the same governance Run contract dispatches to at least two different profiles;
- each profile has evidence-backed capability qualification;
- no profile change weakens the publication floor.

### Phase 5 — Governed experimentation

**Goal:** earn self-improvement from evidence.

Deliverables:

- scrubbed evaluation/replay bundle format;
- held-out experiment selector;
- comparison report and recommendation inbox;
- explicit promotion/rollback records.

Acceptance:

- an experiment never changes a live run’s pinned composition;
- recommendations carry control, candidate, population, outcome, and uncertainty;
- promotion is attributable and reversible.

---

## 16. Major risks and responses

| Risk | Response |
|---|---|
| DSH developer-preview breaking changes | Pin upstream; isolate integration in adapters/profile packages; qualify upgrades before promotion. |
| Plugin system mistaken for security isolation | Trusted-only governance composition; run candidate/untrusted plugins only in disposable workers; independent verification. |
| DSH HMR changes a live run | Content-address and pin execution composition at admission; permit HMR only for non-authoritative development/UI contexts. |
| Worker log fabricates success | Treat worker logs as observations; require independent verifier evidence. |
| Proxmox complexity overwhelms product work | Start with one worker profile and one clean-room verification slice; do not build a generic fleet platform first. |
| NIM telemetry becomes a stale routing oracle | Scheduler owns leases; freshness is explicit; stale/unavailable is a third value. |
| Credentials leak into DSH/model/session logs | External broker, scoped leases, scrubbing, no secrets in prompt/argv/env/log/image; minimize worker authority. |
| “Everything plugin” turns into architecture theater | Require at least two real implementations before generalizing an interface; retain a small constitutional authority core. |
| Browser continuity undermines account security | Authorized per-project identity workspace, exclusive lease, encrypted state, explicit reauth/HITL, no evasion features. |

---

## 17. Decisions to make before implementation

1. **Repository shape:** separate greenfield repository versus staged migration repository.
   Recommendation: a separate repository with narrow, versioned adapters to DuploCode
   concepts; avoid a big-bang rewrite of the existing production system.
2. **DSH integration mode:** consume pinned upstream packages or maintain a fork.
   Recommendation: consume/pin upstream plus `@duplocode/*` packages; fork only when a
   change cannot be upstreamed or adapter-isolated.
3. **Control-plane deployment:** one initial container/process group versus separate
   services. Recommendation: one logical deployment is acceptable initially, but retain
   process/API boundaries around credential broker, worker launcher, and verifier.
4. **First worker target:** local clean-room verifier container or Proxmox VM.
   Recommendation: select the smallest target that proves the external launcher/receipt
   contract; Proxmox VM is the desired end-state fleet substrate.
5. **First task class:** TypeScript/Node web repository with runnable tests/runtime gate.
   Recommendation: start where existing verification knowledge is strongest.
6. **Plugin trust/signing:** which package registry, digest lock, review, and promotion
   process governs server-side plugin loading.
7. **Artifact storage:** object-store implementation and retention policy for scrubbed
   trajectories/proofs.
8. **Identity/account model:** single operator first, preserving project-scoped state as
   the foundation for later tenant isolation.

---

## 18. Success definition

The architecture is proven by replacement, not diagrams.

The first meaningful success is:

```text
An operator submits work through a DSH Web UI.
A DuploCode plugin produces a bounded proposal.
The governance plane admits it and leases NIM/worker capacity.
A Proxmox worker runs a pinned DSH coding profile.
A separate verifier independently evaluates the candidate.
The Web UI shows the trajectory, evidence, and accountable outcome.
The worker is destroyed.
The exact same governance path can then run a second harness/model/worker profile
without changing the governance core.
```

If that works, the system has demonstrated the intended property:

> DuploCode can be wrong about how work is executed without being wrong about how work is governed.
