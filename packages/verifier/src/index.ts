import type { Evidence, Verdict, Sha256Digest } from '@duplocode/contracts'
export interface VerificationSpec { readonly id: string; readonly digest: Sha256Digest; readonly command: readonly string[] }
export interface CleanRoomExecutor { execute(spec: VerificationSpec, candidate: Sha256Digest): Promise<{ ran: boolean; exitCode?: number; detail: string }> }
export async function verify(runId: string, candidate: Sha256Digest, spec: VerificationSpec, executor: CleanRoomExecutor, verifierId: string, plane: string, composition: Sha256Digest): Promise<{ evidence: Evidence; verdict: Verdict }> {
 const result = await executor.execute(spec, candidate)
 const kind = !result.ran ? 'inconclusive' : result.exitCode === 0 ? 'pass' : 'fail'
 const evidence: Evidence = { id: `evidence:${runId}:${spec.id}`, runId, verifierId, verifierTrustClass: 'trusted-verifier', verifierPlaneId: plane, verifierCompositionDigest: composition, candidateDigest: candidate, verificationSpecDigest: spec.digest, ran: result.ran, artifactReferences: [], receiptIds: [], observedAt: 'synthetic' }
 return { evidence, verdict: { evidenceId: evidence.id, kind, reason: result.detail } }
}
