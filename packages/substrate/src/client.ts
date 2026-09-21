import { kollectyve } from "@kollectyve/chain-descriptors";
import { CHAIN_INFO } from "@kollectyve/chain-descriptors/chain-info";
import { createClient, type PolkadotClient, type PolkadotSigner, type TypedApi } from "polkadot-api";
import { WsEvent, getWsProvider, type StatusChange } from "polkadot-api/ws-provider";
import type { TxFinalizedPayload } from "polkadot-api";
import { ConnectionError, NETWORKS, TransactionError } from "@kollectyve/core";
import { submitTx, toTxOptions, type SignerOrTxOptions, type SubmittableTx } from "./tx.js";

/** The runtime API, typed from the chain's own metadata. */
export type KollectyveApi = TypedApi<typeof kollectyve>;

export interface SubstrateClientOptions {
  /** Substrate JSON-RPC websocket. Defaults to the testnet. */
  substrateWs?: string;
  /** Default signer for extrinsics (from a wallet extension or a keypair). */
  signer?: PolkadotSigner;
  /**
   * Called on every websocket transition. The provider reconnects on its own and never gives
   * up, so this callback is the only way to notice that a node has gone away — without it a
   * dApp just hangs on its next read. Use it to drive a "reconnecting" banner.
   */
  onConnectionStatus?: (status: StatusChange) => void;
  /** Milliseconds before an unanswered request is considered failed. PAPI's default if unset. */
  requestTimeout?: number;
  /**
   * What to do when the connected chain does not match the descriptors this SDK was built
   * against — `"throw"` (default), `"warn"` to log and continue, or `"ignore"`.
   *
   * Loosen it only deliberately: a runtime whose `specVersion` has moved may encode the same
   * call differently, and the symptom is a decode failure several calls later rather than
   * anything pointing at the mismatch.
   */
  onChainMismatch?: "throw" | "warn" | "ignore";
  /**
   * How long {@link SubstrateClient.ready} waits for the first connection before giving up.
   * Default 20s. The provider keeps retrying regardless — this only bounds the wait.
   */
  connectionTimeout?: number;
}

export { WsEvent, type StatusChange };

/**
 * Thin wrapper over a PAPI client.
 *
 * `api` is the **typed** runtime API, built from `@kollectyve/chain-descriptors` — generated out
 * of the chain's own metadata, and versioned with the runtime's `specVersion` rather than with
 * this package. Every pallet call, query and event the façades touch is checked against the
 * runtime at compile time.
 *
 * Regenerate when the runtime's `specVersion` changes in a way that affects the pallet API.
 * For anything the descriptors don't cover, {@link unsafeApi} is the untyped escape hatch.
 */
export class SubstrateClient {
  readonly client: PolkadotClient;
  readonly signer?: PolkadotSigner;
  readonly endpoint: string;
  #status: StatusChange | undefined;
  #connected = false;
  #connectionTimeout: number;
  #onChainMismatch: "throw" | "warn" | "ignore";
  #compatibilityChecked = false;

  constructor(options: SubstrateClientOptions = {}) {
    const ws = options.substrateWs ?? NETWORKS.testnet.substrateWs;
    this.endpoint = ws;
    this.#connectionTimeout = options.connectionTimeout ?? 20_000;
    this.#onChainMismatch = options.onChainMismatch ?? "throw";
    try {
      this.client = createClient(
        getWsProvider(ws, {
          ...(options.requestTimeout === undefined ? {} : { timeout: options.requestTimeout }),
          onStatusChanged: (status: StatusChange) => {
            this.#status = status;
            if (status.type === WsEvent.CONNECTED) this.#connected = true;
            options.onConnectionStatus?.(status);
          },
        }),
      );
    } catch (cause) {
      throw new ConnectionError(`failed to connect to ${ws}`, { cause });
    }
    this.signer = options.signer;
  }

  /** Latest websocket transition, or `undefined` before the first connection attempt lands. */
  get connectionStatus(): StatusChange | undefined {
    return this.#status;
  }

  /** Whether the websocket is currently up. A `false` here explains a read that never resolves. */
  get connected(): boolean {
    return this.#status?.type === WsEvent.CONNECTED;
  }

  /**
   * Whether the socket has connected at least once.
   *
   * Distinct from {@link connected}, which is the *current* state: {@link ready} waits on this
   * one so a transient drop does not restart the wait on a client that is plainly working.
   */
  get hasEverConnected(): boolean {
    return this.#connected;
  }

