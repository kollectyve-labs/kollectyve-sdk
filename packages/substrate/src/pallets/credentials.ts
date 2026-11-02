import { bytesToHex, type H256Hex, type IdentityId } from "@kollectyve/core";
import type { SubstrateClient } from "../client.js";
import { h256 } from "../codec.js";
import type { SignerOrTxOptions } from "../tx.js";

/** `KollectyveCredentials.Credentials[digest]`, in SDK form. Times are unix milliseconds. */
export interface CredentialRecord {
  issuer: IdentityId;
  subject: IdentityId;
  schema: H256Hex;
  authorizedBy?: H256Hex;
  issuedAt: number;
  expiresAt?: number;
  revokedAt?: number;
}

const ms = (v: bigint | undefined) => (v === undefined ? undefined : Number(v));

/**
 * `pallet-kollectyve-credentials` — the format-neutral credential registry.
 *
 * Calls: `register_schema`, `issue`, `revoke` (signed by an identity's controller) and
 * `set_trust_anchor` (root / governance — pass `{ sudo: true }`).
 * Storage: `Schemas`, `Credentials`, `TrustAnchors`.
 *
 * Documents stay off chain; build them and their digests with `@kollectyve/credentials`.
 */
export class CredentialsModule {
  constructor(private readonly c: SubstrateClient) {}

  // --- reads ---

  async credential(digest: H256Hex): Promise<CredentialRecord | undefined> {
    const r = await this.c.api.query.KollectyveCredentials.Credentials.getValue(h256(digest));
    if (!r) return undefined;
    return {
      issuer: r.issuer,
      subject: r.subject,
      schema: bytesToHex(r.schema.asBytes()),
      authorizedBy: r.authorized_by ? bytesToHex(r.authorized_by.asBytes()) : undefined,
      issuedAt: Number(r.issued_at),
      expiresAt: ms(r.expires_at),
      revokedAt: ms(r.revoked_at),
    };
  }

  /** The identity that registered `schema`, if it is registered. */
  schemaCreator(schema: H256Hex): Promise<IdentityId | undefined> {
    return this.c.api.query.KollectyveCredentials.Schemas.getValue(h256(schema));
  }

  async isTrustAnchor(id: IdentityId): Promise<boolean> {
    return (await this.c.api.query.KollectyveCredentials.TrustAnchors.getValue(id)) !== undefined;
  }

  // --- writes ---

  /** Register a schema hash. Signed by any identity's controller. */
  registerSchema(schema: H256Hex, options?: SignerOrTxOptions) {
    return this.c.submit(this.c.api.tx.KollectyveCredentials.register_schema({ schema: h256(schema) }), options);
  }

  /**
   * Anchor a credential issued by the signer's identity. `expiresAt` is unix milliseconds;
   * `authorizedBy` must be a live credential whose subject is the issuer.
   */
  issue(
    input: { subject: IdentityId; schema: H256Hex; digest: H256Hex; authorizedBy?: H256Hex; expiresAt?: number },
    options?: SignerOrTxOptions,
  ) {
    return this.c.submit(
      this.c.api.tx.KollectyveCredentials.issue({
        subject: input.subject,
        schema: h256(input.schema),
        digest: h256(input.digest),
        authorized_by: input.authorizedBy ? h256(input.authorizedBy) : undefined,
        expires_at: input.expiresAt === undefined ? undefined : BigInt(input.expiresAt),
      }),
      options,
    );
  }

  /** Revoke a credential. Issuer-only; the record stays, stamped with the time. */
  revoke(digest: H256Hex, options?: SignerOrTxOptions) {
    return this.c.submit(this.c.api.tx.KollectyveCredentials.revoke({ digest: h256(digest) }), options);
  }

  /** Mark or unmark a root of trust. Root only: pass `{ sudo: true }` on a sudo chain. */
  setTrustAnchor(id: IdentityId, anchored: boolean, options?: SignerOrTxOptions) {
    return this.c.submit(this.c.api.tx.KollectyveCredentials.set_trust_anchor({ id, anchored }), options);
  }
}

/**
 * The three reads `verifyCredential` / `verifyPresentation` in `@kollectyve/credentials` need,
 * backed by the chain. Structurally a `ChainReader`; this package does not depend on that one.
 */
export function chainReader(c: SubstrateClient) {
  const credentials = new CredentialsModule(c);
  return {
    credential: (digest: H256Hex) => credentials.credential(digest),
    controllerOf: (id: IdentityId) => c.api.query.KollectyveId.ControllerOf.getValue(id),
    isTrustAnchor: (id: IdentityId) => credentials.isTrustAnchor(id),
  };
}
