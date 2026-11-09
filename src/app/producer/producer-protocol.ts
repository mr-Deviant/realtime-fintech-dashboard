import { SettingsModel } from '../pages/settings/settings-model';

export type ProducerStatus = 'running' | 'paused';

// Messages sent from the app to the producer worker
export type ProducerCommand =
  | { readonly type: 'start'; readonly runId: number; readonly settings: SettingsModel }
  | { readonly type: 'pause'; readonly runId: number }
  | { readonly type: 'resume'; readonly runId: number }
  | { readonly type: 'stop' };

// Messages sent from the producer worker to the app
export type ProducerEvent =
  | { readonly type: 'ready' }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'status'; readonly runId: number; readonly status: ProducerStatus }
  /** `records` is a flat buffer of `RECORD_FIELDS` i32 values per update. */
  | { readonly type: 'batch'; readonly runId: number; readonly records: Int32Array };
