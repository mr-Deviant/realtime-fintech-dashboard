import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FakeProducerWorker, fakeWorkerClass } from "../../producer/fake-producer-worker";
import { SettingsService } from "./settings-service";
import { Settings } from "./settings";

describe("Settings", () => {
  let fixture: ComponentFixture<Settings>;
  let settingsService: SettingsService;

  const inputs = () =>
    Array.from(fixture.nativeElement.querySelectorAll("input")) as HTMLInputElement[];
  const applyButton = () => fixture.nativeElement.querySelector("button") as HTMLButtonElement;

  async function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event("input"));
    await fixture.whenStable();
  }

  beforeEach(async () => {
    vi.stubGlobal("Worker", fakeWorkerClass(new FakeProducerWorker()));
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

  it("applies valid values", async () => {
    await type(inputs()[0], "10");
    await type(inputs()[1], "250");
    await type(inputs()[2], "100");
    applyButton().click();
    await fixture.whenStable();
    expect(settingsService.settings()).toEqual({
      instrumentCount: 10,
      updatesPerBatch: 250,
      batchIntervalMs: 100,
    });
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
  ])("rejects input %i = '%s'", async (index, value) => {
    await type(inputs()[index], value);
    expect(applyButton().disabled).toBe(true);
    applyButton().click();
    await fixture.whenStable();
    expect(settingsService.settings().instrumentCount).toBe(5);
  });
});
