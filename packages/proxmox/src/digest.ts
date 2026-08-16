import { createHash } from 'node:crypto'

/**
 * A small, self-contained canonical-JSON + SHA-256 helper.
 *
 * Kept local so the launcher boundary does not pull governance/digest authority
 * from another package. It only provides a stable digest of a frozen declaration;
 * the authoritative composition digest still lives in `@duplocode/composition`.
 */
export type Sha256Digest = `sha256:${string}`
export type CanonicalJson = null | boolean | number | string | readonly CanonicalJson[] | { readonly [key: string]: CanonicalJson }

function canonicalize(value: CanonicalJson): string {
   if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
   if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Profile digest inputs must not contain non-finite numbers.')
      return JSON.stringify(value)
   }
   if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
   const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
   return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`).join(',')}}`
}

/** Order-independent JSON used as the only input to a profile digest. */
export function canonicalJson(value: CanonicalJson): string {
   return canonicalize(value)
}

export function sha256(value: string): Sha256Digest {
   return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

export function digestCanonical(value: CanonicalJson): Sha256Digest {
   return sha256(canonicalJson(value))
}
