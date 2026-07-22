import type { GeoPoint, TrackWaypoint, Track, WarningAreaType } from "./types";

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const haversineMeters = (a: GeoPoint, b: GeoPoint): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);

  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

export const cumulativeDistanceFromWaypoints = (
  waypoints: TrackWaypoint[]
): number[] => {
  if (waypoints.length === 0) {
    return [0];
  }

  const distances: number[] = [0];
  for (let i = 1; i < waypoints.length; i += 1) {
    const add = haversineMeters(waypoints[i - 1], waypoints[i]);
    distances.push(distances[distances.length - 1] + add);
  }
  return distances;
};

export type SegmentProjection = {
  fraction: number;
  distanceMeters: number;
};

export const projectPointToSegmentMeters = (
  point: GeoPoint,
  start: GeoPoint,
  end: GeoPoint
): SegmentProjection => {
  const referenceLatitude = toRadians((point.lat + start.lat + end.lat) / 3);
  const longitudeScale = Math.cos(referenceLatitude);
  const pointX = toRadians(point.lng - start.lng) * EARTH_RADIUS_METERS * longitudeScale;
  const pointY = toRadians(point.lat - start.lat) * EARTH_RADIUS_METERS;
  const segmentX = toRadians(end.lng - start.lng) * EARTH_RADIUS_METERS * longitudeScale;
  const segmentY = toRadians(end.lat - start.lat) * EARTH_RADIUS_METERS;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSquared <= Number.EPSILON) {
    return {
      fraction: 0,
      distanceMeters: Math.hypot(pointX, pointY),
    };
  }

  const rawFraction = (pointX * segmentX + pointY * segmentY) / segmentLengthSquared;
  const fraction = Math.min(1, Math.max(0, rawFraction));
  const projectedX = segmentX * fraction;
  const projectedY = segmentY * fraction;

  return {
    fraction,
    distanceMeters: Math.hypot(pointX - projectedX, pointY - projectedY),
  };
};

export const resolveProgressSampleJumpLimitMeters = (
  elapsedMilliseconds: number,
  combinedAccuracyMeters = 0
): number => {
  const elapsedSeconds = Math.max(0, elapsedMilliseconds) / 1000;
  const accuracyAllowance = Math.min(50, Math.max(0, combinedAccuracyMeters));
  const plausibleDistance = elapsedSeconds * 7 + accuracyAllowance;
  return Math.min(1000, Math.max(80, plausibleDistance));
};

export const resolveConfirmedOffRouteDistanceMeters = (
  distanceFromRouteMeters: number,
  accuracyMeters = 0
): number => {
  if (!Number.isFinite(distanceFromRouteMeters)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, distanceFromRouteMeters - Math.max(0, accuracyMeters));
};

type SequentialRouteProgressOptions = {
  point: GeoPoint;
  previousPoint?: GeoPoint | null;
  waypoints: TrackWaypoint[];
  cumulativeDistances: number[];
  currentWaypointIndex: number;
  currentProgressMeters: number;
  reachRadiusMeters: number;
  routeCorridorMeters: number;
  maxSampleJumpMeters?: number;
};

