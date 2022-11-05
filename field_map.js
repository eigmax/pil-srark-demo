const {bitLength} = require("./bigint.js");

const r = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const n64 = Math.floor((bitLength(r - 1n) - 1)/64) +1;
const f1size = n64*8;

function toMontgomery(a) {
  return BigInt(a) * ( 1n << BigInt(f1size*8)) % r;
}

function bn128_to_gl(e) {
  let mask = 0xffffffff_ffffffffn;
  let res = []
  for (let i = 0; i < 4; i ++) {
    res[i] = e & mask;
    e = e >> 64n;
  }
  return res;
}

function gl_to_bn128(es) {
  let res = 0n;
  for (let i = 0; i < 4; i ++) {
    res += (es[i] << BigInt(64*i));
  }
  return res;
}

let n = [1n, 1003n, 2003n, 0n];
let t = gl_to_bn128(n)
console.log("bn128", t);
let mt = toMontgomery(t)
let tt = bn128_to_gl(mt)
console.log(tt)
