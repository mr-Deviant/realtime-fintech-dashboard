import { SettingsModel } from '../pages/settings/settings-model';
import { ProducerEngine } from './producer-engine';
import { ProducerEvent } from './producer-protocol';
import { MarketDataGenerator, RECORD_FIELDS } from './wasm-producer';

class FakeGenerator implements MarketDataGenerator {
  readonly initCalls: Array<{ seed: number; instrumentCount: number }> = [];
  readonly generateCalls: number[] = [];

  init(seed: number, instrumentCount: number): void {
    this.initCalls.push({ seed, instrumentCount });
  }

  generate(count: number): Int32Array {
    this.generateCalls.push(count);
    return new Int32Array(count * RECORD_FIELDS);
  }
}

const settings: SettingsModel = { instrumentCount: 3, updatesPerBatch: 10, batchIntervalMs: 500 };

describe('ProducerEngine', () => {
  let generator: FakeGenerator;
  let events: ProducerEvent[];
  let engine: ProducerEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    generator = new FakeGenerator();
    events = [];
    engine = new ProducerEngine(generator, (event) => events.push(event));
  });

  afterEach(() => vi.useRealTimers());

  const batches = () => events.filter((e) => e.type === 'batch');

  it('initialises the generator and emits batches on the requested interval', () => {
    engine.handle({ type: 'start', runId: 1, settings });

    expect(generator.initCalls).toHaveLength(1);
    expect(generator.initCalls[0].instrumentCount).toBe(3);
    expect(events).toEqual([{ type: 'status', runId: 1, status: 'running' }]);

    vi.advanceTimersByTime(499);
    expect(batches()).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(batches()).toHaveLength(1);

    vi.advanceTimersByTime(500);
    expect(generator.generateCalls).toEqual([10, 10]);
    expect(batches().every((e) => e.type === 'batch' && e.runId === 1)).toBe(true);
  });

  it('uses a different seed for each run', () => {
    engine.handle({ type: 'start', runId: 1, settings });
    engine.handle({ type: 'start', runId: 2, settings });

    expect(generator.initCalls[0].seed).not.toBe(generator.initCalls[1].seed);
  });

  it('stops generating while paused and resumes without catching up', () => {
    engine.handle({ type: 'start', runId: 1, settings });
    vi.advanceTimersByTime(500);
    engine.handle({ type: 'pause' });

    expect(vi.getTimerCount()).toBe(0);
    expect(events.at(-1)).toEqual({ type: 'status', runId: 1, status: 'paused' });

    // A long pause produces nothing.
    vi.advanceTimersByTime(60_000);
    expect(generator.generateCalls).toEqual([10]);

    engine.handle({ type: 'resume' });
    expect(events.at(-1)).toEqual({ type: 'status', runId: 1, status: 'running' });
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(500);
    // One batch after resuming, not one per missed interval.
    expect(generator.generateCalls).toEqual([10, 10]);
    // Init was not repeated, so generator state is preserved across the pause.
    expect(generator.initCalls).toHaveLength(1);
  });

  it('ignores pause and resume before any run has started', () => {
    engine.handle({ type: 'pause' });
    engine.handle({ type: 'resume' });

    expect(events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores resume while running and pause while paused', () => {
    engine.handle({ type: 'start', runId: 1, settings });
    events.length = 0;

    engine.handle({ type: 'resume' });
    expect(events).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);

    engine.handle({ type: 'pause' });
    events.length = 0;
    engine.handle({ type: 'pause' });
    expect(events).toEqual([]);
  });

  it('reports status for the latest run after a restart', () => {
    engine.handle({ type: 'start', runId: 1, settings });
    engine.handle({ type: 'start', runId: 2, settings });

    engine.handle({ type: 'pause' });
    expect(events.at(-1)).toEqual({ type: 'status', runId: 2, status: 'paused' });
  });

  it('cancels the previous run timer when a new run starts', () => {
    engine.handle({ type: 'start', runId: 1, settings });
    engine.handle({ type: 'start', runId: 2, settings: { ...settings, updatesPerBatch: 25 } });

    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(500);

    expect(generator.generateCalls).toEqual([25]);
    expect(batches().map((e) => e.type === 'batch' && e.runId)).toEqual([2]);
  });

  it('starting a new run from paused begins generating again', () => {
    engine.handle({ type: 'start', runId: 1, settings });
    engine.handle({ type: 'pause' });
    engine.handle({ type: 'start', runId: 2, settings });

    expect(events.at(-1)).toEqual({ type: 'status', runId: 2, status: 'running' });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('reports generator errors instead of throwing', () => {
    generator.init = () => {
      throw new RangeError('bad count');
    };
    engine.handle({ type: 'start', runId: 1, settings });

    expect(events).toEqual([{ type: 'error', message: 'bad count' }]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
