import type { RunState } from '@duplocode/contracts'

/**
 * Legal RunState transitions. A run only ever leaves a state on an explicitly
 * enumerated successor; any other target is an illegal transition and fails
 * closed. Terminal states have no successors.
 *
 * Rationale (PRD §13):
 *  - admission flows admitted -> leased -> dispatching -> running -> verifying.
 *  - a run may divert anywhere to `needs-attention` (operator Inbox) or `refused`.
 *  - only a run that has been verifying (or recovered from needs-attention) may
 *    be published; publication then completes the lifecycle.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  admitted: ['leased', 'refused', 'needs-attention'],
  leased: ['dispatching', 'refused', 'needs-attention'],
  dispatching: ['running', 'refused', 'needs-attention'],
  running: ['verifying', 'refused', 'needs-attention'],
  verifying: ['published', 'completed', 'refused', 'needs-attention'],
  'needs-attention': ['leased', 'dispatching', 'running', 'verifying', 'published', 'completed', 'refused'],
  published: ['completed'],
  completed: [],
  refused: []
}

export class IllegalTransitionError extends Error {
  constructor(readonly from: RunState, readonly to: RunState) {
    super(`Illegal RunState transition: ${from} -> ${to}`)
    this.name = 'IllegalTransitionError'
  }
}

/** Returns true when `to` is a legal successor of `from`. */
export function isLegalTransition(from: RunState, to: RunState): boolean {
  return LEGAL_TRANSITIONS[from]!.includes(to)
}

/** Throws unless `to` is a legal successor of `from`. No-op identity moves are rejected. */
export function assertLegalTransition(from: RunState, to: RunState): void {
  if (from === to) throw new IllegalTransitionError(from, to)
  if (!isLegalTransition(from, to)) throw new IllegalTransitionError(from, to)
}
