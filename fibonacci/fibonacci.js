const path = require("path");
const { expect } = require("chai");
const fs = require("fs");
const ejs = require("ejs");
const wasm_tester = require("circom_tester").wasm;
const { FGL, starkSetup, starkGen, starkVerify } = require("pil-stark");
const { interpolate } = require("../node_modules/pil-stark/src/fft_p.js");
const buildMerkleHash = require("../node_modules/pil-stark/src/merklehash_p.js");
const starkInfoGen = require("../node_modules/pil-stark/src/starkinfo.js");
const F1Field = require("../node_modules/pil-stark/src/f3g.js");

const {BigBuffer} = require("pilcom");
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

  const starkStruct = await proveAndVerify(pil, constPols, cmPols);
  console.log("5");

  // generate vk
  const vk = await buildConsttree(pil, constPols, cmPols, starkStruct);

  const circomFile = "/tmp/fibonacci.verifier.circom";
  const verifier = await pil2circom(pil, vk.constRoot, starkStruct)
  await fs.promises.writeFile(circomFile, verifier, "utf8");

  let circuit = await wasm_tester(circomFile, {O:1, prime: "goldilocks", include: "../circuits.gl"});
  console.log("End comliling...");

}

async function buildConsttree(pil, constPols, cmPols, starkStruct) {
  const nBits = starkStruct.nBits;
  const nBitsExt = starkStruct.nBitsExt;
  const n = 1 << nBits;
  const nExt = 1 << nBitsExt;

  const constBuff  = constPols.writeToBuff();

  const constPolsArrayE = new BigBuffer(nExt*pil.nConstants);

  await interpolate(constBuff, pil.nConstants, nBits, constPolsArrayE, nBitsExt );

  let MH = await buildMerkleHash();

  console.log("Start merkelizing..");
  const constTree = await MH.merkelize(constPolsArrayE, pil.nConstants, nExt);

  const constRoot = MH.root(constTree);

  const verKey = {
    constRoot: constRoot
  };

  console.log("files Generated Correctly");
  return verKey
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
  return starkStruct;
}

async function pil2circom(pil, constRoot, starkStruct) {

    const starkInfo = starkInfoGen(pil, starkStruct);

    const F = new F1Field();

    setDimensions(starkInfo.verifierCode.first);
    setDimensions(starkInfo.verifierQueryCode.first);

    let template;
    if (starkStruct.verificationHashType == "GL") {
        template = await fs.promises.readFile(path.join(__dirname, "..", "circuits.gl", "stark_verifier.circom.ejs"), "utf8");
    } else {
        throw new Error("Invalid Hash Type: "+ starkStruct.verificationHashType);
    }


    const obj = {
        F: F,
        starkInfo: starkInfo,
        starkStruct: starkStruct,
        constRoot: constRoot,
        pil: pil
    };

    return ejs.render(template ,  obj);
}


function setDimensions(code) {
  const tmpDim = [];

  for (let i=0; i<code.length; i++) {
    let newDim;
    switch (code[i].op) {
      case 'add': newDim = Math.max(getDim(code[i].src[0]), getDim(code[i].src[1])); break;
      case 'sub': newDim = Math.max(getDim(code[i].src[0]), getDim(code[i].src[1])); break;
      case 'mul': newDim = Math.max(getDim(code[i].src[0]), getDim(code[i].src[1])); break;
      case 'copy': newDim = getDim(code[i].src[0]); break;
      default: throw new Error("Invalid op:"+ code[i].op);
    }
    setDim(code[i].dest, newDim);
  }


  function getDim(r) {
    let d;
    switch (r.type) {
      case "tmp": d=tmpDim[r.id]; break;
      case "tree1": d=r.dim; break;
      case "tree2": d=r.dim; break;
      case "tree3": d=r.dim; break;
      case "tree4": d=r.dim; break;
      case "const": d=1; break;
      case "eval": d=3; break;
      case "number": d=1; break;
      case "public": d=1; break;
      case "challenge": d=3; break;
      case "xDivXSubXi": d=3; break;
      case "xDivXSubWXi": d=3; break;
      case "x": d=3; break;
      case "Z": d=3; break;
      default: throw new Error("Invalid reference type get: " + r.type);
    }
    r.dim = d;
    return d;
  }

  function setDim(r, dim) {
    switch (r.type) {
      case "tmp": tmpDim[r.id] = dim; r.dim=dim; return;
      default: throw new Error("Invalid reference type set: " + r.type);
    }
  }
}

run().then(() => {
  console.log("Done")
})
