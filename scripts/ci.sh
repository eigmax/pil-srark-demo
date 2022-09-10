#!/bin/bash
set -xe
cmd="node --max-old-space-size=32000"

#pil-stark source directory
git clone https://github.com/eigmax/pil-stark
cd pil-stark
#curdir=$(cd $(dirname $0)/..; pwd)
curdir=$PWD

if [ 0 = 0 ]; then

rm -rf ${curdir}/tmp/*

${cmd} ${curdir}/test/sm_fibonacci/main_buildconst_fibonacci.js \
    -o ${curdir}/tmp/fibonacci.const.bin

${cmd} ${curdir}/test/sm_fibonacci/main_exec_fibonacci.js \
    -i ${curdir}/test/sm_fibonacci/fibonacci.input.json \
    -o ${curdir}/tmp/fibonacci.commit

${cmd} ./node_modules/pilcom/src/main_pilverifier.js \
    ${curdir}/tmp/fibonacci.commit \
    -p ${curdir}/test/sm_fibonacci/fibonacci_main.pil \
    -c ${curdir}/tmp/fibonacci.const.bin

${cmd} src/main_buildconsttree.js \
    -c ${curdir}/tmp/fibonacci.const.bin \
    -p ${curdir}/test/sm_fibonacci/fibonacci_main.pil \
    -s ${curdir}/test/sm_fibonacci/fibonacci.starkstruct.json \
    -t ${curdir}/tmp/fibonacci.consttree \
    -v ${curdir}/tmp/fibonacci.verkey.json

${cmd} src/main_prover.js -m ${curdir}/tmp/fibonacci.commit \
    -c ${curdir}/tmp/fibonacci.const.bin \
    -t ${curdir}/tmp/fibonacci.consttree \
    -p ${curdir}/test/sm_fibonacci/fibonacci_main.pil \
    -s ${curdir}/test/sm_fibonacci/fibonacci.starkstruct.json \
    -o ${curdir}/tmp/fibonacci.proof.json \
    -z ${curdir}/tmp/fibonacci.proof.zkin.json \
    -b ${curdir}/tmp/fibonacci.public.json

${cmd} src/main_verifier.js \
    -p ${curdir}/test/sm_fibonacci/fibonacci_main.pil \
    -s ${curdir}/test/sm_fibonacci/fibonacci.starkstruct.json \
    -o ${curdir}/tmp/fibonacci.proof.json \
    -b ${curdir}/tmp/fibonacci.public.json \
    -v ${curdir}/tmp/fibonacci.verkey.json

${cmd} src/main_pil2circom.js \
    -p ${curdir}/test/sm_fibonacci/fibonacci_main.pil \
    -s ${curdir}/test/sm_fibonacci/fibonacci.starkstruct.json \
    -v ${curdir}/tmp/fibonacci.verkey.json \
    -o ${curdir}/tmp/fibonacci.verifier.circom

cp ${curdir}/tmp/fibonacci.verifier.circom ${curdir}/../eigen-zkit/fri_verifier/circuits
cp ${curdir}/tmp/fibonacci.proof.zkin.json ${curdir}/../eigen-zkit/test

yarn fibonacci_compileverifier

fi

${cmd} src/compressor12/main_compressor12_setup.js \
    -r ${curdir}/tmp/fibonacci.verifier.r1cs \
    -p ${curdir}/tmp/fibonacci.c12.pil \
    -c ${curdir}/tmp/fibonacci.c12.const \
    -e ${curdir}/tmp/fibonacci.c12.exec

${cmd} src/main_genstarkinfo.js \
    -p ${curdir}/tmp/fibonacci.c12.pil \
    -s ${curdir}/test/sm_fibonacci/fibonacci.c12.starkstruct.json \
    -i ${curdir}/tmp/fibonacci.c12.starkinfo.json

${cmd} src/compressor12/main_compressor12_exec.js \
    -i ${curdir}/tmp/fibonacci.proof.zkin.json \
    -w ${curdir}/tmp/fibonacci.verifier_js/fibonacci.verifier.wasm \
    -p ${curdir}/tmp/fibonacci.c12.pil \
    -e ${curdir}/tmp/fibonacci.c12.exec \
    -m ${curdir}/tmp/fibonacci.c12.commit

${cmd} src/main_buildconsttree.js \
    -p ${curdir}/tmp/fibonacci.c12.pil \
    -c ${curdir}/tmp/fibonacci.c12.const \
    -s ${curdir}/test/sm_fibonacci/fibonacci.c12.starkstruct.json \
    -t ${curdir}/tmp/fibonacci.c12.consttree \
    -v ${curdir}/tmp/fibonacci.c12.verkey.json

${cmd} src/main_prover.js \
    -m ${curdir}/tmp/fibonacci.c12.commit \
    -c ${curdir}/tmp/fibonacci.c12.const \
    -t ${curdir}/tmp/fibonacci.c12.consttree \
    -p ${curdir}/tmp/fibonacci.c12.pil \
    -s ${curdir}/test/sm_fibonacci/fibonacci.c12.starkstruct.json \
    -o ${curdir}/tmp/fibonacci.c12.proof.json \
    -z ${curdir}/tmp/fibonacci.c12.proof.zkin.json \
    -b ${curdir}/tmp/fibonacci.c12.public.json \
    --proverAddr=0x2FD31EB1BB3f0Ac8C4feBaF1114F42431c1F29E4

${cmd} src/main_verifier.js \
    -p ${curdir}/tmp/fibonacci.c12.pil \
    -s ${curdir}/test/sm_fibonacci/fibonacci.c12.starkstruct.json \
    -o ${curdir}/tmp/fibonacci.c12.proof.json \
    -b ${curdir}/tmp/fibonacci.c12.public.json \
    -v ${curdir}/tmp/fibonacci.c12.verkey.json
