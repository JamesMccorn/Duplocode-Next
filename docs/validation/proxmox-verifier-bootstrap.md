# Proxmox clean-room verifier bootstrap

- Cloned dedicated worker template VMID `100` into VMID `104`.
- VM name: `duplocode-verifier-bootstrap-v1`.
- Node/pool/storage: `pve2` / `builder-arms` / `ssd-thin`.
- The clone and explicit start tasks completed through the authenticated,
  TLS-pinned Proxmox API.
- Final status inspection reported `running`.

This is an isolated bootstrap compute instance for the future `verify-node-web-v1`
profile. It has no publication credential or authority; a worker bootstrap,
scoped lease delivery, artifact gateway, and clean-room verification command are
still required before it can produce decisive evidence.
