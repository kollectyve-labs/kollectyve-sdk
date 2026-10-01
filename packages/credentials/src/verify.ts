import type { H256Hex, IdentityId } from "@kollectyve/core";
import { credentialDigest } from "./canonical.js";
import type { KollectyveCredential } from "./credential.js";
import { parseIdentityDid } from "./did.js";

/** `KollectyveCredentials.Credentials[digest]`, as the verifier sees it. Times in unix millis. */
export interface ChainCredential {
  issuer: IdentityId;
  subject: IdentityId;
  schema: H256Hex;
  authorizedBy?: H256Hex;
  issuedAt: number;
  expiresAt?: number;
  revokedAt?: number;
}

/**
 * The three chain reads verification needs. The chain-backed implementation lives with the
 * Substrate façade; tests and offline verifiers supply their own.
 */
export interface ChainReader {
  credential(digest: H256Hex): Promise<ChainCredential | undefined>;
  /** SS58 address of the identity's current controller. */
  controllerOf(id: IdentityId): Promise<string | undefined>;
  isTrustAnchor(id: IdentityId): Promise<boolean>;
}

export interface VerifyOptions {
  /** Unix millis to judge expiry against. Defaults to `Date.now()`. */
  now?: number;
  /**
   * The verifier's own roots of trust. When set, these replace the chain's `TrustAnchors`: an
   * employer may trust one ministry and nobody else.
   */
  anchors?: IdentityId[];
  /** Longest `authorizedBy` chain to follow. Default 8. */
  maxDepth?: number;
}

export interface CredentialVerification {
  digest: H256Hex;
  /** Anchored, matches the document, not revoked, not expired. */
  valid: boolean;
  /** `valid`, and every link up to a trust anchor is valid too. */
  trusted: boolean;
  /** The trust anchor reached, if any. */
  anchor?: IdentityId;
  /** This credential's digest, then each authorising credential up the chain. */
  path: H256Hex[];
  reason?: string;
}

/** Check one credential document against the chain and walk its authorisation chain. */
export async function verifyCredential(
  reader: ChainReader,
  doc: KollectyveCredential,
  options: VerifyOptions = {},
): Promise<CredentialVerification> {
  const now = options.now ?? Date.now();
  const maxDepth = options.maxDepth ?? 8;
  const digest = credentialDigest(doc);
  const path: H256Hex[] = [digest];
  const fail = (reason: string, valid = false): CredentialVerification => ({
    digest,
    valid,
    trusted: false,
    path,
    reason,
  });

  const record = await reader.credential(digest);
  if (!record) return fail("not anchored on chain (document altered, or never issued)");
  const mismatch = documentMismatch(doc, record);
  if (mismatch) return fail(mismatch);
  const status = liveness(record, now);
  if (status) return fail(status);

  const isAnchor = options.anchors
    ? async (id: IdentityId) => options.anchors!.includes(id)
    : (id: IdentityId) => reader.isTrustAnchor(id);

  let current = record;
  for (let depth = 0; depth <= maxDepth; depth++) {
    if (await isAnchor(current.issuer)) {
      return { digest, valid: true, trusted: true, anchor: current.issuer, path };
    }
    const parentDigest = current.authorizedBy;
    if (!parentDigest) return fail(`issuer ${current.issuer} is not a trust anchor`, true);
    const parent = await reader.credential(parentDigest);
    path.push(parentDigest);
    if (!parent) return fail(`authorising credential ${parentDigest} is missing`, true);
    if (parent.subject !== current.issuer) {
      return fail(`authorising credential ${parentDigest} is not held by the issuer`, true);
    }
    const parentStatus = liveness(parent, now);
    if (parentStatus) return fail(`authorising credential ${parentDigest}: ${parentStatus}`, true);
    current = parent;
  }
  return fail(`no trust anchor within ${maxDepth} links`, true);
}

function liveness(c: ChainCredential, now: number): string | undefined {
  if (c.revokedAt !== undefined) return "revoked";
  if (c.expiresAt !== undefined && now > c.expiresAt) return "expired";
  return undefined;
}

function documentMismatch(doc: KollectyveCredential, c: ChainCredential): string | undefined {
  try {
    if (parseIdentityDid(doc.issuer) !== c.issuer) return "issuer differs from the chain record";
    if (parseIdentityDid(doc.credentialSubject.id) !== c.subject) {
      return "subject differs from the chain record";
    }
  } catch (e) {
    return (e as Error).message;
  }
  if (doc.credentialSchema?.id !== c.schema) return "schema differs from the chain record";
  if ((doc.authorizedBy ?? undefined) !== c.authorizedBy) {
    return "authorizedBy differs from the chain record";
  }
  return undefined;
}
