import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Field, RECORD_FIELDS, WasmProducer } from '../../src/app/producer/wasm-producer';

const wasmBytes = readFileSync(new URL('../../public/wasm/producer.wasm', import.meta.url));

interface Update {
  instrument: number;
  priceCents: number;
  tradeQuantity: number;
  bidCents: number;
  askCents: number;
  bidQuantity: number;
  askQuantity: number;
}

function decode(records: Int32Array): Update[] {
  const updates: Update[] = [];
  for (let base = 0; base < records.length; base += RECORD_FIELDS) {
    updates.push({
      instrument: records[base + Field.Instrument],
      priceCents: records[base + Field.PriceCents],
      tradeQuantity: records[base + Field.TradeQuantity],
      bidCents: records[base + Field.BidCents],
      askCents: records[base + Field.AskCents],
      bidQuantity: records[base + Field.BidQuantity],
      askQuantity: records[base + Field.AskQuantity],
    });
  }
  return updates;
}

describe('Wasm market-data generator', () => {
  let producer: WasmProducer;

  beforeAll(async () => {
    producer = await WasmProducer.instantiate(wasmBytes);
  });

  it.each([1, 100, 1000])('returns exactly %i updates per batch', (size) => {
    producer.init(42, 5);
    const records = producer.generate(size);
    expect(records.length).toBe(size * RECORD_FIELDS);
  });

  it('generates valid values across many batches', () => {
    producer.init(7, 50);
    for (let batch = 0; batch < 200; batch++) {
      for (const u of decode(producer.generate(1000))) {
        expect(Number.isInteger(u.instrument)).toBe(true);
        expect(u.instrument).toBeGreaterThanOrEqual(0);
        expect(u.instrument).toBeLessThan(50);
        expect(u.bidCents).toBeGreaterThan(0);
        expect(u.bidCents).toBeLessThan(u.askCents);
        expect([u.bidCents, u.askCents]).toContain(u.priceCents);
        expect(u.tradeQuantity).toBeGreaterThan(0);
        expect(u.bidQuantity).toBeGreaterThanOrEqual(0);
        expect(u.askQuantity).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('only emits instruments within the configured count', () => {
    producer.init(3, 2);
    const instruments = new Set(decode(producer.generate(1000)).map((u) => u.instrument));
    expect(instruments).toEqual(new Set([0, 1]));
  });

  it('evolves prices from previous values instead of jumping randomly', () => {
    producer.init(11, 1);
    const updates = decode(producer.generate(1000));
    for (let i = 1; i < updates.length; i++) {
      const prevMid = (updates[i - 1].bidCents + updates[i - 1].askCents) / 2;
      const mid = (updates[i].bidCents + updates[i].askCents) / 2;
      // Each step moves the mid by at most ~0.2% (plus one cent of rounding slack).
      expect(Math.abs(mid - prevMid)).toBeLessThanOrEqual(prevMid * 0.002 + 1);
    }
  });

  it('retains per-instrument state between calls', () => {
    producer.init(5, 1);
    const first = decode(producer.generate(1));
    const second = decode(producer.generate(1));
    const firstMid = (first[0].bidCents + first[0].askCents) / 2;
    const secondMid = (second[0].bidCents + second[0].askCents) / 2;
    expect(Math.abs(secondMid - firstMid)).toBeLessThanOrEqual(firstMid * 0.002 + 1);
  });

  it('is deterministic for a fixed seed and resets on init', () => {
    producer.init(1234, 5);
    const a = producer.generate(100);
    producer.generate(100); // advance state
    producer.init(1234, 5);
    const b = producer.generate(100);
    expect(b).toEqual(a);
  });

  it('returns copies that are not overwritten by later batches', () => {
    producer.init(9, 3);
    const first = producer.generate(10);
    const snapshot = first.slice();
    producer.generate(10);
    expect(first).toEqual(snapshot);
  });

  it('rejects out-of-range instrument counts and batch sizes', () => {
    expect(() => producer.init(1, 0)).toThrow(RangeError);
    expect(() => producer.init(1, 51)).toThrow(RangeError);
    producer.init(1, 5);
    expect(() => producer.generate(0)).toThrow(RangeError);
    expect(() => producer.generate(1001)).toThrow(RangeError);
  });
});
