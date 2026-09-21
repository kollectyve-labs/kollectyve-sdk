import { createContext, useContext } from "react";
import type { KollectyveClient } from "@kollectyve/sdk";

export const KollectyveContext = createContext<KollectyveClient | null>(null);

/** Access the {@link KollectyveClient} provided by {@link KollectyveProvider}. */
export function useKollectyve(): KollectyveClient {
  const client = useContext(KollectyveContext);
  if (!client) {
    throw new Error("useKollectyve must be used within a <KollectyveProvider>");
  }
  return client;
}
