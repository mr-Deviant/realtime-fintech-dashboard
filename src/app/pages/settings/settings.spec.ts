import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FakeProducerWorker, fakeWorkerClass } from "../../producer/fake-producer-worker";
import { DEFAULT_SETTINGS, SettingsService } from "./settings-service";
import { Settings } from "./settings";

describe("Settings", () => {
  let fixture: ComponentFixture<Settings>;
  let settingsService: SettingsService;
  let worker: FakeProducerWorker;

  const inputs = () =>
    Array.from(fixture.nativeElement.querySelectorAll("input")) as HTMLInputElement[];
  const applyButton = () => fixture.nativeElement.querySelector("button") as HTMLButtonElement;

  async function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event("input"));
    await fixture.whenStable();
  }

  beforeEach(async () => {
    worker = new FakeProducerWorker();
    vi.stubGlobal("Worker", fakeWorkerClass(worker));
    await TestBed.configureTestingModule({ imports: [Settings] }).compileComponents();
    settingsService = TestBed.inject(SettingsService);
    fixture = TestBed.createComponent(Settings);
    await fixture.whenStable();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows the defaults", () => {
    expect(inputs().map((input) => input.value)).toEqual(["5", "100", "500"]);
    expect(applyButton().disabled).toBe(false);
  });

  it("does not touch the store while editing", async () => {
    await type(inputs()[0], "10");
    expect(settingsService.settings().instrumentCount).toBe(5);
  });

  it("does not start a new run while editing", async () => {
    await type(inputs()[0], "10");
    expect(worker.commands).toHaveLength(1); // only the initial run
  });

  it("applies valid values and starts a new run with them", async () => {
    await type(inputs()[0], "10");
    await type(inputs()[1], "250");
    await type(inputs()[2], "100");
    applyButton().click();
    await fixture.whenStable();

    const applied = { instrumentCount: 10, updatesPerBatch: 250, batchIntervalMs: 100 };
    expect(settingsService.settings()).toEqual(applied);
    expect(worker.lastCommand).toEqual({ type: "start", runId: 2, settings: applied });
  });

  it("starts a new run even when the values are unchanged", async () => {
    applyButton().click();
    await fixture.whenStable();

    expect(worker.lastCommand).toEqual({ type: "start", runId: 2, settings: DEFAULT_SETTINGS });
  });

  it.each([
    [0, "0"],
    [0, "51"],
    [1, "0"],
    [1, "1001"],
    [2, "49"],
    [2, "2001"],
    [0, "2.5"],
    [0, ""],
    [1, "99.5"],
    [2, "500.5"],
  ])("rejects input %i = '%s'", async (index, value) => {
    await type(inputs()[index], value);
    applyButton().click();
    await fixture.whenStable();

    // Nothing is applied and no new run starts...
    expect(settingsService.settings()).toEqual(DEFAULT_SETTINGS);
    expect(worker.commands).toHaveLength(1);
    // ...and the user is told why.
    expect(fixture.nativeElement.querySelector("mat-error")).not.toBeNull();
  });
});
