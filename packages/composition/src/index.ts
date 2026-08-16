import { createHash } from 'node:crypto'

/** Kept structural so this package does not pull governance authority into the loader path. */
export type Sha256Digest = `sha256:${string}`
export type CanonicalJson = null | boolean | number | string | readonly CanonicalJson[] | { readonly [key: string]: CanonicalJson }

function canonicalize(value: CanonicalJson): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Composition values must not contain non-finite numbers.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`

  const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`).join(',')}}`
}

/** Stable JSON serialization used as the only input to a composition digest. */
export function canonicalJson(value: CanonicalJson): string {
  return canonicalize(value)
}

export function sha256(value: string): Sha256Digest {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

export function digestComposition(composition: CanonicalJson): Sha256Digest {
  return sha256(canonicalJson(composition))
}

/** Closed admission-time input. Unknown or missing top-level keys are rejected. */
export type RunCompositionManifest = {
  readonly schemaVersion: 1
  readonly repositoryCommit: string
  readonly executionComposition: CanonicalJson
} & { readonly [key: string]: CanonicalJson }

const MANIFEST_KEYS = ['executionComposition', 'repositoryCommit', 'schemaVersion']

export function validateRunCompositionManifest(value: CanonicalJson): asserts value is RunCompositionManifest {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError('Run composition manifest must be an object.')
  const keys = Object.keys(value).sort()
  if (keys.length !== MANIFEST_KEYS.length || keys.some((key, index) => key !== MANIFEST_KEYS[index])) {
    throw new TypeError('Run composition manifest must contain exactly schemaVersion, repositoryCommit, and executionComposition.')
  }
  const object = value as { readonly [key: string]: CanonicalJson }
  if (object.schemaVersion !== 1 || typeof object.repositoryCommit !== 'string' || object.repositoryCommit.length === 0) {
    throw new TypeError('Run composition manifest has an invalid schemaVersion or repositoryCommit.')
  }
}

export function digestRunComposition(manifest: RunCompositionManifest): Sha256Digest {
  validateRunCompositionManifest(manifest)
  return digestComposition(manifest)
}
