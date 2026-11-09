import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { ProducerService } from './producer/producer-service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Create the producer once at startup so it runs regardless of which page is open.
    provideAppInitializer(() => {
      inject(ProducerService);
    }),
  ]
};
