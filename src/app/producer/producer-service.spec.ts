import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS, SettingsService } from '../pages/settings/settings-service';
import { PRODUCER_WORKER_FACTORY } from './create-producer-worker';
import { FakeProducerWorker, provideFakeProducerWorker } from './fake-producer-worker';
import { ProducerService } from './producer-service';
import { Field, RECORD_FIELDS } from './wasm-producer';

function batch(...trades: Array<{ instrument: number; price: number; qty: number }>): Int32Array {
  const records = new Int32Array(trades.length * RECORD_FIELDS);
  trades.forEach((t, i) => {
    records[i * RECORD_FIELDS + Field.Instrument] = t.instrument;
    records[i * RECORD_FIELDS + Field.PriceCents] = t.price;
    records[i * RECORD_FIELDS + Field.TradeQuantity] = t.qty;
    records[i * RECORD_FIELDS + Field.BidCents] = t.price - 2;
    records[i * RECORD_FIELDS + Field.AskCents] = t.price + 2;
    records[i * RECORD_FIELDS + Field.BidQuantity] = 100;
    records[i * RECORD_FIELDS + Field.AskQuantity] = 100;
  });
  return records;
}

describe('ProducerService', () => {
  let worker: FakeProducerWorker;
  let service: ProducerService;

  beforeEach(() => {
    worker = new FakeProducerWorker();
    TestBed.configureTestingModule({ providers: [provideFakeProducerWorker(worker)] });
    service = TestBed.inject(ProducerService);
  });

  it('starts the first run with the default settings and no data', () => {
    expect(worker.commands).toEqual([{ type: 'start', runId: 1, settings: DEFAULT_SETTINGS }]);
    expect(service.status()).toBe('initializing');
    expect(service.metrics()).toHaveLength(5);
    expect(service.metrics().every((m) => m.volume === 0 && m.lastPriceCents === null)).toBe(true);
  });

  it('shows the worker status once it reports it', () => {
    worker.emit({ type: 'status', runId: 1, status: 'running' });
    expect(service.status()).toBe('running');
  });

  it('folds batches into the metrics', () => {
    worker.emit({ type: 'batch', runId: 1, records: batch({ instrument: 0, price: 10000, qty: 10 }) });
    worker.emit({ type: 'batch', runId: 1, records: batch({ instrument: 0, price: 10200, qty: 30 }) });

    const [first, second] = service.metrics();
    expect(first.volume).toBe(40);
    expect(first.vwapCents).toBeCloseTo(10150);
    expect(second.volume).toBe(0);
  });

  describe('apply', () => {
    const next = { instrumentCount: 2, updatesPerBatch: 10, batchIntervalMs: 100 };

    it('stores the settings and starts a new run', () => {
      service.apply(next);

      expect(TestBed.inject(SettingsService).settings()).toEqual(next);
      expect(worker.lastCommand).toEqual({ type: 'start', runId: 2, settings: next });
      expect(worker.commands.filter((c) => c.type === 'start')).toHaveLength(2);
    });

    it('clears the previous run values and totals', () => {
      worker.emit({ type: 'batch', runId: 1, records: batch({ instrument: 0, price: 10000, qty: 10 }) });

      service.apply(next);

      expect(service.metrics()).toHaveLength(2);
      expect(service.metrics().every((m) => m.volume === 0 && m.vwapCents === null)).toBe(true);
    });

    it('rejects results from the previous run', () => {
      service.apply(next);

      worker.emit({ type: 'batch', runId: 1, records: batch({ instrument: 0, price: 10000, qty: 10 }) });
      worker.emit({ type: 'status', runId: 1, status: 'paused' });
      expect(service.metrics()[0].volume).toBe(0);
      expect(service.status()).toBe('initializing');

      worker.emit({ type: 'batch', runId: 2, records: batch({ instrument: 0, price: 10000, qty: 10 }) });
      expect(service.metrics()[0].volume).toBe(10);
    });

    it('starts generation again when the previous run was paused', () => {
      worker.emit({ type: 'status', runId: 1, status: 'running' });
      service.pause();
      worker.emit({ type: 'status', runId: 1, status: 'paused' });

      service.apply(next);
      worker.emit({ type: 'status', runId: 2, status: 'running' });

      expect(worker.lastCommand?.type).toBe('start');
      expect(service.status()).toBe('running');
    });
  });

  describe('pause and resume', () => {
    beforeEach(() => worker.emit({ type: 'status', runId: 1, status: 'running' }));

    it('sends pause and resume for the current run', () => {
      service.pause();
      expect(worker.lastCommand).toEqual({ type: 'pause', runId: 1 });
      service.resume();
      expect(worker.lastCommand).toEqual({ type: 'resume', runId: 1 });
    });

    it('toggles according to the current status', () => {
      service.toggle();
      expect(worker.lastCommand).toEqual({ type: 'pause', runId: 1 });

      worker.emit({ type: 'status', runId: 1, status: 'paused' });
      service.toggle();
      expect(worker.lastCommand).toEqual({ type: 'resume', runId: 1 });
    });

    it('keeps values and totals while paused and after resuming', () => {
      worker.emit({ type: 'batch', runId: 1, records: batch({ instrument: 0, price: 10000, qty: 10 }) });
      worker.emit({ type: 'status', runId: 1, status: 'paused' });
      worker.emit({ type: 'status', runId: 1, status: 'running' });
      worker.emit({ type: 'batch', runId: 1, records: batch({ instrument: 0, price: 10200, qty: 30 }) });

      expect(service.metrics()[0].volume).toBe(40);
    });

    it('does nothing when there is no running or paused run to toggle', () => {
      worker.fail('boom');
      const before = worker.commands.length;
      service.toggle();
      expect(worker.commands).toHaveLength(before);
    });
  });

  describe('errors', () => {
    it('reports errors from the worker', () => {
      worker.emit({ type: 'error', message: 'Failed to initialise the Wasm producer: nope' });
      expect(service.status()).toBe('error');
      expect(service.error()).toBe('Failed to initialise the Wasm producer: nope');
    });

    it('reports a worker that fails to load', () => {
      worker.fail('Script error');
      expect(service.status()).toBe('error');
      expect(service.error()).toBe('Script error');
    });

    it('clears the error once a run is running again', () => {
      worker.emit({ type: 'error', message: 'bad' });
      service.apply(DEFAULT_SETTINGS);
      worker.emit({ type: 'status', runId: 2, status: 'running' });

      expect(service.error()).toBeNull();
      expect(service.status()).toBe('running');
    });
  });

  it('reports a worker that cannot be created', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PRODUCER_WORKER_FACTORY,
          useValue: () => {
            throw new Error('Workers are not supported');
          },
        },
      ],
    });
    const failing = TestBed.inject(ProducerService);
    expect(failing.status()).toBe('error');
    expect(failing.error()).toContain('Workers are not supported');
  });

  it('stops and terminates the worker when destroyed', () => {
    TestBed.resetTestingModule();
    expect(worker.lastCommand).toEqual({ type: 'stop' });
    expect(worker.terminated).toBe(true);
  });
});
