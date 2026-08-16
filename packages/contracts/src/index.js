/** A worker observation can never satisfy this narrower verifier-only shape. */
export function isDecisivePass(evidence, verdict) {
    return evidence.ran && evidence.verifierTrustClass === 'trusted-verifier' && verdict.kind === 'pass';
}
//# sourceMappingURL=index.js.map