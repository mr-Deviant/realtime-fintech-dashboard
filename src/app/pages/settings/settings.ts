import { Component, inject } from "@angular/core";
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidatorFn,
  Validators
} from '@angular/forms';
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import {  DashboardService} from '../dashboard/dashboard-service';

// All settings must be whole numbers. Empty values are left to Validators.required.
const integer: ValidatorFn = (control) =>
  control.value === null || control.value === '' || Number.isInteger(control.value)
    ? null
    : { integer: true };

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
  private readonly dashboardService = inject(DashboardService);
  private readonly fb = inject(NonNullableFormBuilder);

  // Better to use here Signal Forms, but I and maybe you also, have more experience with Reactive forms
  protected readonly form = this.fb.group({
    instrumentCount: this.fb.control<number>(
      this.dashboardService.settings().instrumentCount,
      [ Validators.required, integer, Validators.min(1), Validators.max(50) ]
    ),
    updatesPerBatch: this.fb.control<number>(
      this.dashboardService.settings().updatesPerBatch,
      [ Validators.required, integer, Validators.min(1), Validators.max(1000) ]
    ),
    batchIntervalMs: this.fb.control<number>(
      this.dashboardService.settings().batchIntervalMs,
      [ Validators.required, integer, Validators.min(50), Validators.max(2000) ]
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

    this.dashboardService.applySettings(this.form.getRawValue());
  }
}
