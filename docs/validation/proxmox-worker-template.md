# Proxmox worker-template bootstrap

- Created from the approved CI template `9002` without modifying that source.
- New dedicated template: `duplocode-worker-base-v1` (VMID `100`).
- Node: `pve2`; pool: `builder-arms`; storage: `ssd-thin`.
- The clone and conversion tasks both returned `OK` through the authenticated,
  TLS-pinned Proxmox API.
- Final resource inspection confirmed `template=1`, pool `builder-arms`, and the
  expected name.

This establishes the isolated base image boundary. It is not evidence that a
worker is dispatchable: runtime leases, worker bootstrap configuration,
credential brokering, durable storage, and clean-room verification remain
separate constitutional requirements.
