/// <reference lib="webworker" />

import { ProducerEngine } from './producer-engine';
import { ProducerCommand, ProducerEvent } from './producer-protocol';
import { WasmProducer } from './wasm-producer';

// Resolved relative to the worker script, so it also works under a non-root base href (for example GitHub Pages)
const WASM_URL = new URL('wasm/producer.wasm', self.location.href);

// Easy to replace in unit tests
const post = (event: ProducerEvent, transfer: Transferable[] = []): void =>
  postMessage(event, transfer);

async function loadGenerator(): Promise<WasmProducer> {
  const response = await fetch(WASM_URL);
  if (!response.ok) { // Fetch doesn’t throw on a 404
    throw new Error(`HTTP ${response.status} while loading ${WASM_URL.pathname}`);
  }
  return WasmProducer.instantiate(await response.arrayBuffer());
}

// Loading starts immediately; commands wait on this promise instead of being queued by hand
const engine = loadGenerator().then(
  (generator) =>
    new ProducerEngine(generator, post),
);

// Report a load failure once
engine.catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  post({ type: 'error', message: `Failed to initialise the Wasm producer: ${reason}` });
});

// Callbacks on one promise run in the order they were added, so command order is preserved
addEventListener('message', ({ data }: MessageEvent<ProducerCommand>) => {
  engine.then(
    (producer) => producer.handle(data),
    () => undefined, // already reported above
  );
});
