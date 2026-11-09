import { SettingsModel } from '../pages/settings/settings-model';
import { ProducerEngine, Scheduler } from './producer-engine';
import { ProducerEvent } from './producer-protocol';
import { MarketDataGenerator, RECORD_FIELDS } from './wasm-producer';

class FakeScheduler implements Scheduler {
  private nextHandle = 1;
  readonly timers = new Map<number, { callback: () => void; ms: number }>();

  setTimeout(callback: () => void, ms: number): unknown {
    const handle = this.nextHandle++;
    this.timers.set(handle, { callback, ms });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Fires every pending timer once. */
  fire(): void {
    const due = [...this.timers.entries()];
    this.timers.clear();
    due.forEach(([, timer]) => timer.callback());
  }
}

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
  let scheduler: FakeScheduler;
  let generator: FakeGenerator;
  let events: ProducerEvent[];
  let engine: ProducerEngine;

  beforeEach(() => {
    scheduler = new FakeScheduler();
    generator = new FakeGenerator();
    events = [];
    engine = new ProducerEngine(generator, (event) => events.push(event), scheduler, () => 99);
  });

  const batches = () => events.filter((e) => e.type === 'batch');

  it('initialises the generator and emits batches on the requested interval', () => {
    engine.handle({ type: 'start', runId: 1, settings });

    expect(generator.initCalls).toEqual([{ seed: 99, instrumentCount: 3 }]);
    expect(events).toEqual([{ type: 'status', runId: 1, status: 'running' }]);
    expect([...scheduler.timers.values()][0].ms).toBe(500);

    scheduler.fire();
    scheduler.fire();

    expect(generator.generateCalls).toEqual([10, 10]);
    expect(batches()).toHaveLength(2);
    expect(batches().every((e) => e.type === 'batch' && e.runId === 1)).toBe(true);
  });

  it('stops generating while paused and resumes without catching up', () => {
    engine.handle({ type: 'start', runId: 1, settings });
    scheduler.fire();
    engine.handle({ type: 'pause', runId: 1 });

    expect(scheduler.timers.size).toBe(0);
    expect(events.at(-1)).toEqual({ type: 'status', runId: 1, status: 'paused' });

    engine.handle({ type: 'resume', runId: 1 });
    expect(events.at(-1)).toEqual({ type: 'status', runId: 1, status: 'running' });
    expect(scheduler.timers.size).toBe(1);

    scheduler.fire();
    expect(generator.generateCalls).toEqual([10, 10]);
    // Init was not repeated, so generator state is preserved across the pause.
    expect(generator.initCalls).toHaveLength(1);
  });

  it('ignores pause and resume for a previous run', () => {
    engine.handle({ type: 'start', runId: 1, settings });
    engine.handle({ type: 'start', runId: 2, settings });
    events.length = 0;

    engine.handle({ type: 'pause', runId: 1 });
    expect(events).toEqual([]);
    expect(scheduler.timers.size).toBe(1);
  });

  it('cancels the previous run timer when a new run starts', () => {
    engine.handle({ type: 'start', runId: 1, settings });
    engine.handle({ type: 'start', runId: 2, settings: { ...settings, updatesPerBatch: 25 } });

    expect(scheduler.timers.size).toBe(1);
    scheduler.fire();

    expect(generator.generateCalls).toEqual([25]);
    expect(batches().map((e) => e.type === 'batch' && e.runId)).toEqual([2]);
  });

  it('starting a new run from paused begins generating again', () => {
    engine.handle({ type: 'start', runId: 1, settings });
    engine.handle({ type: 'pause', runId: 1 });
    engine.handle({ type: 'start', runId: 2, settings });

    expect(events.at(-1)).toEqual({ type: 'status', runId: 2, status: 'running' });
    expect(scheduler.timers.size).toBe(1);
  });

  it('stop clears the timer and later commands for the old run are ignored', () => {
    engine.handle({ type: 'start', runId: 1, settings });
    engine.handle({ type: 'stop' });
    expect(scheduler.timers.size).toBe(0);

    engine.handle({ type: 'resume', runId: 1 });
    expect(scheduler.timers.size).toBe(0);
  });

  it('reports generator errors instead of throwing', () => {
    generator.init = () => {
      throw new RangeError('bad count');
    };
    engine.handle({ type: 'start', runId: 1, settings });

    expect(events).toEqual([{ type: 'error', message: 'bad count' }]);
    expect(scheduler.timers.size).toBe(0);
  });
});
