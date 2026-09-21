import { describe, expect, it } from "vitest";
import { COMMITMENT_DOMAIN, userCommitment } from "../src/types.js";

/**
 * These vectors were produced by the *deployed* implementation — `deriveCommitment` in
 * kumulus-backend-light (`@polkadot/util-crypto`'s `blake2AsHex`) — not by this code. They are
 * the contract: every commitment already anchored on chain came from that function, so the SDK
 * has to reproduce it byte for byte or the same user forks into two identities.
 */
describe("userCommitment", () => {
  it("matches the Kumulus backend's deriveCommitment", () => {
    expect(userCommitment("user-123")).toBe(
      "0x39f2dc374bfb0232a56dc9077e2cf13de8d7e3fa57ea83f17317454461cb8fd8",
    );
    expect(userCommitment("abc")).toBe(
      "0xc5e821c876eeb78d3120263b852af397b8e71a17fe24bbb0acacd816fa9b9e62",
    );
  });

  it("uses the same default domain tag as the backend", () => {
    expect(COMMITMENT_DOMAIN).toBe("kollectyve:identity:v1");
    expect(userCommitment("user-123", COMMITMENT_DOMAIN)).toBe(userCommitment("user-123"));
  });

  it("separates domains, so a tag change cannot collide", () => {
    expect(userCommitment("user-123", "other:v1")).not.toBe(userCommitment("user-123"));
  });

  it("rejects an empty subject rather than anchoring a constant", () => {
    expect(() => userCommitment("")).toThrow(/userId is required/);
    expect(() => userCommitment("   ")).toThrow(/userId is required/);
  });
});
