import { FixedSizeBinary } from "polkadot-api";
import {
  hexToBytes,
  type AssetPolicy,
  type H256Hex,
  type KycClaim,
  type KycTier,
  type ProviderRecord,
  type ProviderSpecs,
} from "@kollectyve/core";

/**
 * Conversion between the SDK's plain camelCase types (`@kollectyve/core`) and the SCALE shapes
 * PAPI encodes/decodes.
 *
 * Two things differ from plain JS objects and are easy to get wrong:
 *  - **enums** are `{ type, value }` objects (what `Enum("Basic")` builds), not bare strings;
 *  - **struct fields** keep the runtime's snake_case names.
 *
 * Keeping the translation here means the façades expose one stable, idiomatic surface, and
 * switching from the unsafe API to generated descriptors only touches this file.
 */

/** A PAPI enum with no payload, as the runtime's `KycTier` is encoded. */
export interface ChainEnum<T extends string> {
  type: T;
  value: undefined;
}

export function tierToChain(tier: KycTier): ChainEnum<KycTier> {
  return { type: tier, value: undefined };
}

/** `TierOf` is `ValueQuery`, so an unknown identity decodes as `None` rather than absent. */
export function tierFromChain(value: ChainEnum<KycTier> | undefined): KycTier {
  return value?.type ?? "None";
}

/** A 32-byte hash for an `H256` argument. */
export function h256(hex: H256Hex): FixedSizeBinary<32> {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) throw new Error(`expected a 32-byte H256, got ${bytes.length} bytes`);
  return new FixedSizeBinary<32>(bytes);
}

interface ChainKycClaim {
  tier: ChainEnum<KycTier>;
  jurisdiction: number;
  accredited: boolean;
  expires_at: bigint | undefined;
}

export function claimToChain(claim: KycClaim): ChainKycClaim {
  return {
    tier: tierToChain(claim.tier),
    jurisdiction: claim.jurisdiction,
    accredited: claim.accredited,
    expires_at: claim.expiresAt,
  };
}

export function claimFromChain(raw: ChainKycClaim | undefined): KycClaim | undefined {
  if (!raw) return undefined;
  return {
    tier: tierFromChain(raw.tier),
    jurisdiction: raw.jurisdiction,
    accredited: raw.accredited,
    expiresAt: raw.expires_at ?? undefined,
  };
}

interface ChainAssetPolicy {
  min_tier: ChainEnum<KycTier>;
  require_accredited: boolean;
  allowed_jurisdictions: number[];
  blocked_jurisdictions: number[];
  frozen: boolean;
}

export function policyToChain(policy: AssetPolicy): ChainAssetPolicy {
  return {
    min_tier: tierToChain(policy.minTier),
    require_accredited: policy.requireAccredited,
    allowed_jurisdictions: policy.allowedJurisdictions,
    blocked_jurisdictions: policy.blockedJurisdictions,
    frozen: policy.frozen,
  };
}

export function policyFromChain(raw: ChainAssetPolicy | undefined): AssetPolicy | undefined {
  if (!raw) return undefined;
  return {
    minTier: tierFromChain(raw.min_tier),
    requireAccredited: raw.require_accredited,
    allowedJurisdictions: [...raw.allowed_jurisdictions],
    blockedJurisdictions: [...raw.blocked_jurisdictions],
    frozen: raw.frozen,
  };
}

interface ChainProviderSpecs {
  cpu_cores: number;
  memory_mb: number;
  storage_gb: number;
  region: number;
}

export function specsToChain(specs: ProviderSpecs): ChainProviderSpecs {
  return {
    cpu_cores: specs.cpuCores,
    memory_mb: specs.memoryMb,
    storage_gb: specs.storageGb,
    region: specs.region,
  };
}

export function specsFromChain(raw: ChainProviderSpecs): ProviderSpecs {
  return {
    cpuCores: raw.cpu_cores,
    memoryMb: raw.memory_mb,
    storageGb: raw.storage_gb,
    region: raw.region,
  };
}

export function providerFromChain(
  raw: { specs: ChainProviderSpecs; active: boolean } | undefined,
): ProviderRecord | undefined {
  if (!raw) return undefined;
  return { specs: specsFromChain(raw.specs), active: raw.active };
}
