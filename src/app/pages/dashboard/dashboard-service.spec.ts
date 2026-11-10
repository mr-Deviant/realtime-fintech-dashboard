import { TestBed } from '@angular/core/testing';
import { batch, FakeWorker } from '../../testing/fake-worker';
import { DashboardService } from './dashboard-service';

describe('DashboardService', () => {
  let worker: FakeWorker;
  let service: DashboardService;

  const row = (index: number) => service.metrics()[index];

  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker);
    service = TestBed.inject(DashboardService);
    worker = FakeWorker.instance;
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('metrics', () => {
    beforeEach(() => worker.emit({ type: 'ready' }));

    it('shows one row per instrument with unavailable values and zero volume before data arrives', () => {
      expect(service.metrics()).toHaveLength(5);
      expect(row(0)).toEqual({
        symbol: 'ALFA',
        lastPriceCents: null,
        spreadCents: null,
        volume: 0,
        vwapCents: null,
        imbalance: null,
      });
    });

    it('calculates the worked example from the task', () => {
      worker.emit(
        batch(
          1,
          [0, 10000, 10, 10000, 10004, 500, 500], // 10 units at $100
          [0, 10200, 30, 10196, 10200, 600, 400], // 30 units at $102
        ),
      );

      expect(row(0).lastPriceCents).toBe(10200);
      expect(row(0).volume).toBe(40);
      expect(row(0).vwapCents).toBe(10150); // $101.50
      expect(row(0).spreadCents).toBe(4); // $0.04
      expect(row(0).imbalance).toBeCloseTo(0.2);
    });

    it('counts trades from every batch', () => {
      worker.emit(batch(1, [0, 10000, 10, 9999, 10001, 1, 1]));
      worker.emit(batch(1, [0, 10200, 30, 10199, 10201, 1, 1]));

      expect(row(0).volume).toBe(40);
      expect(row(0).vwapCents).toBe(10150);
    });

    it('shows imbalance as unavailable when both book quantities are zero', () => {
      worker.emit(batch(1, [0, 10000, 10, 9999, 10001, 0, 0]));

      expect(row(0).imbalance).toBeNull();
      expect(row(0).vwapCents).toBe(10000);
    });

    it('reaches the imbalance limits of -1 and +1', () => {
      worker.emit(batch(1, [0, 10000, 1, 9999, 10001, 100, 0], [1, 10000, 1, 9999, 10001, 0, 100]));

      expect(row(0).imbalance).toBe(1);
      expect(row(1).imbalance).toBe(-1);
    });

    it('keeps instruments isolated from each other', () => {
      worker.emit(batch(1, [0, 10000, 10, 9999, 10001, 100, 300]));

      expect(row(0).volume).toBe(10);
      expect(row(1)).toEqual({
        symbol: 'BETA',
        lastPriceCents: null,
        spreadCents: null,
        volume: 0,
        vwapCents: null,
        imbalance: null,
      });
    });

    it('ignores an instrument index outside the run', () => {
      worker.emit(batch(1, [99, 10000, 10, 9999, 10001, 100, 300]));

      expect(service.metrics().every((metrics) => metrics.volume === 0)).toBe(true);
    });
  });

  describe('run lifecycle', () => {
    it('is initializing until the worker is ready, and ignores the toggle', () => {
      expect(service.status()).toBe('initializing');

      service.toggle();

      expect(worker.commands).toEqual([]);
    });

    it('starts a run with the default settings when the worker is ready', () => {
      worker.emit({ type: 'ready' });

      expect(service.status()).toBe('running');
      expect(worker.commands).toEqual([
        { type: 'start', settings: { runId: 1, instrumentCount: 5, updatesPerBatch: 100, batchIntervalMs: 500 } },
      ]);
    });

    it('pauses and resumes, keeping the current values', () => {
      worker.emit({ type: 'ready' });
      worker.emit(batch(1, [0, 10000, 10, 9999, 10001, 100, 300]));

      service.toggle();
      expect(service.status()).toBe('paused');
      expect(worker.commands.at(-1)).toEqual({ type: 'pause' });

      service.toggle();
      expect(service.status()).toBe('running');
      expect(worker.commands.at(-1)).toEqual({ type: 'resume' });
      expect(row(0).volume).toBe(10);
    });

    it('applying settings clears the previous run and starts a new one', () => {
      worker.emit({ type: 'ready' });
      worker.emit(batch(1, [0, 10000, 10, 9999, 10001, 100, 300]));

      service.applySettings({ instrumentCount: 2, updatesPerBatch: 10, batchIntervalMs: 50 });

      expect(service.metrics().map((metrics) => metrics.symbol)).toEqual(['ALFA', 'BETA']);
      expect(row(0).volume).toBe(0);
      expect(row(0).lastPriceCents).toBeNull();
      expect(worker.commands.at(-1)).toEqual({
        type: 'start',
        settings: { runId: 2, instrumentCount: 2, updatesPerBatch: 10, batchIntervalMs: 50 },
      });
    });

    it('applying settings starts generation again after a pause', () => {
      worker.emit({ type: 'ready' });
      service.toggle();
      expect(service.status()).toBe('paused');

      service.applySettings({ instrumentCount: 5, updatesPerBatch: 100, batchIntervalMs: 500 });

      expect(service.status()).toBe('running');
      expect(worker.commands.at(-1)).toMatchObject({ type: 'start' });
    });

    it('rejects a batch from a previous run', () => {
      worker.emit({ type: 'ready' }); // run 1
      service.applySettings({ instrumentCount: 5, updatesPerBatch: 100, batchIntervalMs: 500 }); // run 2

      worker.emit(batch(1, [0, 10000, 10, 9999, 10001, 100, 300]));
      expect(row(0).volume).toBe(0);

      worker.emit(batch(2, [0, 10000, 10, 9999, 10001, 100, 300]));
      expect(row(0).volume).toBe(10);
    });
  });

  describe('errors and cleanup', () => {
    it('shows the error reported by the worker', () => {
      worker.emit({ type: 'error', message: 'Failed to load Wasm: nope' });

      expect(service.status()).toBe('error');
      expect(service.error()).toBe('Failed to load Wasm: nope');
    });

    it('shows an error when the worker crashes', () => {
      worker.onerror?.();

      expect(service.status()).toBe('error');
      expect(service.error()).not.toBe('');
    });

    it('clears the error when a new run is applied', () => {
      worker.emit({ type: 'error', message: 'Wasm init rejected the instrument count' });

      service.applySettings({ instrumentCount: 5, updatesPerBatch: 100, batchIntervalMs: 500 });

      expect(service.status()).toBe('running');
      expect(service.error()).toBe('');
    });

    it('terminates the worker when the service is destroyed', () => {
      TestBed.resetTestingModule();

      expect(worker.terminated).toBe(true);
    });
  });

  it('shows an error when Web Workers are not supported', () => {
    TestBed.resetTestingModule();
    vi.stubGlobal('Worker', undefined);

    const withoutWorkers = TestBed.inject(DashboardService);

    expect(withoutWorkers.status()).toBe('error');
    expect(withoutWorkers.error()).toContain('Web Workers');
  });
});
