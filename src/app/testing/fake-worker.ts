import { RECORD_FIELDS } from '../pages/dashboard/dashboard-service';

// Stands in for the real worker in tests: records what the page sends and lets tests send events back
export class FakeWorker {
  static instance: FakeWorker;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  commands: unknown[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instance = this;
  }

  get lastCommand(): unknown {
    return this.commands.at(-1);
  }

  postMessage(command: unknown): void {
    this.commands.push(command);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data });
  }
}

// A batch event. One update is [instrument, price, tradeQty, bid, ask, bidQty, askQty]
export function batch(runId: number, ...updates: number[][]) {
  const records = new Int32Array(updates.length * RECORD_FIELDS);
  updates.forEach((update, i) => records.set(update, i * RECORD_FIELDS));
  return { type: 'batch', runId, records };
}
