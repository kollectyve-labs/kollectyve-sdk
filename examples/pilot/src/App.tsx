import { useState } from "react";
import { KollectyveProvider, useConnectWallet } from "@kollectyve/react";
import type { NetworkName } from "@kollectyve/sdk";
import { EvmPanel } from "./panels/EvmPanel.js";
import { SubstratePanel } from "./panels/SubstratePanel.js";
import { BridgePanel } from "./panels/BridgePanel.js";

export function App() {
  const [network, setNetwork] = useState<NetworkName>("local");
  return (
    // `key` forces a fresh provider (new client) when the network changes.
    <KollectyveProvider key={network} network={network}>
      <Playground network={network} onNetwork={setNetwork} />
    </KollectyveProvider>
  );
}

function Playground({ network, onNetwork }: { network: NetworkName; onNetwork: (n: NetworkName) => void }) {
  const { wallet, connect, connecting, error } = useConnectWallet();

  return (
    <div className="app">
      <header>
        <h1>Kollectyve Playground</h1>
        <div className="controls">
          <select value={network} onChange={(e) => onNetwork(e.target.value as NetworkName)}>
            <option value="local">local (dev-chain.sh)</option>
            <option value="testnet">testnet</option>
          </select>
          {wallet ? (
            <span className="pill ok" title={wallet.address}>
              {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
            </span>
          ) : (
            <button onClick={connect} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect MetaMask"}
            </button>
          )}
        </div>
      </header>

      {error && <p className="error">Wallet: {error.message}</p>}

      <main>
        <EvmPanel wallet={wallet} />
        <SubstratePanel />
        <BridgePanel wallet={wallet} />
      </main>

      <footer>
        Run the chain first: <code>cd kollectyve-chain &amp;&amp; ./scripts/dev-chain.sh</code>. EVM on{" "}
        <code>:8545</code>, Substrate on <code>:9944</code>.
      </footer>
    </div>
  );
}
