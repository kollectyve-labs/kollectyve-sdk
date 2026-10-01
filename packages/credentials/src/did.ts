import type { IdentityId } from "@kollectyve/core";
import { CredentialError } from "./canonical.js";

/**
 * `did:kollectyve:<identityId>` — the DID of an on-chain identity.
 *
 * It names the `IdentityId`, never a key, so it survives every controller rotation. Resolving it
 * means reading `KollectyveId.ControllerOf` for the current key.
 */
export type KollectyveDid = `did:kollectyve:${string}`;

const PATTERN = /^did:kollectyve:(0|[1-9][0-9]*)$/;

export function identityDid(id: IdentityId): KollectyveDid {
  if (id < 0n) throw new CredentialError(`identityDid: negative id ${id}`);
  return `did:kollectyve:${id.toString()}`;
}

export function parseIdentityDid(did: string): IdentityId {
  const m = PATTERN.exec(did);
  if (!m?.[1]) throw new CredentialError(`not a did:kollectyve identifier: ${did}`);
  return BigInt(m[1]);
}
