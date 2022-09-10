const path = require("path");
const { expect } = require("chai");

const { FGL, starkSetup, starkGen, starkVerify } = require("pil-stark");

const { newConstantPolsArray, newCommitPolsArray, compile, verifyPil } = require("pilcom");

class FibonacciJS {
  async buildConstants(pols) {
    const N = pols.ISLAST.length;
    for (let i = 0; i < N-1; i++) {
      pols.ISLAST[i] = 0n;
    }
    pols.ISLAST[N-1] = 1n;
  }

  async execute(pols, input) {
    const N = pols.aLast.length;
    pols.aBeforeLast[0] = BigInt(input[0]);
    pols.aLast[0] = BigInt(input[1]);

    for (let i = 1; i < N; i ++) {
      pols.aBeforeLast[i] = pols.aLast[i-1];
      pols.aLast[i] = FGL.add(pols.aBeforeLast[i-1], pols.aLast[i-1]);
    }
    return pols.aLast[N - 1];
  }
}

async function run() {
  let pil = await compile(FGL, path.join(__dirname, "fibonacci.pil"));
  let fibjs = new FibonacciJS();

  let constPols = newConstantPolsArray(pil);
  await fibjs.buildConstants(constPols.Fibonacci);

  let cmPols = newCommitPolsArray(pil);
  let res2 = await fibjs.execute(cmPols.Fibonacci, [1, 2]);

  const res = await verifyPil(FGL, pil, cmPols, constPols);
  console.log(res);
  expect(res.length).eq(0);

  await proveAndVerify(pil, constPols, cmPols);
  console.log("5");
}

async function proveAndVerify(pil, constPols, cmPols) {
  const starkStruct = {
    nBits: 10,
    nBitsExt: 14,
    nQueries: 32,
    verificationHashType: "GL",
    steps: [
      {nBits: 14},
      {nBits: 9},
      {nBits: 4}
    ]
  }
  const setup = await starkSetup(constPols, pil, starkStruct);
  const proof = await starkGen(cmPols, constPols, setup.constTree, setup.starkInfo);
  const verified = await starkVerify(proof.proof, proof.publics, setup.constRoot, setup.starkInfo);
  expect(verified).eq(true);
}

run().then(() => {
  console.log("Done")
})
