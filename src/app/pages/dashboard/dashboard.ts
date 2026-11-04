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
      symbol: 'ALFA',
      tradePrice: undefined,
      askPrice: undefined,
      bidPrice: undefined,
      tradeQuantity: undefined,
      bidQuantity: undefined,
      askQuantity: undefined
    }]
  );
}
