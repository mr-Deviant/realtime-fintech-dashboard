import { CurrencyPipe, DecimalPipe } from "@angular/common";
import { Component, signal } from "@angular/core";
import { MatTableModule } from "@angular/material/table";
import { DashboardItem } from "./dashboard-item";

@Component({
  imports: [CurrencyPipe, DecimalPipe, MatTableModule],
  selector: "app-dashboard",
  styleUrl: "./dashboard.scss",
  templateUrl: "./dashboard.html",
})
export class Dashboard {
  protected readonly columns = ["symbol", "lastPrice", "spread", "volume", "vwap", "imbalance"];

  protected readonly rows = signal<DashboardItem[]>(
    [{
      "instrument": "ALFA",
      "priceCents": 10200,
      "tradeQuantity": 30,
      "bidCents": 10196,
      "askCents": 10200,
      "bidQuantity": 600,
      "askQuantity": 400
    }]
  );
}
