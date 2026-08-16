# Phase-0 foundation review

**Scope:** static evidence audit of the requested plan, contracts, composition code/test, and pinned DSH documentation. The checked-out DSH revision is the plan's stated `47f943859bef60e4160492346772ded9b24f765a` (`docs/implementation-plan.md:5-6`).

## Verified strengths

- The plan correctly states the governing floor: producer observations are not publication authority, three verdict values are required, and decisive verification must be independent (`docs/implementation-plan.md:15-16`, `:28-32`).
- Contracts model all three verdict values (`packages/contracts/src/index.ts:6`) and `isDecisivePass` fails closed for `fail`, `inconclusive`, or unrun evidence (`:109-112`).
- `Evidence.verifierTrustClass` is narrowed to `trusted-verifier` (`:81-91`), while receipts retain producer trust class (`:68-79`), a useful initial separation.
- A run records DSH revision, profile/plugin/image/model/policy/verification fields (`:24-33`, `:46-55`). The composition package deterministically serializes object insertion-order variants and hashes UTF-8 SHA-256 (`packages/composition/src/index.ts:7-31`); its test covers those two basics (`index.test.ts:5-15`).
- The DSH architecture supports removable composition in principle: profiles are ordered plugin trees and plugin registrations unwind on unload (`upstream/deepseek-harness/docs/architecture.md:11-13`, `:17-27`).

## Gaps and risks

1. **P0 — producer/verifier separation is descriptive, not enforced.** `isDecisivePass` does not verify `verdict.evidenceId` against `Evidence.id`, verifier identity against an approved independent verifier, or separate workspace/plane provenance (`packages/contracts/src/index.ts:81-112`). `PublicationDecision` has neither signature/issuer nor a checked link from its decisive evidence to the run (`:100-107`). A producer could therefore supply a structurally trusted-looking object at this boundary. Require runtime validation, identity/provenance bindings, and a policy evaluator that alone authorizes publication.
2. **P0 — composition digest is not guaranteed complete.** `digestComposition` accepts arbitrary `CanonicalJson`, rather than `ExecutionComposition` or a manifest including the repository snapshot (`packages/composition/src/index.ts:30-31`; `packages/contracts/src/index.ts:24-33`, `:46-55`). Callers can omit fields, add ambiguous ones, or set `Run.compositionDigest` unrelated to `Run.composition`; no validator/tests bind them. Define one versioned, closed manifest that includes repository commit, exact DSH/profile/plugin/image/model/policy/verifier inputs, reject unknown/missing fields, and verify the stored digest on admission and use.
3. **P1 — three-valued handling is incomplete.** The union and helper are correct as far as they go, but no transition/policy maps unavailable or unrun evidence to `inconclusive`/`needs-attention`; `Evidence.ran: false` has no required verdict relationship (`packages/contracts/src/index.ts:7-16`, `:81-112`). Add exhaustiveness tests for `pass`/`fail`/`inconclusive`, missing evidence, mismatched evidence IDs, and publication denial.
4. **P1 — canonicalization needs an explicit interoperable contract and stronger tests.** Key ordering uses locale-dependent `localeCompare` (`packages/composition/src/index.ts:17`), so cross-host digest stability is not established. Tests omit nested arrays/objects, Unicode/key-order edge cases, `-0`, and fixed digest vectors (`index.test.ts:5-15`). Specify a canonical JSON standard or code-point comparator and add vectors.
5. **P1 — DSH-profile claims are not supported by current artifacts.** The plan claims a `duplocode-control` overlay/profile and pinned-runtime validation (`docs/implementation-plan.md:53-56`), but the examined `packages/dsh-control-profile/` directory contains no manifest/configuration. DSH defines a profile as a Harness-home composition declared through `package.json` `dsh.profile`, with bundles and patches (`upstream/deepseek-harness/docs/architecture.md:19-27`); neither a profile declaration nor a `--dump-config` validation record was available. Consequently the exit-gate claims about removal and no implicit plugin admission remain unverified (`docs/implementation-plan.md:58-60`).

## Prioritized next changes

1. Implement a closed, versioned composition manifest and admission-time digest/binding checks.
2. Implement a signed control-plane publication decision that validates evidence/run/verdict identity and independent verifier provenance; fail closed to `inconclusive`/Needs-Attention.
3. Add the actual DSH profile declaration and patch, an allowlisted plugin inventory, and pinned-runtime `dsh --profile ... --dump-config` evidence.
4. Specify canonical JSON and expand digest/verdict/authority-boundary tests.

## Limitations

This was static review only: tests and a DSH profile were not run because no profile artifact was present in the requested scope. No credentials or secret files were inspected. Absence of evidence above is not a claim that uninspected implementation is clean.
