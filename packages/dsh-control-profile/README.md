# `@duplocode/dsh-control-profile`

Source-controlled template for the **DuploCode control-plane DSH profile** — the
Phase-0 "minimal `duplocode-control` overlay/profile" from
[`docs/implementation-plan.md`](../../docs/implementation-plan.md). It pins how
an operator/worker runtime composes on DeepSeek Harness (DSH).

> **One-sentence trust statement:** deploying this profile *copies a DSH
> configuration under `$DSH_HOME`*. That is a **composition choice**, not a grant
> of authority. DSH (and the `dsh-web-app` surface this profile mounts) gets
> **no** governance power over admission, leases, worker lifecycle, verification,
> verdicts, evidence, attestation, or publication — all of which stay owned by the
> `@duplocode` control plane.

---

## What this is / is not

| | This package gives you | This package does **not** |
|---|---|---|
| A **DSH profile** = a composition layer that lives at `$DSH_HOME/profiles/duplocode-control/` and selects which DSH bundles mount. | A governance authority, a publication channel, or a way for a worker to bypass the policy floor. |
| In-box bundle wiring: `@deepseek-ai/dsh-base` then `@deepseek-ai/dsh-web-app`, in that order. | Any out-of-tree plugin or dependency; any credential, model route, or policy; any mount that confers authority. |
| An **empty** `cordis.patch.yml` (`[]`), so the composed tree is exactly the two bundle layers. | A non-authoritative DuploCode plugin seam. That seam is a separate, reviewed deliverable and is deliberately absent — see [Limitations](#limitations---not-yet-done). |
| A *removable overlay*: delete the profile directory and the governance plane is untouched. | Permanent state. Nothing here mutates a run, lease, receipt, evidence, verdict, or `PublicationDecision`. |

## DSH profile model (verified against the pinned upstream)

Verified against `upstream/deepseek-harness` commit
`47f943859bef60e4160492346772ded9b24f765a`
(`upstream/deepseek-harness/packages/boot/app-boot/src/profile.ts`,
`.../src/index.ts`, `docs/architecture.md`, `docs/user/develop/basic/publish.md`):

- A **profile** is a directory under `$DSH_HOME/profiles/<name>` (DSH home resolves
  as `$DSH_HOME`, else `~/.dsh`) holding a `package.json` whose `dsh.profile.bundles`
  is an **ordered** list of bundle layers, plus a `cordis.patch.yml` (the user's
  own patch layer, applied after every bundle layer) and `pnpm-workspace.yaml`.
  DSH identifies a profile by its **directory name**, not by the manifest `name`.
- A **bundle** is a package that declares `dsh.bundle` (a patch file); `loadProfile`
  **fails loud** if a listed bundle does not declare `dsh.bundle`, so the layer
  stack is a known, in-box composition — this profile names **only** the two
  shipped, verified in-box bundles (below), which resolve from the `dsh`
  installation itself.
- Layers apply over an empty entry list in order: ① each bundle in
  `dsh.profile.bundles` order, ② the profile's `cordis.patch.yml`, ③ the home-level
  `$DSH_HOME/cordis.patch.yml`, ④ each `--patch <file>` overlay. A later layer wins
  per row; a patch replaces a row's whole `config`.
- The two bundles here are exactly DSH's shipped **`web`** template tuple
  (`PROFILE_TEMPLATES.web`): `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']`.
- **User patch layer format.** `loadOptionalPatches` parses an existing
  `cordis.patch.yml` as a top-level YAML array of loader patch entries. A missing
  optional patch file is accepted; a present comments-only/non-array file is not.
  An empty list `[]` is the canonical "no user patches." This profile ships `[]`
  so the tree is exactly the two bundle layers, and no
  id-targeted override, `insert`, or `disabled` row is declared.

## Files

```
packages/dsh-control-profile/
├─ package.json            # THIS pnpm package: a source-controlled template + offline test.
├─ README.md               # this file: trust boundary, install, validation.
├─ profile/                # the deployable DSH profile template (copy these 3 into $DSH_HOME)
│  ├─ package.json         #   DSH profile manifest: dsh.profile.bundles = [dsh-base, dsh-web-app]
│  ├─ cordis.patch.yml     #   empty user layer: `[]` (no patch; non-authoritative by design)
│  └─ pnpm-workspace.yaml  #   DSH profile pnpm settings (inert until a reviewed plugin is added)
└─ test/
   └─ validate.test.js     # offline structural validator (Node stdlib only)
```

The `profile/` directory is a functionally conformant template of what DSH's
`initProfile` would write for a `duplocode-control` profile. Its DuploCode
comments are intentional, so it is not claimed to be byte-identical. Keeping it
here makes the composition reviewed, versioned, and reproducible instead of
generated on first launch.

## Installation

The profile deploys into the **DSH harness home**, **not** into this repository and
**not** into any run/lease/verdict store. `DSH_HOME` resolves to `$DSH_HOME` or
`~/.dsh`, or use an explicit home the operator controls. All commands below run
the standard `dsh` CLI (installed form `apps/cli/lib/bin.js`, or `pnpm dsh` from the
DSH repo root after `pnpm run build`); building the DSH install is a prerequisite,
not something this package does.

**1. Create the profile directory under `DSH_HOME`, without clobbering it.**
`initProfile` never overwrites existing files, so re-deploying is safe; the check
below mirrors that intent on a fresh box.

```sh
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DEST="$DSH_HOME/profiles/duplocode-control"
mkdir -p "$DEST"
# Idempotent copy; refuse to overwrite an existing operator-authored file:
#   install -D -m 0644 packages/dsh-control-profile/profile/.* "$DEST"/   # GNU install
#   or, cross-platform, rsync --ignore-existing the three files.
rsync -a --ignore-existing packages/dsh-control-profile/profile/ "$DEST"/
# Result: $DEST/package.json, $DEST/cordis.patch.yml, $DEST/pnpm-workspace.yaml
```

Windows (PowerShell): replace the copy with
`Copy-Item -Path packages\dsh-control-profile\profile\* -Destination $env:DSH_HOME\profiles\duplocode-control -Force $false`
(or copy only the three known files). Keep the same three files and nothing else.

**2. Do not** add anything to this profile: no `dsh.plugin` dependency, no
`cordis.patch.yml` patch row, no credential, no model route. Any such addition is
out of scope for Phase-0 and would move authority into DSH.

## Validation

### A. Offline, no external dependencies (always safe to run here)

Structural check of the template — no `dsh`, no install, no `$DSH_HOME` access:

```sh
node --test packages/dsh-control-profile/test/validate.test.js
# or, from a package that defines it in its scripts:
# pnpm --filter @duplocode/dsh-control-profile test
```

It asserts: the `profile/` directory holds exactly the three template files; the
manifest lists **exactly** `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]`
in that order (nothing invented/out-of-tree); `dependencies` is empty; the manifest
has **no** `dsh.bundle`/`dsh.plugin` (it is a profile, not a mountable plugin);
`cordis.patch.yml` is the empty top-level array `[]` (not comments-only, so DSH will
not throw); `pnpm-workspace.yaml` mirrors DSH's `initProfile`; and the profile name
obeys DSH's `resolveProfileDir` rules.

### B. Against the pinned DSH runtime (requires a real `dsh` install)

These require a built `dsh` installation (in-box bundles must resolve), but they do
**not** start a server or run any app command-line provider — they only print the
composed configuration, which is exactly what a reviewer wants to inspect:

```sh
# Bundle layers only (the two-bundle composition, no user layer).
dsh --profile duplocode-control --dump-default-config

# Full composition: the two bundle layers + the empty [] user layer
# (and the home-level $DSH_HOME/cordis.patch.yml, if present).
# Both print a "# == <file>" provenance comment per row group; !!js stays verbatim.
dsh --profile duplocode-control --dump-config
```

Expected: `--dump-config` shows a `# == dsh-base` group, a `# == dsh-web-app` group,
and (at most) an empty `# == cordis.patch.yml` user layer. No `@duplocode/*`
plugin row appears — any such row would be a regression caught by the offline
test. A boot that needs no server is not claimed for a
web profile: booting `dsh --profile duplocode-control` starts the `dsh-web-app`
browser surface, which is an **operator/worker UI**, not a publication authority.

## Control-plane trust boundary

Constitutional rules this package enforces by *not doing something* (from
`docs/implementation-plan.md`):

- **DSH supplies the runtime and the Web surface; DuploCode owns governance.**
  Admission, leases, worker lifecycle, independent verification, evidence,
  attestation, and publication authority live in `@duplocode/*` (see
  [`../contracts`](../contracts) and [`../composition`](../composition)). A DSH
  profile is a *configuration input* to the runtime; it is not a control-plane
  adapter.
- **A producer is never a publication authority.** Worker logs, summaries, and
  self-authored test claims are observations only. `dsh-base`/`dsh-web-app` mount
  worker tooling and an operator UI; neither can turn a worker claim into a
  `PublicationDecision`.
- **Independent verification.** A decisive verifier runs independently of the
  producer workspace/plane; verdicts are `pass` / `fail` / `inconclusive`, and
  unavailable evidence cannot become success. Nothing in this profile wires the
  verifier into DSH; that wiring is a control-plane concern.
- **No bypass of the publication floor.** Publication follows a signed policy
  decision backed by verifier evidence; neither a worker nor a DSH plugin may
  bypass it. This profile mounts no plugin and grants no capability that could do
  so.
- **Removable overlay.** The entire `duplocode-control` profile — its two bundle
  layers and its empty user patch — can be deleted (remove
  `$DSH_HOME/profiles/duplocode-control/`) without touching any
  `WorkProposal` / `Run` / `Lease` / `Receipt` / `Evidence` / `Verdict` /
  `PublicationDecision`. That removability **is** the Phase-0 exit gate: removing
  the overlay leaves the governance contracts untouched and a run still records its
  exact composition; and **no out-of-tree plugin is implicitly admitted** to this
  profile.
- **Configuration, not authority, in the patch layer.** `cordis.patch.yml` is an
  *operator configuration* surface (override an id, insert a row, disable a seam).
  Declaring a row there changes the **runtime surface**, never the **authority**
  boundary: it still cannot publish. A later, reviewed, *non-authoritative*
  DuploCode plugin seam is the only sanctioned way to add behavior, and it must
  remain removable without affecting governance state.

## Limitations / not-yet-done

- **No non-authoritative DSH plugin seam is admitted.** Adding one would require
  declaring a real `cordis.patch.yml` row for a `@duplocode/…` package, which would
  rely on a DSH plugin/loader API this package has **not** verified end-to-end
  (no in-repo DSH plugin of this kind exists yet at the pinned commit). That seam
  is a later Phase-0 deliverable and is intentionally absent here; the patch layer
  stays `[]` until it is reviewed.
- **Not a runnable web app by itself.** Booting requires a built `dsh`
  installation (Typert host artifacts + frontend/client bundles) per the DSH
  reference. The `--dump-*` commands are the offline-friendly validation; a real
  boot starts the `dsh-web-app` operator/worker UI, **not** a publication path.
- **No out-of-tree dependency, build, or credential.** `profile/pnpm-workspace.yaml`
  mirrors DSH's `initProfile` output and is inert while `dependencies` is empty; it
  becomes load-bearing only after a reviewed plugin is `add`-ed.
- **Not installed by this build.** This is a template package; nothing in
  `pkg build` copies it to `$DSH_HOME`. Install is an operator step in
  [Installation](#installation).

## Upstream pin & references

- Pinned upstream: `upstream/deepseek-harness` @
  `47f943859bef60e4160492346772ded9b24f765a` (`.gitmodules`).
- Profile mechanics: `upstream/deepseek-harness/packages/boot/app-boot/src/profile.ts`
  (`PROFILE_TEMPLATES`, `DEFAULT_PROFILE_BUNDLES`, `loadProfile`,
  `resolveProfileDir`, `initProfile`) and `.../src/index.ts`
  (`loadOptionalPatches`/`parsePatchList`).
- Prose: `docs/architecture.md` (*Profiles and bundles*),
  `docs/user/develop/basic/publish.md` (*The bundle / profile manifest*),
  `apps/cli/reference/README.md` (*Profile boot*, config-dump commands).
- Governance contracts: `packages/contracts/src/index.ts`,
  `packages/composition/src/index.ts`; plan: `docs/implementation-plan.md`.
