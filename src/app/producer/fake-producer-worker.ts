import { Provider } from '@angular/core';
import { PRODUCER_WORKER_FACTORY } from './create-producer-worker';
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

/** Provides `worker` wherever the app would create the real producer worker. */
export function provideFakeProducerWorker(worker: FakeProducerWorker): Provider {
  return { provide: PRODUCER_WORKER_FACTORY, useValue: () => worker as unknown as Worker };
}
