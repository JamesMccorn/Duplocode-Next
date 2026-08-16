// Offline structural validation for the DuploCode control-profile template.
//
// Runs with `node --test` on Node >= 18 and NO external dependencies (only the
// Node stdlib). It does not boot DSH, install a package, or touch $DSH_HOME; it
// only checks that the deployable template under `../profile` is well-formed and
// stays a non-authoritative, in-box-only composition. Pair it with the DSH-side
// composition check in the README (`dsh --profile duplocode-control
// --dump-config`), which requires a real dsh installation.

import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

const profileDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'profile')
const profileName = 'duplocode-control'

// The shipped DSH `web` template (from @deepseek-ai/dsh-app-boot PROFILE_TEMPLATES).
// These are the only in-box bundle names this profile may reference, and in this
// exact order. A name outside this list would be an unverified/out-of-tree plugin
// and is rejected here.
const EXPECTED_BUNDLES = Object.freeze(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])

function readJson(file) {
   return JSON.parse(readFileSync(file, 'utf8'))
}

/** Strip full-line `#` comments and blank lines; collapse internal whitespace. */
function yamlNonCommentLines(text) {
   return text
   .split('\n')
   .map((line) => line.trim())
   .filter((line) => line !== '' && !line.startsWith('#'))
}

test('profile directory holds exactly the three template files', () => {
   const entries = readdirSync(profileDir).sort()
   assert.deepEqual(
      entries,
      ['cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml'],
      `unexpected files in ${profileDir}`,
   )
})

test('profile manifest lists the ordered in-box bundles and nothing invented', () => {
   const manifest = readJson(join(profileDir, 'package.json'))

   // It is a profile, not a bundle/plugin. A `dsh.bundle` would mean DSH treats
   // this directory as a mountable plugin, which is out of scope and unverified.
   assert.equal(manifest.dsh?.bundle, undefined, 'profile must not declare dsh.bundle')
   assert.equal(manifest.dsh?.plugin, undefined, 'profile must not declare dsh.plugin')

   const bundles = manifest.dsh?.profile?.bundles
   assert.ok(Array.isArray(bundles), 'dsh.profile.bundles must be an array')
   assert.deepEqual(bundles, EXPECTED_BUNDLES, 'bundles must be exactly the ordered in-box pair')
   // Re-assert order independently so a future reordering is caught loudly.
   assert.equal(bundles[0], '@deepseek-ai/dsh-base')
   assert.equal(bundles[1], '@deepseek-ai/dsh-web-app')

   // No out-of-tree authority is admitted: no dependencies install any package.
   const deps = manifest.dependencies ?? {}
   assert.deepEqual(deps, {}, 'profile must mount no out-of-tree (out-of-trust) dependencies')

   // The profile directory name is how DSH identifies it; the manifest `name`
   // follows DSH's dsh-profile-<profile> init convention and must not drift.
   assert.equal(manifest.name, `dsh-profile-${profileName}`, 'manifest name follows DSH init convention')
   assert.ok(manifest.private === true, 'profile manifest must be private')
})

test('cordis.patch.yml is an empty, valid top-level YAML array (not comments-only)', () => {
   const path = join(profileDir, 'cordis.patch.yml')
   assert.ok(existsSync(path), 'cordis.patch.yml must exist so this source-controlled template has an explicit empty layer')
   const raw = readFileSync(path, 'utf8')
   // A missing optional layer is accepted by DSH, but this checked-in template
   // deliberately carries an explicit valid empty array rather than ambiguous comments.
   const body = yamlNonCommentLines(raw).join('\n').trim()
   assert.equal(body, '[]', 'user patch layer must be the empty array []')
   // Guard against a comments-only regression (which would break boot).
   assert.notEqual(yamlNonCommentLines(raw).length, 0, 'file must contain the [] array, not only comments')
})

test('pnpm-workspace.yaml mirrors DSH initProfile and is inert for this profile', () => {
   const raw = readFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'utf8')
   assert.match(raw, /nodeLinker:\s*hoisted/, 'nodeLinker hoisted (DSH profile default)')
   assert.match(raw, /autoInstallPeers:\s*false/, 'autoInstallPeers false (DSH profile default)')
   assert.match(raw, /packages:\s*\n\s*-\s*\./, 'workspace packages: [.] (DSH profile default)')
})

test('deployment target path derives from the profile name', () => {
   // `resolveProfileDir` rejects '/', '\\', '.', '..', and 'node_modules'.
   for (const bad of ['/', '\\', '.', '..', 'node_modules']) {
      assert.ok(!profileName.includes(bad), `profile name must not contain ${JSON.stringify(bad)}`)
   }
   assert.equal(profileName, 'duplocode-control')
})
