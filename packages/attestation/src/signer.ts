import { canonicalAttestation, type AttestationPayload } from './payload.js'
import type { SignatureScheme } from './scheme.js'

/**
 * A signed attestation. The signature is over the canonical bytes of
 * `payload`; the verifier recomputes those bytes, so a tampered payload is
 * detected because its signature no longer matches.
 */
export interface SignedAttestation {
    readonly payload: AttestationPayload
    readonly schemeId: string
    readonly signature: string
}

/**
 * Injectable signer boundary. A control plane supplies its own implementation;
 * the attestation package never holds the signing key itself.
 */
export interface AttestationSigner {
    sign(payload: AttestationPayload): SignedAttestation
}

/**
 * Sign with a fixed scheme and private key held by the control plane. The
 * returned payload is defensively copied so the canonical binding is frozen.
 */
export function createAttestationSigner(scheme: SignatureScheme, signingKey: string): AttestationSigner {
    return {
        sign(payload) {
            const signature = scheme.sign(canonicalAttestation(payload), signingKey)
            return {
                payload: {
                    runId: payload.runId,
                    policyVersion: payload.policyVersion,
                    decisiveEvidenceIds: [...payload.decisiveEvidenceIds],
                    issuer: payload.issuer
                     },
                schemeId: scheme.id,
                signature
                 }
             }
         }
}
