/**
 * @duplocode/governance
 *
 * Fail-closed, deterministic run governance over @duplocode/contracts and
 * @duplocode/composition. It owns three boundaries:
 *   1. Admission: a WorkProposal is admitted only after its run composition is
 *      verified as a closed, digested whole.
 *   2. Lifecycle: RunState transitions are strictly legal; illegal moves throw.
 *   3. Publication: a run is published only when checkDecisivePass passes on an
 *      independent trusted-verifier record and a control-plane attestation is
 *      supplied. Unavailable or unrun evidence is surfaced as needs-attention /
 *      inconclusive, never as a pass.
 *
 * Signing is a separate control-plane service concern: this package never invents
 * or verifies an attestation signature, it only requires one to be provided.
 */
export * from './transitions.js'
export * from './ports.js'
export * from './run-service.js'
