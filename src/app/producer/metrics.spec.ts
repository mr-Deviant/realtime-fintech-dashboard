import { MetricsAccumulator, symbolsFor } from './metrics';
import { Field, RECORD_FIELDS } from './wasm-producer';

interface UpdateInit {
  instrument?: number;
  price?: number;
  qty?: number;
  bid?: number;
  ask?: number;
  bidQty?: number;
  askQty?: number;
}

function records(...updates: UpdateInit[]): Int32Array {
  const buffer = new Int32Array(updates.length * RECORD_FIELDS);
  updates.forEach((u, i) => {
    const base = i * RECORD_FIELDS;
    buffer[base + Field.Instrument] = u.instrument ?? 0;
    buffer[base + Field.PriceCents] = u.price ?? 10000;
    buffer[base + Field.TradeQuantity] = u.qty ?? 1;
    buffer[base + Field.BidCents] = u.bid ?? 9990;
    buffer[base + Field.AskCents] = u.ask ?? 10010;
    buffer[base + Field.BidQuantity] = u.bidQty ?? 100;
    buffer[base + Field.AskQuantity] = u.askQty ?? 100;
  });
  return buffer;
}

describe('MetricsAccumulator', () => {
  it('shows unavailable values and zero volume before any data arrives', () => {
    const [row] = new MetricsAccumulator(['ALFA']).snapshot();
    expect(row).toEqual({
      symbol: 'ALFA',
      lastPriceCents: null,
      spreadCents: null,
      volume: 0,
      vwapCents: null,
      imbalance: null,
    });
  });

  it('computes the worked example', () => {
    const metrics = new MetricsAccumulator(['ALFA']);
    metrics.add(
      records(
        { price: 10000, qty: 10, bid: 9996, ask: 10000, bidQty: 500, askQty: 500 },
        { price: 10200, qty: 30, bid: 10196, ask: 10200, bidQty: 600, askQty: 400 },
      ),
    );

    const [row] = metrics.snapshot();
    expect(row.lastPriceCents).toBe(10200);
    expect(row.volume).toBe(40);
    expect(row.vwapCents).toBeCloseTo(10150); // (100×10 + 102×30) / 40 = $101.50
    expect(row.spreadCents).toBe(4); // $0.04
    expect(row.imbalance).toBeCloseTo(0.2); // (600 − 400) / (600 + 400)
  });

  it('accumulates across batches, counting every trade once', () => {
    const metrics = new MetricsAccumulator(['ALFA']);
    metrics.add(records({ price: 10000, qty: 10 }));
    metrics.add(records({ price: 10200, qty: 30 }));

    const [row] = metrics.snapshot();
    expect(row.volume).toBe(40);
    expect(row.vwapCents).toBeCloseTo(10150);
  });

  it('does not count book quantities as trading volume', () => {
    const metrics = new MetricsAccumulator(['ALFA']);
    metrics.add(records({ qty: 5, bidQty: 900, askQty: 700 }));
    expect(metrics.snapshot()[0].volume).toBe(5);
  });

  it('uses the latest bid, ask and book quantities', () => {
    const metrics = new MetricsAccumulator(['ALFA']);
    metrics.add(records({ bid: 9990, ask: 10010, bidQty: 100, askQty: 300 }));
    metrics.add(records({ bid: 10000, ask: 10001, bidQty: 300, askQty: 100 }));

    const [row] = metrics.snapshot();
    expect(row.spreadCents).toBe(1);
    expect(row.imbalance).toBeCloseTo(0.5);
  });

  it('reports imbalance as unavailable when both book quantities are zero', () => {
    const metrics = new MetricsAccumulator(['ALFA']);
    metrics.add(records({ bidQty: 0, askQty: 0 }));

    const [row] = metrics.snapshot();
    expect(row.imbalance).toBeNull();
    expect(row.vwapCents).not.toBeNull(); // other metrics are unaffected
  });

  it('keeps imbalance within -1 and +1', () => {
    const metrics = new MetricsAccumulator(['ALFA', 'BETA']);
    metrics.add(records({ instrument: 0, bidQty: 500, askQty: 0 }, { instrument: 1, bidQty: 0, askQty: 500 }));

    const [alfa, beta] = metrics.snapshot();
    expect(alfa.imbalance).toBe(1);
    expect(beta.imbalance).toBe(-1);
  });

  it('isolates instruments from each other', () => {
    const metrics = new MetricsAccumulator(['ALFA', 'BETA']);
    metrics.add(
      records(
        { instrument: 0, price: 10000, qty: 10 },
        { instrument: 1, price: 5000, qty: 4 },
        { instrument: 0, price: 10200, qty: 30 },
      ),
    );

    const [alfa, beta] = metrics.snapshot();
    expect(alfa.volume).toBe(40);
    expect(alfa.vwapCents).toBeCloseTo(10150);
    expect(alfa.lastPriceCents).toBe(10200);
    expect(beta.volume).toBe(4);
    expect(beta.vwapCents).toBe(5000);
    expect(beta.lastPriceCents).toBe(5000);
  });

  it('leaves untouched instruments unavailable', () => {
    const metrics = new MetricsAccumulator(['ALFA', 'BETA']);
    metrics.add(records({ instrument: 0 }));

    const beta = metrics.snapshot()[1];
    expect(beta.lastPriceCents).toBeNull();
    expect(beta.volume).toBe(0);
  });

  it('ignores updates for instruments outside the run', () => {
    const metrics = new MetricsAccumulator(['ALFA']);
    expect(() => metrics.add(records({ instrument: 7 }))).not.toThrow();
    expect(metrics.snapshot()[0].volume).toBe(0);
  });

  it('returns snapshots that are not changed by later updates', () => {
    const metrics = new MetricsAccumulator(['ALFA']);
    metrics.add(records({ qty: 10 }));
    const before = metrics.snapshot();
    metrics.add(records({ qty: 10 }));
    expect(before[0].volume).toBe(10);
  });
});

describe('symbolsFor', () => {
  it('returns the requested number of unique symbols', () => {
    const symbols = symbolsFor(50);
    expect(symbols).toHaveLength(50);
    expect(new Set(symbols).size).toBe(50);
    expect(symbols.slice(0, 2)).toEqual(['ALFA', 'BETA']);
  });
});
