import { useState } from "react";
import { useKollectyve } from "@kollectyve/react";

/**
 * The one primitive that makes this a single chain rather than two: `pallet-revive` keeps one
 * balance ledger but addresses it two ways, and the mapping is stateless in both directions.
 */
export function BridgePanel() {
  const k = useKollectyve();
  const [evm, setEvm] = useState("0xf24FF3a9CF04c71Dbc94D0b566f7A27B94566cac");
  const [ss58, setSs58] = useState("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
  const [error, setError] = useState<string>();

  const convert = (fn: () => void) => {
    setError(undefined);
    try {
      fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="panel">
      <h2>Address bridge</h2>

      <div className="row">
        <input className="mono" value={evm} onChange={(e) => setEvm(e.target.value)} />
        <button onClick={() => convert(() => setSs58(k.addresses.evmToSs58(evm as `0x${string}`)))}>
          → SS58
        </button>
      </div>
      <div className="row">
        <input className="mono" value={ss58} onChange={(e) => setSs58(e.target.value)} />
        <button onClick={() => convert(() => setEvm(k.addresses.ss58ToEvm(ss58)))}>→ H160</button>
      </div>
      {error && <p className="error small">{error}</p>}
      <p className="muted small">
        An EVM-origin account maps to <code>address ++ 0xEE×12</code>. A Substrate account that
        called <code>revive.map()</code> resolves through on-chain storage instead, so this
        stateless form does not cover it.
      </p>
    </section>
  );
}
