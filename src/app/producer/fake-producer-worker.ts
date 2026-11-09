import { ProducerCommand, ProducerEvent } from './producer-protocol';

/** Test double for the producer worker: records commands and lets tests emit events. */
export class FakeProducerWorker {
  readonly commands: ProducerCommand[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<ProducerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(command: ProducerCommand): void {
    this.commands.push(command);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(event: ProducerEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<ProducerEvent>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }

  get lastCommand(): ProducerCommand | undefined {
    return this.commands.at(-1);
  }
}

/**
 * A class that `new Worker(...)` can be replaced with: constructing it returns `worker`.
 * Use as `vi.stubGlobal('Worker', fakeWorkerClass(worker))`.
 */
export function fakeWorkerClass(worker: FakeProducerWorker): typeof Worker {
  return class {
    constructor() {
      return worker;
    }
  } as unknown as typeof Worker;
}
