import { describe, expect, it } from "vitest";
import { userCommitment } from "@kollectyve/core";
import {
  claimFromChain,
  claimToChain,
  h256,
  policyFromChain,
  policyToChain,
  specsToChain,
  tierFromChain,
  tierToChain,
} from "../src/codec.js";

// These assertions pin the *runtime's* field names and enum shape. A rename in the pallets
// must break this test — that is the failure the untyped PAPI API cannot catch for us.

describe("tier", () => {
  it("encodes as a PAPI enum, not a bare string", () => {
    expect(tierToChain("Verified")).toEqual({ type: "Verified", value: undefined });
  });

  it("decodes an absent ValueQuery entry as None", () => {
    expect(tierFromChain(undefined)).toBe("None");
    expect(tierFromChain({ type: "Basic", value: undefined })).toBe("Basic");
  });
});

describe("KycClaim", () => {
  it("maps to the pallet's snake_case fields", () => {
    expect(claimToChain({ tier: "Basic", jurisdiction: 250, accredited: false, expiresAt: 42n })).toEqual({
      tier: { type: "Basic", value: undefined },
      jurisdiction: 250,
      accredited: false,
      expires_at: 42n,
    });
  });

  it("round-trips, treating a missing expiry as never", () => {
    const claim = { tier: "Accredited" as const, jurisdiction: 0, accredited: true };
    expect(claimFromChain(claimToChain(claim))).toEqual({ ...claim, expiresAt: undefined });
    expect(claimFromChain(undefined)).toBeUndefined();
  });
});

describe("AssetPolicy", () => {
  it("round-trips through the chain shape", () => {
    const policy = {
      minTier: "Verified" as const,
      requireAccredited: true,
      allowedJurisdictions: [250, 840],
      blockedJurisdictions: [],
      frozen: false,
    };
    const chain = policyToChain(policy);
    expect(chain.min_tier).toEqual({ type: "Verified", value: undefined });
    expect(chain.require_accredited).toBe(true);
    expect(chain.allowed_jurisdictions).toEqual([250, 840]);
    expect(policyFromChain(chain)).toEqual(policy);
  });
});

describe("ProviderSpecs", () => {
  it("maps to the pallet's field names", () => {
    expect(specsToChain({ cpuCores: 8, memoryMb: 16384, storageGb: 512, region: 686 })).toEqual({
      cpu_cores: 8,
      memory_mb: 16384,
      storage_gb: 512,
      region: 686,
    });
  });
});

describe("h256", () => {
  it("accepts a 32-byte commitment and rejects anything else", () => {
    expect(h256(userCommitment("subject-1")).asHex()).toBe(userCommitment("subject-1"));
    expect(() => h256("0xdeadbeef")).toThrow(/32-byte/);
  });

  it("derives a stable, domain-separated commitment", () => {
    expect(userCommitment("subject-1")).toBe(userCommitment("subject-1"));
    expect(userCommitment("subject-1")).not.toBe(userCommitment("subject-2"));
    expect(userCommitment("s", "tag-a")).not.toBe(userCommitment("s", "tag-b"));
  });
});
