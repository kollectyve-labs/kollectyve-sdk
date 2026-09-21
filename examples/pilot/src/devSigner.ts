import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from "@polkadot-labs/hdkd-helpers";
import { getPolkadotSigner, type PolkadotSigner } from "polkadot-api/signer";

/**
 * A PAPI signer for the well-known dev account "Alice" (`//Alice` of the standard dev phrase).
 *
 * On a `--dev` chain Alice is sudo and is wired as both the enrollment and compliance key, so
 * she can call `register_identity` / `set_tier`. DEV ONLY — this seed is public.
 */
export function aliceSigner(): PolkadotSigner {
  const miniSecret = entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE));
  const alice = sr25519CreateDerive(miniSecret)("//Alice");
  return getPolkadotSigner(alice.publicKey, "Sr25519", alice.sign);
}
