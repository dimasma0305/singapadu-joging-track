import type { TrackCheckpoint } from "./types";
import {
  formatDistance,
  formatDuration,
  formatPace,
} from "./track-utils";

export const LIVE_NOTIFICATION_DISTANCE_STEP_METERS = 250;
export const LIVE_NOTIFICATION_TIME_STEP_SECONDS = 60;

export type RunNotificationMetrics = {
  distanceMeters: number;
  durationSeconds: number;
  averagePacePerKm: number;
  completedLaps: number;
  currentLapNumber: number;
};

type RunNotificationEvent =
  | {
      kind: "started" | "live" | "paused" | "resumed" | "finished";
      trackName: string;
      metrics: RunNotificationMetrics;
    }
  | {
      kind: "checkpoint";
      checkpointName: string;
      lapNumber: number;
      metrics: RunNotificationMetrics;
    }
  | {
      kind: "lap";
      completedLap: number;
      metrics: RunNotificationMetrics;
    }
  | {
      kind: "warning" | "off-route";
      title: string;
      message: string;
      distanceMeters?: number;
    };

export type RunNotificationPayload = {
  title: string;
  body: string;
  tag: string;
  silent: boolean;
  renotify: boolean;
  requireInteraction: boolean;
};

const buildMetricSummary = (
  metrics: RunNotificationMetrics,
  lapLabel = `Lap ${Math.max(1, metrics.currentLapNumber)}`
): string => {
  const pieces = [
    lapLabel,
    formatDistance(Math.max(0, metrics.distanceMeters)),
    formatDuration(Math.max(0, metrics.durationSeconds)),
  ];
  const pace = formatPace(metrics.averagePacePerKm);
  if (pace !== "--") {
    pieces.push(`Pace ${pace}`);
  }
  return pieces.join(" • ");
};

export const buildRunNotificationPayload = (
  event: RunNotificationEvent
): RunNotificationPayload => {
  switch (event.kind) {
    case "started":
      return {
        title: "Sesi lari dimulai",
        body: `${event.trackName} • ${buildMetricSummary(event.metrics)}`,
        tag: "joging-track-live",
        silent: true,
        renotify: false,
        requireInteraction: true,
      };
    case "live":
      return {
        title: `Lari aktif • Lap ${Math.max(1, event.metrics.currentLapNumber)}`,
        body: buildMetricSummary(event.metrics),
        tag: "joging-track-live",
        silent: true,
        renotify: false,
        requireInteraction: true,
      };
    case "paused":
      return {
        title: "Sesi lari dijeda",
        body: `${buildMetricSummary(event.metrics)} • Tracking sementara berhenti`,
        tag: "joging-track-live",
        silent: false,
        renotify: true,
        requireInteraction: true,
      };
    case "resumed":
      return {
        title: "Sesi lari dilanjutkan",
        body: `${buildMetricSummary(event.metrics)} • Tracking aktif kembali`,
        tag: "joging-track-live",
        silent: false,
        renotify: true,
        requireInteraction: true,
      };
    case "finished": {
      const lapLabel =
        event.metrics.completedLaps > 0
          ? `${event.metrics.completedLaps} lap selesai`
          : "Sesi selesai";
      return {
        title: "Sesi lari selesai",
        body: `${event.trackName} • ${buildMetricSummary(event.metrics, lapLabel)}`,
        tag: "joging-track-finished",
        silent: false,
        renotify: true,
        requireInteraction: false,
      };
    }
    case "checkpoint":
      return {
        title: `${event.checkpointName} dilewati`,
        body: buildMetricSummary(event.metrics, `Lap ${Math.max(1, event.lapNumber)}`),
        tag: "joging-track-route-event",
        silent: false,
        renotify: true,
        requireInteraction: false,
      };
    case "lap":
      return {
        title: `Lap ${Math.max(1, event.completedLap)} selesai`,
        body: `${buildMetricSummary(
          event.metrics,
          `${Math.max(1, event.completedLap)} lap selesai`
        )} • Tracking tetap berjalan`,
        tag: "joging-track-route-event",
        silent: false,
        renotify: true,
        requireInteraction: false,
      };
    case "warning":
    case "off-route": {
      const distance =
        typeof event.distanceMeters === "number" &&
        Number.isFinite(event.distanceMeters)
          ? ` • Jarak ${formatDistance(Math.max(0, event.distanceMeters))}`
          : "";
      return {
        title:
          event.kind === "off-route"
            ? "Keluar dari lintasan"
            : `Peringatan: ${event.title}`,
        body: `${event.message}${distance}`,
        tag: "joging-track-safety",
        silent: false,
        renotify: true,
        requireInteraction: true,
      };
    }
  }
};

