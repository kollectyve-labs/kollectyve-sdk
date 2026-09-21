import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { KollectyveClient, type KollectyveClientOptions } from "@kollectyve/sdk";
import { KollectyveContext } from "./context.js";

export interface KollectyveProviderProps extends KollectyveClientOptions {
  children: ReactNode;
  /** Provide a pre-built client instead of constructing one from options. */
  client?: KollectyveClient;
  /**
   * Grace period before a client is torn down after the provider unmounts, in ms. Default 1000.
   * See the note on StrictMode below; set to 0 to tear down immediately.
   */
  teardownDelayMs?: number;
}

/**
 * Provides a single {@link KollectyveClient} to the React tree. The client is memoised on the
 * network endpoints, and torn down shortly after unmount.
 *
 * **Why teardown is deferred.** React 18's `<StrictMode>` mounts, runs effect cleanups, then
 * remounts — while `useMemo` keeps returning the *same* client. Destroying it in the cleanup
 * therefore hands the remounted tree a dead client: the websocket is gone, every read hangs
 * forever, and nothing throws, so the UI just sits on "loading" with a clean console. Deferring
 * the teardown lets the immediate remount cancel it, while a genuine unmount still closes the
 * socket a moment later.
 *
 * ```tsx
 * <KollectyveProvider network="testnet">
 *   <App />
 * </KollectyveProvider>
 * ```
 */
export function KollectyveProvider({
  children,
  client,
  teardownDelayMs = 1000,
  ...options
}: KollectyveProviderProps) {
  const network = options.network;
  const instance = useMemo(
    () => client ?? new KollectyveClient(options),
    // Re-create only when the network changes; a caller-supplied client is used as-is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, typeof network === "string" ? network : JSON.stringify(network)],
  );

  const pendingTeardown = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    // A remount (StrictMode, or a fast unmount/mount) cancels a teardown still in flight.
    if (pendingTeardown.current) {
      clearTimeout(pendingTeardown.current);
      pendingTeardown.current = undefined;
    }
    return () => {
      if (client) return; // caller owns its lifecycle
      pendingTeardown.current = setTimeout(() => instance.destroy(), teardownDelayMs);
    };
  }, [instance, client, teardownDelayMs]);

  return <KollectyveContext.Provider value={instance}>{children}</KollectyveContext.Provider>;
}
