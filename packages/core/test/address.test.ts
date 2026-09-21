import { describe, expect, it } from "vitest";
import {
  accountId32ToEvm,
  encodeSs58,
  decodeSs58,
  evmToAccountId32,
  isEthDerived,
  ss58ToEvm,
  evmToSs58,
} from "../src/index.js";

// alith — a well-known EVM dev account. Its fallback AccountId32 is the exact hex literal
// funded in the chain's genesis (runtime/src/genesis_config_presets.rs).
const ALITH = "0xf24FF3a9CF04c71Dbc94D0b566f7A27B94566cac";
const ALITH_ACCOUNT_ID =
  "0xf24ff3a9cf04c71dbc94d0b566f7a27b94566caceeeeeeeeeeeeeeeeeeeeeeee";

// Canonical Substrate "Alice": sr25519 public key and its SS58 (prefix 42) address.
const ALICE_PUBKEY =
  "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
const ALICE_SS58 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

describe("EVM ⇄ AccountId32 bridge", () => {
  it("maps an H160 to its 0xEE-suffixed AccountId32 (matches genesis)", () => {
    expect(evmToAccountId32(ALITH).toLowerCase()).toBe(ALITH_ACCOUNT_ID);
  });

  it("recognises eth-derived accounts by the 0xEE suffix", () => {
    expect(isEthDerived(ALITH_ACCOUNT_ID)).toBe(true);
    expect(isEthDerived(ALICE_PUBKEY)).toBe(false);
  });

  it("strips the suffix for eth-derived AccountId32 → H160", () => {
    expect(accountId32ToEvm(ALITH_ACCOUNT_ID).toLowerCase()).toBe(ALITH.toLowerCase());
  });

  it("round-trips H160 → AccountId32 → H160", () => {
    expect(accountId32ToEvm(evmToAccountId32(ALITH)).toLowerCase()).toBe(ALITH.toLowerCase());
  });

  it("hashes (not truncates) a native pubkey for AccountId32 → H160", () => {
    const evm = accountId32ToEvm(ALICE_PUBKEY);
    // 20-byte address, and NOT a naive truncation of the first/last 20 pubkey bytes
    expect(evm).toMatch(/^0x[0-9a-f]{40}$/);
    expect(evm.toLowerCase()).not.toBe("0x" + ALICE_PUBKEY.slice(2, 42));
  });
});

describe("SS58", () => {
  it("encodes the canonical Alice address", () => {
    expect(encodeSs58(ALICE_PUBKEY, 42)).toBe(ALICE_SS58);
  });

  it("decodes back to the public key", () => {
    expect("0x" + Buffer.from(decodeSs58(ALICE_SS58)).toString("hex")).toBe(ALICE_PUBKEY);
  });

  it("rejects a corrupted checksum", () => {
    expect(() => decodeSs58(ALICE_SS58.slice(0, -1) + "A")).toThrow();
  });

  it("bridges SS58 ⇄ EVM via the same rules", () => {
    // alith's AccountId32 encoded as SS58, then back to the H160
    const alithSs58 = evmToSs58(ALITH);
    expect(ss58ToEvm(alithSs58).toLowerCase()).toBe(ALITH.toLowerCase());
  });
});