export const buildLiveNotificationUpdateKey = (
  distanceMeters: number,
  durationSeconds: number
): string => {
  const distanceBucket = Math.floor(
    Math.max(0, distanceMeters) / LIVE_NOTIFICATION_DISTANCE_STEP_METERS
  );
  const timeBucket = Math.floor(
    Math.max(0, durationSeconds) / LIVE_NOTIFICATION_TIME_STEP_SECONDS
  );
  return `${distanceBucket}:${timeBucket}`;
};

type CrossedCheckpointOptions = {
  previousProgressMeters: number;
  currentProgressMeters: number;
  lapDistanceMeters: number;
  isLoop: boolean;
  cumulativeDistances: number[];
  checkpoints: Array<Pick<TrackCheckpoint, "id" | "name" | "routeIndex">>;
};

export type CrossedCheckpoint = {
  checkpoint: Pick<TrackCheckpoint, "id" | "name" | "routeIndex">;
  lapNumber: number;
};

export const findLatestCrossedCheckpoint = ({
  previousProgressMeters,
  currentProgressMeters,
  lapDistanceMeters,
  isLoop,
  cumulativeDistances,
  checkpoints,
}: CrossedCheckpointOptions): CrossedCheckpoint | null => {
  const previous = Math.max(0, previousProgressMeters);
  const current = Math.max(0, currentProgressMeters);
  if (
    current <= previous ||
    !Number.isFinite(lapDistanceMeters) ||
    lapDistanceMeters <= 0
  ) {
    return null;
  }

  const firstLapIndex = isLoop
    ? Math.max(0, Math.floor(previous / lapDistanceMeters))
    : 0;
  const lastLapIndex = isLoop
    ? Math.max(0, Math.floor(current / lapDistanceMeters))
    : 0;

  let latest:
    | (CrossedCheckpoint & { absoluteProgressMeters: number })
    | null = null;

  for (let lapIndex = firstLapIndex; lapIndex <= lastLapIndex; lapIndex += 1) {
    for (const checkpoint of checkpoints) {
      if (checkpoint.routeIndex <= 0) {
        continue;
      }

      const checkpointProgress =
        cumulativeDistances[checkpoint.routeIndex];
      if (
        typeof checkpointProgress !== "number" ||
        !Number.isFinite(checkpointProgress)
      ) {
        continue;
      }

      const absoluteProgressMeters =
        (isLoop ? lapIndex * lapDistanceMeters : 0) +
        Math.max(0, checkpointProgress);
      const wasCrossed =
        absoluteProgressMeters > previous + 0.01 &&
        absoluteProgressMeters <= current + 0.01;

      if (
        wasCrossed &&
        (!latest ||
          absoluteProgressMeters > latest.absoluteProgressMeters)
      ) {
        latest = {
          checkpoint,
          lapNumber: lapIndex + 1,
          absoluteProgressMeters,
        };
      }
    }
  }

  if (!latest) {
    return null;
  }

  return {
    checkpoint: latest.checkpoint,
    lapNumber: latest.lapNumber,
  };
};
