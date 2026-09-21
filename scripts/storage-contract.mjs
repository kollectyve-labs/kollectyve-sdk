/**
 * The sample `Storage` contract from `kollectyve-chain/contracts`, compiled with solc 0.8.28
 * (evmVersion cancun). ABI plus creation bytecode, so the smoke test can deploy it without a
 * Hardhat step. Mirrors `examples/pilot/src/storage.ts`.
 */
export const storageAbi = [
  { type: "constructor", inputs: [{ name: "initial", type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "retrieve", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "store", inputs: [{ name: "newNumber", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "increment", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  {
    type: "event",
    name: "NumberChanged",
    inputs: [
      { name: "by", type: "address", indexed: true },
      { name: "oldValue", type: "uint256", indexed: false },
      { name: "newValue", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
];

export const storageBytecode =
  "0x6080604052348015600e575f5ffd5b50604051610219380380610219833981016040819052602b91606f565b5f818155604080519182526020820183905233917f8a0ae77ff4183de38d23837cbfa0ad4ee3ab54e24c501706d5a9e375d5a6bfc7910160405180910390a2506085565b5f60208284031215607e575f5ffd5b5051919050565b610187806100925f395ff3fe608060405234801561000f575f5ffd5b506004361061003f575f3560e01c80632e64cec1146100435780636057361d14610058578063d09de08a1461006d575b5f5ffd5b5f545b60405190815260200160405180910390f35b61006b610066366004610115565b610075565b005b6100466100bb565b5f805490829055604080518281526020810184905233917f8a0ae77ff4183de38d23837cbfa0ad4ee3ab54e24c501706d5a9e375d5a6bfc7910160405180910390a25050565b5f80546100c981600161012c565b5f81905560405133917f8a0ae77ff4183de38d23837cbfa0ad4ee3ab54e24c501706d5a9e375d5a6bfc79161010691858252602082015260400190565b60405180910390a250505f5490565b5f60208284031215610125575f5ffd5b5035919050565b8082018082111561014b57634e487b7160e01b5f52601160045260245ffd5b9291505056fea2646970667358221220f75eef3846429e882acfe3d50575434316e36c1ce6f82500c5ce616ac4ebc1e164736f6c634300081c0033";
