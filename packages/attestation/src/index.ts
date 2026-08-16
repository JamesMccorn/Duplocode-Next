/**
 * @duplocode/attestation
 *
 * Injectable signer/verifier boundary for signed `PublicationDecision`
 * attestations.
 *
 * A canonical payload binds exactly four authority-carrying fields — `runId`,
 * `policyVersion`, `decisiveEvidenceIds`, and `issuer`. A control plane signs
 * that canonical payload with an injected signature scheme; the verifier fails
 * closed on any disagreement with what it is asked to admit: an *unsigned*
 * attestation, an *invalid signature*, an *unknown scheme*, an *untrusted
 * issuer* (trusted via the authenticated signature payload, never a self-
 * claimed one), or a *payload mismatch* against the binding the consumer asserts.
 *
 * Signing remains a control-plane responsibility: the package supplies the
 * boundary and a fake HMAC engine for tests, and is not yet wired into
 * @duplocode/governance.
 */
export * from './payload.js'
export * from './scheme.js'
export * from './signer.js'
export * from './verifier.js'
