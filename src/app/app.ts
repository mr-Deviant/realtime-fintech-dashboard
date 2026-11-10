import { Component } from "@angular/core";
import { RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  selector: "app-root",
  styleUrl: "./app.scss",
  templateUrl: "./app.html",
})
export class App {}

// if (typeof Worker !== "undefined") {
//   // Create a new
//   const worker = new Worker(new URL("./app.worker", import.meta.url));
//   worker.onmessage = ({ data }) => {
//     console.log(`page got message: ${data}`);
//
//     if (data === 'ready') {
//       worker.postMessage({ type: 'start', settings: { seed: 1, instrumentCount: 5, updatesPerBatch: 100, batchIntervalMs: 500 } });
//     }
//   };
// } else {
//   // Web Workers are not supported in this environment.
//   // You should add a fallback so that your program still executes correctly.
// }
