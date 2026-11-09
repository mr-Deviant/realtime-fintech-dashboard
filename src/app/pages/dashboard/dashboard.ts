import { CurrencyPipe, DecimalPipe } from "@angular/common";
import { Component, computed, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatTableModule } from "@angular/material/table";
import { InstrumentMetrics } from "../../producer/metrics";
import { ProducerService } from "../../producer/producer-service";

@Component({
  imports: [CurrencyPipe, DecimalPipe, MatButtonModule, MatTableModule],
  selector: "app-dashboard",
  styleUrl: "./dashboard.scss",
  templateUrl: "./dashboard.html",
})
export class Dashboard {
  protected readonly producer = inject(ProducerService);

  protected readonly na = 'N/A';

  protected readonly columns = ["symbol", "lastPrice", "spread", "volume", "vwap", "imbalance"];

  protected readonly canToggle = computed(() => {
    const status = this.producer.status();
    return status === 'running' || status === 'paused';
  });

  protected readonly statusLabel = computed(() => {
    switch (this.producer.status()) {
      case 'running':
        return 'Running';
      case 'paused':
        return 'Paused';
      case 'error':
        return 'Error';
      default:
        return 'Starting…';
    }
  });

  // TODO: An instrument may appear more than once in a batch
  protected readonly trackBySymbol = (_: number, row: InstrumentMetrics) => row.symbol;
}
