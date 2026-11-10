import { Service, signal } from '@angular/core';
import { SettingsModel } from './settings-model';

export const DEFAULT_SETTINGS: SettingsModel = {
  instrumentCount: 5,
  updatesPerBatch: 100,
  batchIntervalMs: 500,
};

@Service()
export class SettingsService {
  public readonly settings = signal<SettingsModel>(DEFAULT_SETTINGS);

  apply(settings: SettingsModel): void {
    this.settings.set(settings);
  }
}
