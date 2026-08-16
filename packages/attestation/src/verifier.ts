import { canonicalAttestation, type AttestationPayload } from './payload.js'
import type { SignatureScheme } from './scheme.js'
import type { SignedAttestation } from './signer.js'

/**
 * Fail-closed reasons. Each is mutually exclusive and a verifier returns exactly
 * one when admission is refused, so a caller can audit *why* a control plane
 * would not accept the attestation.
 */
export type AttestationFailure =
   | 'unsigned'
   | 'invalid-signature'
   | 'unknown-scheme'
   | 'untrusted-issuer'
   | 'payload-mismatch'

export type AttestationVerdict =
   | { readonly ok: true; readonly issuer: string }
   | { readonly ok: false; readonly reason: AttestationFailure }

export interface AttestationVerifier {
     /**
      * Admit a signed attestation only when it is signed, its signature is
      * valid, its authenticated issuer is trusted, and its payload matches the
      * `expected` binding the consumer asserts. Any failure returns ok:false.
      */
    verify(expected: AttestationPayload, attestation: SignedAttestation): AttestationVerdict
}

export interface AttestationVerifierConfig {
     /** Trusted issuer -> verifying key. Membership IS trust; absence fails closed. */
    readonly trustedIssuers: ReadonlyMap<string, string>
     /** Signature engines, keyed by the `schemeId` a signed attestation routes to. */
    readonly schemes: ReadonlyMap<string, SignatureScheme>
}

export function createAttestationVerifier(config: AttestationVerifierConfig): AttestationVerifier {
    return {
        verify(expected, attestation) {
            // 1. Reject anything never signed.
            if (attestation.signature.length === 0) return { ok: false, reason: 'unsigned' }

            // 2. Route to a known engine; an unknown scheme cannot be checked.
            const scheme = config.schemes.get(attestation.schemeId)
            if (scheme === undefined) return { ok: false, reason: 'unknown-scheme' }

            // 3. Trust is keyed off the *authenticated* issuer (the signed payload's),
            //    never a self-asserted one. Unknown issuer fails closed first.
            const key = config.trustedIssuers.get(attestation.payload.issuer)
            if (key === undefined) return { ok: false, reason: 'untrusted-issuer' }

            // 4. The signed bytes must genuinely match this key.
            const signedData = canonicalAttestation(attestation.payload)
            if (!scheme.verify(signedData, attestation.signature, key)) {
                return { ok: false, reason: 'invalid-signature' }
             }

            // 5. What was signed must equal what the consumer asserts.
            if (canonicalAttestation(expected) !== signedData) {
                return { ok: false, reason: 'payload-mismatch' }
             }

            return { ok: true, issuer: attestation.payload.issuer }
            }
         }
}
