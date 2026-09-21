import type { HexString, PolkadotSigner, TxEvent, TxFinalizedPayload } from "polkadot-api";
import { TransactionError } from "@kollectyve/core";

/**
 * Minimal structural view of what we consume from an rxjs `Observable`, so the SDK's public
 * types never force a consumer to install or reason about rxjs.
 */
export interface Subscribable<T> {
  subscribe(observer: {
    next: (value: T) => void;
    error: (err: unknown) => void;
    complete: () => void;
  }): { unsubscribe: () => void };
}

/** A PAPI transaction, reduced to what this SDK needs of it. */
export interface SubmittableTx {
  signAndSubmit: (signer: PolkadotSigner) => Promise<TxFinalizedPayload>;
  signSubmitAndWatch: (signer: PolkadotSigner) => Subscribable<TxEvent>;
  /** The decoded call, so it can be nested inside another (e.g. `Sudo.sudo`). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decodedCall?: any;
}

/**
 * Where an extrinsic is on its way to finality.
 *
 * `inBestBlock` is the first point at which the outcome is known — it carries `ok` and, on
 * failure, the `dispatchError` — but a best block can still be reorged away. `finalized` is
 * the one that cannot be taken back. A UI usually shows a result at `inBestBlock` and stops
 * showing a spinner at `finalized`.
 */
export type TxPhase = "signed" | "broadcasted" | "inBestBlock" | "finalized";

export interface TxProgress {
  phase: TxPhase;
  /** PAPI's hex-encoded transaction hash. */
  txHash: HexString;
  /** Present from `inBestBlock` on. */
  block?: { hash: string; number: number; index: number };
  /** Whether the call dispatched successfully. Present from `inBestBlock` on. */
  ok?: boolean;
  /** Set when `ok` is false — e.g. `{ type: "Module", value: … }`. */
  dispatchError?: { type: string; value: unknown };
}

/** Called on every transition; never throws into the submission. */
export type TxProgressHandler = (progress: TxProgress) => void;

export interface TxOptions {
  /** Overrides the client's default signer. */
  signer?: PolkadotSigner;
  /**
   * Stream the extrinsic's progress. Supplying this switches submission from "await the
   * final result" to a watched submission — the returned promise still resolves with the
   * same finalized payload.
   */
  onProgress?: TxProgressHandler;
  /**
   * Dispatch from **root** by wrapping the call in `Sudo.sudo`.
   *
   * The privileged origins are `EnsureRoot OR EnsureSignedBy<key>`; this takes the root arm, for
   * a chain whose genesis never wired the key. The signer must be the sudo key.
   *
   * A sudo-wrapped extrinsic succeeds at the outer level even when the inner call fails, so the
   * SDK checks the `Sudo.Sudid` event and **throws** a {@link TransactionError} on inner failure
   * rather than handing back a result that looks successful.
   */
  sudo?: boolean;
}

/** Every façade write takes either a bare signer or the full options object. */
export type SignerOrTxOptions = PolkadotSigner | TxOptions;

/** `PolkadotSigner` always carries a `publicKey`; {@link TxOptions} never does. */
export function isSigner(value: SignerOrTxOptions | undefined): value is PolkadotSigner {
  return !!value && "publicKey" in value;
}

export function toTxOptions(value?: SignerOrTxOptions): TxOptions {
  if (!value) return {};
  return isSigner(value) ? { signer: value } : value;
}

/**
 * Submit an extrinsic, optionally reporting each step.
 *
 * Without `onProgress` this is PAPI's plain `signAndSubmit`. With it, the transaction is
 * watched and every transition is reported before the promise settles. Either way the
 * promise resolves with the finalized payload — including for a call the runtime *rejected*,
 * which resolves with `ok: false` and a `dispatchError` rather than throwing. Only a
 * transaction that never made it (invalid, dropped, connection lost) rejects.
 */
export function submitTx(
  tx: SubmittableTx,
  signer: PolkadotSigner,
  onProgress?: TxProgressHandler,
): Promise<TxFinalizedPayload> {
  if (!onProgress) return tx.signAndSubmit(signer);

  return new Promise<TxFinalizedPayload>((resolve, reject) => {
    let settled = false;
    const subscription = tx.signSubmitAndWatch(signer).subscribe({
      next: (event) => {
        switch (event.type) {
          case "signed":
          case "broadcasted":
            onProgress({ phase: event.type, txHash: event.txHash });
            break;
          case "txBestBlocksState":
            // `found: false` means the tx is not in the current best block — still in flight,
            // or displaced by a reorg. Nothing to report until it lands.
            if (event.found) {
              onProgress({
                phase: "inBestBlock",
                txHash: event.txHash,
                block: event.block,
                ok: event.ok,
                dispatchError: event.dispatchError,
              });
            }
            break;
          case "finalized":
            onProgress({
              phase: "finalized",
              txHash: event.txHash,
              block: event.block,
              ok: event.ok,
              dispatchError: event.dispatchError,
            });
            settled = true;
            resolve({
              txHash: event.txHash,
              ok: event.ok,
              events: event.events,
              block: event.block,
              dispatchError: event.dispatchError,
            } as TxFinalizedPayload);
            subscription.unsubscribe();
            break;
        }
      },
      error: (err) => {
        settled = true;
        reject(new TransactionError((err as Error)?.message ?? "the transaction failed", { cause: err }));
      },
      complete: () => {
        // The stream ends after `finalized`; ending before that means the tx was dropped.
        if (!settled) reject(new TransactionError("the transaction ended without being finalized"));
      },
    });
  });
}
