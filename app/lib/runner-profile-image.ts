import {
  ACHIEVEMENT_DEFINITIONS,
  normalizeRunnerName,
  type AchievementCollectionSharePayload,
  type AchievementDefinition,
  type AchievementIconName,
  type AchievementTier,
} from "./achievement-utils";
import { formatDistance, formatDuration, formatPace } from "./track-utils";

export type RunnerProfileImageInput = {
  payload: AchievementCollectionSharePayload;
  trackName: string;
  profileUrl: string;
  routePoints?: readonly RunnerProfileRoutePoint[];
};

export type RunnerProfileRoutePoint = {
  lat: number;
  lng: number;
};

export type RunnerProfileRouteGeometry = {
  points: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
};

export type RunnerProfileImageShareOutcome =
  | "shared"
  | "downloaded"
  | "cancelled"
  | "unavailable";

export type RunnerProfileImageShareResult = {
  outcome: RunnerProfileImageShareOutcome;
  fileName: string;
};

const ARTWORK_WIDTH = 1080;
const ARTWORK_HEIGHT = 1350;

const TIER_LABELS: Record<AchievementTier, string> = {
  bronze: "BRONZE",
  silver: "SILVER",
  gold: "GOLD",
  platinum: "PLATINUM",
  special: "SPECIAL",
};

const TIER_COLORS: Record<AchievementTier, { accent: string; soft: string }> = {
  bronze: { accent: "#a85d23", soft: "#fff2e5" },
  silver: { accent: "#667085", soft: "#f1f3f5" },
  gold: { accent: "#a86e00", soft: "#fff5cc" },
  platinum: { accent: "#027a8a", soft: "#e6f7fa" },
  special: { accent: "#18794e", soft: "#e9f8ef" },
};

const FALLBACK_ROUTE_POINTS: readonly RunnerProfileRoutePoint[] = [
  { lat: 0.12, lng: 0.18 },
  { lat: 0.06, lng: 0.42 },
  { lat: 0.18, lng: 0.7 },
  { lat: 0.42, lng: 0.78 },
  { lat: 0.7, lng: 0.62 },
  { lat: 0.82, lng: 0.34 },
  { lat: 0.58, lng: 0.12 },
  { lat: 0.28, lng: 0.2 },
  { lat: 0.12, lng: 0.18 },
];

