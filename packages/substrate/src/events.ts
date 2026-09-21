import type { BlockInfo, EventPhase } from "polkadot-api";
import type { Subscribable } from "./tx.js";

/** Stop receiving events. Always call this when the subscriber goes away. */
export type Unsubscribe = () => void;

/** One decoded event, with the block it was emitted in. */
export interface ChainEvent<T> {
  payload: T;
  block: BlockInfo;
  phase: EventPhase;
}

/** The shape PAPI's typed API exposes per event (`api.event.Pallet.EventName`). */
export interface WatchableEvent<T> {
  watch: (filter?: (value: T) => boolean) => Subscribable<{
    meta: { block: BlockInfo; phase: EventPhase };
    payload: T;
  }>;
  pull: () => Promise<Array<{ meta: { block: BlockInfo; phase: EventPhase }; payload: T }>>;
}

export interface WatchOptions<T> {
  /** Only deliver events matching this predicate — applied on-chain-side by PAPI. */
  filter?: (payload: T) => boolean;
  /** Called if the subscription itself fails. Without it, errors are swallowed. */
  onError?: (error: unknown) => void;
}

/**
 * Subscribe to one event kind on the **finalized** chain, mapping each payload with `decode`.
 *
 * PAPI watches finalized blocks, so an event arrives once it can no longer be reorged away —
 * later than the `inBestBlock` phase of a transaction that caused it, and more trustworthy.
 */
export function watchEvent<TChain, TOut>(
  event: WatchableEvent<TChain>,
  decode: (payload: TChain) => TOut,
  onEvent: (event: ChainEvent<TOut>) => void,
  options: WatchOptions<TChain> = {},
): Unsubscribe {
  const subscription = event.watch(options.filter).subscribe({
    next: ({ meta, payload }) => onEvent({ payload: decode(payload), block: meta.block, phase: meta.phase }),
    error: (err) => options.onError?.(err),
    complete: () => {},
  });
  return () => subscription.unsubscribe();
}

/** Read every matching event already present in the latest finalized block. */
export async function pullEvents<TChain, TOut>(
  event: WatchableEvent<TChain>,
  decode: (payload: TChain) => TOut,
): Promise<Array<ChainEvent<TOut>>> {
  const found = await event.pull();
  return found.map(({ meta, payload }) => ({
    payload: decode(payload),
    block: meta.block,
    phase: meta.phase,
  }));
}