export const advanceSequentialRouteProgress = ({
  point,
  previousPoint,
  waypoints,
  cumulativeDistances,
  currentWaypointIndex,
  currentProgressMeters,
  reachRadiusMeters,
  routeCorridorMeters,
  maxSampleJumpMeters = 80,
}: SequentialRouteProgressOptions): {
  waypointIndex: number;
  routeProgressMeters: number;
  offRouteDistanceMeters: number;
} => {
  if (waypoints.length === 0) {
    return {
      waypointIndex: 0,
      routeProgressMeters: 0,
      offRouteDistanceMeters: Number.POSITIVE_INFINITY,
    };
  }

  const lastIndex = waypoints.length - 1;
  let waypointIndex = Math.min(Math.max(0, currentWaypointIndex), lastIndex);
  const sampleJumpMeters = previousPoint
    ? haversineMeters(previousPoint, point)
    : Number.POSITIVE_INFINITY;
  const canUseMovementSegment = Boolean(
    previousPoint && sampleJumpMeters > 0 && sampleJumpMeters <= maxSampleJumpMeters
  );

  while (waypointIndex < lastIndex) {
    const nextWaypoint = waypoints[waypointIndex + 1];
    const directDistance = haversineMeters(point, nextWaypoint);
    const crossedDistance = canUseMovementSegment && previousPoint
      ? projectPointToSegmentMeters(nextWaypoint, previousPoint, point).distanceMeters
      : Number.POSITIVE_INFINITY;

    if (directDistance > reachRadiusMeters && crossedDistance > reachRadiusMeters) {
      break;
    }

    waypointIndex += 1;
  }

  const totalDistance = cumulativeDistances[lastIndex] ?? 0;
  if (canUseMovementSegment && waypointIndex < lastIndex) {
    let furthestSegmentIndex = waypointIndex;
    let furthestProgressMeters = Math.max(0, currentProgressMeters);

    for (let segmentIndex = waypointIndex; segmentIndex < lastIndex; segmentIndex += 1) {
      const segmentStartDistance = cumulativeDistances[segmentIndex] ?? 0;
      if (segmentStartDistance - currentProgressMeters > maxSampleJumpMeters + reachRadiusMeters) {
        break;
      }

      const segmentEndDistance = cumulativeDistances[segmentIndex + 1] ?? segmentStartDistance;
      const projection = projectPointToSegmentMeters(
        point,
        waypoints[segmentIndex],
        waypoints[segmentIndex + 1]
      );
      const candidateProgressMeters =
        segmentStartDistance + (segmentEndDistance - segmentStartDistance) * projection.fraction;
      const forwardDeltaMeters = candidateProgressMeters - currentProgressMeters;
      const isPlausibleCatchUp =
        projection.distanceMeters <= routeCorridorMeters &&
        forwardDeltaMeters >= 0 &&
        forwardDeltaMeters <= maxSampleJumpMeters + reachRadiusMeters;

      if (isPlausibleCatchUp && candidateProgressMeters > furthestProgressMeters) {
        furthestSegmentIndex = segmentIndex;
        furthestProgressMeters = candidateProgressMeters;
      }
    }

    waypointIndex = furthestSegmentIndex;
  }

  if (waypointIndex >= lastIndex) {
    return {
      waypointIndex: lastIndex,
      routeProgressMeters: totalDistance,
      offRouteDistanceMeters: haversineMeters(point, waypoints[lastIndex]),
    };
  }

  const segmentStartDistance = cumulativeDistances[waypointIndex] ?? 0;
  const segmentEndDistance = cumulativeDistances[waypointIndex + 1] ?? segmentStartDistance;
  const projection = projectPointToSegmentMeters(
    point,
    waypoints[waypointIndex],
    waypoints[waypointIndex + 1]
  );
  const projectedDistance = projection.distanceMeters <= routeCorridorMeters
    ? segmentStartDistance + (segmentEndDistance - segmentStartDistance) * projection.fraction
    : segmentStartDistance;

  return {
    waypointIndex,
    routeProgressMeters: Math.min(
      totalDistance,
      Math.max(0, currentProgressMeters, projectedDistance)
    ),
    offRouteDistanceMeters: projection.distanceMeters,
  };
};

type RouteProgressPaceSample = {
  timestamp: number;
  routeProgressMeters?: number;
};

export const calculateRollingPacePerKm = (
  samples: RouteProgressPaceSample[],
  windowMs = 30_000
): number => {
  const validSamples = samples.filter(
    (sample): sample is RouteProgressPaceSample & { routeProgressMeters: number } =>
      Number.isFinite(sample.timestamp) &&
      typeof sample.routeProgressMeters === "number" &&
      Number.isFinite(sample.routeProgressMeters) &&
      sample.routeProgressMeters >= 0
  );

  if (validSamples.length < 2) {
    return 0;
  }

  const latest = validSamples[validSamples.length - 1];
  const cutoffTimestamp = latest.timestamp - Math.max(5_000, windowMs);
  let anchor = validSamples[0];

  for (let index = 0; index < validSamples.length - 1; index += 1) {
    const candidate = validSamples[index];
    if (candidate.timestamp <= cutoffTimestamp) {
      anchor = candidate;
      continue;
    }
    break;
  }

  const elapsedSeconds = (latest.timestamp - anchor.timestamp) / 1000;
  const forwardDistanceMeters = latest.routeProgressMeters - anchor.routeProgressMeters;

  if (elapsedSeconds < 5 || forwardDistanceMeters < 8) {
    return 0;
  }

  const pacePerKm = elapsedSeconds / 60 / (forwardDistanceMeters / 1000);
  if (!Number.isFinite(pacePerKm) || pacePerKm < 2.5 || pacePerKm > 30) {
    return 0;
  }

  return Number(pacePerKm.toFixed(2));
};