export const buildRunnerProfileRouteGeometry = (
  routePoints: readonly RunnerProfileRoutePoint[],
  width: number,
  height: number,
  padding = 24
): RunnerProfileRouteGeometry => {
  const validPoints = routePoints.filter(
    (point) =>
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng)
  );
  const source =
    validPoints.length >= 2 ? validPoints : FALLBACK_ROUTE_POINTS;
  const meanLatitude =
    source.reduce((total, point) => total + point.lat, 0) /
    source.length;
  const longitudeScale = Math.max(
    0.1,
    Math.cos((meanLatitude * Math.PI) / 180)
  );
  const projected = source.map((point) => ({
    x: point.lng * longitudeScale,
    y: point.lat,
  }));
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const spanX = Math.max(maxX - minX, Number.EPSILON);
  const spanY = Math.max(maxY - minY, Number.EPSILON);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(
    availableWidth / spanX,
    availableHeight / spanY
  );
  const drawnWidth = spanX * scale;
  const drawnHeight = spanY * scale;
  const offsetX = padding + (availableWidth - drawnWidth) / 2;
  const offsetY = padding + (availableHeight - drawnHeight) / 2;
  const normalized = projected.map((point) => ({
    x: offsetX + (point.x - minX) * scale,
    y: offsetY + (maxY - point.y) * scale,
  }));
  const formatPoint = (point: { x: number; y: number }) =>
    `${point.x.toFixed(1)},${point.y.toFixed(1)}`;

  return {
    points: normalized.map(formatPoint).join(" "),
    start: normalized[0],
    end: normalized[normalized.length - 1],
  };
};

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const truncate = (value: string, maxLength: number): string => {
  const characters = Array.from(value);
  return characters.length <= maxLength
    ? value
    : `${characters.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
};

const getRunnerInitials = (runnerName: string): string => {
  const normalized = normalizeRunnerName(runnerName);
  if (!normalized) {
    return "RS";
  }
  const words = normalized.split(" ").filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
    .join("");
};

const slugify = (value: string): string => {
  const slug = normalizeRunnerName(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "runner";
};

const getUnlockedAchievements = (
  payload: AchievementCollectionSharePayload
): AchievementDefinition[] => {
  const unlockedIds = new Set(payload.unlockedAchievementIds);
  return ACHIEVEMENT_DEFINITIONS.filter((achievement) =>
    unlockedIds.has(achievement.id)
  );
};

const renderBadgeIcon = (
  icon: AchievementIconName,
  centerX: number,
  centerY: number,
  color: string
): string => {
  const stroke = `fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"`;

  if (icon === "medal") {
    return `
      <path d="M ${centerX - 12} ${centerY - 23} L ${centerX - 3} ${centerY - 5} L ${centerX + 4} ${centerY - 20}" ${stroke}/>
      <path d="M ${centerX + 12} ${centerY - 23} L ${centerX + 3} ${centerY - 5}" ${stroke}/>
      <circle cx="${centerX}" cy="${centerY + 9}" r="15" ${stroke}/>
      <path d="M ${centerX} ${centerY + 2} L ${centerX + 3} ${centerY + 8} L ${centerX + 10} ${centerY + 9} L ${centerX + 5} ${centerY + 14} L ${centerX + 6} ${centerY + 21} L ${centerX} ${centerY + 17} L ${centerX - 6} ${centerY + 21} L ${centerX - 5} ${centerY + 14} L ${centerX - 10} ${centerY + 9} L ${centerX - 3} ${centerY + 8} Z" fill="${color}"/>
    `;
  }

  if (icon === "trophy") {
    return `
      <path d="M ${centerX - 16} ${centerY - 20} H ${centerX + 16} V ${centerY - 8} C ${centerX + 16} ${centerY + 6}, ${centerX + 9} ${centerY + 13}, ${centerX} ${centerY + 13} C ${centerX - 9} ${centerY + 13}, ${centerX - 16} ${centerY + 6}, ${centerX - 16} ${centerY - 8} Z" ${stroke}/>
      <path d="M ${centerX - 17} ${centerY - 14} H ${centerX - 27} V ${centerY - 7} C ${centerX - 27} ${centerY + 1}, ${centerX - 22} ${centerY + 5}, ${centerX - 15} ${centerY + 5}" ${stroke}/>
      <path d="M ${centerX + 17} ${centerY - 14} H ${centerX + 27} V ${centerY - 7} C ${centerX + 27} ${centerY + 1}, ${centerX + 22} ${centerY + 5}, ${centerX + 15} ${centerY + 5}" ${stroke}/>
      <path d="M ${centerX} ${centerY + 14} V ${centerY + 23} M ${centerX - 13} ${centerY + 25} H ${centerX + 13}" ${stroke}/>
    `;
  }

  if (icon === "crown") {
    return `
      <path d="M ${centerX - 27} ${centerY - 12} L ${centerX - 15} ${centerY + 18} H ${centerX + 17} L ${centerX + 27} ${centerY - 12} L ${centerX + 10} ${centerY} L ${centerX} ${centerY - 19} L ${centerX - 10} ${centerY} Z" ${stroke}/>
      <path d="M ${centerX - 14} ${centerY + 26} H ${centerX + 16}" ${stroke}/>
    `;
  }

  if (icon === "route") {
    return `
      <circle cx="${centerX - 20}" cy="${centerY + 18}" r="6" ${stroke}/>
      <circle cx="${centerX + 21}" cy="${centerY - 18}" r="6" ${stroke}/>
      <path d="M ${centerX - 14} ${centerY + 16} C ${centerX + 12} ${centerY + 14}, ${centerX - 8} ${centerY - 11}, ${centerX + 15} ${centerY - 16}" ${stroke}/>
    `;
  }

  if (icon === "flame") {
    return `
      <path d="M ${centerX + 2} ${centerY - 27} C ${centerX + 9} ${centerY - 13}, ${centerX + 26} ${centerY - 5}, ${centerX + 18} ${centerY + 13} C ${centerX + 12} ${centerY + 29}, ${centerX - 14} ${centerY + 28}, ${centerX - 20} ${centerY + 11} C ${centerX - 24} ${centerY - 2}, ${centerX - 14} ${centerY - 12}, ${centerX - 5} ${centerY - 19} C ${centerX - 7} ${centerY - 7}, ${centerX - 2} ${centerY - 2}, ${centerX + 3} ${centerY + 3} C ${centerX + 10} ${centerY - 6}, ${centerX + 7} ${centerY - 16}, ${centerX + 2} ${centerY - 27} Z" ${stroke}/>
    `;
  }

  if (icon === "zap") {
    return `
      <path d="M ${centerX + 5} ${centerY - 29} L ${centerX - 21} ${centerY + 5} H ${centerX - 3} L ${centerX - 7} ${centerY + 29} L ${centerX + 22} ${centerY - 7} H ${centerX + 4} Z" ${stroke}/>
    `;
  }

  return `
    <path d="M ${centerX - 18} ${centerY + 17} C ${centerX - 25} ${centerY + 5}, ${centerX - 18} ${centerY - 4}, ${centerX - 8} ${centerY - 2} C ${centerX + 2} ${centerY}, ${centerX + 3} ${centerY + 13}, ${centerX - 2} ${centerY + 22}" ${stroke}/>
    <path d="M ${centerX + 7} ${centerY + 8} C ${centerX + 1} ${centerY - 5}, ${centerX + 8} ${centerY - 17}, ${centerX + 19} ${centerY - 14} C ${centerX + 29} ${centerY - 11}, ${centerX + 28} ${centerY + 3}, ${centerX + 20} ${centerY + 13}" ${stroke}/>
  `;
};

