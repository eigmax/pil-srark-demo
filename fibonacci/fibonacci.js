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
const { proof2zkin } = require("../node_modules/pil-stark/src/proof2zkin.js");
const { WitnessCalculatorBuilder } = require("circom_runtime");
const {log2} = require("../node_modules/pil-stark/src/utils.js");
const buildMerklehashBN128 = require("../node_modules/pil-stark/src/merklehash_bn128_p.js");
const JSONbig = require('json-bigint')({ useNativeBigInt: true, alwaysParseAsBig: true, storeAsString: true });

const {readR1cs} = require("r1csfile");
const plonkSetup = require("../node_modules/pil-stark/src/compressor12/compressor12_setup.js");

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

  const proof = await proveAndVerify(pil, constPols, cmPols, starkStruct);
  let zkIn = proof2zkin(proof.proof);
  zkIn.publics = proof.publics;

  // generate vk
  const vk = await buildConsttree(pil, constPols, cmPols, starkStruct);

  const circomFile = path.join(__dirname, "../circuits.gl/fibonacci.verifier.circom");
  const verifier = await pil2circom(pil, vk.constRoot, starkStruct)
  await fs.promises.writeFile(circomFile, verifier, "utf8");

  const workspace = "/tmp/fib"
  let circuit = await wasm_tester(circomFile, {O:1, prime: "goldilocks", include: "../circuits.gl", output: workspace});
  console.log("End comliling..., circuits: ", circuit);

  // setup key
  const F = FGL;
  const r1csFile = path.join(circuit.dir, "fibonacci.verifier.r1cs")
  const r1cs = await readR1cs(r1csFile, {F: F, logger:console });
  const setupRes = await plonkSetup(r1cs);

  const c12ExecFile = path.join(workspace, "c12.exec");
  await writeExecFile(c12ExecFile, setupRes.plonkAdditions, setupRes.sMap);

  let c12PilFile = path.join(workspace, "c12.pil");
  await fs.promises.writeFile(c12PilFile, setupRes.pilStr, "utf8");
  let c12ConstFile = path.join(workspace, "c12.const");
  await setupRes.constPols.saveToFile(c12ConstFile)

  const c12Pil = await compile(F, c12PilFile, null, {}/*pilConfig*/);

  // gen stark info
  const c12StarkStruct = {
    nBits: 19,
    nBitsExt: 20,
    nQueries: 8,
    verificationHashType: "BN128",
    steps: [
      {nBits: 20},
      {nBits: 17},
      {nBits: 11},
      {nBits: 7},
      {nBits: 4}
    ]
  }

  // generate vk
  const starkInfo = starkInfoGen(c12Pil, c12StarkStruct);
  // prove

  const c12CmPols = newCommitPolsArray(c12Pil);
  const c12ConstPols = newConstantPolsArray(c12Pil);
  // load const pols
  await c12ConstPols.loadFromFile(c12ConstFile);

  const wasmFile = path.join(workspace, "fibonacci.verifier_js/fibonacci.verifier.wasm");
  const fd =await fs.promises.open(wasmFile, "r");
  const st =await fd.stat();
  const wasm = new Uint8Array(st.size);
  await fd.read(wasm, 0, st.size);
  await fd.close();

  const wc = await WitnessCalculatorBuilder(wasm);

  // read input

  const { nAdds, nSMap, addsBuff, sMapBuff } = await readExecFile(c12ExecFile);
  const w = await wc.calculateWitness(zkIn);

  for (let i=0; i<nAdds; i++) {
    w.push( F.add( F.mul( w[addsBuff[i*4]], addsBuff[i*4 + 2]), F.mul( w[addsBuff[i*4+1]],  addsBuff[i*4+3]  )));
  }

  const Nbits = log2(nSMap -1) +1;
  const N = 1 << Nbits

  for (let i=0; i<nSMap; i++) {
    for (let j=0; j<12; j++) {
      if (sMapBuff[12*i+j] != 0) {
        c12CmPols.Compressor.a[j][i] = w[sMapBuff[12*i+j]];
      } else {
        c12CmPols.Compressor.a[j][i] = 0n;
      }
    }
  }

  for (let i=nSMap; i<N; i++) {
    for (let j=0; j<12; j++) {
      c12CmPols.Compressor.a[j][i] = 0n;
    }
  }

  const c12Vk = await buildConsttree(c12Pil, c12ConstPols, c12CmPols, c12StarkStruct);
  // verify

  const c12Proof = await proveAndVerify(c12Pil, c12ConstPols, c12CmPols, c12StarkStruct);

  const c12ZkIn = proof2zkin(c12Proof.proof);
  c12ZkIn.proverAddr = BigInt("0x2FD31EB1BB3f0Ac8C4feBaF1114F42431c1F29E4");

  let publicFile = path.join(workspace, "c12.public.info.json")
  await fs.promises.writeFile(publicFile, JSONbig.stringify(c12Proof.publics, null, 1), "utf8");

  let zkinFile = path.join(workspace, "c12.zkin.json")
  await fs.promises.writeFile(zkinFile, JSONbig.stringify(c12ZkIn, (k, v) => {
        if (typeof(v) === "bigint") {
            return v.toString();
        } else {
            return v;
        }
    }, 1), "utf8");

  let proofFile = path.join(workspace, "c12.proof.json")
  await fs.promises.writeFile(proofFile, JSONbig.stringify(c12Proof.proof, null, 1), "utf8");
}

