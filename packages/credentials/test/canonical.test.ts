import { describe, expect, it } from "vitest";
import { canonicalize, controllerCommitment, credentialDigest } from "../src/index.js";

describe("canonicalize (RFC 8785)", () => {
  it("sorts keys, drops whitespace and undefined", () => {
    expect(canonicalize({ b: "x", a: [1, true, null], c: undefined })).toBe(
      '{"a":[1,true,null],"b":"x"}',
    );
  });

  it("sorts by UTF-16 code unit and nests", () => {
    expect(canonicalize({ "\u20ac": 1, "\r": 2, "1": 3, z: { b: 1, a: 2 } })).toBe(
      '{"\\r":2,"1":3,"z":{"a":2,"b":1},"\u20ac":1}',
    );
  });

  it("serialises numbers the ECMAScript way", () => {
    expect(canonicalize([1e21, 1e-7, -0, 0.1, 333333333.3333333])).toBe(
      "[1e+21,1e-7,0,0.1,333333333.3333333]",
    );
  });

  it("refuses values another implementation could not reproduce", () => {
    expect(() => canonicalize({ x: Number.NaN })).toThrow();
    expect(() => canonicalize({ x: 1n })).toThrow();
  });
});

describe("digests", () => {
  // Expected values computed independently with Python's hashlib.blake2b(digest_size=32).
  it("credentialDigest is blake2b-256 of the JCS form, ignoring proof", () => {
    const doc = { b: "x", a: [1, true, null] };
    const expected = "0xcd5eb8fe251e139f8c66b0bcce02edaefb5c0c612b1d8244ff7d02dbb0e4a7f4";
    expect(credentialDigest(doc)).toBe(expected);
    expect(credentialDigest({ ...doc, proof: { anything: 1 } })).toBe(expected);
  });

  it("controllerCommitment matches the pallet's blake2_256(SCALE(AccountId32))", () => {
    expect(controllerCommitment(new Uint8Array(32).fill(1))).toBe(
      "0xf40ceaf86e5776923332b8d8fd3bef849cadb19c6996bc272af1f648d9566a4c",
    );
    expect(() => controllerCommitment(new Uint8Array(33))).toThrow();
  });
});
