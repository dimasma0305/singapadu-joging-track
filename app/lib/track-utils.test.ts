import { describe, expect, test } from "bun:test";
import {
  advanceContinuousRouteProgress,
  advanceSequentialRouteProgress,
  calculateActiveDurationSeconds,
  calculateRollingPacePerKm,
  createGoogleStreetViewUrl,
  cumulativeDistanceFromWaypoints,
  resolveConfirmedOffRouteDistanceMeters,
  resolveProgressSampleJumpLimitMeters,
} from "./track-utils";
import type { TrackWaypoint } from "./types";

type TrackGeoJson = {
  features: Array<{
    properties: {
      startRadiusMeters: number;
      endFinishRadiusMeters: number;
      checkpoints: Array<{
        id: string;
        name: string;
        lat: number;
        lng: number;
        routeIndex: number;
        streetView: boolean;
      }>;
    };
    geometry: {
      coordinates: Array<[number, number]>;
    };
  }>;
};

const trackPayload = await Bun.file(
  new URL("../../public/track.json", import.meta.url)
).json() as TrackGeoJson;
const waypoints: TrackWaypoint[] = trackPayload.features[0].geometry.coordinates.map(
  ([lng, lat]) => ({ lat, lng })
);
const cumulativeDistances = cumulativeDistanceFromWaypoints(waypoints);

const interpolate = (
  start: TrackWaypoint,
  end: TrackWaypoint,
  fraction: number
): TrackWaypoint => ({
  lat: start.lat + (end.lat - start.lat) * fraction,
  lng: start.lng + (end.lng - start.lng) * fraction,
});

const progressOptions = {
  waypoints,
  cumulativeDistances,
  reachRadiusMeters: 20,
  routeCorridorMeters: 20,
};

describe("sequential route progress", () => {
  test("does not add meters when moving backward or outside the route corridor", () => {
    const start = waypoints[0];
    const halfway = interpolate(waypoints[0], waypoints[1], 0.5);
    const quarter = interpolate(waypoints[0], waypoints[1], 0.25);
    const threeQuarters = interpolate(waypoints[0], waypoints[1], 0.75);

    const forward = advanceSequentialRouteProgress({
      ...progressOptions,
      point: halfway,
      previousPoint: start,
      currentWaypointIndex: 0,
      currentProgressMeters: 0,
    });
    const backward = advanceSequentialRouteProgress({
      ...progressOptions,
      point: quarter,
      previousPoint: halfway,
      currentWaypointIndex: forward.waypointIndex,
      currentProgressMeters: forward.routeProgressMeters,
    });
    const forwardAgain = advanceSequentialRouteProgress({
      ...progressOptions,
      point: threeQuarters,
      previousPoint: quarter,
      currentWaypointIndex: backward.waypointIndex,
      currentProgressMeters: backward.routeProgressMeters,
    });
    const offRoute = advanceSequentialRouteProgress({
      ...progressOptions,
      point: { lat: threeQuarters.lat + 0.001, lng: threeQuarters.lng },
      previousPoint: threeQuarters,
      currentWaypointIndex: forwardAgain.waypointIndex,
      currentProgressMeters: forwardAgain.routeProgressMeters,
    });

    expect(backward.routeProgressMeters).toBeCloseTo(forward.routeProgressMeters, 5);
    expect(forwardAgain.routeProgressMeters).toBeGreaterThan(backward.routeProgressMeters);
    expect(offRoute.routeProgressMeters).toBeCloseTo(forwardAgain.routeProgressMeters, 5);
  });

  test("cannot complete a loop by jumping directly from start to finish", () => {
    const result = advanceSequentialRouteProgress({
      ...progressOptions,
      point: waypoints[waypoints.length - 1],
      previousPoint: waypoints[0],
      currentWaypointIndex: 0,
      currentProgressMeters: 0,
    });

    expect(result.waypointIndex).toBe(0);
    expect(result.routeProgressMeters).toBe(0);
  });

  test("catches up to the correct segment after a plausible background GPS gap", () => {
    const afterFirstWaypoint = interpolate(waypoints[1], waypoints[2], 0.2);
    const maxSampleJumpMeters = resolveProgressSampleJumpLimitMeters(45_000, 12);
    const result = advanceSequentialRouteProgress({
      ...progressOptions,
      point: afterFirstWaypoint,
      previousPoint: waypoints[0],
      currentWaypointIndex: 0,
      currentProgressMeters: 0,
      maxSampleJumpMeters,
    });

    expect(maxSampleJumpMeters).toBeGreaterThan(80);
    expect(result.waypointIndex).toBe(1);
    expect(result.routeProgressMeters).toBeGreaterThan(cumulativeDistances[1]);
  });

  test("accounts for GPS accuracy before confirming off-route distance", () => {
    expect(resolveConfirmedOffRouteDistanceMeters(42, 12)).toBe(30);
    expect(resolveConfirmedOffRouteDistanceMeters(10, 15)).toBe(0);
  });

  test("continues route-valid distance on the next lap of a loop", () => {
    let previous = waypoints[0];
    let waypointIndex = 0;
    let routeProgressMeters = 0;

    for (const point of waypoints.slice(1)) {
      const result = advanceContinuousRouteProgress({
        ...progressOptions,
        point,
        previousPoint: previous,
        currentWaypointIndex: waypointIndex,
        currentTotalProgressMeters: routeProgressMeters,
        isLoop: true,
        maxSampleJumpMeters: 400,
      });
      previous = point;
      waypointIndex = result.waypointIndex;
      routeProgressMeters = result.routeProgressMeters;
    }

    expect(routeProgressMeters).toBeCloseTo(cumulativeDistances.at(-1) ?? 0, 5);
    expect(waypointIndex).toBe(0);

    const nextLapPoint = interpolate(waypoints[0], waypoints[1], 0.5);
    const nextLap = advanceContinuousRouteProgress({
      ...progressOptions,
      point: nextLapPoint,
      previousPoint: waypoints[0],
      currentWaypointIndex: waypointIndex,
      currentTotalProgressMeters: routeProgressMeters,
      isLoop: true,
    });

    expect(nextLap.completedLaps).toBe(1);
    expect(nextLap.lapProgressMeters).toBeGreaterThan(0);
    expect(nextLap.routeProgressMeters).toBeGreaterThan(
      cumulativeDistances.at(-1) ?? 0
    );
  });

  test("accumulates three complete laps without resetting total progress", () => {
    const lapDistance = cumulativeDistances.at(-1) ?? 0;
    let previous = waypoints[0];
    let waypointIndex = 0;
    let routeProgressMeters = 0;
    let completedLaps = 0;

    for (let lap = 0; lap < 3; lap += 1) {
      for (const point of waypoints.slice(1)) {
        const result = advanceContinuousRouteProgress({
          ...progressOptions,
          point,
          previousPoint: previous,
          currentWaypointIndex: waypointIndex,
          currentTotalProgressMeters: routeProgressMeters,
          isLoop: true,
          maxSampleJumpMeters: 400,
        });
        previous = point;
        waypointIndex = result.waypointIndex;
        routeProgressMeters = result.routeProgressMeters;
        completedLaps = result.completedLaps;
      }
    }

    expect(completedLaps).toBe(3);
    expect(routeProgressMeters).toBeCloseTo(lapDistance * 3, 5);
    expect(waypointIndex).toBe(0);
  });

  test("does not add post-finish distance while outside the route corridor", () => {
    const lapDistance = cumulativeDistances.at(-1) ?? 0;
    const result = advanceContinuousRouteProgress({
      ...progressOptions,
      point: {
        lat: waypoints[0].lat + 0.001,
        lng: waypoints[0].lng + 0.001,
      },
      previousPoint: waypoints[0],
      currentWaypointIndex: 0,
      currentTotalProgressMeters: lapDistance,
      isLoop: true,
    });

    expect(result.routeProgressMeters).toBeCloseTo(lapDistance, 5);
    expect(result.lapProgressMeters).toBe(0);
  });
});

