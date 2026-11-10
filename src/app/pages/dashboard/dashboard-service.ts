import { DestroyRef, inject, Service, signal } from '@angular/core';
import { InstrumentMetrics, SettingsModel, Totals, WorkerEvent } from './dashboard-model';

// Number of i32 values per generated update in a batch buffer
export const RECORD_FIELDS = 7;

// Offsets of each field inside one record of a batch buffer
export const Field = {
  Instrument: 0,
  PriceCents: 1,
  TradeQuantity: 2,
  BidCents: 3,
  AskCents: 4,
  BidQuantity: 5,
  AskQuantity: 6,
} as const;

const GREEK = [
  'ALFA', 'BETA', 'GAMA', 'DELT', 'EPSI', 'ZETA', 'ETAA', 'THET', 'IOTA', 'KAPA', 'LAMB', 'MUUU',
  'NUUU', 'XIII', 'OMIC', 'PIII', 'RHOO', 'SIGM', 'TAUU', 'UPSI', 'PHII', 'CHII', 'PSII', 'OMEG',
];

export const DEFAULT_SETTINGS: SettingsModel = {
  instrumentCount: 5,
  updatesPerBatch: 100,
  batchIntervalMs: 500,
};

@Service()
export class DashboardService {
  private worker?: Worker;
  private runId = 0;
  private totals!: Totals[];
  private symbols!: string[];
  private readonly _status = signal<'initializing' | 'running' | 'paused' | 'error'>('initializing');
  public readonly status = this._status.asReadonly();
  public readonly error = signal('');
  private readonly _metrics = signal<InstrumentMetrics[]>([]);
  readonly metrics = this._metrics.asReadonly();

  constructor() {
    this.reset(); // Rows are visible before the worker is ready

    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL("../../app.worker", import.meta.url));
      this.worker.onmessage = ({ data }: MessageEvent<WorkerEvent>) => {
        switch (data.type) {
          case 'ready':
            this.start();
            break;
          case 'batch':
            // Ignore batches that the worker generated for a previous run
            if (data.runId !== this.runId) break;
            this.add(data.records);
            this._metrics.set(this.snapshot());
            break;
          case 'error':
            this.fail(data.message);
            break;
        }
      };
      // The worker script itself failed to load or crashed
      this.worker.onerror = () => this.fail('The producer worker crashed');
    } else {
      this.fail('Web Workers are not supported in this browser');
    }

    inject(DestroyRef).onDestroy(() => {
      this.worker?.terminate(); // Stops the timer and frees the Wasm instance
      this.worker = undefined;
    });
  }

  public readonly settings = signal<SettingsModel>(DEFAULT_SETTINGS);

  applySettings(settings: SettingsModel): void {
    this.settings.set(settings);
    this.start();
  }

  public start(): void {
    this.reset();
    this.error.set('');
    this._status.set('running');
    this.runId++;
    this.worker?.postMessage({ type: 'start', settings: { runId: this.runId, ...this.settings() } });
  }

  private fail(message: string): void {
    this.error.set(message);
    this._status.set('error');
  }

  // Zero totals and N/A values for every instrument
  private reset(): void {
    this.symbols = this.symbolsFor(this.settings().instrumentCount);
    this.totals = this.symbols.map(() => ({
      lastPriceCents: null,
      bidCents: null,
      askCents: null,
      bidQuantity: null,
      askQuantity: null,
      volume: 0,
      notionalCents: 0,
    }));
    this._metrics.set(this.snapshot()); // Show the cleared values right away, not after the first batch
  }

  public pause(): void {
    this._status.set('paused');
    this.worker?.postMessage({ type: 'pause' });
  }

  public resume(): void {
    this._status.set('running');
    this.worker?.postMessage({ type: 'resume' });
  }

  public toggle(): void {
    if (this.status() === 'running') {
      this.pause();
    } else if (this.status() === 'paused') {
      this.resume();
    }
  }

  /** Adds a flat buffer of `RECORD_FIELDS` i32 values per update. */
  private add(records: Int32Array): void {
    for (let base = 0; base + RECORD_FIELDS <= records.length; base += RECORD_FIELDS) {
      const totals = this.totals[records[base + Field.Instrument]];
      if (!totals) continue; // index outside this run's instruments

      const price = records[base + Field.PriceCents];
      const quantity = records[base + Field.TradeQuantity];
      totals.lastPriceCents = price;
      totals.volume += quantity;
      totals.notionalCents += price * quantity;
      totals.bidCents = records[base + Field.BidCents];
      totals.askCents = records[base + Field.AskCents];
      totals.bidQuantity = records[base + Field.BidQuantity];
      totals.askQuantity = records[base + Field.AskQuantity];
    }
  }

  private snapshot(): InstrumentMetrics[] {
    return this.totals.map((t, i) => {
      const bookQuantity = (t.bidQuantity ?? 0) + (t.askQuantity ?? 0);
      return {
        symbol: this.symbols[i],
        lastPriceCents: t.lastPriceCents,
        spreadCents: t.bidCents !== null && t.askCents !== null ? t.askCents - t.bidCents : null,
        volume: t.volume,
        vwapCents: t.volume > 0 ? t.notionalCents / t.volume : null,
        imbalance: bookQuantity > 0 ? ((t.bidQuantity ?? 0) - (t.askQuantity ?? 0)) / bookQuantity : null,
      };
    });
  }

  // Symbols for instrument indexes `0..count-1`: ALFA, BETA, ..., OMEG, ALFA2, BETA2, ...
  private symbolsFor(count: number): string[] {
    return Array.from({ length: count }, (_, i) => {
      const round = Math.floor(i / GREEK.length);
      return GREEK[i % GREEK.length] + (round > 0 ? round + 1 : '');
    });
  }
}
