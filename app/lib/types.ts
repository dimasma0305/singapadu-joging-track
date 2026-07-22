export type TrackingStatus = "idle" | "running" | "paused" | "finished";

export type GeoPoint = {
  lat: number;
  lng: number;
};

export type TrackWaypoint = GeoPoint;

export type TrackCheckpoint = GeoPoint & {
  id: string;
  name: string;
  routeIndex: number;
  streetView: boolean;
};

export type WarningAreaType = "info" | "warning" | "critical";

export type WarningArea = {
  id: string;
  name: string;
  type: WarningAreaType;
  center: GeoPoint;
  radiusMeters: number;
  triggerDistanceMeters: number;
  message: string;
  cooldownSeconds: number;
  showOnce: boolean;
  active: boolean;
};

export type Track = {
  id: string;
  name: string;
  distanceMeters?: number;
  waypoints: TrackWaypoint[];
  checkpoints: TrackCheckpoint[];
  warningAreas: WarningArea[];
  startAt: GeoPoint;
  endAt: GeoPoint;
  startRadiusMeters?: number;
  endFinishRadiusMeters?: number;
  offRouteThresholdMeters?: number;
};

export type SessionSample = GeoPoint & {
  accuracy?: number | null;
  routeProgressMeters?: number;
  timestamp: number;
};

export type RunSession = {
  sessionId: string;
  trackId: string;
  status: TrackingStatus;
  startedAt: number | null;
  endedAt: number | null;
  pausedAt: number | null;
  totalPausedMilliseconds: number;
  distanceMeters: number;
  durationSeconds: number;
  averagePacePerKm: number;
  maxPacePerKm: number;
  closestIndex: number;
  routeProgressMeters: number;
  samples: SessionSample[];
  persisted: boolean;
};

export type WarningEvent = {
  areaId: string;
  areaName: string;
  message: string;
  type: WarningAreaType;
  distanceMeters: number;
  timestamp: number;
};
