import { SettingsModel } from '../pages/settings/settings-model';

export type ProducerStatus = 'running' | 'paused';

// Messages sent from the app to the producer worker
export type ProducerCommand =
  | { readonly type: 'start'; readonly runId: number; readonly settings: SettingsModel }
  // Pause and resume carry no run id: messages arrive in order, so they always apply to the latest start
  | { readonly type: 'pause' }
  | { readonly type: 'resume' };

// Messages sent from the producer worker to the app
export type ProducerEvent =
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'status'; readonly runId: number; readonly status: ProducerStatus }
  | { readonly type: 'batch'; readonly runId: number; readonly records: Int32Array };
