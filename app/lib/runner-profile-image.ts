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
  bronze: { accent: "#f59e0b", soft: "#2c2118" },
  silver: { accent: "#e2e8f0", soft: "#222833" },
  gold: { accent: "#fde047", soft: "#302c16" },
  platinum: { accent: "#a5f3fc", soft: "#17303a" },
  special: { accent: "#86efac", soft: "#173326" },
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
}: RunnerProfileImageInput): string => {
  const runnerName = normalizeRunnerName(payload.runnerName) || "Pelari Singapadu";
  const achievements = getUnlockedAchievements(payload);
  const latestRunDate = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(payload.latestRunAt));
  const badgeWidth = 448;
  const badgeHeight = 82;
  const badgeGapX = 22;
  const badgeGapY = 16;
  const badgeStartX = 72;
  const badgeStartY = 812;

  const badgeMarkup = achievements
    .map((achievement, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = badgeStartX + column * (badgeWidth + badgeGapX);
      const y = badgeStartY + row * (badgeHeight + badgeGapY);
      const color = TIER_COLORS[achievement.tier];
      return `
        <g>
          <rect x="${x}" y="${y}" width="${badgeWidth}" height="${badgeHeight}" rx="20" fill="${color.soft}" stroke="${color.accent}" stroke-opacity="0.45"/>
          <circle cx="${x + 43}" cy="${y + 41}" r="28" fill="#090d15" stroke="${color.accent}" stroke-opacity="0.55"/>
          ${renderBadgeIcon(achievement.icon, x + 43, y + 41, color.accent)}
          <text x="${x + 84}" y="${y + 35}" class="badge-title">${escapeXml(truncate(achievement.title, 25))}</text>
          <text x="${x + 84}" y="${y + 58}" class="badge-tier" fill="${color.accent}">${TIER_LABELS[achievement.tier]}</text>
        </g>
      `;
    })
    .join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${ARTWORK_WIDTH}" height="${ARTWORK_HEIGHT}" viewBox="0 0 ${ARTWORK_WIDTH} ${ARTWORK_HEIGHT}">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1a1e27"/>
          <stop offset="0.55" stop-color="#090c12"/>
          <stop offset="1" stop-color="#111620"/>
        </linearGradient>
        <radialGradient id="orangeGlow" cx="1" cy="0" r="1">
          <stop offset="0" stop-color="#ff5a1f" stop-opacity="0.3"/>
          <stop offset="0.7" stop-color="#ff5a1f" stop-opacity="0"/>
        </radialGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="18" stdDeviation="25" flood-color="#000" flood-opacity="0.34"/>
        </filter>
        <style>
          text { font-family: Arial, Helvetica, sans-serif; }
          .eyebrow { fill: #ffad8d; font-size: 22px; font-weight: 700; letter-spacing: 4px; }
          .profile-name { fill: #fff; font-size: 48px; font-weight: 800; }
          .profile-track { fill: #cbd5e1; font-size: 25px; }
          .distance { fill: #fff; font-size: 116px; font-weight: 800; letter-spacing: -6px; }
          .distance-label { fill: #ffad8d; font-size: 23px; font-weight: 800; letter-spacing: 3px; }
          .stat-value { fill: #fff; font-size: 32px; font-weight: 800; }
          .stat-label { fill: #94a3b8; font-size: 17px; font-weight: 700; letter-spacing: 1px; }
          .section-title { fill: #fff; font-size: 27px; font-weight: 800; letter-spacing: 2px; }
          .section-count { fill: #ffad8d; font-size: 21px; font-weight: 700; }
          .badge-title { fill: #f8fafc; font-size: 21px; font-weight: 700; }
          .badge-tier { font-size: 15px; font-weight: 800; letter-spacing: 2px; }
          .footer { fill: #94a3b8; font-size: 18px; }
          .footer-brand { fill: #ffad8d; font-size: 18px; font-weight: 800; letter-spacing: 1px; }
        </style>
      </defs>

      <rect width="${ARTWORK_WIDTH}" height="${ARTWORK_HEIGHT}" fill="url(#background)"/>
      <rect width="${ARTWORK_WIDTH}" height="${ARTWORK_HEIGHT}" fill="url(#orangeGlow)"/>
      <rect x="0" y="0" width="12" height="${ARTWORK_HEIGHT}" fill="#ff5a1f"/>

      <g filter="url(#shadow)">
        <circle cx="130" cy="137" r="58" fill="#ff5a1f"/>
        <text x="130" y="154" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="43" font-weight="800">${escapeXml(getRunnerInitials(runnerName))}</text>
      </g>
      <text x="218" y="105" class="eyebrow">SINGAPADU RUNNER PROFILE</text>
      <text x="218" y="157" class="profile-name">${escapeXml(truncate(runnerName, 30))}</text>
      <text x="218" y="194" class="profile-track">${escapeXml(truncate(trackName, 48))}</text>

      <line x1="72" y1="245" x2="1008" y2="245" stroke="#fff" stroke-opacity="0.1"/>

      <text x="72" y="378" class="distance">${(payload.totalDistanceMeters / 1000).toFixed(2)}</text>
      <text x="76" y="425" class="distance-label">KILOMETER ALL-TIME</text>

      <rect x="72" y="474" width="936" height="230" rx="28" fill="#121720" stroke="#fff" stroke-opacity="0.1"/>
      <line x1="384" y1="502" x2="384" y2="676" stroke="#fff" stroke-opacity="0.08"/>
      <line x1="696" y1="502" x2="696" y2="676" stroke="#fff" stroke-opacity="0.08"/>
      <line x1="100" y1="588" x2="980" y2="588" stroke="#fff" stroke-opacity="0.08"/>

      <text x="112" y="548" class="stat-value">${payload.completedRuns}</text>
      <text x="112" y="575" class="stat-label">RUN SELESAI</text>
      <text x="424" y="548" class="stat-value">${formatDuration(payload.totalDurationSeconds)}</text>
      <text x="424" y="575" class="stat-label">WAKTU TOTAL</text>
      <text x="736" y="548" class="stat-value">${payload.averagePaceSecondsPerKm > 0 ? formatPace(payload.averagePaceSecondsPerKm / 60) : "--"}</text>
      <text x="736" y="575" class="stat-label">PACE RATA-RATA</text>

      <text x="112" y="650" class="stat-value">${payload.bestPaceSecondsPerKm > 0 ? formatPace(payload.bestPaceSecondsPerKm / 60) : "--"}</text>
      <text x="112" y="677" class="stat-label">MAX / BEST PACE</text>
      <text x="424" y="650" class="stat-value">${formatDistance(payload.longestRunMeters)}</text>
      <text x="424" y="677" class="stat-label">RUN TERJAUH</text>
      <text x="736" y="650" class="stat-value">${achievements.length}</text>
      <text x="736" y="677" class="stat-label">ACHIEVEMENT</text>

      <text x="72" y="766" class="section-title">TROPHY CASE</text>
      <text x="1008" y="766" text-anchor="end" class="section-count">${achievements.length} TERBUKA</text>
      ${badgeMarkup}

      <line x1="72" y1="1262" x2="1008" y2="1262" stroke="#fff" stroke-opacity="0.1"/>
      <text x="72" y="1308" class="footer">${escapeXml(latestRunDate)}</text>
      <text x="1008" y="1308" text-anchor="end" class="footer-brand">KKN PPM PNB · 2026</text>
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
