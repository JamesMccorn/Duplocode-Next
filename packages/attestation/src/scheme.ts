import { createHmac } from 'node:crypto'

/**
 * The cryptographic boundary behind the attestation boundary. Attestation
 * verification never calls into a concrete signature engine directly: it asks
 * the injected scheme to verify a signature against a canonical string and a
 * key. This is what makes the signer/verifier boundary injectable and unit
 * testable with a fake engine.
 */
export interface SignatureScheme {
    /** Stable id carried by every signed attestation so a verifier routes to the right engine. */
    readonly id: string
    /** Deterministically sign the canonical bytes with a private signing key. */
    sign(signedData: string, signingKey: string): string
    /** Constant-time check of a signature previously produced by `sign`. */
    verify(signedData: string, signature: string, verifyingKey: string): boolean
}

/**
 * A concrete, dependency-free scheme backed by HMAC-SHA256. It is a *fake* in
 * the sense that a real control plane would swap in an asymmetric engine, but
 * it exercises the same boundary contract: sign over canonical bytes, verify
 * against a key, and fail closed on any discrepancy.
 */
export function createHmacSha256Scheme(): SignatureScheme {
    const sign: SignatureScheme['sign'] = (signedData, signingKey) =>
        createHmac('sha256', signingKey).update(signedData, 'utf8').digest('hex')
    const verify: SignatureScheme['verify'] = (signedData, signature, verifyingKey) => {
        if (signature.length === 0) return false
        const expected = createHmac('sha256', verifyingKey).update(signedData, 'utf8').digest('hex')
        if (expected.length !== signature.length) return false
        return createHmac('sha256', verifyingKey).update(signedData, 'utf8').digest('hex') === signature
    }
    return { id: 'hmac-sha256', sign, verify }
}
