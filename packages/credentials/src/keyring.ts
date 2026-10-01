import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  entropyToMiniSecret,
  generateMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from "@polkadot-labs/hdkd-helpers";
import { bytesToHex, encodeSs58, type H256Hex } from "@kollectyve/core";
import { blake2_256, CredentialError } from "./canonical.js";

/** One controller key of the ring. */
export interface ControllerKey {
  index: number;
  publicKey: Uint8Array;
  /** SS58 address — what `KollectyveId.ControllerOf` returns for this key. */
  address: string;
  sign(message: Uint8Array): Uint8Array;
}

/**
 * A wallet's controller keys, all derived from one recovery phrase, with KERI-style
 * pre-rotation built in.
 *
 * Key `i` is `//kollectyve//controller//i` (hard junctions, alphanumeric — see the junction
 * caveat on `signerFromMnemonic`). The identity is controlled by key `i` and committed to key
 * `i + 1` on chain, so rotating means: sign `rotate_to_committed` with key `i + 1`, passing the
 * commitment for key `i + 2`. The phrase alone recovers every key, and a leaked key `i` cannot
 * rotate because it does not hold `i + 1`.
 */
export class KeyRing {
  private readonly derive: ReturnType<typeof sr25519CreateDerive>;

  private constructor(mnemonic: string) {
    this.derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(mnemonic)));
  }

  /** A fresh 12-word phrase. Show it once and have the user write it down. */
  static generateMnemonic(): string {
    return generateMnemonic(128);
  }

  static fromMnemonic(mnemonic: string): KeyRing {
    const phrase = mnemonic.trim().split(/\s+/).join(" ");
    if (!validateMnemonic(phrase)) throw new CredentialError("invalid recovery phrase");
    return new KeyRing(phrase);
  }

  controller(index: number): ControllerKey {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new CredentialError(`controller index must be a non-negative integer, got ${index}`);
    }
    const pair = this.derive(`//kollectyve//controller//${index}`);
    return {
      index,
      publicKey: pair.publicKey,
      address: encodeSs58(pair.publicKey),
      sign: (message) => pair.sign(message),
    };
  }

  /** The value to pass as `commitment` / `next_commitment` so that key `index` comes next. */
  commitmentFor(index: number): H256Hex {
    return controllerCommitment(this.controller(index).publicKey);
  }
}

/**
 * `blake2_256(SCALE(AccountId32))` — exactly `pallet_kollectyve_id::controller_commitment`.
 * SCALE encodes an `AccountId32` as its 32 raw bytes, so this is the hash of the public key.
 */
export function controllerCommitment(publicKey: Uint8Array): H256Hex {
  if (publicKey.length !== 32) {
    throw new CredentialError(`controllerCommitment: expected a 32-byte key, got ${publicKey.length}`);
  }
  return bytesToHex(blake2_256(publicKey));
}
