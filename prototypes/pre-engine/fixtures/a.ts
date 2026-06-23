import { extFn } from './ext';

function knownFn(x: number, y: number) {
  return x + y;
}

function target() {
  knownFn(1, 2, 3);  // argument_count_mismatch: actual=3 > expected=2
  unknownFn(1);       // unresolved_call
}
