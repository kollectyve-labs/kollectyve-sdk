import { blake2b } from "@noble/hashes/blake2b";
import { KollectyveError, bytesToHex, type H256Hex } from "@kollectyve/core";

/** A credential or presentation that cannot be canonicalised, or fails verification. */
export class CredentialError extends KollectyveError {}

/**
 * JSON Canonicalization Scheme (RFC 8785): the one byte string every party hashes.
 *
 * Object keys are sorted by UTF-16 code unit, there is no whitespace, and strings and numbers
 * use ECMAScript serialisation, which is what RFC 8785 specifies. `undefined` members are
 * dropped, matching `JSON.stringify`. Non-finite numbers and non-JSON values throw rather than
 * hash to something another implementation would not reproduce.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CredentialError(`canonicalize: ${value} is not JSON`);
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => (v === undefined ? "null" : canonicalize(v))).join(",")}]`;
      }
      const entries = Object.keys(value as object)
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`);
      return `{${entries.join(",")}}`;
    }
    default:
      throw new CredentialError(`canonicalize: a ${typeof value} is not JSON`);
  }
}

/** blake2b-256, the hash the chain uses everywhere. */
export function blake2_256(bytes: Uint8Array): Uint8Array {
  return blake2b(bytes, { dkLen: 32 });
}

/**
 * The on-chain id of a credential: blake2b-256 over the JCS form of the document **without its
 * `proof` member**. The chain record is the proof, so the digest must not depend on one; an
 * issuer may still attach a signature later without changing the id.
 */
export function credentialDigest(doc: object): H256Hex {
  const { proof: _proof, ...body } = doc as Record<string, unknown>;
  return bytesToHex(blake2_256(new TextEncoder().encode(canonicalize(body))));
}
