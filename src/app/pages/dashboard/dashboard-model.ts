// Dashboard values for one instrument. `null` means unavailable.
export interface InstrumentMetrics {
  readonly symbol: string;
  readonly lastPriceCents: number | null;
  readonly spreadCents: number | null;
  readonly volume: number;
  readonly vwapCents: number | null;
  readonly imbalance: number | null; // Between -1 and +1
}

export interface Totals {
  lastPriceCents: number | null;
  bidCents: number | null;
  askCents: number | null;
  bidQuantity: number | null;
  askQuantity: number | null;
  volume: number;
  /** sum(tradePrice × tradeQuantity), in cents. */
  notionalCents: number;
}
