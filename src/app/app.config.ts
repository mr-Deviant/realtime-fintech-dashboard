import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { DashboardService } from './pages/dashboard/dashboard-service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Create the dashboard service once at startup so it runs regardless of which page is open.
    provideAppInitializer(() => {
      inject(DashboardService);
    }),
  ]
};
