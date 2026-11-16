export interface DeviceCalibration {
  rmsThreshold: number;
  silenceRms: number;
  extraLatencyMs: number;
  calibratedAt: string;
}

const CALIBRATION_KEY = 'sonicmambo:calibration';

const DEFAULT_CALIBRATION: DeviceCalibration = {
  rmsThreshold: 0.01,
  silenceRms: 0.0033,
  extraLatencyMs: 0,
  calibratedAt: '',
};

/**
 * Computes noise-floor threshold from silence RMS samples:
 * `rmsThreshold = clamp(3 * p95(rmsSamples), 0.002, 0.08)`.
 */
export function computeNoiseFloorThreshold(rmsSamples: readonly number[]): {
  silenceRms: number;
  rmsThreshold: number;
} {
  const valid = rmsSamples
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);

  if (valid.length === 0) {
    return { silenceRms: DEFAULT_CALIBRATION.silenceRms, rmsThreshold: DEFAULT_CALIBRATION.rmsThreshold };
  }

  const p95Idx = Math.min(valid.length - 1, Math.floor((valid.length - 1) * 0.95));
  const silenceRms = valid[p95Idx];
  const rmsThreshold = Number(Math.min(0.08, Math.max(0.002, silenceRms * 3)).toFixed(4));
  return { silenceRms: Number(silenceRms.toFixed(5)), rmsThreshold };
}

export function readCalibration(): DeviceCalibration | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(CALIBRATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeviceCalibration>;
    if (typeof parsed.rmsThreshold !== 'number' || !Number.isFinite(parsed.rmsThreshold)) {
      return null;
    }
    return {
      rmsThreshold: Math.min(0.08, Math.max(0.002, parsed.rmsThreshold)),
      silenceRms:
        typeof parsed.silenceRms === 'number' && Number.isFinite(parsed.silenceRms)
          ? parsed.silenceRms
          : parsed.rmsThreshold / 3,
      extraLatencyMs:
        typeof parsed.extraLatencyMs === 'number' && Number.isFinite(parsed.extraLatencyMs)
          ? parsed.extraLatencyMs
          : 0,
      calibratedAt: typeof parsed.calibratedAt === 'string' ? parsed.calibratedAt : '',
    };
  } catch {
    return null;
  }
}

export function writeCalibration(partial: Partial<DeviceCalibration>): DeviceCalibration {
  const existing = readCalibration() ?? DEFAULT_CALIBRATION;
  const next: DeviceCalibration = {
    rmsThreshold:
      partial.rmsThreshold != null && Number.isFinite(partial.rmsThreshold)
        ? Math.min(0.08, Math.max(0.002, partial.rmsThreshold))
        : existing.rmsThreshold,
    silenceRms:
      partial.silenceRms != null && Number.isFinite(partial.silenceRms)
        ? Math.max(0, partial.silenceRms)
        : existing.silenceRms,
    extraLatencyMs:
      partial.extraLatencyMs != null && Number.isFinite(partial.extraLatencyMs)
        ? Math.max(-250, Math.min(400, partial.extraLatencyMs))
        : existing.extraLatencyMs,
    calibratedAt: partial.calibratedAt ?? new Date().toISOString(),
  };

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CALIBRATION_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignore storage quota / private mode failures
  }
  return next;
}