  /**
   * Resolve once the node is reachable, or reject with a {@link ConnectionError} naming the
   * endpoint.
   *
   * The websocket provider retries forever by design, so without this a client pointed at a
   * node that isn't there produces reads that never settle and never error — the single most
   * confusing way for an integration to fail. Await this before the first call, or use
   * `KollectyveClient.connect()`, which does it for you.
   */
  async ready(timeoutMs = this.#connectionTimeout): Promise<void> {
    if (!this.hasEverConnected) {
      const deadline = Date.now() + timeoutMs;
      while (!this.hasEverConnected && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!this.hasEverConnected) {
      throw new ConnectionError(
        `no response from ${this.endpoint} after ${timeoutMs}ms — is the node running? ` +
          `(a local dev chain starts with kollectyve-chain/scripts/dev-chain.sh)`,
      );
    }
    // Every success path lands here, so the descriptors are checked exactly once per client.
    await this.assertCompatible();
  }

  /** The runtime `@kollectyve/chain-descriptors` was generated from. */
  get descriptorChain(): typeof CHAIN_INFO {
    return CHAIN_INFO;
  }

  /**
   * Compare the connected chain against the descriptors, and complain if they differ.
   *
   * The two mismatches are not equally serious, and are treated differently:
   *
   *  - **`specVersion`** decides whether the typed API still encodes calls correctly. A runtime
   *    that has moved on may encode the same call differently, and the failure surfaces as an
   *    opaque decode error somewhere unrelated — so this is the one that honours
   *    {@link SubstrateClientOptions.onChainMismatch} and throws by default.
   *  - **`genesisHash`** identifies the chain *instance*, not its API. A purged and restarted
   *    dev chain gets a new genesis while its metadata stays byte-identical, so treating this
   *    as fatal would break every local dev loop. It always warns, never throws — but it is
   *    worth surfacing, because for a backend it usually means "pointed at the wrong chain".
   *
   * Runs once per client, from {@link ready}.
   */
  async assertCompatible(): Promise<void> {
    if (this.#compatibilityChecked || this.#onChainMismatch === "ignore") return;
    this.#compatibilityChecked = true;

    let fatal: string | undefined;
    let warning: string | undefined;
    try {
      const spec = await this.client.getChainSpecData();
      if (spec.genesisHash && spec.genesisHash !== CHAIN_INFO.genesisHash) {
        warning =
          `genesis ${spec.genesisHash} but the descriptors were built against ` +
          `${CHAIN_INFO.genesisHash} — a different chain, or one that was purged and restarted. ` +
          `Harmless if the runtime API is unchanged; check you are on the chain you meant.`;
      }
      const version = await this.api.constants.System.Version();
      if (version.spec_version !== CHAIN_INFO.specVersion) {
        fatal =
          `runtime specVersion ${version.spec_version} but the descriptors were generated from ` +
          `${CHAIN_INFO.specVersion} — regenerate with \`npm run codegen:substrate\``;
      }
    } catch {
      // A node that cannot answer these is a connection problem, which `ready` already reports.
      return;
    }

    if (warning) console.warn(`[kollectyve] ${this.endpoint}: ${warning}`);
    if (!fatal) return;
    const message = `${this.endpoint}: ${fatal}`;
    if (this.#onChainMismatch === "throw") throw new ConnectionError(message);
    console.warn(`[kollectyve] ${message}`);
  }

  /** Runtime API typed against the generated descriptors. */
  get api(): KollectyveApi {
    return this.client.getTypedApi(kollectyve);
  }

  /**
   * Metadata-untyped runtime API. Use only for pallets or calls the generated descriptors do
   * not cover; prefer {@link api}.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get unsafeApi(): any {
    return this.client.getUnsafeApi();
  }

  /**
   * Sign and submit an extrinsic, streaming its progress when the caller asked for it.
   * Every façade write routes through here — see {@link submitTx}.
   */
  async submit(tx: SubmittableTx, options?: SignerOrTxOptions): Promise<TxFinalizedPayload> {
    const { signer, onProgress, sudo } = toTxOptions(options);
    // Fail loudly rather than sit on an extrinsic that can never be broadcast.
    await this.ready();
    const result = await submitTx(sudo ? this.sudo(tx) : tx, this.requireSigner(signer), onProgress);
    // With a sudo wrapper the outer success says nothing about the wrapped call.
    if (sudo && this.sudoFailed(result)) {
      throw new TransactionError("the sudo-wrapped call failed (Sudo.Sudid reported an error)");
    }
    return result;
  }

  /**
   * Wrap a call so it dispatches from **root** via `pallet-sudo`.
   *
   * The runtime's privileged origins are `EnsureRoot OR EnsureSignedBy<key>`. Where the
   * genesis-wired key is set, sign the call directly; where it is not (a chain spec that left
   * `enrollmentKey` empty), root is the only arm and sudo is how you reach it.
   *
   * The outer extrinsic succeeds even when the inner call fails, so check the `Sudo.Sudid`
   * event — `submit` cannot see through the wrapper. Dev/bootstrap only: a production chain
   * should wire the real keys and drop sudo entirely.
   *
   * Usually you want `{ sudo: true }` on any façade write instead of calling this directly:
   *
   * ```ts
   * await k.substrate.identity.registerIdentity(controller, commitment, { signer, sudo: true });
   * ```
   */
  sudo(tx: SubmittableTx): SubmittableTx {
    if (!tx.decodedCall) throw new TransactionError("this transaction cannot be wrapped in sudo");
    return this.api.tx.Sudo.sudo({ call: tx.decodedCall }) as unknown as SubmittableTx;
  }

  /**
   * Whether a finalized result contains a failed `Sudo.Sudid` — i.e. the wrapper succeeded but
   * the wrapped call did not. Always check this after submitting a {@link sudo} call.
   */
  sudoFailed(result: TxFinalizedPayload): boolean {
    const [sudid] = this.api.event.Sudo.Sudid.filter(result.events);
    return sudid ? sudid.sudo_result.success === false : false;
  }

  requireSigner(override?: PolkadotSigner): PolkadotSigner {
    const signer = override ?? this.signer;
    if (!signer) throw new TransactionError("this call needs a signer; pass one to the client or the method");
    return signer;
  }

  /** Close the underlying connection. */
  destroy(): void {
    this.client.destroy();
  }
}