async function writeExecFile(execFile, adds, sMap) {

    const size = 2 + adds.length*4 + sMap.length*sMap[0].length;
    const buff = new BigUint64Array(size);

    buff[0] = BigInt(adds.length);
    buff[1] = BigInt(sMap[0].length);

    for (let i=0; i< adds.length; i++) {
        buff[2 + i*4     ] = BigInt(adds[i][0]);
        buff[2 + i*4 + 1 ] = BigInt(adds[i][1]);
        buff[2 + i*4 + 2 ] = adds[i][2];
        buff[2 + i*4 + 3 ] = adds[i][3];
    }

    for (let i=0; i<sMap[0].length; i++) {
        for (let c=0; c<12; c++) {
            buff[2 + adds.length*4 + 12*i + c] = BigInt(sMap[c][i]);
        }
    }

    const fd =await fs.promises.open(execFile, "w+");
    await fd.write(buff);
    await fd.close();

}

async function readExecFile(execFile) {

    const fd =await fs.promises.open(execFile, "r");
    const buffH = new BigUint64Array(2);
    await fd.read(buffH, 0, 2*8);
    const nAdds= Number(buffH[0]);
    const nSMap= Number(buffH[1]);


    const addsBuff = new BigUint64Array(nAdds*4);
    await fd.read(addsBuff, 0, nAdds*4*8);

    const sMapBuff = new BigUint64Array(nSMap*12);
    await fd.read(sMapBuff, 0, nSMap*12*8);

    await fd.close();

    return { nAdds, nSMap, addsBuff, sMapBuff };

}

async function buildConsttree(pil, constPols, cmPols, starkStruct) {
  console.log(constPols)
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

async function proveAndVerify(pil, constPols, cmPols, starkStruct) {
  const setup = await starkSetup(constPols, pil, starkStruct);
  const proof = await starkGen(cmPols, constPols, setup.constTree, setup.starkInfo);
  const verified = await starkVerify(proof.proof, proof.publics, setup.constRoot, setup.starkInfo);
  expect(verified).eq(true);
  return proof;
}

async function pil2circom(pil, constRoot, starkStruct) {

  const starkInfo = starkInfoGen(pil, starkStruct);

  setDimensions(starkInfo.verifierCode.first);
  setDimensions(starkInfo.verifierQueryCode.first);

  let template;
  if (starkStruct.verificationHashType == "GL") {
    template = await fs.promises.readFile(path.join(__dirname, "..", "circuits.gl", "stark_verifier.circom.ejs"), "utf8");
  } else {
    throw new Error("Invalid Hash Type: "+ starkStruct.verificationHashType);
  }


  const obj = {
    F: FGL,
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
