import { SubstrateClient, type SubstrateClientOptions } from "./client.js";

// Re-exported so a consumer never has to add `polkadot-api` to their own dependencies just to
// name a signer or a transaction result.
export type { BlockInfo, HexString, PolkadotSigner, TxFinalizedPayload } from "polkadot-api";
import { IdentityModule } from "./pallets/identity.js";
import { PolicyModule } from "./pallets/policy.js";
import { KumulusModule } from "./pallets/kumulus.js";
import { BalancesModule } from "./pallets/balances.js";

export {
  SubstrateClient,
  WsEvent,
  type KollectyveApi,
  type StatusChange,
  type SubstrateClientOptions,
} from "./client.js";
export {
  IdentityModule,
  type ControllerRotated,
  type IdentityRegistered,
  type TierSet,
} from "./pallets/identity.js";
export {
  PolicyModule,
  type AssetFrozen,
  type AssetPolicySet,
  type ClaimRevoked,
  type ClaimSet,
} from "./pallets/policy.js";
export { KumulusModule, type ProviderChanged } from "./pallets/kumulus.js";
export { BalancesModule } from "./pallets/balances.js";
export {
  pullEvents,
  watchEvent,
  type ChainEvent,
  type Unsubscribe,
  type WatchOptions,
  type WatchableEvent,
} from "./events.js";
export {
  isSigner,
  submitTx,
  toTxOptions,
  type SignerOrTxOptions,
  type Subscribable,
  type SubmittableTx,
  type TxOptions,
  type TxPhase,
  type TxProgress,
  type TxProgressHandler,
} from "./tx.js";
export {
  devSigner,
  signerFromKeyProvider,
  signerFromKeypair,
  signerFromMnemonic,
  type Keypair,
  type RemoteSign,
  type SignatureScheme,
} from "./signers.js";
export {
  connectSubstrateWallet,
  getSubstrateWallets,
  type ConnectedSubstrateWallet,
  type InjectedExtension,
  type InjectedPolkadotAccount,
} from "./wallet.js";

/** The Substrate half of the SDK: a client plus one façade per pallet. */
export class KollectyveSubstrate {
  readonly client: SubstrateClient;
  readonly identity: IdentityModule;
  readonly policy: PolicyModule;
  readonly kumulus: KumulusModule;
  readonly balances: BalancesModule;

  constructor(options: SubstrateClientOptions = {}) {
    this.client = new SubstrateClient(options);
    this.identity = new IdentityModule(this.client);
    this.policy = new PolicyModule(this.client);
    this.kumulus = new KumulusModule(this.client);
    this.balances = new BalancesModule(this.client);
  }

  destroy(): void {
    this.client.destroy();
  }
}
