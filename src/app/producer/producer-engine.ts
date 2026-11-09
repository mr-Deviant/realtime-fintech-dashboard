import { SettingsModel } from '../pages/settings/settings-model';
import { ProducerCommand, ProducerEvent } from './producer-protocol';
import { MarketDataGenerator } from './wasm-producer';

export interface Scheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type PostEvent = (event: ProducerEvent, transfer?: Transferable[]) => void;

interface Run {
  readonly runId: number;
  readonly updatesPerBatch: number;
  readonly batchIntervalMs: number;
  timer: unknown;
}

/**
 * Drives a generator on a timer and reports batches tagged with their run id.
 * Lives in the worker but has no worker dependencies, so it can be unit tested
 * with a fake generator and scheduler.
 */
export class ProducerEngine {
  private run: Run | undefined;

  constructor(
    private readonly generator: MarketDataGenerator,
    private readonly post: PostEvent,
    private readonly scheduler: Scheduler,
    private readonly nextSeed: () => number,
  ) {}

  handle(command: ProducerCommand): void {
    switch (command.type) {
      case 'start':
        this.start(command.runId, command.settings);
        break;
      case 'pause':
        if (this.isCurrent(command.runId) && this.run?.timer !== undefined) {
          this.cancelTimer();
          this.post({ type: 'status', runId: command.runId, status: 'paused' });
        }
        break;
      case 'resume':
        if (this.isCurrent(command.runId) && this.run?.timer === undefined) {
          this.schedule();
          this.post({ type: 'status', runId: command.runId, status: 'running' });
        }
        break;
      case 'stop':
        this.cancelTimer();
        this.run = undefined;
        break;
    }
  }

  private start(runId: number, settings: SettingsModel): void {
    this.cancelTimer();
    this.run = undefined;
    try {
      this.generator.init(this.nextSeed(), settings.instrumentCount);
    } catch (error) {
      this.post({ type: 'error', message: errorMessage(error) });
      return;
    }
    this.run = {
      runId,
      updatesPerBatch: settings.updatesPerBatch,
      batchIntervalMs: settings.batchIntervalMs,
      timer: undefined,
    };
    this.schedule();
    this.post({ type: 'status', runId, status: 'running' });
  }

  private tick(): void {
    const run = this.run;
    if (!run) return;
    run.timer = undefined;
    let records: Int32Array;
    try {
      records = this.generator.generate(run.updatesPerBatch);
    } catch (error) {
      this.run = undefined;
      this.post({ type: 'error', message: errorMessage(error) });
      return;
    }
    this.post({ type: 'batch', runId: run.runId, records }, [records.buffer]);
    this.schedule();
  }

  private schedule(): void {
    const run = this.run;
    if (run) {
      run.timer = this.scheduler.setTimeout(() => this.tick(), run.batchIntervalMs);
    }
  }

  private cancelTimer(): void {
    if (this.run?.timer !== undefined) {
      this.scheduler.clearTimeout(this.run.timer);
      this.run.timer = undefined;
    }
  }

  private isCurrent(runId: number): boolean {
    return this.run?.runId === runId;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
