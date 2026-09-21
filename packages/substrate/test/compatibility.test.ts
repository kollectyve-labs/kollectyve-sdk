import { describe, expect, it, vi } from "vitest";
import { CHAIN_INFO } from "@kollectyve/chain-descriptors/chain-info";
import { ConnectionError } from "@kollectyve/core";
import { SubstrateClient } from "../src/client.js";

/**
 * The descriptors are only valid for the runtime they were generated from. These cover the
 * check that says so out loud, since the alternative symptom — an opaque decode failure several
 * calls later — is the one that costs an afternoon.
 */
function clientWith(
  { genesisHash = CHAIN_INFO.genesisHash, specVersion = CHAIN_INFO.specVersion },
  options = {},
) {
  // Port 1 is never a node; nothing here actually connects.
  const client = new SubstrateClient({ substrateWs: "ws://127.0.0.1:1", ...options });
  vi.spyOn(client.client, "getChainSpecData").mockResolvedValue({
    name: "Kollectyve",
    genesisHash,
    properties: {},
  });
  Object.defineProperty(client, "api", {
    value: { constants: { System: { Version: async () => ({ spec_version: specVersion }) } } },
    configurable: true,
  });
  return client;
}

describe("descriptor/runtime compatibility", () => {
  it("passes silently when the chain matches the descriptors", async () => {
    const client = clientWith({});
    await expect(client.assertCompatible()).resolves.toBeUndefined();
    client.destroy();
  });

  it("names both versions when the runtime has moved on", async () => {
    const client = clientWith({ specVersion: CHAIN_INFO.specVersion + 1 });
    await expect(client.assertCompatible()).rejects.toThrow(
      new RegExp(`specVersion ${CHAIN_INFO.specVersion + 1}.*${CHAIN_INFO.specVersion}`),
    );
    client.destroy();
  });

  it("tells you to regenerate", async () => {
    const client = clientWith({ specVersion: 999 });
    await expect(client.assertCompatible()).rejects.toThrow(/codegen:substrate/);
    client.destroy();
  });

  it("warns but does not throw on a different genesis", async () => {
    // A purged dev chain gets a new genesis while its metadata stays byte-identical, so this
    // must not be fatal — otherwise every local purge-and-restart breaks the SDK.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = clientWith({ genesisHash: `0x${"ab".repeat(32)}` });
    await expect(client.assertCompatible()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/purged and restarted/));
    warn.mockRestore();
    client.destroy();
  });

  it("still throws on a genesis mismatch if the runtime also moved", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = clientWith({ genesisHash: `0x${"ab".repeat(32)}`, specVersion: 999 });
    await expect(client.assertCompatible()).rejects.toThrow(ConnectionError);
    warn.mockRestore();
    client.destroy();
  });

  it("can be downgraded to a warning, and only fires once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = clientWith({ specVersion: 999 }, { onChainMismatch: "warn" });
    await client.assertCompatible();
    await client.assertCompatible();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    client.destroy();
  });

  it("can be switched off", async () => {
    const client = clientWith({ specVersion: 999 }, { onChainMismatch: "ignore" });
    await expect(client.assertCompatible()).resolves.toBeUndefined();
    client.destroy();
  });

  it("exposes what the descriptors were built for", () => {
    const client = clientWith({});
    expect(client.descriptorChain.specVersion).toBe(CHAIN_INFO.specVersion);
    expect(client.descriptorChain.specName).toBe("kollectyve-runtime");
    client.destroy();
  });
});

describe("ready() runs the check", () => {
  it("checks compatibility on the already-connected path, not just after a timeout", async () => {
    const client = clientWith({ specVersion: 999 });
    // Pretend the socket is already up — the common case, and the one that silently skipped
    // the check when `ready` returned early on it.
    Object.defineProperty(client, "hasEverConnected", { value: true, configurable: true });
    const spy = vi.spyOn(client, "assertCompatible");
    await client.ready(200).catch(() => {});
    expect(spy).toHaveBeenCalled();
    client.destroy();
  });
});
