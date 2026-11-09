/** Number of i32 values per generated update in a batch buffer. */
export const RECORD_FIELDS = 7;

/** Offsets of each field inside one record of a batch buffer. */
export const Field = {
  Instrument: 0,
  PriceCents: 1,
  TradeQuantity: 2,
  BidCents: 3,
  AskCents: 4,
  BidQuantity: 5,
  AskQuantity: 6,
} as const;

/** Anything that can start a run and produce batches of market updates. */
export interface MarketDataGenerator {
  init(seed: number, instrumentCount: number): void;
  /** Returns `count` updates as a flat buffer of `count * RECORD_FIELDS` i32 values. */
  generate(count: number): Int32Array;
}

interface ProducerExports {
  readonly memory: WebAssembly.Memory;
  recordFields(): number;
  maxInstruments(): number;
  maxBatch(): number;
  outputPtr(): number;
  init(seed: number, count: number): number;
  generate(count: number): number;
}

/** Thin typed wrapper around the compiled AssemblyScript generator. */
export class WasmProducer implements MarketDataGenerator {
  private constructor(private readonly exports: ProducerExports) {
    if (exports.recordFields() !== RECORD_FIELDS) {
      throw new Error(
        `Wasm producer record layout mismatch: expected ${RECORD_FIELDS} fields, got ${exports.recordFields()}`,
      );
    }
  }

  static async instantiate(bytes: BufferSource): Promise<WasmProducer> {
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: {
        abort: (_message: number, _file: number, line: number, column: number) => {
          throw new Error(`Wasm producer aborted at ${line}:${column}`);
        },
      },
    });
    return new WasmProducer(instance.exports as unknown as ProducerExports);
  }

  get maxInstruments(): number {
    return this.exports.maxInstruments();
  }

  get maxBatch(): number {
    return this.exports.maxBatch();
  }

  init(seed: number, instrumentCount: number): void {
    if (!this.exports.init(seed >>> 0, instrumentCount)) {
      throw new RangeError(
        `Instrument count must be between 1 and ${this.maxInstruments}, got ${instrumentCount}`,
      );
    }
  }

  generate(count: number): Int32Array {
    const written = this.exports.generate(count);
    // The module returns 0 for any rejected request.
    if (written === 0 || written !== count) {
      throw new RangeError(
        `Batch size must be between 1 and ${this.maxBatch} after init, got ${count}`,
      );
    }
    // Copy out of linear memory so the result can be transferred to another thread
    // and is not overwritten by the next call.
    return new Int32Array(
      this.exports.memory.buffer,
      this.exports.outputPtr(),
      written * RECORD_FIELDS,
    ).slice();
  }
}
