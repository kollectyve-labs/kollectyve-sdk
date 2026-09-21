/**
 * Fund an address on a Kollectyve chain — either side, one command.
 *
 *   node scripts/faucet.mjs <address> [amount] [network]
 *
 *   node scripts/faucet.mjs 0x9168…1bE8 1000          # EVM address
 *   node scripts/faucet.mjs 5GrwvaEF…utQY 1000        # SS58 address
 *   node scripts/faucet.mjs 0x9168…1bE8 50 local
 *
 * The address form picks the ledger: an SS58 address is funded with `balances.transfer_keep_alive`,
 * an `0x` address with a native EVM transfer. There is only **one** balance ledger underneath —
 * `pallet-revive` addresses it two ways — so either route credits the same account. Funding an
 * `0x` address over the Substrate side works too (send to `evmToSs58(address)`); the EVM route is
 * used because it is what a wallet shows immediately.
 *
 * ## Keys
 *
 * Set these for any chain that is not a throwaway:
 *
 *   KOLLECTYVE_FAUCET_SEED      mnemonic or `//Derivation` for the Substrate funder
 *   KOLLECTYVE_FAUCET_EVM_KEY   0x-prefixed private key for the EVM funder
 *
 * Without them this falls back to the well-known dev accounts (`//Alice`, `alith`), which are
 * funded at genesis on every `--dev` chain **and whose keys are public**. That is fine for a
 * chain you can purge and worthless anywhere else, so the fallback warns loudly.
 */
import { formatEther, parseEther } from "viem";
import {
  DEV_ACCOUNTS,
  KollectyveClient,
  devSigner,
  encodeSs58,
  evmToSs58,
  isSs58,
  signerFromMnemonic,
} from "@kollectyve/sdk";

/** Kollectyve mint (#6FE49E) in 24-bit ANSI, with a plain fallback for non-TTY output. */
const tty = process.stdout.isTTY;
const c = {
  mint: (t) => (tty ? `\x1b[38;2;111;228;158m${t}\x1b[0m` : t),
  dim: (t) => (tty ? `\x1b[38;2;125;143;134m${t}\x1b[0m` : t),
  bold: (t) => (tty ? `\x1b[1m${t}\x1b[0m` : t),
  red: (t) => (tty ? `\x1b[38;2;255;122;122m${t}\x1b[0m` : t),
};
const label = (k, v) => `${c.dim(k.padEnd(8))}${v}`;

const [target, amount = "1000", network = "testnet"] = process.argv.slice(2);

const isEvm = !!target && /^0x[0-9a-fA-F]{40}$/.test(target);
const isSub = !!target && isSs58(target);
if (!target || (!isEvm && !isSub)) {
  console.error("usage: node scripts/faucet.mjs <0xaddress|ss58address> [amount] [network]");
  process.exit(1);
}

const seed = process.env.KOLLECTYVE_FAUCET_SEED;
const evmKey = process.env.KOLLECTYVE_FAUCET_EVM_KEY;
const usingDevKeys = isEvm ? !evmKey : !seed;

if (usingDevKeys) {
  console.warn(
    c.red(
      `\n  ⚠  no ${isEvm ? "KOLLECTYVE_FAUCET_EVM_KEY" : "KOLLECTYVE_FAUCET_SEED"} set — ` +
        `falling back to the public dev account.\n` +
        `     Anyone can spend from it. Only acceptable on a chain you can purge.\n`,
    ),
  );
}

/** `//Alice`-style paths derive from the dev phrase; anything else is treated as a mnemonic. */
const substrateSigner = seed
  ? seed.startsWith("//")
    ? devSigner(seed.replace(/^\/\//, ""))
    : signerFromMnemonic(seed)
  : devSigner("Alice");

const k = await KollectyveClient.connect({
  network,
  substrateSigner,
  evmSigner: { privateKey: evmKey ?? DEV_ACCOUNTS.alith.privateKey },
});

const evmBalance = (address) => k.evm.public.getBalance({ address });

try {
  if (isEvm) {
    const from = k.evm.account.address;
    console.log(`\n${c.bold(c.mint("\u25c8 Kollectyve faucet"))}  ${c.dim(`${network} \u00b7 EVM`)}\n`);
    console.log(label("from", `${from}  ${c.dim(`(${formatEther(await evmBalance(from))} tRS)`)}`));
    console.log(label("to", `${target}  ${c.dim(`(${formatEther(await evmBalance(target))} tRS)`)}`));
    console.log(label("send", c.mint(`${amount} tRS`)));

    const hash = await k.evm.wallet.sendTransaction({ to: target, value: parseEther(amount) });
    const receipt = await k.evm.public.waitForTransactionReceipt({ hash });

    const good = receipt.status === "success";
    console.log(`\n${good ? c.mint("✓ " + receipt.status) : c.red("✗ " + receipt.status)} ${c.dim(`in block ${receipt.blockNumber}`)}`);
    console.log(label("  tx", c.dim(hash)));
    console.log(label("  now", c.mint(`${formatEther(await evmBalance(target))} tRS`)));
    console.log(label("  ss58", `${c.dim(evmToSs58(target))}  ${c.dim("· the same account")}`) + "\n");
  } else {
    const from = encodeSs58(substrateSigner.publicKey);
    const planck = parseEther(amount) / 1_000_000n; // 18dp EVM view → 12dp planck
    console.log(`\n${c.bold(c.mint("\u25c8 Kollectyve faucet"))}  ${c.dim(`${network} \u00b7 Substrate`)}\n`);
    console.log(label("from", `${from}  ${c.dim(`(${await k.substrate.balances.freeBalance(from)} planck)`)}`));
    console.log(label("to", `${target}  ${c.dim(`(${await k.substrate.balances.freeBalance(target)} planck)`)}`));
    console.log(label("send", `${c.mint(`${amount} tRS`)} ${c.dim(`(${planck} planck)`)}`));

    const result = await k.substrate.balances.transferKeepAlive(target, planck);
    if (!result.ok) throw new Error(`transfer failed: ${JSON.stringify(result.dispatchError)}`);

    console.log(`\n${c.mint("✓ finalized")} ${c.dim(`in block ${result.block.number}`)}`);
    console.log(label("  tx", c.dim(result.txHash)));
    console.log(label("  now", c.mint(`${await k.substrate.balances.freeBalance(target)} planck`)) + "\n");
  }
} finally {
  k.destroy();
}
