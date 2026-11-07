import { Component, inject } from "@angular/core";
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { SettingsService } from "./settings-service";

@Component({
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  selector: "app-settings",
  styleUrl: "./settings.scss",
  templateUrl: "./settings.html",
})
export class Settings {
  private readonly settingsService = inject(SettingsService);
  private readonly fb = inject(NonNullableFormBuilder);

  // Better to use here Signal Forms, but I and maybe you also, have more experience with Reactive forms
  protected readonly form = this.fb.group({
    instrumentCount: this.fb.control<number>(
      this.settingsService.settings().instrumentCount,
      [ Validators.required, Validators.min(1), Validators.max(50) ]
    ),
    updatesPerBatch: this.fb.control<number>(
      this.settingsService.settings().updatesPerBatch,
      [ Validators.required, Validators.min(1), Validators.max(1000) ]
    ),
    batchIntervalMs: this.fb.control<number>(
      this.settingsService.settings().batchIntervalMs,
      [ Validators.required, Validators.min(50), Validators.max(2000) ]
    ),
  });

  protected readonly instrumentCount = this.form.controls.instrumentCount;
  protected readonly updatesPerBatch = this.form.controls.updatesPerBatch;
  protected readonly batchIntervalMs = this.form.controls.batchIntervalMs;

  protected apply(event: SubmitEvent): void {
    event.preventDefault();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.settingsService.apply(this.form.getRawValue());
  }
}
