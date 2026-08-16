import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

/**
 * Closed admission decision surfaced by an injected admission authority.
 * The control plane is a thin HTTP boundary: it never authorizes work on its
 * own, holds no worker, lease, dispatch, or publish path, and produces a 202
 * Accepted only when the injected handler returns an accepted decision.
 */
export type AdmissionDecision =
  | { readonly accepted: true; readonly runId: string }
  | { readonly accepted: false; readonly reason: string }

/** Context passed to the admission handler so it can distinguish the HTTP source. */
export interface AdmissionContext {
  readonly source: 'http'
  readonly path: string
}

/**
 * The admission authority. It is fully injected so the control surface stays
 * free of governance logic; the process that wires it in owns admission.
 */
export interface AdmissionHandler {
  admit(parsedBody: unknown, context: AdmissionContext): AdmissionDecision
}

/**
 * Fails closed: admits nothing. A server wired without an explicit authority
 * therefore never authorizes any work proposal.
 */
export function inertAdmissionHandler(): AdmissionHandler {
  return { admit: () => ({ accepted: false, reason: 'no admission authority configured' }) }
}

/**
 * A control server is created from an injected health probe and an injected
 * admission handler. When `admission` is omitted the inert (fail-closed)
 * handler is used, so a misconfigured surface refuses rather than approves.
 */
export function createControlServer(config: {
  readonly health?: () => unknown
  readonly admission?: AdmissionHandler
} = {}): Server {
  const health = config.health ?? (() => ({ status: 'ok' }))
  const admission = config.admission ?? inertAdmissionHandler()

  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, health())
    }
    if (req.method === 'POST' && req.url === '/work-proposals') {
      return handleWorkProposal(req, res, admission)
    }
    // No worker, lease, dispatch, or publish endpoint is ever exposed here.
    sendJson(res, 404, { error: 'not found' })
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += typeof chunk === 'string' ? chunk : chunk.toString()
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

async function handleWorkProposal(
  req: IncomingMessage,
  res: ServerResponse,
  admission: AdmissionHandler
): Promise<void> {
  // Malformed bodies fail closed at 400 before the authority is ever consulted.
  let raw = ''
  try {
    raw = await readBody(req)
  } catch {
    sendJson(res, 400, { error: 'failed to read request body' })
    return
    }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.length === 0 ? 'null' : raw)
  } catch {
    sendJson(res, 400, { error: 'malformed json' })
    return
  }

  // The 202 status and its body come solely from the admission authority.
  const decision = admission.admit(parsed, { source: 'http', path: '/work-proposals' })
  if (decision.accepted) {
    sendJson(res, 202, { accepted: true, runId: decision.runId })
    return
  }

  sendJson(res, 409, { accepted: false, reason: decision.reason })
}
