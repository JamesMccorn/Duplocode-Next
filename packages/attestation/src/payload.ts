import { canonicalJson, sha256, type CanonicalJson } from '@duplocode/composition'
import type { PublicationDecision, Sha256Digest } from '@duplocode/contracts'

/**
 * The authoritative fields a control-plane attestation vouches for: a subset of
 * `PublicationDecision`. Only these fields are signed, so anything omitted here
 * cannot carry publication authority.
 */
export interface AttestationPayload {
    readonly runId: string
    readonly policyVersion: string
    readonly decisiveEvidenceIds: readonly string[]
    readonly issuer: string
}

/** Closed, version-guarded schema tag for the signed binding. */
const PAYLOAD_SCHEMA = 'duplocode-attestation/payload-v1'

/**
 * The single canonical serialization that becomes the signed bytes. Field order
 * is fixed and evidence ids are sorted so a payload binds as a set, independent
 * of insertion order.
 */
function canonicalPayload(payload: AttestationPayload): CanonicalJson {
    return {
        schema: PAYLOAD_SCHEMA,
        runId: payload.runId,
        policyVersion: payload.policyVersion,
        issuer: payload.issuer,
        decisiveEvidenceIds: [...payload.decisiveEvidenceIds].sort()
     }
}

/** Canonical JSON of the payload — the exact bytes that get signed. */
export function canonicalAttestation(payload: AttestationPayload): string {
    return canonicalJson(canonicalPayload(payload))
}

/** Stable digest of the canonical payload. */
export function digestAttestation(payload: AttestationPayload): Sha256Digest {
    return sha256(canonicalAttestation(payload))
}

/** The payload that a signed `PublicationDecision` attests to, field-for-field. */
export function payloadFromDecision(decision: PublicationDecision): AttestationPayload {
    return {
        runId: decision.runId,
        policyVersion: decision.policyVersion,
        decisiveEvidenceIds: [...decision.decisiveEvidenceIds],
        issuer: decision.issuer
        }
}
