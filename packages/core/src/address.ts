import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, type Hex } from "./hex.js";
import { decodeSs58, encodeSs58, isSs58 } from "./ss58.js";

/**
 * The Kollectyve address bridge.
 *
 * `pallet-revive`'s `AccountId32Mapper` relates a 20-byte Ethereum address (`H160`) to a
 * 32-byte Substrate account (`AccountId32`). These are the two ways one ledger addresses an
 * account — an EVM address and its Substrate identity. This module reproduces the pallet's
 * *stateless* mapping so a dApp can move between MetaMask addresses and Polkadot-JS accounts
 * without a round-trip to the chain.
 *
 * Reference: substrate/frame/revive `AccountId32Mapper` (polkadot-sdk stable2606).
 */

/** An Ethereum address (20 bytes, `0x`-prefixed). */
export type EvmAddress = Hex;
/** A Substrate public key / AccountId32 (32 bytes, `0x`-prefixed). */
export type AccountId32Hex = Hex;

const EE = 0xee;

/**
 * Is this AccountId32 an "eth-derived" account — i.e. was it produced from an H160?
 * Stateless check: the trailing 12 bytes are all `0xEE`.
 */
export function isEthDerived(accountId32: AccountId32Hex | Uint8Array): boolean {
  const b = typeof accountId32 === "string" ? hexToBytes(accountId32) : accountId32;
  if (b.length !== 32) throw new Error(`expected a 32-byte AccountId32, got ${b.length}`);
  for (let i = 20; i < 32; i++) if (b[i] !== EE) return false;
  return true;
}

/**
 * H160 → AccountId32 (the pallet's *fallback* mapping): the 20 address bytes followed by
 * twelve `0xEE` bytes.
 *
 * This is exactly correct for secp256k1 / EVM-origin accounts (MetaMask, contracts), which
 * always use the `0xEE`-suffixed form. The only case it does NOT cover is a *Substrate*
 * account that explicitly called `revive.map()` to bind itself to an H160 — resolving that
 * requires reading `OriginalAccount` storage on-chain (see `@kollectyve/substrate`).
 */
export function evmToAccountId32(address: EvmAddress | Uint8Array): AccountId32Hex {
  const a = typeof address === "string" ? hexToBytes(address) : address;
  if (a.length !== 20) throw new Error(`expected a 20-byte H160, got ${a.length}`);
  const out = new Uint8Array(32).fill(EE);
  out.set(a, 0);
  return bytesToHex(out);
}

/**
 * AccountId32 → H160, matching `AccountId32Mapper::to_address`:
 *  - eth-derived accounts: strip the `0xEE` suffix (first 20 bytes);
 *  - native (sr25519/ed25519) accounts: `keccak256(pubkey)[12..]`, so the 32-byte key is
 *    hashed rather than truncated.
 *
 * Accepts either a 32-byte hex public key or an SS58 address.
 */
export function accountId32ToEvm(account: AccountId32Hex | string | Uint8Array): EvmAddress {
  let b: Uint8Array;
  if (typeof account === "string" && !account.startsWith("0x") && isSs58(account)) {
    b = decodeSs58(account);
  } else {
    b = typeof account === "string" ? hexToBytes(account) : account;
  }
  if (b.length !== 32) throw new Error(`expected a 32-byte AccountId32, got ${b.length}`);

  if (isEthDerived(b)) return bytesToHex(b.slice(0, 20));
  return bytesToHex(keccak_256(b).slice(12, 32));
}

/** Convenience: H160 → SS58 address (via the fallback mapping). */
export function evmToSs58(address: EvmAddress, prefix?: number): string {
  return encodeSs58(hexToBytes(evmToAccountId32(address)), prefix);
}

/** Convenience: SS58 address → H160. */
export function ss58ToEvm(address: string): EvmAddress {
  return accountId32ToEvm(decodeSs58(address));
}
