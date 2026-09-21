import { describe, expect, it } from "vitest";
import { KollectyveError } from "@kollectyve/core";
import { devSigner, signerFromKeyProvider, signerFromMnemonic } from "../src/signers.js";

describe("devSigner", () => {
  it("derives the canonical Alice account", () => {
    // The public key behind 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY.
    expect(Buffer.from(devSigner("Alice").publicKey).toString("hex")).toBe(
      "d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
    );
  });

  it("gives each dev account its own key", () => {
    expect(devSigner("Alice").publicKey).not.toEqual(devSigner("Bob").publicKey);
  });
});

describe("derivation guard", () => {
  // The helper's path parser drops everything from the first non-`\w` character, so these
  // would otherwise collide silently on one account instead of failing.
  const DEV = "bottom drive obey lake curtain smoke basket hold race lonely fit walk";

  it("rejects junctions containing characters the deriver would drop", () => {
    expect(() => signerFromMnemonic(DEV, "//user-1")).toThrow(KollectyveError);
    expect(() => signerFromMnemonic(DEV, "//user-1")).toThrow(/silently drops/);
    expect(() => signerFromMnemonic(DEV, "//a.b")).toThrow(/silently drops/);
    expect(() => signerFromMnemonic(DEV, "//ok//bad-one")).toThrow(/bad-one/);
  });

  it("rejects junctions too long to encode", () => {
    expect(() => signerFromMnemonic(DEV, `//${"a".repeat(32)}`)).toThrow(/over 31 bytes/);
  });

  it("accepts alphanumeric and underscored junctions, and keeps them distinct", () => {
    const a = signerFromMnemonic(DEV, "//tenant_1//abc123");
    const b = signerFromMnemonic(DEV, "//tenant_2//abc123");
    expect(a.publicKey).not.toEqual(b.publicKey);
  });
});

describe("signerFromKeyProvider", () => {
  it("signs through the remote callback without ever seeing the key", async () => {
    const asked: Uint8Array[] = [];
    const signer = signerFromKeyProvider(new Uint8Array(32).fill(7), async (payload) => {
      asked.push(payload);
      return new Uint8Array(64).fill(1);
    }, "Ed25519");
    expect(signer.publicKey).toEqual(new Uint8Array(32).fill(7));
    expect(asked).toHaveLength(0);
  });

  it("rejects a public key of the wrong length", () => {
    expect(() =>
      signerFromKeyProvider(new Uint8Array(16), async () => new Uint8Array(64), "Ed25519"),
    ).toThrow(/32-byte Ed25519 public key/);
  });
});
