import { ComponentFixture, TestBed } from "@angular/core/testing";
import { batch, FakeWorker } from "../../testing/fake-worker";
import { Dashboard } from "./dashboard";
import { DashboardService } from "./dashboard-service";

describe("Dashboard", () => {
  let fixture: ComponentFixture<Dashboard>;
  let worker: FakeWorker;

  const cellTexts = (row: number) =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("tr.mat-mdc-row")[row].querySelectorAll("td"),
    ).map((cell) => cell.textContent?.trim());
  const toggleButton = () => fixture.nativeElement.querySelector("button") as HTMLButtonElement;
  const statusText = () => fixture.nativeElement.querySelector('[role="status"]').textContent.trim();

  beforeEach(async () => {
    vi.stubGlobal("Worker", FakeWorker);
    await TestBed.configureTestingModule({ imports: [Dashboard] }).compileComponents();

    fixture = TestBed.createComponent(Dashboard);
    worker = FakeWorker.instance;
    await fixture.whenStable(); // Waits until Angular has finished all pending work for that component
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows one row per instrument with unavailable values and zero volume before data arrives", () => {
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll("tr.mat-mdc-row");
    expect(rows).toHaveLength(5);
    expect(cellTexts(0)).toEqual(["ALFA", "N/A", "N/A", "0", "N/A", "N/A"]);
  });

  it("shows formatted metrics once a batch arrives", async () => {
    worker.emit({ type: "ready" });
    worker.emit(batch(1, [0, 10200, 30, 10196, 10200, 600, 400]));
    await fixture.whenStable();

    expect(cellTexts(0)).toEqual(["ALFA", "$102.00", "$0.04", "30", "$102.00", "0.20"]);
  });

  it("disables the toggle until the producer is running", () => {
    expect(toggleButton().disabled).toBe(true);
    expect(statusText()).toContain("Starting");
  });

  it("pauses and resumes through the toggle", async () => {
    worker.emit({ type: "ready" });
    await fixture.whenStable();
    expect(toggleButton().textContent).toContain("Pause");
    expect(statusText()).toContain("Running");

    toggleButton().click();
    await fixture.whenStable();
    expect(worker.lastCommand).toEqual({ type: "pause" });
    expect(toggleButton().textContent).toContain("Resume");
    expect(statusText()).toContain("Paused");

    toggleButton().click();
    await fixture.whenStable();
    expect(worker.lastCommand).toEqual({ type: "resume" });
    expect(statusText()).toContain("Running");
  });

  it("shows initialization errors", async () => {
    worker.emit({ type: "error", message: "Failed to load Wasm: nope" });
    await fixture.whenStable();

    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain("Failed to load Wasm");
    expect(statusText()).toContain("Error");
    expect(toggleButton().disabled).toBe(true);
  });

  it("keeps the active run when the page is re-created", async () => {
    worker.emit({ type: "ready" });
    await fixture.whenStable(); // The button is enabled once the page has rendered the running status
    toggleButton().click();
    fixture.destroy();

    const again = TestBed.createComponent(Dashboard);
    await again.whenStable();

    expect(TestBed.inject(DashboardService).status()).toBe("paused");
    expect(worker.commands.filter((command) => (command as { type: string }).type === "start")).toHaveLength(1);
  });
});
