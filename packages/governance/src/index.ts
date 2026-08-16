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
 * nor produces a signature, but it DOES verify the injected attestation. An
 * @duplocode/attestation verifier is required, so a structurally valid attestation
 * reference can never authorize on its own — only a signature that verifies under a
 * trusted, controlled issuer can.
 */
export * from './transitions.js'
export * from './ports.js'
export * from './run-service.js'
export * from '@duplocode/attestation'
