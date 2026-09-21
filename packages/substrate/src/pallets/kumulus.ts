import type { IdentityId, ProviderRecord, ProviderSpecs } from "@kollectyve/core";
import type { SubstrateClient } from "../client.js";
import { providerFromChain, specsToChain } from "../codec.js";
import { watchEvent, type ChainEvent, type Unsubscribe, type WatchOptions } from "../events.js";
import type { SignerOrTxOptions } from "../tx.js";

/** `Kumulus.ProviderRegistered` / `ProviderUpdated` — both carry only the owner's identity. */
export interface ProviderChanged {
  id: IdentityId;
}

/**
 * `pallet-kumulus` — provider registry demonstrator (identity-keyed records).
 *
 * Calls: `register_provider`. Storage: `Providers`.
 * Events: `ProviderRegistered` (first time), `ProviderUpdated` (overwrite).
 */
export class KumulusModule {
  constructor(private readonly c: SubstrateClient) {}

  /** The provider record for an identity, if registered. */
  async providerOf(id: IdentityId): Promise<ProviderRecord | undefined> {
    return providerFromChain(await this.c.api.query.Kumulus.Providers.getValue(id));
  }

  /**
   * Register (or overwrite) the signer's provider record.
   *
   * The record is keyed by the signer's **identity**, resolved through the anchor — so the
   * signing account must already control one (`register_identity` first), otherwise the call
   * fails with `NoIdentity`.
   */
  registerProvider(specs: ProviderSpecs, options?: SignerOrTxOptions) {
    return this.c.submit(
      this.c.api.tx.Kumulus.register_provider({ specs: specsToChain(specs) }),
      options,
    );
  }

  // --- events (finalized blocks) ---

  /** Watch first-time provider registrations. An overwrite fires {@link onProviderUpdated}. */
  onProviderRegistered(
    onEvent: (event: ChainEvent<ProviderChanged>) => void,
    options?: WatchOptions<{ id: bigint }>,
  ): Unsubscribe {
    return watchEvent(
      this.c.api.event.Kumulus.ProviderRegistered,
      (p) => ({ id: p.id }),
      onEvent,
      options,
    );
  }

  /** Watch existing provider records being overwritten. */
  onProviderUpdated(
    onEvent: (event: ChainEvent<ProviderChanged>) => void,
    options?: WatchOptions<{ id: bigint }>,
  ): Unsubscribe {
    return watchEvent(
      this.c.api.event.Kumulus.ProviderUpdated,
      (p) => ({ id: p.id }),
      onEvent,
      options,
    );
  }
}
