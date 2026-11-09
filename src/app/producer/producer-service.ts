import { DestroyRef, Service, inject, signal } from '@angular/core';
import { SettingsModel } from '../pages/settings/settings-model';
import { SettingsService } from '../pages/settings/settings-service';
import { InstrumentMetrics, MetricsAccumulator, symbolsFor } from './metrics';
import { ProducerCommand, ProducerEvent, ProducerStatus } from './producer-protocol';

export type ProducerState = 'initializing' | ProducerStatus | 'error';

/**
 * Owns the single producer worker for the whole app. It starts a run with the
 * current settings, folds each batch into per-instrument totals and exposes them
 * as signals. Results that belong to a previous run are dropped.
 */
@Service()
export class ProducerService {
  private readonly settingsService = inject(SettingsService);

  private worker: Worker | undefined;
  private runId = 0;
  private accumulator = new MetricsAccumulator([]);

  private readonly _metrics = signal<InstrumentMetrics[]>([]);
  private readonly _status = signal<ProducerState>('initializing');
  private readonly _error = signal<string | null>(null);

  readonly metrics = this._metrics.asReadonly();
  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();

  constructor() {
    try {
      // The Angular builder bundles the worker only when it sees this exact new Worker(new URL(...)) form
      const worker = new Worker(new URL('./producer.worker', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<ProducerEvent>) => this.onEvent(data);
      worker.onerror = (event) => this.fail(event.message || 'The producer worker failed to load');
      this.worker = worker;
    } catch (error) {
      this.fail(`Could not start the producer worker: ${errorMessage(error)}`);
    }

    inject(DestroyRef).onDestroy(() => {
      this.worker?.terminate(); // Stops the timer and frees the Wasm instance
      this.worker = undefined;
    });

    // The application starts with the current (default) settings.
    this.start(this.settingsService.settings());
  }

  /** Stores the settings and starts a new run, clearing the previous run's values. */
  apply(settings: SettingsModel): void {
    this.settingsService.apply(settings);
    this.start(settings);
  }

  pause(): void {
    this.send({ type: 'pause' });
  }

  resume(): void {
    this.send({ type: 'resume' });
  }

  toggle(): void {
    const status = this._status();
    if (status === 'running') {
      this.pause();
    } else if (status === 'paused') {
      this.resume();
    }
  }

  private start(settings: SettingsModel): void {
    this.runId++;
    this.accumulator = new MetricsAccumulator(symbolsFor(settings.instrumentCount));
    this._metrics.set(this.accumulator.snapshot());
    this.send({ type: 'start', runId: this.runId, settings });
  }

  private onEvent(event: ProducerEvent): void {
    if ('runId' in event && event.runId !== this.runId) return; // previous run

    switch (event.type) {
      case 'status':
        this._error.set(null);
        this._status.set(event.status);
        break;
      case 'batch':
        this.accumulator.add(event.records);
        this._metrics.set(this.accumulator.snapshot());
        break;
      case 'error':
        this.fail(event.message);
        break;
    }
  }

  private fail(message: string): void {
    this._status.set('error');
    this._error.set(message);
  }

  private send(command: ProducerCommand): void {
    this.worker?.postMessage(command);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
