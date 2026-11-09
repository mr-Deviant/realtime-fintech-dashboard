import { Field, RECORD_FIELDS } from './wasm-producer';

/** Dashboard values for one instrument. `null` means unavailable. */
export interface InstrumentMetrics {
  readonly symbol: string;
  readonly lastPriceCents: number | null;
  readonly spreadCents: number | null;
  readonly volume: number;
  readonly vwapCents: number | null;
  /** Between -1 and +1. */
  readonly imbalance: number | null;
}

interface Totals {
  lastPriceCents: number | null;
  bidCents: number | null;
  askCents: number | null;
  bidQuantity: number | null;
  askQuantity: number | null;
  volume: number;
  /** sum(tradePrice × tradeQuantity), in cents. */
  notionalCents: number;
}

const GREEK = [
  'ALFA', 'BETA', 'GAMA', 'DELT', 'EPSI', 'ZETA', 'ETAA', 'THET', 'IOTA', 'KAPA', 'LAMB', 'MUUU',
  'NUUU', 'XIII', 'OMIC', 'PIII', 'RHOO', 'SIGM', 'TAUU', 'UPSI', 'PHII', 'CHII', 'PSII', 'OMEG',
];

/** Symbols for instrument indexes `0..count-1`: ALFA, BETA, ..., OMEG, ALFA2, BETA2, ... */
export function symbolsFor(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const round = Math.floor(i / GREEK.length);
    return GREEK[i % GREEK.length] + (round > 0 ? round + 1 : '');
  });
}

/**
 * Keeps running per-instrument totals. Only sums are stored, never the trade
 * history, and every trade is counted exactly once.
 */
export class MetricsAccumulator {
  private readonly totals: Totals[];

  constructor(private readonly symbols: readonly string[]) {
    this.totals = symbols.map(() => ({
      lastPriceCents: null,
      bidCents: null,
      askCents: null,
      bidQuantity: null,
      askQuantity: null,
      volume: 0,
      notionalCents: 0,
    }));
  }

  /** Adds a flat buffer of `RECORD_FIELDS` i32 values per update. */
  add(records: Int32Array): void {
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

  snapshot(): InstrumentMetrics[] {
    return this.totals.map((t, i) => {
      const bookQuantity = (t.bidQuantity ?? 0) + (t.askQuantity ?? 0);
      return {
        symbol: this.symbols[i],
        lastPriceCents: t.lastPriceCents,
        spreadCents: t.bidCents !== null && t.askCents !== null ? t.askCents - t.bidCents : null,
        volume: t.volume,
        vwapCents: t.volume > 0 ? t.notionalCents / t.volume : null,
        imbalance:
          bookQuantity > 0 ? ((t.bidQuantity ?? 0) - (t.askQuantity ?? 0)) / bookQuantity : null,
      };
    });
  }
}