export const buildRunnerProfileSvg = ({
  payload,
  trackName,
  routePoints = [],
}: RunnerProfileImageInput): string => {
  const runnerName = normalizeRunnerName(payload.runnerName) || "Pelari Singapadu";
  const achievements = getUnlockedAchievements(payload);
  const latestRunDate = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(payload.latestRunAt));
  const routeGeometry = buildRunnerProfileRouteGeometry(
    routePoints,
    860,
    300,
    34
  );
  const endpointsOverlap =
    Math.hypot(
      routeGeometry.start.x - routeGeometry.end.x,
      routeGeometry.start.y - routeGeometry.end.y
    ) < 18;
  const badgeWidth = 222;
  const badgeHeight = 76;
  const badgeGapX = 12;
  const badgeGapY = 12;
  const badgeStartX = 72;
  const badgeStartY = 1074;

  const badgeMarkup = achievements
    .map((achievement, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const x = badgeStartX + column * (badgeWidth + badgeGapX);
      const y = badgeStartY + row * (badgeHeight + badgeGapY);
      const color = TIER_COLORS[achievement.tier];
      return `
        <g class="achievement-badge">
          <rect x="${x}" y="${y}" width="${badgeWidth}" height="${badgeHeight}" rx="16" fill="#fff" stroke="#deded9"/>
          <circle cx="${x + 35}" cy="${y + 38}" r="23" fill="${color.soft}"/>
          <g transform="translate(${x + 35} ${y + 38}) scale(0.68) translate(${-x - 35} ${-y - 38})">
            ${renderBadgeIcon(achievement.icon, x + 35, y + 38, color.accent)}
          </g>
          <text x="${x + 67}" y="${y + 34}" class="badge-title">${escapeXml(truncate(achievement.title, 18))}</text>
          <text x="${x + 67}" y="${y + 56}" class="badge-tier" fill="${color.accent}">${TIER_LABELS[achievement.tier]}</text>
        </g>
      `;
    })
    .join("");

  const routeMarkerMarkup = endpointsOverlap
    ? `
      <circle cx="${routeGeometry.end.x}" cy="${routeGeometry.end.y}" r="18" fill="#fff"/>
      <circle cx="${routeGeometry.end.x}" cy="${routeGeometry.end.y}" r="11" fill="#242428" stroke="#fc5200" stroke-width="5"/>
    `
    : `
      <circle cx="${routeGeometry.start.x}" cy="${routeGeometry.start.y}" r="15" fill="#fff"/>
      <circle cx="${routeGeometry.start.x}" cy="${routeGeometry.start.y}" r="9" fill="#2e8b57"/>
      <circle cx="${routeGeometry.end.x}" cy="${routeGeometry.end.y}" r="16" fill="#fff"/>
      <circle cx="${routeGeometry.end.x}" cy="${routeGeometry.end.y}" r="10" fill="#242428"/>
    `;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${ARTWORK_WIDTH}" height="${ARTWORK_HEIGHT}" viewBox="0 0 ${ARTWORK_WIDTH} ${ARTWORK_HEIGHT}">
      <defs>
        <pattern id="mapGrid" width="58" height="58" patternUnits="userSpaceOnUse">
          <path d="M 58 0 L 0 0 0 58" fill="none" stroke="#d9dcd7" stroke-width="2"/>
        </pattern>
        <clipPath id="mapClip">
          <rect x="48" y="200" width="984" height="405" rx="30"/>
        </clipPath>
        <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="18" stdDeviation="26" flood-color="#242428" flood-opacity="0.12"/>
        </filter>
        <filter id="routeShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#8f2f00" flood-opacity="0.26"/>
        </filter>
        <style>
          text { font-family: Arial, Helvetica, sans-serif; }
          .eyebrow { fill: #fc5200; font-size: 18px; font-weight: 800; letter-spacing: 3px; }
          .profile-name { fill: #242428; font-size: 43px; font-weight: 800; letter-spacing: -1px; }
          .profile-track { fill: #6d6d72; font-size: 22px; }
          .activity-pill { fill: #242428; font-size: 16px; font-weight: 800; letter-spacing: 1.5px; }
          .map-label { fill: #242428; font-size: 17px; font-weight: 800; letter-spacing: 1px; }
          .map-meta { fill: #6d6d72; font-size: 15px; font-weight: 700; letter-spacing: 1px; }
          .section-eyebrow { fill: #6d6d72; font-size: 16px; font-weight: 800; letter-spacing: 2px; }
          .primary-stat-value { fill: #242428; font-size: 56px; font-weight: 800; letter-spacing: -2px; }
          .primary-stat-label { fill: #6d6d72; font-size: 16px; font-weight: 800; letter-spacing: 1.5px; }
          .secondary-stat-value { fill: #242428; font-size: 27px; font-weight: 800; }
          .secondary-stat-label { fill: #77777c; font-size: 14px; font-weight: 700; letter-spacing: 1px; }
          .section-title { fill: #242428; font-size: 25px; font-weight: 800; letter-spacing: 1px; }
          .section-count { fill: #fc5200; font-size: 18px; font-weight: 800; }
          .badge-title { fill: #242428; font-size: 16px; font-weight: 800; }
          .badge-tier { font-size: 12px; font-weight: 800; letter-spacing: 1.5px; }
          .footer { fill: #747478; font-size: 17px; }
          .footer-brand { fill: #242428; font-size: 17px; font-weight: 800; letter-spacing: 0.8px; }
        </style>
      </defs>

      <rect width="${ARTWORK_WIDTH}" height="${ARTWORK_HEIGHT}" fill="#f3f3f0"/>
      <rect x="0" y="0" width="${ARTWORK_WIDTH}" height="12" fill="#fc5200"/>

      <circle cx="96" cy="100" r="35" fill="#fc5200"/>
      <text x="96" y="109" text-anchor="middle" fill="#fff" font-size="24" font-weight="800">${escapeXml(getRunnerInitials(runnerName))}</text>
      <text x="150" y="78" class="eyebrow">SINGAPADU JOGGING</text>
      <text x="150" y="124" class="profile-name">${escapeXml(truncate(runnerName, 28))}</text>
      <text x="150" y="158" class="profile-track">${escapeXml(truncate(trackName, 48))}</text>
      <rect x="800" y="66" width="208" height="42" rx="21" fill="#fff" stroke="#d8d8d4"/>
      <circle cx="827" cy="87" r="8" fill="#fc5200"/>
      <text x="847" y="93" class="activity-pill">RUN · ALL-TIME</text>

      <g clip-path="url(#mapClip)" filter="url(#cardShadow)">
        <rect x="48" y="200" width="984" height="405" fill="#e9ece7"/>
        <rect x="48" y="200" width="984" height="405" fill="url(#mapGrid)" opacity="0.78"/>
        <g transform="translate(48 200)" fill="none" stroke-linecap="round">
          <path d="M -30 128 C 210 48, 354 98, 548 12 S 880 24, 1040 146" stroke="#fff" stroke-width="24"/>
          <path d="M 92 -28 C 182 120, 170 250, 316 432" stroke="#f8f8f5" stroke-width="18"/>
          <path d="M 710 -30 C 630 120, 770 218, 672 454" stroke="#fff" stroke-width="20"/>
          <path d="M -20 326 C 204 278, 330 362, 520 292 S 820 246, 1040 350" stroke="#f8f8f5" stroke-width="16"/>
          <path d="M 406 -40 C 482 88, 416 190, 532 442" stroke="#d4d8d2" stroke-width="5" stroke-dasharray="12 14"/>
        </g>
        <g transform="translate(110 250)">
          <polyline points="${routeGeometry.points}" fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          <polyline points="${routeGeometry.points}" fill="none" stroke="#fc5200" stroke-width="15" stroke-linecap="round" stroke-linejoin="round" filter="url(#routeShadow)"/>
          ${routeMarkerMarkup}
        </g>
        <rect x="72" y="536" width="270" height="44" rx="22" fill="#fff" fill-opacity="0.94"/>
        <text x="94" y="563" class="map-label">SINGLE QR ROUTE</text>
        <text x="1008" y="563" text-anchor="end" class="map-meta">SINGAPADU TENGAH · BALI</text>
      </g>

      <g filter="url(#cardShadow)">
        <rect x="48" y="632" width="984" height="363" rx="30" fill="#fff"/>
      </g>
      <text x="80" y="682" class="section-eyebrow">ALL-TIME RUNNING STATS</text>

      <line x1="370" y1="714" x2="370" y2="835" stroke="#e5e5e2" stroke-width="2"/>
      <line x1="700" y1="714" x2="700" y2="835" stroke="#e5e5e2" stroke-width="2"/>
      <text x="80" y="778" class="primary-stat-value">${(payload.totalDistanceMeters / 1000).toFixed(2)}</text>
      <text x="80" y="816" class="primary-stat-label">DISTANCE · KM</text>
      <text x="410" y="778" class="primary-stat-value">${formatDuration(payload.totalDurationSeconds)}</text>
      <text x="410" y="816" class="primary-stat-label">MOVING TIME</text>
      <text x="740" y="778" class="primary-stat-value">${payload.averagePaceSecondsPerKm > 0 ? formatPace(payload.averagePaceSecondsPerKm / 60).replace(" /km", "") : "--"}</text>
      <text x="740" y="816" class="primary-stat-label">AVERAGE PACE · /KM</text>

      <line x1="80" y1="854" x2="1000" y2="854" stroke="#e5e5e2" stroke-width="2"/>
      <line x1="310" y1="878" x2="310" y2="960" stroke="#ececea" stroke-width="2"/>
      <line x1="540" y1="878" x2="540" y2="960" stroke="#ececea" stroke-width="2"/>
      <line x1="770" y1="878" x2="770" y2="960" stroke="#ececea" stroke-width="2"/>
      <text x="80" y="916" class="secondary-stat-value">${payload.completedRuns}</text>
      <text x="80" y="946" class="secondary-stat-label">RUNS</text>
      <text x="340" y="916" class="secondary-stat-value">${payload.bestPaceSecondsPerKm > 0 ? formatPace(payload.bestPaceSecondsPerKm / 60).replace(" /km", "") : "--"}</text>
      <text x="340" y="946" class="secondary-stat-label">BEST PACE · /KM</text>
      <text x="570" y="916" class="secondary-stat-value">${formatDistance(payload.longestRunMeters)}</text>
      <text x="570" y="946" class="secondary-stat-label">LONGEST RUN</text>
      <text x="800" y="916" class="secondary-stat-value">${achievements.length}</text>
      <text x="800" y="946" class="secondary-stat-label">ACHIEVEMENTS</text>

      <text x="72" y="1040" class="section-title">ACHIEVEMENTS</text>
      <text x="1008" y="1040" text-anchor="end" class="section-count">${achievements.length} UNLOCKED</text>
      ${badgeMarkup}

      <line x1="72" y1="1272" x2="1008" y2="1272" stroke="#d8d8d4" stroke-width="2"/>
      <text x="72" y="1315" class="footer">UPDATED ${escapeXml(latestRunDate.toUpperCase())}</text>
      <text x="1008" y="1315" text-anchor="end" class="footer-brand">KKN PPM PNB · SINGAPADU TENGAH · 2026</text>
    </svg>
  `.trim();
};

const loadSvgImage = (svg: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
    );
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(blobUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error("Artwork profil tidak dapat dirender."));
    };
    image.src = blobUrl;
  });

export const createRunnerProfilePng = async (
  input: RunnerProfileImageInput
): Promise<Blob> => {
  const image = await loadSvgImage(buildRunnerProfileSvg(input));
  const canvas = document.createElement("canvas");
  canvas.width = ARTWORK_WIDTH;
  canvas.height = ARTWORK_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Browser tidak mendukung generator PNG.");
  }
  context.drawImage(image, 0, 0, ARTWORK_WIDTH, ARTWORK_HEIGHT);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("PNG profil gagal dibuat."));
        }
      },
      "image/png",
      0.96
    );
  });
};

const downloadProfileImage = (blob: Blob, fileName: string): boolean => {
  if (typeof document === "undefined") {
    return false;
  }
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  return true;
};

export const shareRunnerProfilePng = async (
  input: RunnerProfileImageInput
): Promise<RunnerProfileImageShareResult> => {
  const runnerName =
    normalizeRunnerName(input.payload.runnerName) || "Pelari Singapadu";
  const fileName = `singapadu-profile-${slugify(runnerName)}.png`;
  const blob = await createRunnerProfilePng(input);
  const file = new File([blob], fileName, {
    type: "image/png",
    lastModified: Date.now(),
  });
  const shareData: ShareData = {
    title: `Profil Lari ${runnerName}`,
    text: `Lihat seluruh achievement dan statistik lari ${runnerName}: ${input.profileUrl}`,
    files: [file],
  };

  const canShareFile =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] }));

  if (canShareFile) {
    try {
      await navigator.share(shareData);
      return { outcome: "shared", fileName };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { outcome: "cancelled", fileName };
      }
    }
  }

  return {
    outcome: downloadProfileImage(blob, fileName) ? "downloaded" : "unavailable",
    fileName,
  };
};
