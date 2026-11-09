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
  timer: unknown; // Pending timer handle, or undefined when no batch is scheduled
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
        // Only if the command’s runId matches the current run and a timer is pending
        if (this.isCurrent(command.runId) && this.run?.timer !== undefined) {
          this.cancelTimer();
          this.post({ type: 'status', runId: command.runId, status: 'paused' });
        }
        break;
      case 'resume':
        // Only if the run id matches and no timer is pending (it's paused)
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
    this.cancelTimer(); // Tear down any previous run
    this.run = undefined;
    try {
      // Re-initialize the Wasm generator with a fresh seed and the new instrument count
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
    if (!run) return; // Do nothing if it was stopped
    run.timer = undefined; // Mark timer as fired
    let records: Int32Array;
    try {
      // Call Wasm to produce the batch as an Int32Array (7 integers per update)
      records = this.generator.generate(run.updatesPerBatch);
    } catch (error) {
      this.run = undefined;
      this.post({ type: 'error', message: errorMessage(error) });
      return;
    }
    // Send the batch tagged with runId and pass records.buffer in the transfer list
    this.post({ type: 'batch', runId: run.runId, records }, [records.buffer]);
    this.schedule(); // Schedule next tick
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
