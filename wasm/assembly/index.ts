const RECORD_FIELDS: i32 = 7; // Number of returned columns
const MIN_INSTRUMENTS: i32 = 1; // Min instrument count
const MAX_INSTRUMENTS: i32 = 50; // Max instrument count
const MIN_BATCH: i32 = 1; // Min updates per batch
const MAX_BATCH: i32 = 1000; // Max updates per batch

const MIN_MID_CENTS: i32 = 100; // Never let the mid price fall below $1.00
const MIN_BOOK_QUANTITY: i32 = 0; // Book quantities are nonnegative
const MAX_BOOK_QUANTITY: i32 = 5000;
const MIN_TRADE_QUANTITY: i32 = 1; // Trade quantities are positive
const MAX_TRADE_QUANTITY: i32 = 100;

// State kept between calls, prices evolve from the previous value rather than being fully random each time
const midCents = new StaticArray<i32>(MAX_INSTRUMENTS); // Since we know max size of array use StaticArray since it's faster, and easy to get data
const bidQuantity = new StaticArray<i32>(MAX_INSTRUMENTS);
const askQuantity = new StaticArray<i32>(MAX_INSTRUMENTS);

const output = new StaticArray<i32>(MAX_BATCH * RECORD_FIELDS);

let rngState: u32 = 0x9e3779b9; // Any positive random number, except 0, here used Fibonacci hashing constant
let instrumentCount: i32 = 0;

// Xorshift32 random pseudo number generator
function nextU32(): u32 {
  let x = rngState;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  rngState = x;
  return x;
}

// Wasm doesn't have Math.random
function randomInt(min: i32, max: i32): i32 {
  const range = <u32>(max - min + 1);
  return min + <i32>(nextU32() % range);
}

// Force value into the min, max interval
function clamp(value: i32, min: i32, max: i32): i32 {
  return value < min ? min : value > max ? max : value;
}

// Export constants instead of duplication them in service
// TODO: delete
export function recordFields(): i32 {
  return RECORD_FIELDS;
}

export function maxInstruments(): i32 {
  return MAX_INSTRUMENTS;
}

export function maxBatch(): i32 {
  return MAX_BATCH;
}

// Byte offset of the output buffer in Wasm linear memory
// JavaScript creates new Int32Array(memory.buffer, ptr, ...) at that address and reads results without copying
// Changetype reinterprets the array reference as a raw pointer-sized integer (usize)
export function outputPtr(): usize {
  // changetype reinterprets a value as a different type without converting or changing it,
  // usize a plain pointer-sized integer
  return changetype<usize>(output);
}

// Starts a new run: seeds the RNG and resets every instrument's state
// Returns false (and changes nothing) when `count` is out of range
export function init(seed: u32, count: i32): bool {
  if (count < MIN_INSTRUMENTS || count > MAX_INSTRUMENTS) return false;

  // Xorshift gets stuck at 0 forever (0 stays 0), so a zero seed is replaced with a default
  rngState = seed != 0 ? seed : 0x9e3779b9;
  instrumentCount = count;

  for (let i = 0; i < count; i++) {
    unchecked((midCents[i] = randomInt(2_000, 50_000))); // $20 – $500, unchecked - skips safety checks
    unchecked((bidQuantity[i] = randomInt(100, 1_000)));
    unchecked((askQuantity[i] = randomInt(100, 1_000)));
  }

  return true;
}

// Produces one batch: generates `count` market updates into the output buffer and returns the number written,
// or 0 when the generator is not initialised or `count` is out of range
export function generate(count: i32): i32 {
  // If init hasn’t run or the batch size is invalid
  if (instrumentCount == 0 || count < MIN_BATCH || count > MAX_BATCH) return 0;

  for (let n = 0; n < count; n++) {
    // Pick a random instrument, one instrument might be selected several times
    const i = randomInt(0, instrumentCount - 1);

    // Random walk of the mid price: step of up to ±0.2% (at least 1 cent)
    let mid = unchecked(midCents[i]); // Previous mid price
    const maxStep = max(1, mid / 500); // Maximum step is mid / 500 = 0.2% of the price, but at least 1 cent
    mid = max(MIN_MID_CENTS, mid + randomInt(-maxStep, maxStep)); // Get random price
    unchecked((midCents[i] = mid)); // Store new value

    // Symmetric spread around the mid: half-spread of 1 cent up to ~0.05%
    // mid >= 100 and half <= max(1, mid / 2000), so bid >= 99 > 0 and bid < ask.
    const half = randomInt(1, max(1, mid / 2000)); // Up to mid / 2000 = 0.05% of the price, but at least 1 cent
    const bid = mid - half;
    const ask = mid + half;

    // Each quantity drifts by −50 to +50 from its previous value, clamped to MIN_BOOK_QUANTITY to MAX_BOOK_QUANTITY, so it never goes negative
    const bidQty = clamp(unchecked(bidQuantity[i]) + randomInt(-50, 50), MIN_BOOK_QUANTITY, MAX_BOOK_QUANTITY);
    const askQty = clamp(unchecked(askQuantity[i]) + randomInt(-50, 50), MIN_BOOK_QUANTITY, MAX_BOOK_QUANTITY);
    unchecked((bidQuantity[i] = bidQty));
    unchecked((askQuantity[i] = askQty));

    // The trade executes at either the bid or the ask,
    // & 1 takes the lowest bit of a random number, which acts like a coin flip
    const price = (nextU32() & 1) != 0 ? ask : bid;
    const tradeQty = randomInt(MIN_TRADE_QUANTITY, MAX_TRADE_QUANTITY);

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
