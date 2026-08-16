# DuploCode Next implementation plan

**Status:** active.  
**Architecture source:** `../duplocode-next-prd.md`.  
**Upstream runtime pin:** DeepSeek Harness commit
`47f943859bef60e4160492346772ded9b24f765a`.

## Outcome

Build a small trusted DuploCode governance plane and a DuploCode plugin suite on
DeepSeek Harness (DSH). DSH supplies the composable agent runtime and Web
surface; DuploCode owns admission, leases, worker lifecycle, independent
verification, evidence, attestation, and publication authority.

A producer is never a publication authority. Worker logs, summaries, and
self-authored test claims are observations only.

## Constitutional constraints

- GitHub is the source of truth for issue intent; a card is a projection and a
  run is an attempt.
- Runs pin their repository snapshot, DSH revision, composition, plugin
  digests, image, model route, policy, and verification specification.
- Worker compute is disposable. Run identity, receipts, evidence, and artifacts
  are durable and attributable.
- No secrets in source control, images, command arguments, model context,
  session logs, or durable trajectories.
- Verdicts are `pass`, `fail`, or `inconclusive`; unavailable evidence cannot
  become success.
- A decisive verifier runs independently of the producer workspace/plane.
- Publication follows a signed policy decision backed by verifier evidence;
  neither a worker nor a DSH plugin may bypass that floor.
- Policy may tighten automatically, never loosen automatically. Stalled or
  unavailable work is surfaced to an operator rather than silently killed or
  rewritten as a terminal verdict.

## Delivery sequence

### Phase 0 — architecture proof

**Goal:** prove DSH composition without weakening the trust boundary.

1. Initialize this repository as a TypeScript/pnpm workspace.
2. Pin DSH upstream as an unmodified git submodule/lock reference at the commit
   above; all local code remains under `@duplocode/*`.
3. Add the initial domain package containing canonical, serializable contracts:
   `WorkProposal`, `Run`, `ExecutionComposition`, `Lease`, `Receipt`,
   `Evidence`, `Verdict`, and `PublicationDecision`.
4. Add composition-manifest canonicalization and SHA-256 digesting. A run may
   reference only an immutable composition digest.
5. Add an explicit trust-boundary model: trusted control-plane adapters versus
   untrusted worker adapters/plugins.
6. Add a minimal `duplocode-control` DSH overlay/profile and one non-authoritative
   DuploCode plugin seam. It must be removable without affecting governance
   state.
7. Validate the DSH profile/configuration with the pinned upstream runtime.

**Exit gate:** removing the UI/plugin overlay leaves the governance contracts
untouched; a sample run records its exact composition; no out-of-tree plugin is
implicitly admitted to the control profile.

### Phase 1 — one governed remote coding slice

**Goal:** one admitted proposal becomes one bounded Proxmox worker attempt and
an independently verified outcome.

1. Implement a control-plane API with durable storage behind repository ports.
2. Implement admission and policy evaluation for one TypeScript/Node task class.
3. Implement Proxmox launcher/adapters using the least-privilege
   `duplo-armctl` account. The launcher receives only an admitted run and an
   approved worker profile.
4. Create a dedicated `duplocode-worker-base-v1` golden template in the
   `builder-arms` pool. Do not modify the CI runner templates.
5. Use short-lived, bounded worker/model/event-ingest leases; the worker returns
   artifacts and scrubbed observations through a gateway.
6. Implement a clean-room verifier profile and three-valued verdict handling.
7. Render run receipts, evidence, and Needs-Attention states in the control UI.

**Exit gate:** a worker loss preserves the durable run; worker success cannot
publish; an independent verifier pass is necessary for the test publication
path; unavailable evidence is explicit.

### Phase 2 — fleet intelligence

Add a trusted fleet snapshot service, freshness semantics, scheduler-issued
route/slot leases, route provenance, and a Fleet UI projection. Observed fleet
status never grants capacity to workers.

### Later phases

Migrate the operator control surface, qualify at least a second execution and
verification profile, then add held-out governed experimentation. No later
phase may alter the constitutional publication floor.

## Infrastructure facts verified

- The local Proxmox API is reachable and authenticated read-only access works.
- Existing accounts include `duplo-armctl`, `duplo-fleetctl`, `duplo-audit`, and
  `duplo-runnerctl`.
- `duplo-armctl` has the expected builder-arm provisioning boundary, but the
  `builder-arms` pool currently has no members.
- Existing `golden-ci-runner*` templates belong to the separate `ci-runners`
  pool and are not a DuploCode Next worker template.
- The NIM gateway is reachable at
  `http://docker-container-tyler.tailfce72b.ts.net:8742`. The MagicDNS hostname
  is required because the gateway routes by its HTTP Host header; the raw
  tailnet IP is not the canonical client endpoint. Model discovery works.
- The initial approved coding route is `z-ai/glm-5.2`. It passed a minimal
  authenticated completion probe, but the endpoint is known to be flaky; it is
  a Phase-0/early-testing route only, not evidence of durable fleet capacity.

## Required operator inputs before Phase 1 dispatch

1. Approve creation of `duplocode-worker-base-v1` in `builder-arms`.
2. Place the normal-operation `duplo-armctl` credential in
   `~/.config/duplocode-next/secrets/proxmox-scoped.secret`; retain the admin
   credential only for bootstrap audits.
3. Approve the initial NIM model-route allowlist/digests from the discovered
   gateway roster.
4. Decide object-store and Postgres deployment details before durable remote
   execution is enabled.

## Secret handling

Credentials are local-only under `~/.config/duplocode-next/secrets/` with mode
`0700` directories and mode `0600` files. They are excluded from source
control. No implementation will read a credential into a model prompt, child
process arguments, or a durable event.
