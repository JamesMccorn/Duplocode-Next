/** Canonical, serializable authority-boundary contracts. */
export type Sha256Digest = `sha256:${string}`;
export type IsoTimestamp = string;
export type TrustClass = 'control-plane' | 'trusted-verifier' | 'untrusted-worker' | 'operator';
export type VerdictKind = 'pass' | 'fail' | 'inconclusive';
export type RunState = 'admitted' | 'leased' | 'dispatching' | 'running' | 'verifying' | 'needs-attention' | 'refused' | 'published' | 'completed';
export interface ArtifactReference {
    readonly digest: Sha256Digest;
    readonly mediaType: string;
    readonly uri: string;
}
export interface ExecutionComposition {
    readonly dshRevision: string;
    readonly profileId: string;
    readonly profileDigest: Sha256Digest;
    readonly pluginDigests: Readonly<Record<string, Sha256Digest>>;
    readonly workerImageDigest: Sha256Digest;
    readonly modelRoute: string;
    readonly policyVersion: string;
    readonly verificationSpecDigest: Sha256Digest;
}
export interface WorkProposal {
    readonly id: string;
    readonly projectId: string;
    readonly issueRef: string;
    readonly requestedBy: string;
    readonly createdAt: IsoTimestamp;
    readonly scope: string;
    readonly repositoryCommit: string;
    readonly requestedComposition: ExecutionComposition;
}
export interface Run {
    readonly id: string;
    readonly proposalId: string;
    readonly projectId: string;
    readonly issueRef: string;
    readonly repositoryCommit: string;
    readonly composition: ExecutionComposition;
    readonly compositionDigest: Sha256Digest;
    readonly state: RunState;
    readonly admittedAt: IsoTimestamp;
}
export interface Lease {
    readonly id: string;
    readonly runId: string;
    readonly kind: 'worker' | 'model-route' | 'credential' | 'event-ingest';
    readonly issuer: string;
    readonly subject: string;
    readonly limits: Readonly<Record<string, number | string>>;
    readonly expiresAt: IsoTimestamp;
}
export interface Receipt {
    readonly id: string;
    readonly runId: string;
    readonly producer: string;
    readonly producerTrustClass: TrustClass;
    readonly sequence: number;
    readonly observedAt: IsoTimestamp;
    readonly receivedAt: IsoTimestamp;
    readonly payloadDigest: Sha256Digest;
    readonly artifactReferences: readonly ArtifactReference[];
    readonly compositionDigest: Sha256Digest;
}
export interface Evidence {
    readonly id: string;
    readonly runId: string;
    readonly verifierId: string;
    readonly verifierTrustClass: 'trusted-verifier';
    readonly candidateDigest: Sha256Digest;
    readonly verificationSpecDigest: Sha256Digest;
    readonly ran: boolean;
    readonly artifactReferences: readonly ArtifactReference[];
    readonly receiptIds: readonly string[];
    readonly observedAt: IsoTimestamp;
}
export interface Verdict {
    readonly evidenceId: string;
    readonly kind: VerdictKind;
    readonly reason: string;
}
export interface PublicationDecision {
    readonly runId: string;
    readonly authorized: boolean;
    readonly policyVersion: string;
    readonly decisiveEvidenceIds: readonly string[];
    readonly decidedAt: IsoTimestamp;
    readonly reason: string;
}
/** A worker observation can never satisfy this narrower verifier-only shape. */
export declare function isDecisivePass(evidence: Evidence, verdict: Verdict): boolean;
//# sourceMappingURL=index.d.ts.map