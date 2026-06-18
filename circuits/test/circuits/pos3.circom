pragma circom 2.0.0;

include "poseidon.circom";

// Poseidon(3) exposed as an output — used by the test harness to compute the
// expected output commitments the joinsplit will constrain against.
template Pos3() {
    signal input a;
    signal input b;
    signal input c;
    signal output out;
    component h = Poseidon(3);
    h.inputs[0] <== a;
    h.inputs[1] <== b;
    h.inputs[2] <== c;
    out <== h.out;
}

component main = Pos3();
