// Market-update generator compiled to WebAssembly (AssemblyScript).
//
// All randomness and price evolution happen here. The host calls `init` once
// per run and then `generate` once per batch. Each generated update is written
// to a fixed output buffer as RECORD_FIELDS consecutive i32 values:
//
//   [instrument, priceCents, tradeQuantity, bidCents, askCents, bidQuantity, askQuantity]
//
// `instrument` is a zero-based index; the host maps it to a symbol.

const RECORD_FIELDS: i32 = 7;
const MAX_INSTRUMENTS: i32 = 50;
const MAX_BATCH: i32 = 1000;

const MIN_MID_CENTS: i32 = 100; // never let the mid price fall below $1.00
const MAX_BOOK_QUANTITY: i32 = 5000;
const MAX_TRADE_QUANTITY: i32 = 100;

// Per-instrument state retained between `generate` calls.
const midCents = new StaticArray<i32>(MAX_INSTRUMENTS);
const bidQuantity = new StaticArray<i32>(MAX_INSTRUMENTS);
const askQuantity = new StaticArray<i32>(MAX_INSTRUMENTS);

const output = new StaticArray<i32>(MAX_BATCH * RECORD_FIELDS);

let rngState: u32 = 0x9e3779b9;
let instrumentCount: i32 = 0;

// xorshift32: small, fast, deterministic for a given seed.
function nextU32(): u32 {
  let x = rngState;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  rngState = x;
  return x;
}

/** Uniform integer in [min, max] (inclusive). */
function randomInt(min: i32, max: i32): i32 {
  const range = <u32>(max - min + 1);
  return min + <i32>(nextU32() % range);
}

function clamp(value: i32, min: i32, max: i32): i32 {
  return value < min ? min : value > max ? max : value;
}

export function recordFields(): i32 {
  return RECORD_FIELDS;
}

export function maxInstruments(): i32 {
  return MAX_INSTRUMENTS;
}

export function maxBatch(): i32 {
  return MAX_BATCH;
}

/** Byte offset of the output buffer in linear memory. */
export function outputPtr(): usize {
  return changetype<usize>(output);
}

/**
 * Starts a new run: seeds the RNG and resets every instrument's state.
 * Returns false (and changes nothing) when `count` is out of range.
 */
export function init(seed: u32, count: i32): bool {
  if (count < 1 || count > MAX_INSTRUMENTS) return false;

  // xorshift has a fixed point at 0, so never seed with it.
  rngState = seed != 0 ? seed : 0x9e3779b9;
  instrumentCount = count;

  for (let i = 0; i < count; i++) {
    unchecked((midCents[i] = randomInt(2_000, 50_000))); // $20 – $500
    unchecked((bidQuantity[i] = randomInt(100, 1_000)));
    unchecked((askQuantity[i] = randomInt(100, 1_000)));
  }
  return true;
}

/**
 * Generates `count` market updates into the output buffer and returns the
 * number written, or 0 when the generator is not initialised or `count`
 * is out of range.
 */
export function generate(count: i32): i32 {
  if (instrumentCount == 0 || count < 1 || count > MAX_BATCH) return 0;

  for (let n = 0; n < count; n++) {
    const i = randomInt(0, instrumentCount - 1);

    // Random walk of the mid price: step of up to ±0.2% (at least 1 cent).
    let mid = unchecked(midCents[i]);
    const maxStep = max(1, mid / 500);
    mid = max(MIN_MID_CENTS, mid + randomInt(-maxStep, maxStep));
    unchecked((midCents[i] = mid));

    // Symmetric spread around the mid: half-spread of 1 cent up to ~0.05%.
    // mid >= 100 and half <= max(1, mid / 2000), so bid >= 99 > 0 and bid < ask.
    const half = randomInt(1, max(1, mid / 2000));
    const bid = mid - half;
    const ask = mid + half;

    // Book quantities drift and stay within [0, MAX_BOOK_QUANTITY].
    const bidQty = clamp(unchecked(bidQuantity[i]) + randomInt(-50, 50), 0, MAX_BOOK_QUANTITY);
    const askQty = clamp(unchecked(askQuantity[i]) + randomInt(-50, 50), 0, MAX_BOOK_QUANTITY);
    unchecked((bidQuantity[i] = bidQty));
    unchecked((askQuantity[i] = askQty));

    // The trade executes at either the bid or the ask.
    const price = (nextU32() & 1) != 0 ? ask : bid;
    const tradeQty = randomInt(1, MAX_TRADE_QUANTITY);

    const base = n * RECORD_FIELDS;
    unchecked((output[base] = i));
    unchecked((output[base + 1] = price));
    unchecked((output[base + 2] = tradeQty));
    unchecked((output[base + 3] = bid));
    unchecked((output[base + 4] = ask));
    unchecked((output[base + 5] = bidQty));
    unchecked((output[base + 6] = askQty));
  }
  return count;
}
