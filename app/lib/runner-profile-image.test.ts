import { describe, expect, test } from "bun:test";
import {
  buildRunnerProfileRouteGeometry,
  buildRunnerProfileSvg,
} from "./runner-profile-image";

const routePoints = [
  { lat: -8.5797866, lng: 115.2606812 },
  { lat: -8.5850807, lng: 115.261076 },
  { lat: -8.5848937, lng: 115.2575094 },
  { lat: -8.5795874, lng: 115.2579657 },
  { lat: -8.5797866, lng: 115.2606812 },
];

describe("runner profile social artwork", () => {
  test("builds a 1080x1350 profile containing every unlocked achievement", () => {
    const svg = buildRunnerProfileSvg({
      payload: {
        runnerName: "Made Dimas",
        unlockedAchievementIds: [
          "first-run",
          "bronze-runner",
          "silver-runner",
          "gold-runner",
          "route-legend",
          "distance-10k",
          "distance-50k",
          "pace-six",
        ],
        completedRuns: 25,
        totalDistanceMeters: 58_500,
        totalDurationSeconds: 19_388,
        averagePaceSecondsPerKm: 331,
        bestPaceSecondsPerKm: 297,
        longestRunMeters: 2_580,
        latestRunAt: Date.UTC(2026, 6, 23),
      },
      trackName: "Singapadu Jogging Loop",
      profileUrl: "https://example.com/#p=profile",
      routePoints,
    });

    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1350"');
    expect(svg).toContain("Singapadu Jogging");
    expect(svg).toContain("Ringkasan lari");
    expect(svg).toContain('stroke="#fc5200"');
    expect(svg).toContain("58.50");
    expect(svg).toContain("Langkah Pertama");
    expect(svg).toContain("Legenda Rute");
    expect(svg).toContain("Speedster 6:00");
    expect(svg.match(/class="badge-title"/g)).toHaveLength(8);
  });

  test("escapes runner and track text before inserting it into SVG", () => {
    const svg = buildRunnerProfileSvg({
      payload: {
        runnerName: "<Made & Ayu>",
        unlockedAchievementIds: ["first-run"],
        completedRuns: 1,
        totalDistanceMeters: 2_000,
        totalDurationSeconds: 720,
        averagePaceSecondsPerKm: 360,
        bestPaceSecondsPerKm: 350,
        longestRunMeters: 2_000,
        latestRunAt: Date.UTC(2026, 6, 23),
      },
      trackName: 'Rute "Utama" & Desa',
      profileUrl: "https://example.com/#p=profile",
      routePoints,
    });

    expect(svg).toContain("&lt;Made &amp; Ayu&gt;");
    expect(svg).toContain("Rute &quot;Utama&quot; &amp; Desa");
    expect(svg).not.toContain("<Made & Ayu>");
  });

  test("normalizes the shared route into the requested map viewport", () => {
    const geometry = buildRunnerProfileRouteGeometry(
      routePoints,
      640,
      280,
      36
    );
    const coordinates = geometry.points.split(" ").map((value) =>
      value.split(",").map(Number)
    );

    expect(coordinates).toHaveLength(routePoints.length);
    expect(
      coordinates.every(
        ([x, y]) =>
          x >= 36 &&
          x <= 604 &&
          y >= 36 &&
          y <= 244
      )
    ).toBe(true);
    expect(geometry.start.x).toBeCloseTo(geometry.end.x, 5);
    expect(geometry.start.y).toBeCloseTo(geometry.end.y, 5);
  });
});