type ActiveDurationOptions = {
  startedAt: number | null;
  currentTimestamp: number;
  totalPausedMilliseconds?: number;
  pausedAt?: number | null;
};

export const calculateActiveDurationSeconds = ({
  startedAt,
  currentTimestamp,
  totalPausedMilliseconds = 0,
  pausedAt = null,
}: ActiveDurationOptions): number => {
  if (!startedAt || currentTimestamp <= startedAt) {
    return 0;
  }

  const currentPauseMilliseconds = pausedAt
    ? Math.max(0, currentTimestamp - pausedAt)
    : 0;
  const activeMilliseconds =
    currentTimestamp -
    startedAt -
    Math.max(0, totalPausedMilliseconds) -
    currentPauseMilliseconds;

  return Math.max(0, Math.floor(activeMilliseconds / 1000));
};

export const createGoogleStreetViewUrl = (point: GeoPoint): string => {
  const viewpoint = encodeURIComponent(`${point.lat},${point.lng}`);
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${viewpoint}`;
};

export const resolveTrackDistance = (track: Track): number => {
  if (track.distanceMeters && track.distanceMeters > 0) {
    return track.distanceMeters;
  }

  const cum = cumulativeDistanceFromWaypoints(track.waypoints);
  return cum[cum.length - 1] ?? 0;
};

export const findClosestWaypointIndex = (
  point: GeoPoint,
  waypoints: TrackWaypoint[]
): number => {
  if (waypoints.length === 0) {
    return 0;
  }

  let index = 0;
  let minDistance = haversineMeters(point, waypoints[0]);

  for (let i = 1; i < waypoints.length; i += 1) {
    const distance = haversineMeters(point, waypoints[i]);
    if (distance < minDistance) {
      minDistance = distance;
      index = i;
    }
  }

  return index;
};

export const formatDistance = (meters: number): string => {
  if (!Number.isFinite(meters) || meters < 0) {
    return "0 m";
  }

  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }

  return `${Math.round(meters)} m`;
};

export const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00:00";
  }

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

export const formatPace = (pace: number): string => {
  if (!Number.isFinite(pace) || pace <= 0) {
    return "--";
  }
  const minutes = Math.floor(pace);
  const seconds = Math.round((pace - minutes) * 60);
  return `${minutes}:${String(seconds).padStart(2, "0")} /km`;
};

export const createSessionId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const WARNING_SOUND_CONFIG: Record<WarningAreaType, { path: string; volume: number }> = {
  info: { path: "/sounds/info.mp3", volume: 0.45 },
  warning: { path: "/sounds/warning.mp3", volume: 0.6 },
  critical: { path: "/sounds/critical.mp3", volume: 0.72 },
};
const warningAudioCache = new Map<WarningAreaType, HTMLAudioElement>();

const getWarningAudio = (type: WarningAreaType): HTMLAudioElement | null => {
  if (typeof window === "undefined" || typeof Audio === "undefined") {
    return null;
  }

  const cached = warningAudioCache.get(type);
  if (cached) {
    return cached;
  }

  const config = WARNING_SOUND_CONFIG[type];
  const audio = new Audio(`${PUBLIC_BASE_PATH}${config.path}`);
  audio.preload = "auto";
  audio.volume = config.volume;
  warningAudioCache.set(type, audio);
  return audio;
};

export const prepareWarningSounds = () => {
  (["info", "warning", "critical"] as WarningAreaType[]).forEach((type) => {
    getWarningAudio(type)?.load();
  });
};

export const playWarningSound = (type: WarningAreaType) => {
  const audio = getWarningAudio(type);
  if (!audio) {
    return;
  }

  try {
    audio.pause();
    audio.currentTime = 0;
    void audio.play().catch((error) => {
      console.warn("Notification audio was blocked by the browser:", error);
    });
  } catch (error) {
    console.warn("Notification audio failed to play:", error);
  }
};

export const triggerVibrate = (type: WarningAreaType | "success") => {
  if (typeof window !== "undefined" && navigator.vibrate) {
    try {
      if (type === "info") {
        navigator.vibrate(60);
      } else if (type === "warning") {
        navigator.vibrate([120, 80, 120]);
      } else if (type === "critical") {
        navigator.vibrate([250, 100, 250, 100, 400]);
      } else if (type === "success") {
        navigator.vibrate([60, 50, 120]);
      }
    } catch (e) {
      console.warn("Vibration API failed:", e);
    }
  }
};
