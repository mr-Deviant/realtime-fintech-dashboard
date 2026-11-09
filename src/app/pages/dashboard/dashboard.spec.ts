import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FakeProducerWorker, provideFakeProducerWorker } from "../../producer/fake-producer-worker";
import { ProducerService } from "../../producer/producer-service";
import { Field, RECORD_FIELDS } from "../../producer/wasm-producer";
import { Dashboard } from "./dashboard";

describe("Dashboard", () => {
  let fixture: ComponentFixture<Dashboard>;
  let worker: FakeProducerWorker;

  const cellTexts = (row: number) =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("tr.mat-mdc-row")[row].querySelectorAll("td"),
    ).map((cell) => cell.textContent?.trim());
  const toggleButton = () => fixture.nativeElement.querySelector("button") as HTMLButtonElement;
  const statusText = () => fixture.nativeElement.querySelector('[role="status"]').textContent.trim();

  beforeEach(async () => {
    worker = new FakeProducerWorker();
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [provideFakeProducerWorker(worker)],
    }).compileComponents();

    fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable();
  });

  it("shows one row per instrument with unavailable values and zero volume before data arrives", () => {
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll("tr.mat-mdc-row");
    expect(rows).toHaveLength(5);
    expect(cellTexts(0)).toEqual(["ALFA", "N/A", "N/A", "0", "N/A", "N/A"]);
  });

  it("shows formatted metrics once a batch arrives", async () => {
    const records = new Int32Array(RECORD_FIELDS);
    records[Field.Instrument] = 0;
    records[Field.PriceCents] = 10200;
    records[Field.TradeQuantity] = 30;
    records[Field.BidCents] = 10196;
    records[Field.AskCents] = 10200;
    records[Field.BidQuantity] = 600;
    records[Field.AskQuantity] = 400;
    worker.emit({ type: "batch", runId: 1, records });
    await fixture.whenStable();

    expect(cellTexts(0)).toEqual(["ALFA", "$102.00", "$0.04", "30", "$102.00", "0.20"]);
  });

  it("disables the toggle until the producer is running", () => {
    expect(toggleButton().disabled).toBe(true);
    expect(statusText()).toContain("Starting");
  });

  it("pauses and resumes through the toggle", async () => {
    worker.emit({ type: "status", runId: 1, status: "running" });
    await fixture.whenStable();
    expect(toggleButton().textContent).toContain("Pause");
    expect(statusText()).toContain("Running");

    toggleButton().click();
    expect(worker.lastCommand).toEqual({ type: "pause", runId: 1 });

    worker.emit({ type: "status", runId: 1, status: "paused" });
    await fixture.whenStable();
    expect(toggleButton().textContent).toContain("Resume");
    expect(statusText()).toContain("Paused");

    toggleButton().click();
    expect(worker.lastCommand).toEqual({ type: "resume", runId: 1 });
  });

  it("shows initialization errors", async () => {
    worker.emit({ type: "error", message: "Failed to initialise the Wasm producer: nope" });
    await fixture.whenStable();

    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain("Failed to initialise the Wasm producer");
    expect(toggleButton().disabled).toBe(true);
  });

  it("keeps the active run when the page is re-created", async () => {
    worker.emit({ type: "status", runId: 1, status: "paused" });
    fixture.destroy();

    const again = TestBed.createComponent(Dashboard);
    await again.whenStable();

    expect(TestBed.inject(ProducerService).status()).toBe("paused");
    expect(worker.commands.filter((c) => c.type === "start")).toHaveLength(1);
  });
});
