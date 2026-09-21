import type { AssetPolicy, IdentityId, KycClaim, KycTier } from "@kollectyve/core";
import type { SubstrateClient } from "../client.js";
import { claimFromChain, claimToChain, policyFromChain, policyToChain, tierFromChain } from "../codec.js";
import { watchEvent, type ChainEvent, type Unsubscribe, type WatchOptions } from "../events.js";
import type { SignerOrTxOptions } from "../tx.js";

/** `KollectyvePolicy.ClaimSet` — a KYC claim was recorded or replaced. */
export interface ClaimSet {
  id: IdentityId;
  tier: KycTier;
}

/** `KollectyvePolicy.ClaimRevoked` — an identity's claim was removed. */
export interface ClaimRevoked {
  id: IdentityId;
}

/** `KollectyvePolicy.AssetPolicySet` — an asset's rules were set or replaced. */
export interface AssetPolicySet {
  asset: number;
}

/** `KollectyvePolicy.AssetFrozen` — an asset was frozen or unfrozen. */
export interface AssetFrozen {
  asset: number;
  frozen: boolean;
}

/**
 * `pallet-kollectyve-policy` — the regulated-asset compliance gate (KYC claims + asset policies).
 *
 * Calls: `set_claim`, `revoke_claim`, `set_asset_policy`, `set_frozen` — **all under the
 * compliance origin** (a multisig in production, root on a `--dev` chain). Reads are open.
 * Storage: `Claims`, `AssetPolicies`. The runtime's `AssetId` is `u32`.
 */
export class PolicyModule {
  constructor(private readonly c: SubstrateClient) {}

  // --- reads ---

  /** The KYC claim recorded for an identity, if any. */
  async claimOf(id: IdentityId): Promise<KycClaim | undefined> {
    return claimFromChain(await this.c.api.query.KollectyvePolicy.Claims.getValue(id));
  }

  /** The policy configured for an asset, if any. */
  async assetPolicy(assetId: number): Promise<AssetPolicy | undefined> {
    return policyFromChain(await this.c.api.query.KollectyvePolicy.AssetPolicies.getValue(assetId));
  }

  // --- writes (compliance origin) ---

  /** Set (or replace) the KYC claim for an existing identity. */
  setClaim(id: IdentityId, claim: KycClaim, options?: SignerOrTxOptions) {
    return this.c.submit(
      this.c.api.tx.KollectyvePolicy.set_claim({ id, claim: claimToChain(claim) }),
      options,
    );
  }

  /** Remove an identity's KYC claim. */
  revokeClaim(id: IdentityId, options?: SignerOrTxOptions) {
    return this.c.submit(this.c.api.tx.KollectyvePolicy.revoke_claim({ id }), options);
  }

  /** Set (or replace) an asset's policy. */
  setAssetPolicy(assetId: number, policy: AssetPolicy, options?: SignerOrTxOptions) {
    return this.c.submit(
      this.c.api.tx.KollectyvePolicy.set_asset_policy({ asset: assetId, policy: policyToChain(policy) }),
      options,
    );
  }

  /**
   * Freeze or unfreeze an asset. The asset must already have a policy — this mutates the
   * `frozen` flag of an existing one rather than creating it.
   */
  setFrozen(assetId: number, frozen: boolean, options?: SignerOrTxOptions) {
    return this.c.submit(
      this.c.api.tx.KollectyvePolicy.set_frozen({ asset: assetId, frozen }),
      options,
    );
  }

  // --- events (finalized blocks) ---

  /** Watch KYC claims being set or replaced. */
  onClaimSet(
    onEvent: (event: ChainEvent<ClaimSet>) => void,
    options?: WatchOptions<{ id: bigint; tier: { type: KycTier } }>,
  ): Unsubscribe {
    return watchEvent(
      this.c.api.event.KollectyvePolicy.ClaimSet,
      (p) => ({ id: p.id, tier: tierFromChain(p.tier) }),
      onEvent,
      options,
    );
  }

  /** Watch claims being revoked. */
  onClaimRevoked(
    onEvent: (event: ChainEvent<ClaimRevoked>) => void,
    options?: WatchOptions<{ id: bigint }>,
  ): Unsubscribe {
    return watchEvent(
      this.c.api.event.KollectyvePolicy.ClaimRevoked,
      (p) => ({ id: p.id }),
      onEvent,
      options,
    );
  }

  /** Watch asset policies being set or replaced. */
  onAssetPolicySet(
    onEvent: (event: ChainEvent<AssetPolicySet>) => void,
    options?: WatchOptions<{ asset: number }>,
  ): Unsubscribe {
    return watchEvent(
      this.c.api.event.KollectyvePolicy.AssetPolicySet,
      (p) => ({ asset: p.asset }),
      onEvent,
      options,
    );
  }

  /**
   * Watch assets being frozen or unfrozen — the event a trading UI needs in order to halt
   * without polling.
   */
  onAssetFrozen(
    onEvent: (event: ChainEvent<AssetFrozen>) => void,
    options?: WatchOptions<{ asset: number; frozen: boolean }>,
  ): Unsubscribe {
    return watchEvent(
      this.c.api.event.KollectyvePolicy.AssetFrozen,
      (p) => ({ asset: p.asset, frozen: p.frozen }),
      onEvent,
      options,
    );
  }
}
