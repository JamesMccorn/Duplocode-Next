import { canonicalJson, digestCanonical, type CanonicalJson, type Sha256Digest } from './digest.js'

/**
 * Worker profiles are versioned declarations, not mutable VM personalities
 * (PRD §9.1). A profile becomes launchable only after it is *approved*: its
 * immutable declaration is digested, and the binding to that digest is recorded.
 */

export type IsoTimestamp = string
export type WorkerLifecycle = 'ephemeral' | 'persistent'
export type WorkerResources = { readonly cpu: number; readonly memory: string } & { readonly [key: string]: number | string }
export type ModelRoute = string
export type RunLease = { readonly kind: 'worker' | 'model-route' | 'credential' | 'event-ingest'; readonly scope: string; readonly expiresAt: IsoTimestamp }

/** The immutable declaration. Every field must be a closed, validated value. */
export interface WorkerProfileDeclaration {
   readonly id: string
   readonly imageDigest: Sha256Digest
   readonly execution: { readonly harnessProfile: string; readonly compositionDigest: Sha256Digest }
   readonly capabilities: readonly string[]
   readonly models: readonly ModelRoute[]
   readonly resources: WorkerResources
   readonly lifecycle: WorkerLifecycle
}

/** The approval a control plane grants to a specific declaration digest. */
export interface WorkerProfileApproval {
   readonly issuer: string
   readonly approvedAt: IsoTimestamp
   readonly profileDigest: Sha256Digest
}

/** An approved profile: the frozen declaration plus its binding. */
export interface ApprovedWorkerProfile extends WorkerProfileDeclaration {
   readonly approval: WorkerProfileApproval
}

const NON_EMPTY = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

function asSha256(value: unknown): asserts value is Sha256Digest {
   if (typeof value !== 'string' || !value.startsWith('sha256:') || value.length !== 'sha256:'.length + 64) {
      throw new TypeError('Expected a sha256:<64hex> digest.')
   }
   if (!/^[0-9a-f]{64}$/.test(value.slice('sha256:'.length))) throw new TypeError('Expected a well-formed sha256 digest.')
}

function asStringArray(value: unknown, label: string): readonly string[] {
   if (!Array.isArray(value) || value.length === 0 || value.some((entry) => !NON_EMPTY(entry))) {
      throw new TypeError(`${label} must be a non-empty array of non-empty strings.`)
   }
   return value
}

function asResources(value: unknown): WorkerResources {
   if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('resources must be an object.')
   const record = value as Record<string, unknown>
   if (typeof record.cpu !== 'number' || !Number.isInteger(record.cpu) || record.cpu <= 0) {
      throw new TypeError('resources.cpu must be a positive integer.')
   }
   if (!NON_EMPTY(record.memory)) throw new TypeError('resources.memory is required.')
   for (const [key, entry] of Object.entries(record)) {
      if (!(key === 'cpu' || key === 'memory') && !(typeof entry === 'number' || typeof entry === 'string')) {
         throw new TypeError(`resources.${key} must be a number or string.`)
      }
   }
   return record as unknown as WorkerResources
}

/**
 * Validate the shape of a raw declaration. Rejects unknown shapes and empty/malformed
 * fields so only a well-formed object can ever reach approval.
 */
export function validateWorkerProfileDeclaration(input: unknown): asserts input is WorkerProfileDeclaration {
   if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Worker profile must be an object.')
   const record = input as Record<string, unknown>
   if (!NON_EMPTY(record.id)) throw new TypeError('profile.id is required.')
   asSha256(record.imageDigest)
   if (record.execution === null || typeof record.execution !== 'object' || Array.isArray(record.execution)) {
      throw new TypeError('profile.execution must be an object.')
   }
   const execution = record.execution as Record<string, unknown>
   if (!NON_EMPTY(execution.harnessProfile)) throw new TypeError('profile.execution.harnessProfile is required.')
   asSha256(execution.compositionDigest)
   asStringArray(record.capabilities, 'profile.capabilities')
   asStringArray(record.models, 'profile.models')
   asResources(record.resources)
   if (record.lifecycle !== 'ephemeral' && record.lifecycle !== 'persistent') {
      throw new TypeError("profile.lifecycle must be 'ephemeral' or 'persistent'.")
   }
}

/**
 * Deep-freeze a value so no launcher can mutate an approved profile. Arrays and
 * nested objects are frozen, not just the top level.
 */
export function deepFreeze<T>(value: T): T {
   if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
   for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
   return Object.freeze(value)
}

/**
 * The digest of a declaration depends only on its declaration fields, never on the
 * approval, and is independent of object-key insertion order.
 */
export function profileDigest(declaration: WorkerProfileDeclaration): Sha256Digest {
   return digestCanonical({
      id: declaration.id,
      imageDigest: declaration.imageDigest,
      execution: { harnessProfile: declaration.execution.harnessProfile, compositionDigest: declaration.execution.compositionDigest },
      capabilities: declaration.capabilities,
      models: declaration.models,
      resources: declaration.resources,
      lifecycle: declaration.lifecycle,
   } as CanonicalJson)
}

/** Approve a declaration: bind a fresh digest to an issuer and timestamp. */
export function approveWorkerProfile(
   declaration: WorkerProfileDeclaration,
   approval: { readonly issuer: string; readonly approvedAt: IsoTimestamp },
): ApprovedWorkerProfile {
   if (!NON_EMPTY(approval.issuer)) throw new TypeError('approval.issuer is required.')
   if (!NON_EMPTY(approval.approvedAt)) throw new TypeError('approval.approvedAt is required.')
   validateWorkerProfileDeclaration(declaration)
   const frozen = deepFreeze({ ...declaration }) as WorkerProfileDeclaration
   return deepFreeze({
      ...frozen,
      approval: deepFreeze({ issuer: approval.issuer, approvedAt: approval.approvedAt, profileDigest: profileDigest(frozen) }),
   })
}

/**
 * Re-verify an approved profile is internally consistent (frozen, approved, digest-bounded).
 * A launcher must call this before trusting a profile it did not itself approve.
 */
export function assertApprovedProfile(profile: ApprovedWorkerProfile): void {
   if (profile === null || typeof profile !== 'object') throw new TypeError('Approved worker profile required.')
   if (!Object.isFrozen(profile)) throw new TypeError('Worker profile is not immutably frozen.')
   validateWorkerProfileDeclaration(profile)
   const approval = profile.approval
   if (approval === null || typeof approval !== 'object' || !Object.isFrozen(approval)) {
      throw new TypeError('Approval record is required and must be frozen.')
   }
   if (!NON_EMPTY(approval.issuer) || !NON_EMPTY(approval.approvedAt)) {
      throw new TypeError('Approval requires issuer and approvedAt.')
   }
   const expected = profileDigest(profile)
   if (approval.profileDigest !== expected) throw new TypeError('Approval digest does not match the declaration.')
   asSha256(approval.profileDigest)
}

export type { CanonicalJson }
