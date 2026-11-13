export const GRACE_PERIOD_MS = 60_000;

export interface ReconnectConfig {
  gracePeriodMs: number;
}

export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  gracePeriodMs: GRACE_PERIOD_MS,
};
