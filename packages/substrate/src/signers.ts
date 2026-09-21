import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from "@polkadot-labs/hdkd-helpers";
import { getPolkadotSigner } from "polkadot-api/signer";
import type { PolkadotSigner } from "polkadot-api";
import { KollectyveError } from "@kollectyve/core";

/**
 * Ways to obtain a `PolkadotSigner`.
 *
 * Which one you want depends on who is acting — see the actor table in the README:
 *
 *  - a **product backend** signing for a custodial user → {@link signerFromKeyProvider}
 *    (the key stays in Vault/KMS and never enters this process);
 *  - a **self-custody user or external dApp** → `connectSubstrateWallet` in `./wallet.js`;
 *  - a **service or machine actor** holding its own key → {@link signerFromKeypair};
 *  - **local development** → {@link devSigner}.
 */

export type SignatureScheme = "Sr25519" | "Ed25519" | "Ecdsa";

/**
  * Sign
 * arbitrary bytes with a key this process does not hold — a Vault Transit endpoint, a KMS, an
 * HSM. May be async; PAPI awaits it.
 */
export type RemoteSign = (payload: Uint8Array) => Promise<Uint8Array> | Uint8Array;

/**
 * A signer backed by a key held somewhere else.
 *
 * This is the shape a product backend needs: the custodial key lives in Vault, the backend
 * knows only the public key and can ask for signatures. Nothing secret enters the SDK.
 *
 * ```ts
 * const signer = signerFromKeyProvider(
 *   await vault.publicKey(userId),
 *   (payload) => vault.sign(userId, payload),   // HTTP call, returns 64 bytes
 * );
 * await k.substrate.kumulus.registerProvider(specs, signer);
 * ```
 *
 * `scheme` is **required and not guessable**: it must match how the key was generated, and a
 * mismatch produces signatures the chain rejects with nothing more informative than
 * `Invalid Transaction`. Kollectyve custodial keys are **ed25519** (KMS/Vault-friendly and
 * accepted by `MultiSignature`) — never sr25519.
 */
export function signerFromKeyProvider(
  publicKey: Uint8Array,
  sign: RemoteSign,
  scheme: SignatureScheme,
): PolkadotSigner {
  if (publicKey.length !== 32 && scheme !== "Ecdsa") {
    throw new KollectyveError(`expected a 32-byte ${scheme} public key, got ${publicKey.length} bytes`);
  }
  return getPolkadotSigner(publicKey, scheme, sign);
}

/** A keypair this process holds outright — a service account, or a machine actor's own key. */
export interface Keypair {
  publicKey: Uint8Array;
  sign: (payload: Uint8Array) => Uint8Array | Promise<Uint8Array>;
}

/** Wrap a locally-held keypair (e.g. from `@polkadot-labs/hdkd`) as a signer. */
export function signerFromKeypair(keypair: Keypair, scheme: SignatureScheme = "Sr25519"): PolkadotSigner {
  return getPolkadotSigner(keypair.publicKey, scheme, keypair.sign);
}

/**
 * Derive an sr25519 signer from a mnemonic and derivation path.
 *
 * **Junction caveat**, and it bites silently: `@polkadot-labs/hdkd-helpers` parses paths with
 * `/(\/{1,2})(\w+)/g`, so a junction is truncated at the first character outside
 * `[A-Za-z0-9_]` — `//user-1` and `//user-2` derive the *same* account. Junctions over 31
 * bytes throw. Keep every junction alphanumeric (underscores are fine) and short.
 */
export function signerFromMnemonic(mnemonic: string, path = ""): PolkadotSigner {
  assertDerivable(path);
  const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(mnemonic)));
  return signerFromKeypair(derive(path));
}

/**
 * A well-known development account (`//Alice`, `//Bob`, …) of the standard dev phrase.
 *
 * On a `--dev` chain Alice is sudo and is wired as both the enrollment and compliance key, so
 * she can call `register_identity` and `set_tier`. **Dev only** — this seed is public and the
 * accounts are funded at genesis on every dev chain in existence.
 */
export function devSigner(account = "Alice"): PolkadotSigner {
  return signerFromMnemonic(DEV_PHRASE, `//${account}`);
}

/** Reject a path whose junctions the helper would silently mangle. */
function assertDerivable(path: string): void {
  if (!path) return;
  const junctions = path.split(/\/+/).filter(Boolean);
  for (const junction of junctions) {
    if (!/^\w+$/.test(junction)) {
      throw new KollectyveError(
        `derivation junction "${junction}" contains characters the deriver silently drops ` +
          `(only [A-Za-z0-9_] survives) — different paths would collide on one account`,
      );
    }
    if (junction.length > 31) {
      throw new KollectyveError(`derivation junction "${junction}" is over 31 bytes and cannot be encoded`);
    }
  }
}
