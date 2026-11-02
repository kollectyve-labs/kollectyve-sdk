import type { H256Hex, IdentityId } from "@kollectyve/core";
import { credentialDigest } from "./canonical.js";
import { identityDid, type KollectyveDid } from "./did.js";

/**
 * A Kollectyve credential: a W3C VC Data Model 2.0 document in plain JSON, hashed with JCS.
 *
 * Only its digest goes on chain. `issuer`, `credentialSubject.id`, `credentialSchema.id` and
 * `authorizedBy` must match the chain record, which is what binds the document to it.
 */
export interface KollectyveCredential {
  "@context": string[];
  type: string[];
  issuer: KollectyveDid;
  validFrom: string;
  validUntil?: string;
  credentialSchema: { id: H256Hex; type: "KollectyveSchema" };
  credentialSubject: { id: KollectyveDid; [claim: string]: unknown };
  credentialStatus: { type: "KollectyveChainStatus"; network: string };
  /** Digest of the credential, held by the issuer, that entitled it to issue this one. */
  authorizedBy?: H256Hex;
  proof?: unknown;
}

export const VC_CONTEXT = "https://www.w3.org/ns/credentials/v2";

export interface BuildCredentialInput {
  issuer: IdentityId;
  subject: IdentityId;
  schema: H256Hex;
  /** Extra VC types, e.g. `"UniversityDiploma"`. */
  types?: string[];
  claims: Record<string, unknown>;
  network: string;
  validFrom?: Date;
  validUntil?: Date;
  authorizedBy?: H256Hex;
}

/**
 * Issuer side: build the document and its digest. Pass the digest to
 * `KollectyveCredentials.issue`, with `expires_at = validUntil` in unix millis, and hand the
 * document to the holder.
 */
export function buildCredential(input: BuildCredentialInput): {
  credential: KollectyveCredential;
  digest: H256Hex;
} {
  const credential: KollectyveCredential = {
    "@context": [VC_CONTEXT],
    type: ["VerifiableCredential", ...(input.types ?? [])],
    issuer: identityDid(input.issuer),
    validFrom: (input.validFrom ?? new Date()).toISOString(),
    ...(input.validUntil ? { validUntil: input.validUntil.toISOString() } : {}),
    credentialSchema: { id: input.schema, type: "KollectyveSchema" },
    credentialSubject: { ...input.claims, id: identityDid(input.subject) },
    credentialStatus: { type: "KollectyveChainStatus", network: input.network },
    ...(input.authorizedBy ? { authorizedBy: input.authorizedBy } : {}),
  };
  return { credential, digest: credentialDigest(credential) };
}
