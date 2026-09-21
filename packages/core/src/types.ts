import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex, type Hex } from "./hex.js";

/** A network-wide identity handle from `pallet-kollectyve-id` (`IdentityId = u64`). */
export type IdentityId = bigint;

/** A 32-byte hash (`H256`), `0x`-prefixed. */
export type H256Hex = Hex;

/** Coarse KYC tier from `pallet-kollectyve-id` / primitives, ordered lowest→highest. */
export type KycTier = "None" | "Basic" | "Verified" | "Accredited";

export const KYC_TIERS: readonly KycTier[] = ["None", "Basic", "Verified", "Accredited"] as const;

/** Anything that can identify an account to the SDK: SS58, 32-byte hex, or an H160. */
export type AccountLike = string | Hex;

/**
 * A KYC claim recorded by the compliance origin (`pallet-kollectyve-policy`'s `KycClaim`).
 *
 * Field names are the SDK's camelCase; `@kollectyve/substrate` converts to and from the
 * runtime's SCALE shape at the call boundary.
 */
export interface KycClaim {
  tier: KycTier;
  /** ISO 3166-1 numeric country code; 0 = unspecified. */
  jurisdiction: number;
  accredited: boolean;
  /** Unix time in **milliseconds** after which the claim is stale. Omit = never expires. */
  expiresAt?: bigint;
}

/** Per-asset holding/transfer rules (`pallet-kollectyve-policy`'s `AssetPolicy`). */
export interface AssetPolicy {
  minTier: KycTier;
  requireAccredited: boolean;
  /** If non-empty, only these jurisdictions may hold. Empty = all except `blockedJurisdictions`. */
  allowedJurisdictions: number[];
  blockedJurisdictions: number[];
  frozen: boolean;
}

/** Hardware a Kumulus provider offers (`pallet-kumulus`'s `ProviderSpecs`). */
export interface ProviderSpecs {
  cpuCores: number;
  memoryMb: number;
  storageGb: number;
  /** ISO 3166-1 numeric region code; 0 = unspecified. */
  region: number;
}

/** A stored provider record, keyed by the owner's identity (`pallet-kumulus`'s `ProviderRecord`). */
export interface ProviderRecord {
  specs: ProviderSpecs;
  active: boolean;
}

/**
 * Domain tag namespacing every commitment. **Must match the value the product backends use**
 * (`KOLLECTYVE_COMMITMENT_DOMAIN`, default below) — a different tag mints a second identity for
 * the same human, which is exactly what the anchor exists to prevent.
 */
export const COMMITMENT_DOMAIN = "kollectyve:identity:v1";

/**
 * Derive the PII-free `user_commitment` that `register_identity` requires.
 *
 *     commitment = blake2b-256( `${domain}:${userId}` )
 *
 * `userId` is the stable, opaque auth subject (a BetterAuth user id — not an email). It is
 * hashed here and never leaves the caller. The chain stores the result in `UsedCommitments` to
 * enforce one identity per auth subject, so enrollment stays idempotent even if the caller's
 * own record is lost.
 *
 * **This must stay byte-identical to `deriveCommitment` in the Kumulus backend**
 * (`src/services/chain/commitment.ts`), which is the deployed convention and the source of
 * every commitment already on chain — see the pinned vectors in `packages/core/test`. Change
 * the ordering, the separator or the tag and the same user forks into two identities.
 *
 * ```ts
 * const commitment = userCommitment(betterAuthUserId);
 * await k.substrate.identity.registerIdentity(controller, commitment, signer);
 * ```
 */
export function userCommitment(userId: string, domain: string = COMMITMENT_DOMAIN): H256Hex {
  if (!userId || userId.trim() === "") throw new Error("userCommitment: userId is required");
  const preimage = new TextEncoder().encode(`${domain}:${userId}`);
  return bytesToHex(blake2b(preimage, { dkLen: 32 }));
}
