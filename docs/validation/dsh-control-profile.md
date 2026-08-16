# DSH control-profile runtime validation

- Upstream commit: `47f943859bef60e4160492346772ded9b24f765a`.
- Profile: `duplocode-control` deployed into a fresh temporary `DSH_HOME`.
- Commands: `pnpm dsh --profile duplocode-control --dump-default-config` and `--dump-config` from the pinned, built DSH checkout.
- Result: both commands exited successfully.
- Default composition SHA-256: `74dc4fde49cdf7cc4f118326b27f434a45349a363982b576adefb1b3b4fa9449`.
- Full composition SHA-256: `74dc4fde49cdf7cc4f118326b27f434a45349a363982b576adefb1b3b4fa9449`.
- Default composition lines: 490.
- Full composition lines: 490.
- Assertion: neither composition contains an `@duplocode/*` plugin row.
- Scope: configuration dump only; no web server, model request, worker, lease, or publication path was started.
