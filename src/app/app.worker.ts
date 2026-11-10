/// <reference lib="webworker" />

// What the compiled module exports (see wasm/assembly/index.ts)
interface Wasm {
  memory: WebAssembly.Memory;
  init(seed: number, count: number): number; // 1 = ok, 0 = count out of range
  generate(count: number): number; // number of updates written, 0 = rejected
  outputPtr(): number; // byte offset of the results in memory
}

type Settings = { seed: number; instrumentCount: number; updatesPerBatch: number; batchIntervalMs: number };
type Command =
  | { type: 'start'; settings: Settings }
  | { type: 'pause' }
  | { type: 'resume' };

export class Producer {
  private readonly FIELDS_PER_UPDATE = 7; // instrument, price, tradeQty, bid, ask, bidQty, askQty
  private wasm!: Wasm;
  private settings!: Settings;
  private timer?: number;
  private isPaused = false;

  public async init(): Promise<void> {
    try {
      // Fetch the .wasm file and instantiate it once, when the worker starts
      this.wasm = await fetch(new URL("wasm/producer.wasm", self.location.href))
        .then((response) => response.arrayBuffer())
        .then((bytes) =>
          // The module imports env.abort, which AssemblyScript calls on a fatal error
          WebAssembly.instantiate(bytes, {
            env: { abort: () => { throw new Error("Wasm aborted"); } },
          }),
        )
        .then(({ instance }) => instance.exports as unknown as Wasm);
    } catch (error) {
      postMessage({ type: 'error', message: `Failed to load Wasm: ${error}` });
      return;
    }

    addEventListener('message', ({ data }: MessageEvent<Command>) => this.handle(data));
    postMessage({ type: 'ready' });
  }

  public start(settings: Settings): void {
    this.settings = settings;

    this.stopTimer();

    if (!this.wasm?.init(this.settings.seed, this.settings.instrumentCount)) {
      postMessage({ type: 'error', message: 'Wasm init rejected the instrument count' });
      return;
    }

    if (this.timer !== undefined) return;

    this.timer = setInterval(() => this.tick(), this.settings.batchIntervalMs);
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    this.isPaused = false;
  }

  private handle(command: Command): void {
    switch (command.type) {
      case 'start':
        this.start(command.settings);
        break;
      case 'pause':
        this.pause();
        break;
      case 'resume':
        if (this.settings) {
          this.resume();
        }
        break;
    }
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private tick(): void {
    if (this.isPaused) return;

    const written = this.wasm?.generate(this.settings.updatesPerBatch);
    if (!written) {
      this.stopTimer();
      postMessage({ type: 'error', message: 'Wasm generate rejected the batch size' });
      return;
    }

    // Read the results straight from Wasm memory. slice() copies just these numbers,
    // otherwise posting the view would copy the whole memory.
    const records = new Int32Array(
      this.wasm.memory.buffer,
      this.wasm.outputPtr(),
      written * this.FIELDS_PER_UPDATE,
    ).slice();
    postMessage({ type: 'batch', records }, [records.buffer]);
  }
}

new Producer().init();