describe("rolling pace", () => {
  test("calculates pace from recent forward route progress", () => {
    const pace = calculateRollingPacePerKm([
      { timestamp: 0, routeProgressMeters: 0 },
      { timestamp: 15_000, routeProgressMeters: 25 },
      { timestamp: 30_000, routeProgressMeters: 50 },
    ]);

    expect(pace).toBe(10);
  });

  test("returns no pace while stationary or moving backward", () => {
    const pace = calculateRollingPacePerKm([
      { timestamp: 30_000, routeProgressMeters: 50 },
      { timestamp: 45_000, routeProgressMeters: 50 },
      { timestamp: 60_000, routeProgressMeters: 50 },
    ]);

    expect(pace).toBe(0);
  });

  test("rejects impossible GPS pace spikes", () => {
    const pace = calculateRollingPacePerKm([
      { timestamp: 0, routeProgressMeters: 0 },
      { timestamp: 5_000, routeProgressMeters: 1000 },
    ]);

    expect(pace).toBe(0);
  });
});

describe("pause and checkpoint integrations", () => {
  test("uses accessible 50 meter start and finish areas", () => {
    const properties = trackPayload.features[0].properties;
    expect(properties.startRadiusMeters).toBe(50);
    expect(properties.endFinishRadiusMeters).toBe(50);
  });

  test("excludes completed and active pause time from session duration", () => {
    expect(calculateActiveDurationSeconds({
      startedAt: 1_000,
      currentTimestamp: 121_000,
      totalPausedMilliseconds: 30_000,
    })).toBe(90);

    expect(calculateActiveDurationSeconds({
      startedAt: 1_000,
      currentTimestamp: 121_000,
      pausedAt: 91_000,
    })).toBe(90);
  });

  test("uses the requested CP1 to CP8 coordinates and Street View checkpoints", () => {
    const checkpoints = trackPayload.features[0].properties.checkpoints;
    expect(checkpoints.map((checkpoint) => checkpoint.name)).toEqual([
      "CP 1", "CP 2", "CP 3", "CP 4", "CP 5", "CP 6", "CP 7", "CP 8",
    ]);
    expect(
      checkpoints.filter((checkpoint) => checkpoint.streetView).map((checkpoint) => checkpoint.name)
    ).toEqual(["CP 3", "CP 5", "CP 8"]);
  });

  test("creates an official Google Maps Street View URL", () => {
    expect(createGoogleStreetViewUrl({ lat: -8.5850807, lng: 115.261076 })).toBe(
      "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=-8.5850807%2C115.261076"
    );
  });
});
