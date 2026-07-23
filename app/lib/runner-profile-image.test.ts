import { describe, expect, test } from "bun:test";
import { buildRunnerProfileSvg } from "./runner-profile-image";

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
    });

    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1350"');
    expect(svg).toContain("SINGAPADU RUNNER PROFILE");
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
    });

    expect(svg).toContain("&lt;Made &amp; Ayu&gt;");
    expect(svg).toContain("Rute &quot;Utama&quot; &amp; Desa");
    expect(svg).not.toContain("<Made & Ayu>");
  });
});
