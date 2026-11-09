import { InjectionToken } from '@angular/core';

/**
 * Creates the producer worker. Kept in its own module because the Angular builder
 * only bundles workers referenced with this exact `new Worker(new URL(...))` form.
 */
export function createProducerWorker(): Worker {
  return new Worker(new URL('./producer.worker', import.meta.url), { type: 'module' });
}

/** Injectable so tests can supply a fake worker. */
export const PRODUCER_WORKER_FACTORY = new InjectionToken<() => Worker>('PRODUCER_WORKER_FACTORY', {
  factory: () => createProducerWorker,
});
