const FIELDS_PER_UPDATE = 7;
const settings = { runId: 1, instrumentCount: 5, updatesPerBatch: 100, batchIntervalMs: 500 };

// Stands in for the compiled Wasm module: same exports, but with simple predictable behaviour
function fakeWasm() {
  const memory = new WebAssembly.Memory({ initial: 1 });
  return {
    memory,
    init: vi.fn((_seed: number, count: number) => (count >= 1 && count <= 50 ? 1 : 0)),
    generate: vi.fn((count: number) => {
      if (count < 1 || count > 1000) return 0;
      // Numbers 1, 2, 3... so a test can check that the batch really comes from Wasm memory
      new Int32Array(memory.buffer, 0, count * FIELDS_PER_UPDATE).forEach((_, i, view) => (view[i] = i + 1));
      return count;
    }),
    outputPtr: () => 0,
  };
}

describe('app.worker', () => {
  let wasm: ReturnType<typeof fakeWasm>;
  let postMessage: ReturnType<typeof vi.fn>;
  let onMessage: (event: { data: unknown }) => void;

  // The worker file starts itself when imported, so each test imports a fresh copy
  async function startWorker(options: { loadFails?: boolean } = {}): Promise<void> {
    vi.resetModules();
    wasm = fakeWasm();
    postMessage = vi.fn();
    vi.stubGlobal('postMessage', postMessage);
    vi.stubGlobal('addEventListener', (_type: string, listener: typeof onMessage) => (onMessage = listener));
    vi.stubGlobal(
      'fetch',
      options.loadFails
        ? vi.fn().mockRejectedValue(new Error('404'))
        : vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
    );
    vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({ instance: { exports: wasm } } as never);

    await import('./app.worker');
    await vi.advanceTimersByTimeAsync(0); // Let the loading promises finish
  }

  const send = (data: unknown) => onMessage({ data });
  const batches = () => postMessage.mock.calls.map(([message]) => message).filter((m) => m.type === 'batch');

  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('loading', () => {
    it('says ready once Wasm is loaded', async () => {
      await startWorker();

      expect(postMessage).toHaveBeenCalledWith({ type: 'ready' });
    });

    it('reports an error when Wasm fails to load', async () => {
      await startWorker({ loadFails: true });

      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage.mock.calls[0][0]).toMatchObject({ type: 'error' });
      expect(postMessage.mock.calls[0][0].message).toContain('Failed to load Wasm');
    });
  });

  describe('generating batches', () => {
    beforeEach(startWorker);

    it('initializes Wasm with the instrument count and a seed', () => {
      send({ type: 'start', settings: { ...settings, instrumentCount: 7 } });

      expect(wasm.init).toHaveBeenCalledTimes(1);
      expect(wasm.init.mock.calls[0][1]).toBe(7);
      expect(typeof wasm.init.mock.calls[0][0]).toBe('number');
    });

    it('sends a batch of the requested size every interval, tagged with the run id', () => {
      send({ type: 'start', settings: { ...settings, runId: 3, updatesPerBatch: 4, batchIntervalMs: 100 } });
      expect(batches()).toHaveLength(0);

      vi.advanceTimersByTime(300);

      expect(batches()).toHaveLength(3);
      expect(wasm.generate).toHaveBeenCalledWith(4);
      expect(batches()[0].runId).toBe(3);
      expect(batches()[0].records).toHaveLength(4 * FIELDS_PER_UPDATE);
    });

    it('sends the numbers that Wasm wrote to its memory', () => {
      send({ type: 'start', settings: { ...settings, updatesPerBatch: 2 } });

      vi.advanceTimersByTime(500);

      expect(Array.from(batches()[0].records)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    });

    it('transfers the batch buffer instead of copying it', () => {
      send({ type: 'start', settings });

      vi.advanceTimersByTime(500);

      const [message, transfer] = postMessage.mock.calls.find(([m]) => m.type === 'batch')!;
      expect(transfer).toEqual([message.records.buffer]);
    });

    it('does not send the whole Wasm memory', () => {
      send({ type: 'start', settings: { ...settings, updatesPerBatch: 1 } });

      vi.advanceTimersByTime(500);

      expect(batches()[0].records.buffer.byteLength).toBe(FIELDS_PER_UPDATE * 4);
    });
  });

  describe('pause and resume', () => {
    beforeEach(async () => {
      await startWorker();
      send({ type: 'start', settings });
    });

    it('stops generating while paused', () => {
      vi.advanceTimersByTime(500);
      send({ type: 'pause' });

      vi.advanceTimersByTime(5000);

      expect(batches()).toHaveLength(1);
      expect(wasm.generate).toHaveBeenCalledTimes(1);
    });

    it('resumes without generating data for the paused time', () => {
      send({ type: 'pause' });
      vi.advanceTimersByTime(5000);

      send({ type: 'resume' });
      expect(batches()).toHaveLength(0);

      vi.advanceTimersByTime(500);
      expect(batches()).toHaveLength(1);
    });

    it('starts generating again when a new run is started while paused', () => {
      send({ type: 'pause' });

      send({ type: 'start', settings: { ...settings, runId: 2 } });
      vi.advanceTimersByTime(500);

      expect(batches().map((batch) => batch.runId)).toEqual([2]);
    });
  });

  it('ignores resume before any run has started', async () => {
    await startWorker();

    send({ type: 'resume' });
    vi.advanceTimersByTime(5000);

    expect(batches()).toHaveLength(0);
  });

  describe('starting a new run', () => {
    beforeEach(startWorker);

    it('stops the previous run timer', () => {
      send({ type: 'start', settings: { ...settings, runId: 1, batchIntervalMs: 100 } });
      send({ type: 'start', settings: { ...settings, runId: 2, batchIntervalMs: 500 } });

      vi.advanceTimersByTime(500);

      // A leftover 100 ms timer would add four more batches for run 1
      expect(batches().map((batch) => batch.runId)).toEqual([2]);
    });

    it('re-initializes Wasm for every run', () => {
      send({ type: 'start', settings });
      send({ type: 'start', settings: { ...settings, runId: 2 } });

      expect(wasm.init).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalid settings', () => {
    beforeEach(startWorker);

    it('reports an error and generates nothing when Wasm rejects the instrument count', () => {
      send({ type: 'start', settings: { ...settings, instrumentCount: 99 } });
      vi.advanceTimersByTime(5000);

      expect(postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Wasm init rejected the instrument count' });
      expect(batches()).toHaveLength(0);
    });

    it('reports an error and stops when Wasm rejects the batch size', () => {
      send({ type: 'start', settings: { ...settings, updatesPerBatch: 5000 } });

      vi.advanceTimersByTime(5000);

      const errors = postMessage.mock.calls.filter(([m]) => m.type === 'error');
      expect(errors).toHaveLength(1); // The timer stopped after the first failure
      expect(errors[0][0].message).toContain('batch size');
      expect(batches()).toHaveLength(0);
    });
  });
});
