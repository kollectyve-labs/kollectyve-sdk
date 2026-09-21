import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits, type Address } from "viem";
import {
  EVM_DECIMALS,
  connectEvmWallet,
  connectSubstrateWallet,
  type ChainEvent,
  type InjectedPolkadotAccount,
  type KollectyveClient,
  type KycTier,
  type PolkadotSigner,
  type TxFinalizedPayload,
  type TxOptions,
  type TxProgress,
  type Unsubscribe,
} from "@kollectyve/sdk";
import { useKollectyve } from "./context.js";

export type { ConnectedEvmWallet } from "@kollectyve/sdk";

/** Generic async-state shape returned by the data hooks. */
export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  refetch: () => void;
}

/** Run an async reader against the client, with loading/error state and a manual refetch. */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<Omit<AsyncState<T>, "refetch">>({
    data: undefined,
    error: undefined,
    loading: true,
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn().then(
      (data) => mounted.current && setState({ data, error: undefined, loading: false }),
      (error) => mounted.current && setState({ data: undefined, error: error as Error, loading: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(run, [run]);
  return { ...state, refetch: run };
}

/** Native (tRS) balance of an EVM address, formatted and raw. */
export function useEvmBalance(address: Address | undefined): AsyncState<{ raw: bigint; formatted: string }> {
  const k = useKollectyve();
  return useAsync(async () => {
    if (!address) throw new Error("no address");
    const raw = await k.evm.public.getBalance({ address });
    return { raw, formatted: formatUnits(raw, EVM_DECIMALS) };
  }, [k, address]);
}

/** KYC tier of an identity from `pallet-kollectyve-id`. Unknown identities read as `"None"`. */
export function useKycTier(identityId: bigint | undefined): AsyncState<KycTier | undefined> {
  const k = useKollectyve();
  return useAsync(async () => {
    if (identityId === undefined) return undefined;
    return k.substrate.identity.tierOf(identityId);
  }, [k, identityId]);
}

/** The identity controlled by an account, if any — `undefined` when the account has none. */
export function useIdentityOf(account: string | undefined): AsyncState<bigint | undefined> {
  const k = useKollectyve();
  return useAsync(async () => {
    if (!account) return undefined;
    return k.substrate.identity.identityOf(account);
  }, [k, account]);
}

/**
 * Connect an injected EVM wallet (MetaMask), prompting the user and ensuring they are on the
 * Kollectyve network — adding it to the wallet if it isn't there yet.
 *
 * All of the actual work is `connectEvmWallet` in `@kollectyve/evm`; this hook only holds the
 * result in state. Non-React consumers call that function directly.
 */
export function useConnectWallet() {
  const k = useKollectyve();
  const [wallet, setWallet] = useState<Awaited<ReturnType<typeof connectEvmWallet>> | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [connecting, setConnecting] = useState(false);
  const ethRpc = k.endpoints.ethRpc;

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(undefined);
    try {
      setWallet(await connectEvmWallet({ ethRpc }));
    } catch (e) {
      setError(e as Error);
    } finally {
      setConnecting(false);
    }
  }, [ethRpc]);

  return { wallet, connect, connecting, error };
}

export interface SubstrateWalletState {
  /** Accounts the user has permissioned, each carrying a ready `polkadotSigner`. */
  accounts: InjectedPolkadotAccount[];
  /** The account extrinsics are signed with — the first permissioned one until `select` is called. */
  selected: InjectedPolkadotAccount | undefined;
  select: (address: string) => void;
  connect: (wallet?: string) => Promise<void>;
  disconnect: () => void;
  connecting: boolean;
  error: Error | undefined;
}

/**
 * Connect a Substrate wallet extension (Polkadot-JS, Talisman, SubWallet) and keep its account
 * list live. The EVM counterpart is {@link useConnectWallet}.
 *
 * ```tsx
 * const { selected, connect } = useSubstrateWallet();
 * await k.substrate.identity.rotateController(id, next, selected!.polkadotSigner);
 * ```
 */
export function useSubstrateWallet(dappName = "Kollectyve"): SubstrateWalletState {
  const [accounts, setAccounts] = useState<InjectedPolkadotAccount[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const teardown = useRef<(() => void) | undefined>(undefined);

  // Drop the extension subscription when the component goes away.
  useEffect(() => () => teardown.current?.(), []);

  const connect = useCallback(
    async (wallet?: string) => {
      setConnecting(true);
      setError(undefined);
      try {
        teardown.current?.();
        const w = await connectSubstrateWallet(dappName, wallet);
        setAccounts(w.accounts);
        const unsubscribe = w.subscribe(setAccounts);
        teardown.current = () => {
          unsubscribe();
          w.disconnect();
        };
      } catch (e) {
        setError(e as Error);
      } finally {
        setConnecting(false);
      }
    },
    [dappName],
  );

  const disconnect = useCallback(() => {
    teardown.current?.();
    teardown.current = undefined;
    setAccounts([]);
    setSelectedAddress(undefined);
  }, []);

  const selected = accounts.find((a) => a.address === selectedAddress) ?? accounts[0];

  return {
    accounts,
    selected,
    select: setSelectedAddress,
    connect,
    disconnect,
    connecting,
    error,
  };
}

/**
 * Subscribe to a chain event for as long as the component is mounted, keeping the most recent
 * ones in state.
 *
 * `subscribe` is captured on first render and re-read on every event, so it may close over
 * fresh props without re-subscribing; the subscription itself is only torn down and rebuilt
 * when the client changes.
 *
 * ```tsx
 * const registrations = useChainEvents<IdentityRegistered>(
 *   (k, onEvent) => k.substrate.identity.onIdentityRegistered(onEvent),
 * );
 * ```
 */
export function useChainEvents<T>(
  subscribe: (client: KollectyveClient, onEvent: (event: ChainEvent<T>) => void) => Unsubscribe,
  options: { limit?: number } = {},
): { events: ChainEvent<T>[]; latest: ChainEvent<T> | undefined; clear: () => void } {
  const k = useKollectyve();
  const limit = options.limit ?? 50;
  const [events, setEvents] = useState<ChainEvent<T>[]>([]);
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;

  useEffect(() => {
    const unsubscribe = subscribeRef.current(k, (event) => {
      setEvents((prev) => [event, ...prev].slice(0, limit));
    });
    return unsubscribe;
  }, [k, limit]);

  const clear = useCallback(() => setEvents([]), []);
  return { events, latest: events[0], clear };
}

export interface TxState {
  /** Latest transition, or `undefined` before the first submission. */
  progress: TxProgress | undefined;
  /** True from submission until the extrinsic is finalized or fails. */
  pending: boolean;
  /** Set when the transaction never made it on-chain (rejected, dropped, disconnected). */
  error: Error | undefined;
  /**
   * The finalized result. A call the runtime *rejected* still lands here, with `ok: false`
   * and a `dispatchError` — check `ok`, don't assume a result means success.
   */
  result: TxFinalizedPayload | undefined;
  submit: (
    run: (client: KollectyveClient, options: TxOptions) => Promise<TxFinalizedPayload>,
  ) => Promise<TxFinalizedPayload | undefined>;
  reset: () => void;
}

/**
 * Drive one extrinsic and follow it through signing → broadcast → best block → finalized.
 *
 * ```tsx
 * const { submit, progress, pending, result } = useTx(wallet.polkadotSigner);
 * await submit((k, o) => k.substrate.identity.setTier(id, "Verified", o));
 * // progress.phase: "signed" → "broadcasted" → "inBestBlock" → "finalized"
 * ```
 */
export function useTx(signer?: PolkadotSigner): TxState {
  const k = useKollectyve();
  const [progress, setProgress] = useState<TxProgress | undefined>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [result, setResult] = useState<TxFinalizedPayload | undefined>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    setProgress(undefined);
    setError(undefined);
    setResult(undefined);
  }, []);

  const submit = useCallback<TxState["submit"]>(
    async (run) => {
      setPending(true);
      setProgress(undefined);
      setError(undefined);
      setResult(undefined);
      try {
        const finalized = await run(k, {
          signer,
          onProgress: (p) => mounted.current && setProgress(p),
        });
        if (mounted.current) setResult(finalized);
        return finalized;
      } catch (e) {
        if (mounted.current) setError(e as Error);
        return undefined;
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [k, signer],
  );

  return { progress, pending, error, result, submit, reset };
}
