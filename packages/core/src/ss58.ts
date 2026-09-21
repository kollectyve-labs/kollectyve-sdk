import { blake2b } from "@noble/hashes/blake2b";
import { base58 } from "@scure/base";
import { concatBytes, hexToBytes, type Hex } from "./hex.js";
import { KOLLECTYVE_SS58_PREFIX } from "./constants.js";

// SS58 checksum context, per the Substrate SS58 spec.
const SS58_PRE = new TextEncoder().encode("SS58PRE");

/**
 * Encode a 32-byte public key as an SS58 address.
 *
 * Only single-byte network prefixes (< 64) are supported — Kollectyve uses 42,
 * the generic Substrate prefix. See {@link KOLLECTYVE_SS58_PREFIX}.
 */
export function encodeSs58(
  publicKey: Uint8Array | Hex,
  prefix: number = KOLLECTYVE_SS58_PREFIX,
): string {
  if (prefix >= 64) throw new Error(`only single-byte SS58 prefixes (<64) are supported, got ${prefix}`);
  const key = typeof publicKey === "string" ? hexToBytes(publicKey) : publicKey;
  if (key.length !== 32) throw new Error(`expected a 32-byte public key, got ${key.length}`);

  const payload = concatBytes(new Uint8Array([prefix]), key);
  const checksum = blake2b(concatBytes(SS58_PRE, payload), { dkLen: 64 }).slice(0, 2);
  return base58.encode(concatBytes(payload, checksum));
}

/** Decode an SS58 address to its raw 32-byte public key (checksum is verified). */
export function decodeSs58(address: string): Uint8Array {
  const data = base58.decode(address);
  // 1 prefix byte + 32 payload + 2 checksum. (Multi-byte prefixes are out of scope.)
  if (data.length !== 35) throw new Error(`unexpected SS58 length ${data.length} (multi-byte prefixes unsupported)`);
  const payload = data.slice(0, 33);
  const checksum = data.slice(33);
  const expected = blake2b(concatBytes(SS58_PRE, payload), { dkLen: 64 }).slice(0, 2);
  if (checksum[0] !== expected[0] || checksum[1] !== expected[1]) {
    throw new Error(`SS58 checksum mismatch for ${address}`);
  }
  return payload.slice(1);
}

export function isSs58(address: string): boolean {
  try {
    decodeSs58(address);
    return true;
  } catch {
    return false;
  }
}
