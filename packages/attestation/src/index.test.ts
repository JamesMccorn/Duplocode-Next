import assert from 'node:assert/strict'
import test from 'node:test'

import type { PublicationDecision } from '@duplocode/contracts'

import {
    createAttestationSigner,
    createAttestationVerifier,
    createHmacSha256Scheme,
    digestAttestation,
    canonicalAttestation,
    payloadFromDecision,
    type AttestationPayload,
    type SignedAttestation
     } from './index.js'

const scheme = createHmacSha256Scheme()
const TRUSTED_ISSUER = 'control-plane:alpha'
const TRUSTED_KEY = 'key-for-alpha'

function decision(payload: Partial<AttestationPayload> = {}): PublicationDecision {
    return {
       runId: payload.runId ?? 'run-wp-1',
       authorized: true,
       policyVersion: payload.policyVersion ?? 'policy-7',
       decisiveEvidenceIds: payload.decisiveEvidenceIds ?? ['ev-1', 'ev-2'],
       issuer: payload.issuer ?? TRUSTED_ISSUER,
       attestation: { digest: (`sha256:${'0'.repeat(64)}`) as `sha256:${string}`, mediaType: 'application/duplocode-attestation+json', uri: 'attestations/run-wp-1/decision' },
       decidedAt: '2020-01-01T00:00:00.000Z',
       reason: ''
      }
   }

function trustedVerifier() {
    return createAttestationVerifier({
       trustedIssuers: new Map([[TRUSTED_ISSUER, TRUSTED_KEY]]),
       schemes: new Map([[scheme.id, scheme]])
      })
   }
const untrustedIssuer = 'control-plane:rogue'
const untrustedKey = 'key-for-rogue'

test('a trusted, well-formed attestation admits its binding', () => {
   const signer = createAttestationSigner(scheme, TRUSTED_KEY)
   const payload = payloadFromDecision(decision())
   const attestation = signer.sign(payload)
   const verdict = trustedVerifier().verify(payload, attestation)
   assert.deepEqual(verdict, { ok: true, issuer: TRUSTED_ISSUER })
})

test('canonical binding is order-independent over evidence ids', () => {
   const a = digestAttestation({ runId: 'r', policyVersion: 'p', issuer: 'i', decisiveEvidenceIds: ['ev-2', 'ev-1'] })
   const b = digestAttestation({ runId: 'r', policyVersion: 'p', issuer: 'i', decisiveEvidenceIds: ['ev-1', 'ev-2'] })
   assert.equal(a, b)
})

test('verification rejects an unsigned attestation', () => {
   const signer = createAttestationSigner(scheme, TRUSTED_KEY)
   const payload = payloadFromDecision(decision())
   const unsigned: SignedAttestation = { ...signer.sign(payload), signature: '' }
   assert.deepEqual(trustedVerifier().verify(payload, unsigned), { ok: false, reason: 'unsigned' })
})

test('verification rejects a payload mismatch against the consumer binding', () => {
   const signer = createAttestationSigner(scheme, TRUSTED_KEY)
   const signed = signer.sign(payloadFromDecision(decision({ decisiveEvidenceIds: ['ev-1', 'ev-2'] })))
   const expected = payloadFromDecision(decision({ decisiveEvidenceIds: ['ev-1', 'ev-3'] }))
   assert.deepEqual(trustedVerifier().verify(expected, signed), { ok: false, reason: 'payload-mismatch' })
})

test('verification rejects a forged signature from an untrusted key', () => {
   const rogue = createAttestationSigner(scheme, 'rogue-key-that-is-not-trusted')
   const payload = payloadFromDecision(decision())
   const forged = rogue.sign(payload)
   assert.deepEqual(trustedVerifier().verify(payload, forged), { ok: false, reason: 'invalid-signature' })
})

test('verification fails closed on an untrusted issuer', () => {
   const signer = createAttestationSigner(scheme, untrustedKey)
   const payload = payloadFromDecision(decision({ issuer: untrustedIssuer }))
   const attestation = signer.sign(payload)
   assert.deepEqual(trustedVerifier().verify(payload, attestation), { ok: false, reason: 'untrusted-issuer' })
})

test('verification rejects an unknown signature scheme', () => {
   const signer = createAttestationSigner(scheme, TRUSTED_KEY)
   const payload = payloadFromDecision(decision())
   const attestation = signer.sign(payload)
   const verifier = createAttestationVerifier({
       trustedIssuers: new Map([[TRUSTED_ISSUER, TRUSTED_KEY]]),
       schemes: new Map()
      })
   assert.deepEqual(verifier.verify(payload, attestation), { ok: false, reason: 'unknown-scheme' })
})

test('payloadFromDecision mirrors the authority-carrying decision fields', () => {
   const payload = payloadFromDecision(decision())
   assert.deepEqual([payload.issuer, payload.policyVersion, payload.runId, payload.decisiveEvidenceIds],
       [TRUSTED_ISSUER, 'policy-7', 'run-wp-1', ['ev-1', 'ev-2']])
   assert.ok(canonicalAttestation(payload).includes('duplocode-attestation/payload-v1'))
})
