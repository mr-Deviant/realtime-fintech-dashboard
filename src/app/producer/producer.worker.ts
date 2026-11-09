/// <reference lib="webworker" />

import { ProducerEngine } from './producer-engine';
import { ProducerCommand, ProducerEvent } from './producer-protocol';
import { WasmProducer } from './wasm-producer';

// Resolved relative to the worker script, so it also works under a non-root base href.
const WASM_URL = new URL('wasm/producer.wasm', self.location.href);

const post = (event: ProducerEvent, transfer: Transferable[] = []): void =>
  postMessage(event, transfer);

// Commands that arrive while the Wasm module is still loading are replayed once it is ready.
let pending: ProducerCommand[] | undefined = [];
let engine: ProducerEngine | undefined;

addEventListener('message', ({ data }: MessageEvent<ProducerCommand>) => {
  if (engine) {
    engine.handle(data);
  } else {
    pending?.push(data);
  }
});

async function loadGenerator(): Promise<WasmProducer> {
  const response = await fetch(WASM_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading ${WASM_URL.pathname}`);
  }
  return WasmProducer.instantiate(await response.arrayBuffer());
}

loadGenerator().then(
  (generator) => {
    engine = new ProducerEngine(
      generator,
      post,
      { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as number) },
      () => crypto.getRandomValues(new Uint32Array(1))[0],
    );
    post({ type: 'ready' });
    const queued = pending ?? [];
    pending = undefined;
    queued.forEach((command) => engine?.handle(command));
  },
  (error: unknown) => {
    pending = undefined;
    const reason = error instanceof Error ? error.message : String(error);
    post({ type: 'error', message: `Failed to initialise the Wasm producer: ${reason}` });
  },
);
