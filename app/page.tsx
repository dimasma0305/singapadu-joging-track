"use client";

import fallbackTrackPayload from "../public/track.json";

import dynamic from "next/dynamic";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type L from "leaflet";
import {
  Play,
  Pause,
  Flag,
  Locate,
  Map,
  Activity,
  AlertTriangle,
  History,
  Settings,
  Timer,
  Zap,
  Flame,
  Navigation,
  MapPin,
  Volume2,
  Trash2,
  Shield,
  Trophy,
  X,
  ChevronUp,
  ChevronDown,
  Sun,
  Moon,
  Loader2,
  Award,
  Medal,
  Footprints,
  Crown,
  Route,
  LockKeyhole,
  CheckCircle2,
  XCircle,
  CircleDashed,
  TestTube2,
  RotateCcw,
  Database,
  Link2,
  ImageDown,
  Bell,
  BellOff,
} from "lucide-react";
import type {
  RunSession,
  SessionSample,
  Track,
  TrackCheckpoint,
  TrackWaypoint,
  WarningArea,
  WarningEvent,
} from "./lib/types";
import {
  cumulativeDistanceFromWaypoints,
  advanceContinuousRouteProgress,
  calculateActiveDurationSeconds,
  calculateRollingPacePerKm,
  createSessionId,
  formatDistance,
  formatDuration,
  formatPace,
  haversineMeters,
  resolveTrackDistance,
  resolveConfirmedOffRouteDistanceMeters,
  resolveProgressSampleJumpLimitMeters,
  playWarningSound,
  prepareWarningSounds,
  triggerVibrate,
} from "./lib/track-utils";
import {
  addSessionToHistory,
  parseWarningHistory,
  readLocalStorageItem,
  removeLocalStorageItem,
  writeLocalStorageItem,
} from "./lib/storage-utils";
import {
  protectSessionHistory,
  restoreProtectedSessionHistory,
} from "./lib/session-history-integrity";
import {
  hardenInitialSession,
  hardenSessionHistory,
  hardenSessionTransition,
  type SessionTransitionOptions,
} from "./lib/session-state-integrity";
import {
  buildAchievementProgress,
  buildAchievementCollectionShareUrl,
  createAchievementCollectionSharePayload,
  decodeAchievementCollectionHash,
  normalizeRunnerName,
  shareAchievementCollectionLink,
  summarizeAchievements,
  type AchievementDefinition,
  type AchievementIconName,
  type AchievementProgress,
  type AchievementTier,
  type DecodedAchievementCollectionShare,
} from "./lib/achievement-utils";
import {
  buildRunnerProfileRouteGeometry,
  shareRunnerProfilePng,
} from "./lib/runner-profile-image";
import {
  completeSessionAtPosition,
  resolvePrimarySessionControl,
} from "./lib/session-control-utils";
import {
  buildFunctionalTestHistoryUpdate,
  createCompletedFunctionalTestSession,
} from "./lib/functional-test-utils";
import {
  buildLiveNotificationUpdateKey,
  buildRunNotificationPayload,
  findLatestCrossedCheckpoint,
  type RunNotificationMetrics,
  type RunNotificationPayload,
} from "./lib/notification-utils";

type GeolocationPermissionState = PermissionState | "unknown" | "unsupported";
type GpsHealthState = "unknown" | "checking" | "ready" | "permission-denied" | "timeout" | "provider-off" | "error";
type SystemNotificationPermission =
  | NotificationPermission
  | "checking"
  | "unsupported"
  | "error";
type ToastSeverity = WarningArea["type"] | "error";
type StartBlockReason = {
  title: string;
  message: string;
};
type ToastMessage = {
  id: string;
  title: string;
  message: string;
  severity: ToastSeverity;
  distanceMeters?: number;
  warningAreaId?: string;
  autoHideMs?: number;
};
type SheetTab = "metrics" | "warnings" | "history" | "settings";

type FunctionalTestId =
  | "track-config"
  | "map-render"
  | "local-storage"
  | "share-protocol"
  | "session-start"
  | "progress-metrics"
  | "pause-resume"
  | "warning-engine"
  | "multi-lap-loop"
  | "finish-flow"
  | "achievement-engine";
type FunctionalTestStatus = "pending" | "running" | "passed" | "failed" | "skipped";
type FunctionalTestRunState = "idle" | "running" | "passed" | "failed" | "cancelled";
type FunctionalTestResult = {
  id: FunctionalTestId;
  label: string;
  status: FunctionalTestStatus;
  message: string;
};

const FUNCTIONAL_TEST_CASES: ReadonlyArray<Pick<FunctionalTestResult, "id" | "label">> = [
  { id: "track-config", label: "Data rute & checkpoint" },
  { id: "map-render", label: "Render peta Leaflet" },
  { id: "local-storage", label: "Penyimpanan lokal" },
  { id: "share-protocol", label: "Protokol URL profil" },
  { id: "session-start", label: "Mulai sesi simulasi" },
  { id: "progress-metrics", label: "Progress, jarak & pace" },
  { id: "pause-resume", label: "Pause & resume" },
  { id: "warning-engine", label: "Geofence & warning toast" },
  { id: "multi-lap-loop", label: "Loop lebih dari satu lap" },
  { id: "finish-flow", label: "Selesai di posisi saat ini" },
  { id: "achievement-engine", label: "Achievement & statistik" },
];

const createFunctionalTestResults = (): FunctionalTestResult[] =>
  FUNCTIONAL_TEST_CASES.map((testCase) => ({
    ...testCase,
    status: "pending",
    message: "Menunggu pengujian.",
  }));

const TrackMapDynamic = dynamic(() => import("./components/TrackMap"), {
  ssr: false,
});

const TRACK_KEY = "joging-track:session-history";
const WARNING_LOG_KEY = "joging-track:warning-history";
const SYSTEM_NOTIFICATIONS_KEY = "joging-track:system-notifications";
const SYSTEM_NOTIFICATION_HINT_KEY = "joging-track:notification-hint-seen";
const SESSION_HISTORY_LIMIT = 25;
const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const TRACK_FILE = `${PUBLIC_BASE_PATH}/track.json`;
const SERVICE_WORKER_FILE = `${PUBLIC_BASE_PATH}/sw.js`;
const APP_ROOT_PATH = `${PUBLIC_BASE_PATH || ""}/`;
const NOTIFICATION_ICON_PATH = `${PUBLIC_BASE_PATH}/icons/icon-192.png`;
const NOTIFICATION_BADGE_PATH = `${PUBLIC_BASE_PATH}/icons/badge-96.png`;
const DEFAULT_START_RADIUS_METERS = 50;
const DEFAULT_FINISH_RADIUS_METERS = 50;
const FUNCTIONAL_TEST_TARGET_LAPS = 2;
const FUNCTIONAL_TEST_INTERVAL_MILLISECONDS = 250;
const MAX_START_GPS_STALE_AGE_MS = 8_000;
const START_POSITION_TIMEOUT_MS = 5000;
const START_POSITION_MAX_AGE_MS = 5_000;
const LOOP_END_AT_START_MAX_DISTANCE_METERS = 20;
const RECENT_GPS_GRACE_MS = 30_000;
const GEOLOCATION_PERMISSION_DENIED = 1;
const GEOLOCATION_POSITION_UNAVAILABLE = 2;
const GEOLOCATION_TIMEOUT = 3;

const ACHIEVEMENT_TIER_LABELS: Record<AchievementTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  special: "Special",
};

const AchievementIcon = ({
  name,
  size = 24,
}: {
  name: AchievementIconName;
  size?: number;
}) => {
  const iconProps = { size, "aria-hidden": true } as const;
  switch (name) {
    case "footprints":
      return <Footprints {...iconProps} />;
    case "medal":
      return <Medal {...iconProps} />;
    case "trophy":
      return <Trophy {...iconProps} />;
    case "crown":
      return <Crown {...iconProps} />;
    case "route":
      return <Route {...iconProps} />;
    case "flame":
      return <Flame {...iconProps} />;
    case "zap":
      return <Zap {...iconProps} />;
  }
};

const RunnerProfileCard = ({
  runnerName,
  trackName,
  achievements,
  completedRuns,
  totalDistanceMeters,
  totalDurationSeconds,
  averagePaceSecondsPerKm,
  bestPaceSecondsPerKm,
  longestRunMeters,
  latestRunAt,
  routePoints,
}: {
  runnerName: string;
  trackName: string;
  achievements: AchievementDefinition[];
  completedRuns: number;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  averagePaceSecondsPerKm: number;
  bestPaceSecondsPerKm: number;
  longestRunMeters: number;
  latestRunAt: number | null;
  routePoints: readonly TrackWaypoint[];
}) => {
  const routeGeometry = buildRunnerProfileRouteGeometry(
    routePoints,
    640,
    280,
    36
  );
  const endpointsOverlap =
    Math.hypot(
      routeGeometry.start.x - routeGeometry.end.x,
      routeGeometry.start.y - routeGeometry.end.y
    ) < 14;
  const latestDate = latestRunAt
    ? new Date(latestRunAt).toLocaleDateString("id-ID", {
        dateStyle: "long",
      })
    : "Belum ada run selesai";
  const averagePace =
    averagePaceSecondsPerKm > 0
      ? formatPace(averagePaceSecondsPerKm / 60).replace(" /km", "")
      : "--";
  const bestPace =
    bestPaceSecondsPerKm > 0
      ? formatPace(bestPaceSecondsPerKm / 60).replace(" /km", "")
      : "--";

  return (
    <article className="run-achievement-summary" aria-label="Profil lengkap runner">
      <header className="run-summary-header">
        <span className="run-summary-sport-icon">
          <Activity size={20} aria-hidden="true" />
        </span>
        <div>
          <span className="run-summary-kicker">Singapadu Tengah Jogging</span>
          <strong>{runnerName || "Pelari Singapadu"}</strong>
          <small>{trackName}</small>
        </div>
      </header>

      <section className="run-summary-route" aria-label={`Visual rute ${trackName}`}>
        <svg
          className="run-summary-route-map"
          viewBox="0 0 640 280"
          role="img"
          aria-label={`Rute ${trackName}`}
        >
          <rect width="640" height="280" className="run-summary-map-background" />
          <polyline
            points={routeGeometry.points}
            className="run-summary-route-halo"
          />
          <polyline
            points={routeGeometry.points}
            className="run-summary-route-line"
          />
          {endpointsOverlap ? (
            <>
              <circle
                cx={routeGeometry.end.x}
                cy={routeGeometry.end.y}
                r="11"
                className="run-summary-route-marker-halo"
              />
              <circle
                cx={routeGeometry.end.x}
                cy={routeGeometry.end.y}
                r="7"
                className="run-summary-route-marker finish"
              />
            </>
          ) : (
            <>
              <circle
                cx={routeGeometry.start.x}
                cy={routeGeometry.start.y}
                r="7"
                className="run-summary-route-marker start"
              />
              <circle
                cx={routeGeometry.end.x}
                cy={routeGeometry.end.y}
                r="7"
                className="run-summary-route-marker finish"
              />
            </>
          )}
        </svg>
        <div className="run-summary-route-caption">
          <span><MapPin size={13} aria-hidden="true" /> Singapadu Tengah, Bali</span>
        </div>
      </section>

      <div className="run-summary-primary-stats">
        <span>
          <strong>{(totalDistanceMeters / 1000).toFixed(2)}</strong>
          <small>km</small>
          <em>Jarak</em>
        </span>
        <span>
          <strong>{formatDuration(totalDurationSeconds)}</strong>
          <em>Waktu bergerak</em>
        </span>
        <span>
          <strong>{averagePace}</strong>
          <small>/km</small>
          <em>Pace rata-rata</em>
        </span>
      </div>

      <div className="run-summary-secondary-stats">
        <span><strong>{completedRuns}</strong><small>Lari selesai</small></span>
        <span><strong>{bestPace}</strong><small>Pace terbaik</small></span>
        <span><strong>{formatDistance(longestRunMeters)}</strong><small>Terjauh</small></span>
      </div>

      <section className="run-summary-trophies" aria-label={`${achievements.length} achievement terbuka`}>
        <div className="run-summary-trophies-heading">
          <span>Achievement</span>
          <strong>{achievements.length} terbuka</strong>
        </div>
        <div className="run-summary-badge-grid">
          {achievements.map((achievement) => (
            <span
              key={achievement.id}
              className={`run-summary-badge tier-${achievement.tier}`}
              title={achievement.title}
            >
              <AchievementIcon name={achievement.icon} size={20} />
              <small>{achievement.title}</small>
            </span>
          ))}
        </div>
      </section>

      <footer className="run-summary-footer">
        <span>Diperbarui {latestDate}</span>
        <strong>KKN PPM PNB · 2026</strong>
      </footer>
    </article>
  );
};

const isGeolocationPositionError = (error: unknown): error is GeolocationPositionError => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return code === GEOLOCATION_PERMISSION_DENIED ||
    code === GEOLOCATION_POSITION_UNAVAILABLE ||
    code === GEOLOCATION_TIMEOUT;
};

const isIosBrowser = (): boolean => {
  if (typeof navigator === "undefined") {
    return false;
  }
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !(window as { MSStream?: unknown }).MSStream;
};

const createIdleSession = (trackId: string): RunSession => {
  const result = hardenInitialSession({
    sessionId: createSessionId(),
    trackId,
    status: "idle",
    startedAt: null,
    endedAt: null,
    pausedAt: null,
    totalPausedMilliseconds: 0,
    distanceMeters: 0,
    durationSeconds: 0,
    averagePacePerKm: 0,
    maxPacePerKm: 0,
    closestIndex: 0,
    routeProgressMeters: 0,
    finishPosition: null,
    samples: [],
    persisted: false,
  });
  if (!result.valid) {
    throw new Error(result.reason);
  }
  return result.session;
};

type UnknownRecord = Record<string, unknown>;
const isString = (value: unknown): value is string => typeof value === "string";

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isGeoPoint = (value: unknown): value is { lat: number; lng: number } => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const obj = value as UnknownRecord;
  return isNumber(obj.lat) && isNumber(obj.lng);
};

const parseLegacyWaypoints = (value: unknown): TrackWaypoint[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const points: TrackWaypoint[] = [];

  for (const point of value) {
    if (isGeoPoint(point)) {
      points.push({ lat: point.lat, lng: point.lng });
    }
  }
  return points;
};

const parseTrackCheckpoints = (value: unknown): TrackCheckpoint[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const checkpoints: TrackCheckpoint[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const checkpoint = entry as UnknownRecord;
    if (
      !isString(checkpoint.id) ||
      !isString(checkpoint.name) ||
      !isNumber(checkpoint.lat) ||
      !isNumber(checkpoint.lng) ||
      !isNumber(checkpoint.routeIndex)
    ) {
      continue;
    }

    checkpoints.push({
      id: checkpoint.id,
      name: checkpoint.name,
      lat: checkpoint.lat,
      lng: checkpoint.lng,
      routeIndex: Math.max(0, Math.floor(checkpoint.routeIndex)),
      streetView: checkpoint.streetView === true,
    });
  }

  return checkpoints;
};

const parseGeoJSONWaypoints = (value: unknown): TrackWaypoint[] => {
  if (!value || typeof value !== "object") {
    return [];
  }

  const root = value as UnknownRecord;
  if (root.type !== "FeatureCollection" || !Array.isArray(root.features)) {
    return [];
  }

  const first = root.features[0] as UnknownRecord | undefined;
  if (!first || typeof first !== "object") {
    return [];
  }

  const geometry = first.geometry as UnknownRecord | undefined;
  if (!geometry || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return [];
  }

  const coordinates = geometry.coordinates as unknown[];
  const waypoints: TrackWaypoint[] = [];

  for (const coordinate of coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      continue;
    }

    const lng = coordinate[0];
    const lat = coordinate[1];
    if (!isNumber(lng) || !isNumber(lat)) {
      continue;
    }

    waypoints.push({ lat, lng });
  }

  return waypoints;
};

const getGeoJSONFeature = (value: unknown): UnknownRecord | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const root = value as UnknownRecord;
  if (root.type !== "FeatureCollection" || !Array.isArray(root.features)) {
    return undefined;
  }

  const first = root.features[0] as UnknownRecord | undefined;
  if (!first || typeof first !== "object") {
    return undefined;
  }

  return first as UnknownRecord;
};

const normalizeTrackPayload = (payload: unknown, fallbackTrackId: string): Track => {
  if (!payload || typeof payload !== "object") {
    return {
      id: fallbackTrackId,
      name: "Singapadu Tengah Run Track",
      distanceMeters: 0,
      waypoints: [],
      checkpoints: [],
      warningAreas: [],
      startAt: { lat: -8.5797866, lng: 115.2606812 },
      endAt: { lat: -8.5797866, lng: 115.2606812 },
      startRadiusMeters: DEFAULT_START_RADIUS_METERS,
      endFinishRadiusMeters: DEFAULT_FINISH_RADIUS_METERS,
      offRouteThresholdMeters: 55,
    };
  }

  const raw = payload as UnknownRecord;
  const geojsonWaypoints = parseGeoJSONWaypoints(raw);
  const legacyWaypoints = parseLegacyWaypoints(raw.waypoints);
  const geojsonFeature = getGeoJSONFeature(raw);
  const geojsonProps = (geojsonFeature?.properties ?? {}) as UnknownRecord;
  const checkpointSource = Array.isArray(raw.checkpoints)
    ? raw.checkpoints
    : geojsonProps.checkpoints;

  const parsedTrack = {
    id: isString(raw.id)
      ? raw.id
      : isString(geojsonProps.id)
        ? geojsonProps.id
        : fallbackTrackId,
    name: isString(raw.name)
      ? raw.name
      : isString(geojsonProps.name)
        ? geojsonProps.name
        : "Singapadu Tengah Run Track",
    distanceMeters: isNumber(raw.distanceMeters) ? raw.distanceMeters : 0,
    waypoints: geojsonWaypoints.length > 0 ? geojsonWaypoints : legacyWaypoints,
    checkpoints: parseTrackCheckpoints(checkpointSource),
    warningAreas: Array.isArray(raw.warningAreas)
      ? (raw.warningAreas as WarningArea[])
      : [],
    startAt: isGeoPoint(raw.startAt)
      ? { lat: raw.startAt.lat, lng: raw.startAt.lng }
      : undefined,
    endAt: isGeoPoint(raw.endAt)
      ? { lat: raw.endAt.lat, lng: raw.endAt.lng }
      : undefined,
    startRadiusMeters: isNumber(raw.startRadiusMeters)
      ? raw.startRadiusMeters
      : isNumber(geojsonProps.startRadiusMeters)
        ? geojsonProps.startRadiusMeters
        : DEFAULT_START_RADIUS_METERS,
      endFinishRadiusMeters: isNumber(raw.endFinishRadiusMeters)
        ? raw.endFinishRadiusMeters
        : isNumber(geojsonProps.endFinishRadiusMeters)
          ? geojsonProps.endFinishRadiusMeters
          : DEFAULT_FINISH_RADIUS_METERS,
    offRouteThresholdMeters: isNumber(raw.offRouteThresholdMeters)
      ? raw.offRouteThresholdMeters
      : isNumber(geojsonProps.offRouteThresholdMeters)
        ? geojsonProps.offRouteThresholdMeters
        : 55,
  };

  const fallbackStart = parsedTrack.waypoints[0] ?? { lat: -8.5797866, lng: 115.2606812 };
  const fallbackEnd = parsedTrack.waypoints[parsedTrack.waypoints.length - 1] ?? fallbackStart;
  const inferredEndAt = parsedTrack.endAt ?? (
    parsedTrack.waypoints.length > 1 &&
    haversineMeters(parsedTrack.waypoints[0], parsedTrack.waypoints[parsedTrack.waypoints.length - 1]) <= LOOP_END_AT_START_MAX_DISTANCE_METERS
      ? undefined
      : fallbackEnd
  );

  return {
    ...parsedTrack,
    waypoints: parsedTrack.waypoints,
    checkpoints: parsedTrack.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      routeIndex: Math.min(
        checkpoint.routeIndex,
        Math.max(0, parsedTrack.waypoints.length - 1)
      ),
    })),
    startAt: parsedTrack.startAt ?? fallbackStart,
    endAt: inferredEndAt ?? fallbackStart,
  };
};

export default function HomePage() {
  const [track, setTrack] = useState<Track | null>(null);
  const [loadingTrack, setLoadingTrack] = useState(true);
  const [session, setSession] = useState<RunSession>(() => createIdleSession("main"));
  const [lastPosition, setLastPosition] = useState<SessionSample | null>(null);
  const [sessionHistory, setSessionHistory] = useState<RunSession[]>(
    () => Object.freeze([]) as unknown as RunSession[]
  );
  const [sessionHistoryStorageReady, setSessionHistoryStorageReady] =
    useState(false);
  const [warningPopup, setWarningPopup] = useState<WarningEvent | null>(null);
  const [warningLog, setWarningLog] = useState<WarningEvent[]>([]);
  const [warningLogStorageReady, setWarningLogStorageReady] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [toastQueue, setToastQueue] = useState<ToastMessage[]>([]);
  const [followUser, setFollowUser] = useState(true);
  const [activeWarningId, setActiveWarningId] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<GeolocationPermissionState>("unknown");
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [showPermissionSheet, setShowPermissionSheet] = useState(false);
  const [startBlockInfo, setStartBlockInfo] = useState<StartBlockReason | null>(null);
  const [gpsHealth, setGpsHealth] = useState<GpsHealthState>("unknown");

  // Tab & Sheet State
  const [activeTab, setActiveTab] = useState<SheetTab>("metrics");
  const [isSheetCollapsed, setIsSheetCollapsed] = useState(true);

  // User Settings State
  const [useSoundAndHaptic, setUseSoundAndHaptic] = useState(true);
  const [useSystemNotifications, setUseSystemNotifications] = useState(false);
  const [systemNotificationPermission, setSystemNotificationPermission] =
    useState<SystemNotificationPermission>("checking");
  const [
    isRequestingSystemNotification,
    setIsRequestingSystemNotification,
  ] = useState(false);
  const [mapTheme, setMapTheme] = useState<"dark" | "light">("light");
  const [achievementStatus, setAchievementStatus] = useState("");
  const [isSharingRunnerProfile, setIsSharingRunnerProfile] = useState(false);
  const [isSharingProfileImage, setIsSharingProfileImage] = useState(false);
  const [sharedAchievementCollection, setSharedAchievementCollection] =
    useState<DecodedAchievementCollectionShare | null>(null);
  const [insecureContext, setInsecureContext] = useState(false);

  // Simulation State
  const [isSimulating, setIsSimulating] = useState(false);
  const [functionalTestState, setFunctionalTestState] =
    useState<FunctionalTestRunState>("idle");
  const [functionalTestResults, setFunctionalTestResults] =
    useState<FunctionalTestResult[]>(createFunctionalTestResults);

  const mapRef = useRef<L.Map | null>(null);
  const sessionRef = useRef(session);
  const sessionHistoryRef = useRef(sessionHistory);
  const warningStateRef = useRef<Record<string, { lastShown: number; shown: boolean }>>({});
  const offRouteStateRef = useRef({ outside: false, lastShown: 0 });
  const useSoundAndHapticRef = useRef(useSoundAndHaptic);
  const useSystemNotificationsRef = useRef(useSystemNotifications);
  const notificationRegistrationRef =
    useRef<ServiceWorkerRegistration | null>(null);
  const lastLiveNotificationKeyRef = useRef<string | null>(null);
  const isSimulatingRef = useRef(isSimulating);
  const isSheetCollapsedRef = useRef(isSheetCollapsed);
  const sheetCollapsedBeforeBlockingOverlayRef = useRef<boolean | null>(null);
  const sheetDragStartYRef = useRef<number | null>(null);
  const suppressSheetHandleClickRef = useRef(false);
  const lastLocationErrorToastRef = useRef<string | null>(null);
  const lastWarningToastRef = useRef<string | null>(null);
  const historyPersistenceInFlightRef = useRef<string | null>(null);
  const historyPersistenceGenerationRef = useRef(0);
  
  const simIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const simResumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const simIndexRef = useRef(0);
  const functionalTestActiveRef = useRef(false);
  const functionalTestPauseTriggeredRef = useRef(false);
  const functionalTestResultsRef = useRef<FunctionalTestResult[]>(createFunctionalTestResults());
  const functionalTestWarningIdsRef = useRef<Set<string>>(new Set());
  const maxProgressWaypointIndexRef = useRef(0);
  const lastPositionRef = useRef<SessionSample | null>(null);

  useEffect(() => {
    useSoundAndHapticRef.current = useSoundAndHaptic;
  }, [useSoundAndHaptic]);

  useEffect(() => {
    useSystemNotificationsRef.current = useSystemNotifications;
  }, [useSystemNotifications]);

  useEffect(() => {
    isSimulatingRef.current = isSimulating;
  }, [isSimulating]);

  useEffect(() => {
    isSheetCollapsedRef.current = isSheetCollapsed;
  }, [isSheetCollapsed]);

  useEffect(() => {
    const hasBlockingOverlay = showPermissionSheet || startBlockInfo !== null;

    if (hasBlockingOverlay) {
      if (sheetCollapsedBeforeBlockingOverlayRef.current === null) {
        sheetCollapsedBeforeBlockingOverlayRef.current = isSheetCollapsed;
      }
      if (!isSheetCollapsed) {
        setIsSheetCollapsed(true);
      }
      return;
    }

    const previousCollapsedState = sheetCollapsedBeforeBlockingOverlayRef.current;
    if (previousCollapsedState !== null) {
      sheetCollapsedBeforeBlockingOverlayRef.current = null;
      if (isSheetCollapsed !== previousCollapsedState) {
        setIsSheetCollapsed(previousCollapsedState);
      }
    }
  }, [showPermissionSheet, startBlockInfo, isSheetCollapsed]);

  // Clean up simulation on unmount
  useEffect(() => {
    return () => {
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
      }
      if (simResumeTimeoutRef.current) {
        clearTimeout(simResumeTimeoutRef.current);
      }
    };
  }, []);

  const cumulativeDistances = useMemo(() => {
    if (!track) {
      return [0];
    }
    return cumulativeDistanceFromWaypoints(track.waypoints);
  }, [track]);

  const trackDistance = useMemo(() => {
    if (!track) {
      return 0;
    }
    return resolveTrackDistance(track);
  }, [track]);

  const isLoopTrack = useMemo(
    () =>
      Boolean(
        track &&
          haversineMeters(track.startAt, track.endAt) <=
            LOOP_END_AT_START_MAX_DISTANCE_METERS
      ),
    [track]
  );

  const displayClosestIndex = useMemo(() => {
    if (!track || track.waypoints.length === 0) {
      return 0;
    }
    if (session.status === "idle") {
      return 0;
    }
    return Math.min(session.closestIndex, track.waypoints.length - 1);
  }, [track, session.closestIndex, session.status]);

  const displayedDistance = useMemo(() => {
    if (session.status === "idle") {
      return 0;
    }
    return session.distanceMeters;
  }, [session.distanceMeters, session.status]);

  const routeCycle = useMemo(() => {
    if (
      session.status === "idle" ||
      !track ||
      cumulativeDistances.length === 0 ||
      trackDistance <= 0
    ) {
      return {
        completedLaps: 0,
        currentLapNumber: 1,
        lapProgressMeters: 0,
      };
    }

    const fallbackProgress =
      cumulativeDistances[
        Math.min(displayClosestIndex, cumulativeDistances.length - 1)
      ] ?? 0;
    const totalProgressMeters = Number.isFinite(session.routeProgressMeters)
      ? Math.max(0, session.routeProgressMeters)
      : fallbackProgress;

    if (!isLoopTrack) {
      return {
        completedLaps: totalProgressMeters >= trackDistance ? 1 : 0,
        currentLapNumber: 1,
        lapProgressMeters: Math.min(trackDistance, totalProgressMeters),
      };
    }

    const completedLaps = Math.floor(totalProgressMeters / trackDistance);
    const currentLapProgress =
      totalProgressMeters - completedLaps * trackDistance;
    const finishedAtLapBoundary =
      session.status === "finished" &&
      totalProgressMeters > 0 &&
      currentLapProgress <= 0.01;

    return {
      completedLaps,
      currentLapNumber: finishedAtLapBoundary
        ? Math.max(1, completedLaps)
        : completedLaps + 1,
      lapProgressMeters: finishedAtLapBoundary
        ? trackDistance
        : currentLapProgress,
    };
  }, [
    cumulativeDistances,
    displayClosestIndex,
    isLoopTrack,
    session.routeProgressMeters,
    session.status,
    track,
    trackDistance,
  ]);

  const progress = useMemo(
    () =>
      trackDistance > 0
        ? Math.min(
            100,
            Math.max(0, (routeCycle.lapProgressMeters / trackDistance) * 100)
          )
        : 0,
    [routeCycle.lapProgressMeters, trackDistance]
  );

  const remainingDistance = useMemo(() => {
    if (!track) {
      return 0;
    }
    if (session.status === "idle") {
      return trackDistance;
    }
    return Math.max(0, trackDistance - routeCycle.lapProgressMeters);
  }, [
    routeCycle.lapProgressMeters,
    session.status,
    trackDistance,
    track,
  ]);

  const nextWaypointDistance = useMemo(() => {
    if (
      session.status === "idle" ||
      !track ||
      !lastPosition ||
      track.checkpoints.length === 0
    ) {
      return null;
    }
    const nextCheckpoint = [...track.checkpoints]
      .sort((a, b) => a.routeIndex - b.routeIndex)
      .find((checkpoint) => checkpoint.routeIndex > displayClosestIndex);
    return nextCheckpoint ? haversineMeters(lastPosition, nextCheckpoint) : null;
  }, [lastPosition, displayClosestIndex, session.status, track]);

  const etaRemainingSeconds = useMemo(() => {
    if (!track || session.status !== "running") {
      return null;
    }

    if (!session.averagePacePerKm || !Number.isFinite(session.averagePacePerKm) || session.averagePacePerKm <= 0) {
      return null;
    }

    const remainKm = remainingDistance / 1000;
    if (!Number.isFinite(remainKm) || remainKm <= 0) {
      return null;
    }
    return Math.max(0, Math.round(remainKm * session.averagePacePerKm * 60));
  }, [track, remainingDistance, session.status, session.averagePacePerKm]);

  const statusTone = useMemo(() => {
    if (session.status === "running") {
      return "running";
    }
    if (session.status === "paused") {
      return "paused";
    }
    if (session.status === "finished") {
      return "finished";
    }
    return "idle";
  }, [session.status]);

  const achievementSummary = useMemo(
    () => summarizeAchievements(sessionHistory),
    [sessionHistory]
  );

  const achievementProgress = useMemo(
    () => buildAchievementProgress(sessionHistory),
    [sessionHistory]
  );

  const unlockedAchievements = useMemo(
    () => achievementProgress.filter((entry) => entry.unlocked),
    [achievementProgress]
  );

  const latestUnlockedAchievement = useMemo<AchievementProgress | null>(
    () =>
      unlockedAchievements.reduce<AchievementProgress | null>(
        (latest, entry) =>
          !latest || (entry.unlockedAt ?? 0) >= (latest.unlockedAt ?? 0)
            ? entry
            : latest,
        null
      ),
    [unlockedAchievements]
  );

  const functionalTestStats = useMemo(() => {
    const passed = functionalTestResults.filter((result) => result.status === "passed").length;
    const failed = functionalTestResults.filter((result) => result.status === "failed").length;
    const skipped = functionalTestResults.filter((result) => result.status === "skipped").length;
    const completed = passed + failed + skipped;
    return {
      passed,
      failed,
      skipped,
      completed,
      percent: Math.round((completed / functionalTestResults.length) * 100),
    };
  }, [functionalTestResults]);

  const locationPermissionMessage = useMemo(() => {
    if (gpsHealth === "provider-off") {
      return "Layanan lokasi tidak aktif / tidak tersedia. Aktifkan GPS pada perangkat lalu muat ulang aplikasi.";
    }

    if (gpsHealth === "timeout") {
      return "Waktu pencarian lokasi habis. Coba aktifkan lokasi, pindah area, lalu coba lagi.";
    }

    if (permissionStatus === "denied") {
      return "Izin lokasi ditolak. Aktifkan lokasi di pengaturan browser lalu coba lagi.";
    }

    if (isIosBrowser()) {
      return "Perangkat iOS sering perlu tindakan pengguna untuk menampilkan dialog izin lokasi. Ketuk tombol di bawah ini agar browser menampilkan konfirmasi.";
    }

    return "Aplikasi membutuhkan akses lokasi untuk menampilkan posisi Anda saat ini dan memungkinkan sesi lari dimulai.";
  }, [permissionStatus, gpsHealth]);

  const systemNotificationHelp = useMemo(() => {
    if (systemNotificationPermission === "checking") {
      return "Memeriksa dukungan notifikasi pada browser...";
    }
    if (systemNotificationPermission === "unsupported") {
      return isIosBrowser()
        ? "Di iPhone: pilih Bagikan → Tambahkan ke Layar Utama, lalu buka app dari ikon agar notifikasi sistem tersedia."
        : "Browser ini belum mendukung notifikasi sistem untuk aplikasi web.";
    }
    if (systemNotificationPermission === "denied") {
      return "Notifikasi diblokir. Izinkan kembali melalui pengaturan situs atau pengaturan notifikasi perangkat.";
    }
    if (systemNotificationPermission === "error") {
      return "Layanan notifikasi belum siap. Periksa koneksi HTTPS lalu muat ulang aplikasi.";
    }
    if (useSystemNotifications) {
      return "Status lari, checkpoint, lap, dan peringatan akan tampil di panel notifikasi. Biarkan sesi tetap terbuka agar update GPS terus diterima.";
    }
    return "Aktifkan agar metrik sesi dan peringatan dapat dicek tanpa terus melihat layar aplikasi.";
  }, [systemNotificationPermission, useSystemNotifications]);

  const systemNotificationActionLabel =
    isRequestingSystemNotification
      ? "Meminta izin..."
      : useSystemNotifications
        ? "Aktif"
        : systemNotificationPermission === "denied"
          ? "Diblokir"
          : systemNotificationPermission === "unsupported"
            ? isIosBrowser()
              ? "Cara Aktifkan"
              : "Tidak Didukung"
            : systemNotificationPermission === "error"
              ? "Coba Lagi"
              : "Aktifkan";

  useEffect(() => {
    if (toastQueue.length === 0 || showPermissionSheet || startBlockInfo) {
      return;
    }

    const activeToast = toastQueue[0];
    const timer = window.setTimeout(() => {
      popToast();
    }, activeToast.autoHideMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toastQueue, showPermissionSheet, startBlockInfo]);

  useEffect(() => {
    if (showPermissionSheet || startBlockInfo) {
      lastLocationErrorToastRef.current = locationError;
      setToastQueue((prev) => {
        const filtered = prev.filter((item) => item.title !== "Info Lokasi");
        return filtered.length === prev.length ? prev : filtered;
      });
      return;
    }

    if (!locationError) {
      lastLocationErrorToastRef.current = null;
      return;
    }
    if (lastLocationErrorToastRef.current === locationError) {
      return;
    }

    lastLocationErrorToastRef.current = locationError;
    enqueueToast({
      title: "Info Lokasi",
      message: locationError,
      severity: "error",
    });
  }, [locationError, showPermissionSheet, startBlockInfo]);

  useEffect(() => {
    if (!warningPopup) {
      return;
    }

    const key = `${warningPopup.areaId}-${warningPopup.timestamp}-${warningPopup.type}`;
    if (lastWarningToastRef.current === key) {
      return;
    }
    lastWarningToastRef.current = key;
    enqueueToast({
      title: warningPopup.areaName,
      message: warningPopup.message,
      severity: warningPopup.type,
      distanceMeters: warningPopup.distanceMeters,
      warningAreaId: warningPopup.areaId,
    });
  }, [warningPopup]);

  // Load settings and verify the device-signed session history.
  useEffect(() => {
    let cancelled = false;

    const loadLocalState = async () => {
      const hapticVal = readLocalStorageItem("joging-track:sound-haptic");
      if (hapticVal !== null) {
        setUseSoundAndHaptic(hapticVal === "true");
      }
      const themeVal = readLocalStorageItem("joging-track:map-theme");
      if (themeVal === "dark" || themeVal === "light") {
        setMapTheme(themeVal as "dark" | "light");
      }
      removeLocalStorageItem("joging-track:achievement-name");
      removeLocalStorageItem("joging-track:certificate-name");

      const restored = await restoreProtectedSessionHistory(
        readLocalStorageItem(TRACK_KEY),
        SESSION_HISTORY_LIMIT
      );
      if (cancelled) {
        return;
      }

      if (restored.status === "migrated" && restored.migratedValue) {
        const migrationSaved = writeLocalStorageItem(
          TRACK_KEY,
          restored.migratedValue
        );
        if (!migrationSaved) {
          enqueueToast({
            title: "Migrasi Riwayat Belum Tersimpan",
            message:
              "Riwayat lama tetap tersedia saat ini, tetapi browser menolak penyimpanan signature perangkat.",
            severity: "warning",
          });
        }
      }

      applySessionHistory(restored.history);
      setSessionHistoryStorageReady(true);

      if (restored.status === "migrated") {
        enqueueToast({
          title: "Riwayat Lokal Dilindungi",
          message:
            "Riwayat lama sudah ditandatangani dengan kunci perangkat ini.",
          severity: "info",
          autoHideMs: 5000,
        });
      } else if (restored.status === "tampered") {
        enqueueToast({
          title: "Riwayat Lokal Ditolak",
          message:
            restored.message ??
            "Signature riwayat berubah sehingga data tidak dimuat.",
          severity: "error",
          autoHideMs: 9000,
        });
      } else if (restored.status === "unavailable") {
        enqueueToast({
          title: "Proteksi Riwayat Tidak Tersedia",
          message:
            restored.message ??
            "Browser tidak dapat membuka kunci perangkat. Riwayat tidak dimuat.",
          severity: "error",
          autoHideMs: 9000,
        });
      }
    };

    void loadLocalState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const setupSystemNotifications = async () => {
      const isLocalhost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";
      const canRegister =
        ("Notification" in window) &&
        ("serviceWorker" in navigator) &&
        (window.isSecureContext || isLocalhost);

      if (!canRegister) {
        if (!cancelled) {
          useSystemNotificationsRef.current = false;
          setUseSystemNotifications(false);
          setSystemNotificationPermission("unsupported");
        }
        return;
      }

      let permission: NotificationPermission;
      try {
        permission = Notification.permission;
      } catch {
        if (!cancelled) {
          setSystemNotificationPermission("unsupported");
        }
        return;
      }

      if (!cancelled) {
        const storedPreference = readLocalStorageItem(
          SYSTEM_NOTIFICATIONS_KEY
        );
        const shouldEnable =
          permission === "granted" && storedPreference !== "false";
        useSystemNotificationsRef.current = shouldEnable;
        setUseSystemNotifications(shouldEnable);
        setSystemNotificationPermission(permission);
      }

      try {
        const registration = await navigator.serviceWorker.register(
          SERVICE_WORKER_FILE,
          { scope: APP_ROOT_PATH }
        );
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        if (!cancelled) {
          notificationRegistrationRef.current = registration;
        }
      } catch {
        if (!cancelled) {
          useSystemNotificationsRef.current = false;
          setUseSystemNotifications(false);
          setSystemNotificationPermission("error");
        }
      }
    };

    void setupSystemNotifications();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      !track ||
      readLocalStorageItem(SYSTEM_NOTIFICATION_HINT_KEY) === "true"
    ) {
      return;
    }

    const iosNeedsHomeScreen =
      systemNotificationPermission === "unsupported" && isIosBrowser();
    if (
      systemNotificationPermission !== "default" &&
      !iosNeedsHomeScreen
    ) {
      return;
    }

    writeLocalStorageItem(SYSTEM_NOTIFICATION_HINT_KEY, "true");
    const timer = window.setTimeout(() => {
      enqueueToast({
        title: iosNeedsHomeScreen
          ? "Notifikasi di iPhone"
          : "Aktifkan Notifikasi Lari",
        message: iosNeedsHomeScreen
          ? "Pilih Bagikan → Tambahkan ke Layar Utama, buka app dari ikon, lalu ketuk tombol lonceng."
          : "Ketuk tombol lonceng di peta agar progres, checkpoint, lap, dan peringatan tampil di panel notifikasi HP.",
        severity: "info",
        autoHideMs: 9000,
      });
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [systemNotificationPermission, track]);

  useEffect(() => {
    let disposed = false;
    let requestNumber = 0;

    const readSharedAchievement = async () => {
      const currentRequest = ++requestNumber;
      try {
        const hash = window.location.hash;
        const decoded = await decodeAchievementCollectionHash(hash);
        if (!disposed && currentRequest === requestNumber) {
          setSharedAchievementCollection(decoded);
        }
      } catch (error) {
        if (disposed || currentRequest !== requestNumber) {
          return;
        }
        setSharedAchievementCollection(null);
        const message = error instanceof Error
          ? error.message
          : "Tautan achievement tidak dapat dibaca.";
        enqueueToast({
          title: "Tautan Achievement Tidak Valid",
          message,
          severity: "error",
        });
      }
    };

    const handleHashChange = () => {
      void readSharedAchievement();
    };
    void readSharedAchievement();
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      disposed = true;
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  // Check for secure context and GPS permission status on load
  useEffect(() => {
    setWarningLog(
      parseWarningHistory(readLocalStorageItem(WARNING_LOG_KEY))
    );
    setWarningLogStorageReady(true);
  }, []);

  useEffect(() => {
    if (!warningLogStorageReady) {
      return;
    }

    writeLocalStorageItem(
      WARNING_LOG_KEY,
      JSON.stringify(warningLog.slice(0, 15))
    );
  }, [warningLog, warningLogStorageReady]);

  // Check for secure context and GPS permission status on load
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const isInsecure = !window.isSecureContext && !isLocalhost;
      setInsecureContext(isInsecure);
      setPermissionStatus("unknown");

      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: "geolocation" as PermissionName }).then((status) => {
          setPermissionStatus(status.state);
          if (status.state === "denied") {
            setGpsHealth("permission-denied");
            setLocationError("Izin lokasi (GPS) diblokir. Harap aktifkan izin lokasi di pengaturan browser Anda.");
            if (isIosBrowser()) {
              setShowPermissionSheet(true);
            }
          } else if (status.state === "granted") {
            setGpsHealth("ready");
            setLocationError(null);
            setShowPermissionSheet(false);
          } else {
            setGpsHealth("unknown");
            setLocationError("Aplikasi menunggu izin lokasi Anda untuk menampilkan titik posisi saat ini.");
          }
          status.onchange = () => {
            setPermissionStatus(status.state);
            if (status.state === "denied") {
              setGpsHealth("permission-denied");
              setLocationError("Izin lokasi (GPS) diblokir. Harap aktifkan izin lokasi di pengaturan browser Anda.");
              if (isIosBrowser()) {
                setShowPermissionSheet(true);
              }
            } else if (status.state === "granted") {
              requestLocationPermission(true);
            } else {
              setGpsHealth("unknown");
              setLocationError("Aplikasi menunggu izin lokasi Anda untuk menampilkan titik posisi saat ini.");
              if (isIosBrowser()) {
                setShowPermissionSheet(true);
              }
            }
          };
        }).catch(() => {
          // Geolocation query not supported on this browser
        });
      }
    }
  }, []);

  // Try to get location automatically on first load
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const bootstrap = async () => {
      if (isSimulating) {
        return;
      }
      await requestLocationPermission(false);
    };

    bootstrap();
  }, []);

  // Fetch track config
  useEffect(() => {
    let cancelled = false;

    const loadTrack = async () => {
      setLoadingTrack(true);
      try {
        const params = new URLSearchParams(window.location.search);
        const trackId = params.get("track") ?? "main";
        const response = await fetch(TRACK_FILE);
        if (!response.ok) {
          throw new Error("track config not found");
        }

        const rawTrack = await response.json();
        if (cancelled) {
          return;
        }

        const normalized = normalizeTrackPayload(rawTrack, trackId);

        setTrack(normalized);
        applySession(createIdleSession(normalized.id), {
          allowSessionReplacement: true,
        });
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          const fallbackTrack = normalizeTrackPayload(fallbackTrackPayload, "main");
          setTrack(fallbackTrack);
          applySession(createIdleSession(fallbackTrack.id), {
            allowSessionReplacement: true,
          });
          enqueueToast({
            title: "Rute Cadangan Aktif",
            message: "Data rute utama gagal dimuat. Aplikasi menggunakan salinan rute lokal.",
            severity: "warning",
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingTrack(false);
        }
      }
    };

    loadTrack();

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSoundAndHaptic = () => {
    const next = !useSoundAndHaptic;
    setUseSoundAndHaptic(next);
    writeLocalStorageItem("joging-track:sound-haptic", String(next));
    if (next) {
      prepareWarningSounds();
    }
  };

  const toggleMapTheme = () => {
    const next = mapTheme === "dark" ? "light" : "dark";
    setMapTheme(next);
    writeLocalStorageItem("joging-track:map-theme", next);
  };

  const applySession = (
    next: RunSession,
    options: SessionTransitionOptions = {}
  ): boolean => {
    const hardened = hardenSessionTransition(
      sessionRef.current,
      next,
      options
    );
    if (!hardened.valid) {
      console.warn("Session state rejected:", hardened.reason);
      enqueueToast({
        title: "Perubahan Sesi Ditolak",
        message: hardened.reason,
        severity: "error",
      });
      return false;
    }

    setSession(hardened.session);
    sessionRef.current = hardened.session;
    return true;
  };

  const applySessionHistory = (next: RunSession[]): boolean => {
    const hardened = hardenSessionHistory(next);
    if (!hardened.valid) {
      console.warn("Session history rejected:", hardened.reason);
      enqueueToast({
        title: "Perubahan Riwayat Ditolak",
        message: hardened.reason,
        severity: "error",
      });
      return false;
    }

    setSessionHistory(hardened.sessions);
    sessionHistoryRef.current = hardened.sessions;
    return true;
  };

  const onShareRunnerProfile = async () => {
    if (!track) {
      return;
    }

    setAchievementStatus("Sedang menyiapkan profil lari...");
    setIsSharingRunnerProfile(true);

    try {
      const trustedProgress = buildAchievementProgress(
        sessionHistoryRef.current
      );
      const trustedSummary = summarizeAchievements(
        sessionHistoryRef.current
      );
      const payload = createAchievementCollectionSharePayload(
        trustedProgress,
        trustedSummary,
        ""
      );
      const result = await shareAchievementCollectionLink({
        payload,
        baseUrl: window.location.href,
        trackName: track.name,
      });
      const messages = {
        shared: "Profil lari lengkap berhasil dibagikan.",
        copied: "Tautan profil lari disalin ke clipboard.",
        cancelled: "Berbagi profil dibatalkan.",
        unavailable: "Browser tidak dapat menyalin otomatis. Salin tautan yang ditampilkan.",
      } as const;
      const message = messages[result.outcome];
      setAchievementStatus(message);

      if (result.outcome === "unavailable") {
        window.prompt("Salin tautan profil lari ini:", result.url);
      }
      if (result.outcome !== "cancelled") {
        enqueueToast({
          title: "Bagikan Profil Lari",
          message,
          severity: result.outcome === "unavailable" ? "warning" : "info",
        });
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Profil lari gagal dibagikan.";
      setAchievementStatus(message);
      enqueueToast({ title: "Gagal Membagikan", message, severity: "error" });
    } finally {
      setIsSharingRunnerProfile(false);
    }
  };

  const onShareRunnerProfileImage = async () => {
    if (!track) {
      return;
    }

    setAchievementStatus("Sedang membuat PNG profil 1080 × 1350...");
    setIsSharingProfileImage(true);

    try {
      const trustedProgress = buildAchievementProgress(
        sessionHistoryRef.current
      );
      const trustedSummary = summarizeAchievements(
        sessionHistoryRef.current
      );
      const payload = createAchievementCollectionSharePayload(
        trustedProgress,
        trustedSummary,
        ""
      );
      const profileUrl = await buildAchievementCollectionShareUrl(
        window.location.href,
        payload
      );
      const result = await shareRunnerProfilePng({
        payload,
        trackName: track.name,
        profileUrl,
        routePoints: track.waypoints,
      });
      const messages = {
        shared: "PNG profil dikirim ke menu share perangkat.",
        downloaded: `PNG profil diunduh sebagai ${result.fileName}.`,
        cancelled: "Berbagi PNG dibatalkan.",
        unavailable: "Browser tidak mendukung share atau download PNG.",
      } as const;
      const message = messages[result.outcome];
      setAchievementStatus(message);
      if (result.outcome !== "cancelled") {
        enqueueToast({
          title: "Bagikan PNG Profil",
          message,
          severity: result.outcome === "unavailable" ? "warning" : "info",
        });
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "PNG profil gagal dibuat.";
      setAchievementStatus(message);
      enqueueToast({ title: "Gagal Membuat PNG", message, severity: "error" });
    } finally {
      setIsSharingProfileImage(false);
    }
  };

  const closeSharedAchievement = () => {
    const cleanUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", cleanUrl);
    setSharedAchievementCollection(null);
  };

  const resetProgressTracking = () => {
    maxProgressWaypointIndexRef.current = 0;
  };

  const resetSession = () => {
    if (!track) {
      return;
    }
    setWarningPopup(null);
    setActiveWarningId(null);
    setLastPosition(null);
    lastPositionRef.current = null;
    warningStateRef.current = {};
    offRouteStateRef.current = { outside: false, lastShown: 0 };
    lastLiveNotificationKeyRef.current = null;
    if (useSystemNotificationsRef.current) {
      void closeRunSystemNotifications();
    }
    resetProgressTracking();
    applySession(createIdleSession(track.id), {
      allowSessionReplacement: true,
    });
  };

  const requestFreshPosition = ({
    timeoutMs = START_POSITION_TIMEOUT_MS,
    maximumAgeMs = 5000,
  }: {
    timeoutMs?: number;
    maximumAgeMs?: number;
  } = {}): Promise<SessionSample> =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation tidak didukung browser ini."));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve(createSessionSample(position));
        },
        (error) => {
          reject(error);
        },
        {
          enableHighAccuracy: true,
          maximumAge: maximumAgeMs,
          timeout: timeoutMs,
        }
      );
    });

  const createSessionSample = (position: GeolocationPosition): SessionSample => ({
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy ?? null,
    timestamp: position.timestamp || Date.now(),
  });

  const applyLocationPosition = (sample: SessionSample, shouldCenter = true) => {
    setLastPosition(sample);
    lastPositionRef.current = sample;
    setGpsHealth("ready");
    setPermissionStatus("granted");
    setLocationError(null);
    setShowPermissionSheet(false);
    setStartBlockInfo(null);

    if (shouldCenter && mapRef.current) {
      mapRef.current.setView([sample.lat, sample.lng], 18, { animate: true });
    }
  };

  const getRecentPositionForStart = (): SessionSample | null => {
    const fallback = sessionRef.current.samples[sessionRef.current.samples.length - 1] ?? null;
    const candidate = lastPositionRef.current ?? fallback;

    if (!candidate) {
      return null;
    }

    if (Date.now() - candidate.timestamp > START_POSITION_MAX_AGE_MS) {
      return null;
    }

    return candidate;
  };

  const showStartBlockDialog = (title: string, message: string) => {
    setShowPermissionSheet(false);
    setStartBlockInfo({ title, message });
  };

  const enqueueToast = (toast: Omit<ToastMessage, "id">) => {
    const candidate: ToastMessage = {
      ...toast,
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      autoHideMs: toast.autoHideMs ?? 7000,
    };

    setToastQueue((prev) => {
      const duplicate = prev.some(
        (item) =>
          item.title === candidate.title &&
          item.message === candidate.message &&
          item.severity === candidate.severity &&
          item.warningAreaId === candidate.warningAreaId
      );
      if (duplicate) {
        return prev;
      }
      return [...prev, candidate];
    });
  };

  const resolveNotificationMetrics = (
    sourceSession: RunSession
  ): RunNotificationMetrics => {
    const safeProgress = Number.isFinite(sourceSession.routeProgressMeters)
      ? Math.max(0, sourceSession.routeProgressMeters)
      : 0;
    const completedLaps =
      trackDistance > 0
        ? isLoopTrack
          ? Math.floor(safeProgress / trackDistance)
          : safeProgress >= trackDistance
            ? 1
            : 0
        : 0;
    const atLapBoundary =
      sourceSession.status === "finished" &&
      completedLaps > 0 &&
      trackDistance > 0 &&
      safeProgress % trackDistance <= 0.01;

    return {
      distanceMeters: sourceSession.distanceMeters,
      durationSeconds: sourceSession.durationSeconds,
      averagePacePerKm: sourceSession.averagePacePerKm,
      completedLaps,
      currentLapNumber: isLoopTrack
        ? atLapBoundary
          ? completedLaps
          : completedLaps + 1
        : 1,
    };
  };

  const ensureNotificationRegistration =
    async (): Promise<ServiceWorkerRegistration | null> => {
      if (notificationRegistrationRef.current) {
        return notificationRegistrationRef.current;
      }
      if (!("serviceWorker" in navigator)) {
        return null;
      }

      try {
        const existing =
          await navigator.serviceWorker.getRegistration(APP_ROOT_PATH);
        const registration =
          existing ??
          (await navigator.serviceWorker.register(SERVICE_WORKER_FILE, {
            scope: APP_ROOT_PATH,
          }));
        notificationRegistrationRef.current = registration;
        return registration;
      } catch {
        return null;
      }
    };

  const deliverSystemNotification = async (
    payload: RunNotificationPayload,
    force = false
  ): Promise<boolean> => {
    if (!force && !useSystemNotificationsRef.current) {
      return false;
    }
    if (!("Notification" in window)) {
      return false;
    }

    let permission: NotificationPermission;
    try {
      permission = Notification.permission;
    } catch {
      return false;
    }
    if (permission !== "granted") {
      if (permission === "denied") {
        useSystemNotificationsRef.current = false;
        setUseSystemNotifications(false);
        setSystemNotificationPermission("denied");
      }
      return false;
    }

    const options: NotificationOptions & {
      renotify?: boolean;
      vibrate?: number[];
    } = {
      body: payload.body,
      tag: payload.tag,
      icon: NOTIFICATION_ICON_PATH,
      badge: NOTIFICATION_BADGE_PATH,
      data: {
        url: new URL(APP_ROOT_PATH, window.location.origin).href,
      },
      silent: payload.silent,
      renotify: payload.renotify,
      requireInteraction: payload.requireInteraction,
      ...(payload.silent ? {} : { vibrate: [180, 80, 180] }),
    };

    try {
      const registration = await ensureNotificationRegistration();
      if (registration) {
        await registration.showNotification(payload.title, options);
        return true;
      }

      const notification = new Notification(payload.title, options);
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      return true;
    } catch {
      return false;
    }
  };

  const closeRunSystemNotifications = async () => {
    const registration = await ensureNotificationRegistration();
    if (!registration || !("getNotifications" in registration)) {
      return;
    }

    try {
      const notifications = await registration.getNotifications();
      notifications.forEach((notification) => {
        if (notification.tag.startsWith("joging-track-")) {
          notification.close();
        }
      });
    } catch {
      // Some browsers expose showNotification without getNotifications.
    }
  };

  const requestSystemNotifications = async () => {
    if (
      systemNotificationPermission === "unsupported" ||
      !("Notification" in window)
    ) {
      enqueueToast({
        title: "Notifikasi Sistem Belum Aktif",
        message: isIosBrowser()
          ? "Di iPhone, pilih Bagikan → Tambahkan ke Layar Utama. Buka app dari ikon Home Screen, lalu ketuk lonceng kembali."
          : "Browser ini belum mendukung notifikasi sistem. Toast, suara, dan getar tetap aktif.",
        severity: "warning",
        autoHideMs: 9000,
      });
      return;
    }

    if (systemNotificationPermission === "denied") {
      enqueueToast({
        title: "Notifikasi Diblokir",
        message:
          "Buka pengaturan situs atau pengaturan notifikasi perangkat, izinkan Singapadu Run, lalu muat ulang aplikasi.",
        severity: "warning",
        autoHideMs: 9000,
      });
      return;
    }

    setIsRequestingSystemNotification(true);
    try {
      let permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }
      setSystemNotificationPermission(permission);

      if (permission !== "granted") {
        useSystemNotificationsRef.current = false;
        setUseSystemNotifications(false);
        writeLocalStorageItem(SYSTEM_NOTIFICATIONS_KEY, "false");
        enqueueToast({
          title:
            permission === "denied"
              ? "Notifikasi Tidak Diizinkan"
              : "Izin Notifikasi Belum Diberikan",
          message:
            "Aplikasi tetap menggunakan toast, suara, dan getar selama layar terbuka.",
          severity: "warning",
        });
        return;
      }

      const registration = await ensureNotificationRegistration();
      if (!registration) {
        setSystemNotificationPermission("error");
        enqueueToast({
          title: "Layanan Notifikasi Gagal Dimuat",
          message: "Periksa koneksi lalu muat ulang aplikasi.",
          severity: "error",
        });
        return;
      }

      useSystemNotificationsRef.current = true;
      setUseSystemNotifications(true);
      writeLocalStorageItem(SYSTEM_NOTIFICATIONS_KEY, "true");

      const current = sessionRef.current;
      if (track && (current.status === "running" || current.status === "paused")) {
        await deliverSystemNotification(
          buildRunNotificationPayload({
            kind: current.status === "paused" ? "paused" : "live",
            trackName: track.name,
            metrics: resolveNotificationMetrics(current),
          }),
          true
        );
      } else {
        await deliverSystemNotification(
          {
            title: "Notifikasi lari aktif",
            body:
              "Checkpoint, lap, progres, dan peringatan rute akan tampil di panel notifikasi HP.",
            tag: "joging-track-live",
            silent: false,
            renotify: true,
            requireInteraction: false,
          },
          true
        );
      }

      enqueueToast({
        title: "Notifikasi Sistem Aktif",
        message:
          "Anda dapat mengecek progres dan peringatan dari panel notifikasi HP.",
        severity: "info",
      });
    } catch {
      setSystemNotificationPermission("error");
      enqueueToast({
        title: "Izin Notifikasi Gagal",
        message: "Browser tidak dapat mengaktifkan notifikasi saat ini.",
        severity: "error",
      });
    } finally {
      setIsRequestingSystemNotification(false);
    }
  };

  const toggleSystemNotifications = async () => {
    if (!useSystemNotificationsRef.current) {
      await requestSystemNotifications();
      return;
    }

    useSystemNotificationsRef.current = false;
    setUseSystemNotifications(false);
    writeLocalStorageItem(SYSTEM_NOTIFICATIONS_KEY, "false");
    lastLiveNotificationKeyRef.current = null;
    await closeRunSystemNotifications();
    enqueueToast({
      title: "Notifikasi Sistem Dinonaktifkan",
      message: "Toast, suara, dan getar di dalam aplikasi tetap tersedia.",
      severity: "info",
    });
  };

  const popToast = () => {
    setToastQueue((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const current = prev[0];
      if (current.warningAreaId) {
        setActiveWarningId((prevId) => (prevId === current.warningAreaId ? null : prevId));
        setWarningPopup((currentPopup) => {
          if (!currentPopup || currentPopup.areaId !== current.warningAreaId) {
            return currentPopup;
          }
          return null;
        });
      }
      return prev.slice(1);
    });
  };

  const resolveGeolocationError = (error: GeolocationPositionError): string => {
    switch (error.code) {
      case GEOLOCATION_PERMISSION_DENIED:
        return "Izin lokasi ditolak. Aktifkan lokasi/Location di pengaturan browser, lalu muat ulang halaman.";
      case GEOLOCATION_POSITION_UNAVAILABLE:
        return "GPS/mode lokasi tidak aktif atau tidak tersedia. Aktifkan layanan lokasi pada perangkat, pastikan sinyal GPS tersedia, lalu coba lagi.";
      case GEOLOCATION_TIMEOUT:
        return "Waktu ambil lokasi habis. Coba aktifkan GPS dan tunggu beberapa detik.";
      default:
        return error.message || "Terjadi kesalahan saat mengambil lokasi.";
    }
  };

  const classifyGeolocationHealth = (error: GeolocationPositionError) => {
    switch (error.code) {
      case GEOLOCATION_PERMISSION_DENIED:
        return "permission-denied";
      case GEOLOCATION_POSITION_UNAVAILABLE:
        return "provider-off";
      case GEOLOCATION_TIMEOUT:
        return "timeout";
      default:
        return "error";
    }
  };

  const handleLocationError = (error: GeolocationPositionError) => {
    const recentPosition = lastPositionRef.current;
    if (
      error.code === GEOLOCATION_TIMEOUT &&
      recentPosition &&
      Date.now() - recentPosition.timestamp <= RECENT_GPS_GRACE_MS
    ) {
      setGpsHealth("ready");
      return;
    }

    const health = classifyGeolocationHealth(error);
    setGpsHealth(health);

    if (error.code === GEOLOCATION_PERMISSION_DENIED) {
      setPermissionStatus("denied");
      setShowPermissionSheet(isIosBrowser());
    } else if (health === "provider-off") {
      setShowPermissionSheet(isIosBrowser());
    }

    setLocationError(resolveGeolocationError(error));
  };

  const queryPermissionState = async (): Promise<GeolocationPermissionState> => {
    if (!navigator.permissions || !navigator.permissions.query) {
      return "unsupported";
    }

    try {
      const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
      return status.state;
    } catch {
      return "unsupported";
    }
  };

  const requestLocationPermission = async (userInitiated = false) => {
    if (!navigator.geolocation) {
      setGpsHealth("provider-off");
      setPermissionStatus("unsupported");
      setLocationError("Geolocation tidak didukung browser ini.");
      setShowPermissionSheet(false);
      setStartBlockInfo(null);
      return;
    }

    const ios = isIosBrowser();
    const permissionState = await queryPermissionState();
    const isPrompt = permissionState === "prompt" || permissionState === "unknown" || permissionState === "unsupported";

    if (ios && !userInitiated && permissionState !== "granted") {
      if (permissionState === "denied") {
        setGpsHealth("permission-denied");
      } else {
        setGpsHealth("unknown");
      }
      setPermissionStatus(permissionState === "unknown" ? "prompt" : permissionState);
      setShowPermissionSheet(true);
      setStartBlockInfo(null);
      setLocationError(
        permissionState === "denied"
          ? "Izin lokasi ditolak. Izinkan lokasi di pengaturan browser untuk mulai lari."
          : "Aplikasi memerlukan akses lokasi. Tekan tombol di bawah untuk meminta izin."
      );
      return;
    }

    setIsRequestingPermission(true);
    setGpsHealth("checking");
    try {
      const sample = await requestFreshPosition();
      applyLocationPosition(sample);
    } catch (error) {
      const permissionDenied =
        isGeolocationPositionError(error) && error.code === GEOLOCATION_PERMISSION_DENIED;
      if (permissionDenied) {
        setPermissionStatus("denied");
        setGpsHealth("permission-denied");
      } else if (isPrompt) {
        setPermissionStatus("prompt");
        setGpsHealth("unknown");
      }

      if (permissionDenied || ios) {
        setShowPermissionSheet(true);
      }

      if (isGeolocationPositionError(error)) {
        handleLocationError(error);
      } else {
        setLocationError("Gagal mendapatkan lokasi. Coba aktifkan GPS, lalu tekan lagi.");
      }
    } finally {
      setIsRequestingPermission(false);
    }
  };

  const getStartRadiusMeters = (sourceTrack: Track): number =>
    Math.max(5, Math.round(sourceTrack.startRadiusMeters ?? DEFAULT_START_RADIUS_METERS));

  const assessStartProximity = (sourceTrack: Track, sample: SessionSample) => {
    const radiusMeters = getStartRadiusMeters(sourceTrack);
    const distanceMeters = haversineMeters(sample, sourceTrack.startAt);
    return {
      radiusMeters,
      distanceMeters,
      isWithinRadius: distanceMeters <= radiusMeters,
    };
  };

  const getMaxAllowedStartAccuracy = (radiusMeters: number): number => {
    const conservativeMax = Math.max(6, Math.round(radiusMeters * 1.2));
    return Math.min(conservativeMax, 25);
  };

  const isStartSampleReliable = (sourceTrack: Track, sample: SessionSample): boolean => {
    const { radiusMeters, distanceMeters } = assessStartProximity(sourceTrack, sample);
    const accuracy = sample.accuracy;
    const maxAccuracy = getMaxAllowedStartAccuracy(radiusMeters);

    const isAccuracyValid =
      typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > 0 && accuracy <= maxAccuracy;

    return distanceMeters <= radiusMeters && isAccuracyValid;
  };

  const finishSession = () => {
    const current = sessionRef.current;
    if ((current.status !== "running" && current.status !== "paused") || !current.startedAt) {
      return;
    }

    const now = Date.now();
    const latestPosition =
      lastPositionRef.current ?? current.samples[current.samples.length - 1] ?? null;
    const finishedSession = completeSessionAtPosition({
      session: current,
      endedAt: now,
      position: latestPosition,
    });
    applySession(finishedSession);
    setActiveTab("metrics");
    setIsSheetCollapsed(false);
    resetProgressTracking();

    setLocationError(null);
    setActiveWarningId(null);
    offRouteStateRef.current = { outside: false, lastShown: 0 };
    setFollowUser(false);

    if (useSoundAndHapticRef.current) {
      triggerVibrate("success");
    }
    if (useSystemNotificationsRef.current && track) {
      void (async () => {
        await closeRunSystemNotifications();
        await deliverSystemNotification(
          buildRunNotificationPayload({
            kind: "finished",
            trackName: track.name,
            metrics: resolveNotificationMetrics(finishedSession),
          })
        );
      })();
    }
  };

  const pauseSession = (): boolean => {
    const current = sessionRef.current;
    if (current.status !== "running" || !current.startedAt) {
      return false;
    }

    const now = Date.now();
    const pausedSession: RunSession = {
      ...current,
      status: "paused",
      pausedAt: now,
      durationSeconds: calculateActiveDurationSeconds({
        startedAt: current.startedAt,
        currentTimestamp: now,
        totalPausedMilliseconds: current.totalPausedMilliseconds,
      }),
      persisted: false,
    };
    applySession(pausedSession);
    setFollowUser(false);
    if (!functionalTestActiveRef.current) {
      enqueueToast({
        title: "Sesi Dijeda",
        message: "Progres, jarak, pace, dan durasi aktif dihentikan sementara.",
        severity: "info",
        autoHideMs: 4000,
      });
      if (track) {
        void deliverSystemNotification(
          buildRunNotificationPayload({
            kind: "paused",
            trackName: track.name,
            metrics: resolveNotificationMetrics(pausedSession),
          })
        );
      }
    }
    return true;
  };

  const resumeSession = (): boolean => {
    const current = sessionRef.current;
    if (current.status !== "paused" || !current.startedAt || !current.pausedAt) {
      return false;
    }

    const now = Date.now();
    const latestPosition = lastPositionRef.current;
    const resumeBaseline: SessionSample | null = latestPosition
      ? {
          ...latestPosition,
          timestamp: now,
          routeProgressMeters: current.routeProgressMeters,
        }
      : null;

    const resumedSession: RunSession = {
      ...current,
      status: "running",
      pausedAt: null,
      totalPausedMilliseconds:
        current.totalPausedMilliseconds + Math.max(0, now - current.pausedAt),
      samples: resumeBaseline
        ? [...current.samples.slice(-299), resumeBaseline]
        : current.samples,
    };
    applySession(resumedSession);
    setFollowUser(true);
    if (!functionalTestActiveRef.current) {
      enqueueToast({
        title: "Sesi Dilanjutkan",
        message: "Tracking aktif kembali dari posisi Anda saat ini.",
        severity: "info",
        autoHideMs: 4000,
      });
      if (track) {
        void deliverSystemNotification(
          buildRunNotificationPayload({
            kind: "resumed",
            trackName: track.name,
            metrics: resolveNotificationMetrics(resumedSession),
          })
        );
      }
    }
    return true;
  };

  const startSession = async () => {
    if (!track) {
      return;
    }

    if (useSoundAndHapticRef.current) {
      prepareWarningSounds();
    }

    setLocationError(null);
    setStartBlockInfo(null);

    if (!navigator.geolocation) {
      const message = "Geolocation tidak didukung browser ini. Anda harus mengaktifkan GPS untuk mulai sesi.";
      showStartBlockDialog("Gagal Memulai Sesi", message);
      setLocationError(message);
      return;
    }

    const ios = isIosBrowser();
    if (ios && permissionStatus !== "granted") {
      setShowPermissionSheet(true);
      setLocationError("Berikan izin lokasi terlebih dahulu untuk memulai sesi.");
      return;
    }

    const messageRadius = getStartRadiusMeters(track);

    try {
      let currentPosition = getRecentPositionForStart();
      const maxStartAccuracy = getMaxAllowedStartAccuracy(messageRadius);

      if (!currentPosition) {
        setLocationError("Mencari lokasi Anda...");
        currentPosition = await requestFreshPosition({
          timeoutMs: START_POSITION_TIMEOUT_MS,
          maximumAgeMs: START_POSITION_MAX_AGE_MS,
        });
      }

      if (typeof currentPosition.accuracy !== "number" || currentPosition.accuracy > maxStartAccuracy) {
        const quickPosition = await requestFreshPosition({
          timeoutMs: START_POSITION_TIMEOUT_MS + 2000,
          maximumAgeMs: 2000,
        });

        if (
          typeof quickPosition.accuracy === "number" &&
          quickPosition.timestamp >= Date.now() - MAX_START_GPS_STALE_AGE_MS &&
          quickPosition.accuracy <= maxStartAccuracy
        ) {
          currentPosition = quickPosition;
        }
      }

      if (currentPosition.timestamp < Date.now() - MAX_START_GPS_STALE_AGE_MS) {
        const message = "Data lokasi terlalu lama. Coba segarkan GPS lalu tekan mulai lagi.";
        showStartBlockDialog("Data Lokasi Belum Stabil", message);
        setLocationError(message);
        return;
      }

      const { isWithinRadius, distanceMeters } = assessStartProximity(track, currentPosition);

      if (!isWithinRadius) {
        const message = `Anda tidak berada di dalam radius start. Jarak saat ini ${Math.round(distanceMeters)}m (maksimal ${messageRadius}m).`;
        showStartBlockDialog("Belum di Area Start", message);
        setLocationError(message);
        return;
      }

      const { accuracy } = currentPosition;
      if (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy <= 0) {
        const message = "Akurasi GPS tidak tersedia. Coba aktifkan lokasi dengan sinyal yang lebih baik.";
        showStartBlockDialog("Akurasi GPS Belum Stabil", message);
        setLocationError(message);
        return;
      }

      if (accuracy > maxStartAccuracy) {
        const message = `Akurasi GPS tidak stabil (±${Math.round(accuracy)}m). Maksimum yang diizinkan untuk memulai: ±${maxStartAccuracy}m.`;
        showStartBlockDialog("Akurasi GPS Tidak Cukup Akurat", message);
        setLocationError(message);
        return;
      }

      if (!isStartSampleReliable(track, currentPosition)) {
        const message = `Lokasi awal tidak valid. Jarak ke titik start ${Math.round(distanceMeters)}m, akurasi ±${Math.round(accuracy)}m.`;
        showStartBlockDialog("Sesi Tidak Bisa Dimulai", message);
        setLocationError(message);
        return;
      }

      if (isSimulating) {
        stopSimulation();
      }

      setLastPosition(currentPosition);
      lastPositionRef.current = currentPosition;
      setLocationError(null);
      setWarningPopup(null);
      setActiveWarningId(null);
      warningStateRef.current = {};
      offRouteStateRef.current = { outside: false, lastShown: 0 };
      resetProgressTracking();
      setFollowUser(true);

      const initialSamples: SessionSample[] = [
        { ...currentPosition, routeProgressMeters: 0 },
      ];
      const closestIndex = 0;

      const startedSession: RunSession = {
        ...createIdleSession(track.id),
        status: "running",
        startedAt: Date.now(),
        samples: initialSamples,
        closestIndex,
      };
      applySession(startedSession);
      lastLiveNotificationKeyRef.current = buildLiveNotificationUpdateKey(
        0,
        0
      );
      if (useSystemNotificationsRef.current) {
        void (async () => {
          await closeRunSystemNotifications();
          await deliverSystemNotification(
            buildRunNotificationPayload({
              kind: "started",
              trackName: track.name,
              metrics: resolveNotificationMetrics(startedSession),
            })
          );
        })();
      }
    } catch (error) {
      const message =
        isGeolocationPositionError(error)
          ? resolveGeolocationError(error)
          : "Gagal mendapatkan lokasi saat ini. Coba aktifkan GPS, lalu tekan mulai lagi.";
      setLocationError(message);
      if (!isGeolocationPositionError(error)) {
        showStartBlockDialog("Tidak Bisa Memulai Sesi", message);
      }
      if (isGeolocationPositionError(error)) {
        handleLocationError(error);
        if (error.code === GEOLOCATION_PERMISSION_DENIED) {
          setStartBlockInfo(null);
        } else {
          showStartBlockDialog("Tidak Bisa Memulai Sesi", message);
        }
      }
    }
  };

  const updateFunctionalTestResult = (
    id: FunctionalTestId,
    status: FunctionalTestStatus,
    message: string
  ) => {
    const next = functionalTestResultsRef.current.map((result) =>
      result.id === id ? { ...result, status, message } : result
    );
    functionalTestResultsRef.current = next;
    setFunctionalTestResults(next);
  };

  const clearFunctionalTestTimers = () => {
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    if (simResumeTimeoutRef.current) {
      clearTimeout(simResumeTimeoutRef.current);
      simResumeTimeoutRef.current = null;
    }
  };

  const finishFunctionalTest = async (current: RunSession) => {
    if (!track) {
      return;
    }

    clearFunctionalTestTimers();
    const now = Date.now();
    const completedSession = createCompletedFunctionalTestSession(current, now);
    const completionStateApplied = applySession(completedSession, {
      allowTimingNormalization: true,
    });

    const finalPosition = completedSession.samples.at(-1);
    const savedFinishPosition = completedSession.finishPosition;
    const distanceToFinish = finalPosition
      ? haversineMeters(finalPosition, track.endAt)
      : Number.POSITIVE_INFINITY;
    const finishRadiusMeters =
      track.endFinishRadiusMeters ?? DEFAULT_FINISH_RADIUS_METERS;
    const completedRequiredLaps =
      completedSession.routeProgressMeters >=
      trackDistance * FUNCTIONAL_TEST_TARGET_LAPS;
    const continuedAfterRequiredLaps =
      completedSession.routeProgressMeters >
      trackDistance * FUNCTIONAL_TEST_TARGET_LAPS;
    const savedLatestPosition =
      finalPosition && savedFinishPosition
        ? haversineMeters(finalPosition, savedFinishPosition) <= 1
        : false;
    const finishedAwayFromOfficialFinish =
      distanceToFinish > finishRadiusMeters;
    const multiLapWorks =
      current.status === "running" &&
      completedRequiredLaps &&
      continuedAfterRequiredLaps;
    updateFunctionalTestResult(
      "multi-lap-loop",
      multiLapWorks ? "passed" : "failed",
      multiLapWorks
        ? `${FUNCTIONAL_TEST_TARGET_LAPS} lap penuh tercapai dan sesi tetap berjalan memasuki lap ${FUNCTIONAL_TEST_TARGET_LAPS + 1}.`
        : `Sesi tidak berhasil melanjutkan progres setelah ${FUNCTIONAL_TEST_TARGET_LAPS} lap.`
    );
    const manualFinishWorks =
      completionStateApplied &&
      completedSession.status === "finished" &&
      Boolean(completedSession.endedAt) &&
      completedRequiredLaps &&
      savedLatestPosition &&
      finishedAwayFromOfficialFinish;
    updateFunctionalTestResult(
      "finish-flow",
      manualFinishWorks ? "passed" : "failed",
      manualFinishWorks
        ? `Sesi selesai manual ${Math.round(distanceToFinish)} m dari checkpoint finish dan posisi terakhir tersimpan.`
        : "Penyelesaian manual atau penyimpanan posisi terakhir gagal."
    );

    const simulatedAchievements = buildAchievementProgress([completedSession]);
    const achievementEngineWorks = simulatedAchievements.some(
      (entry) => entry.definition.id === "first-run" && entry.unlocked
    );

    if (!mapRef.current) {
      updateFunctionalTestResult("map-render", "failed", "Instance peta tidak tersedia.");
    }
    if (functionalTestWarningIdsRef.current.size === 0) {
      updateFunctionalTestResult(
        "warning-engine",
        "failed",
        "Engine warning tidak menghasilkan event."
      );
    }

    for (const result of functionalTestResultsRef.current) {
      if (
        result.id !== "achievement-engine" &&
        (result.status === "pending" || result.status === "running")
      ) {
        updateFunctionalTestResult(
          result.id,
          "failed",
          "Tahap pengujian tidak selesai."
        );
      }
    }

    const coreTestFailed = functionalTestResultsRef.current.some(
      (result) =>
        result.id !== "achievement-engine" && result.status === "failed"
    );
    let achievementCompletionMessage =
      "Sesi uji belum ditambahkan ke progress achievement.";

    if (!achievementEngineWorks) {
      updateFunctionalTestResult(
        "achievement-engine",
        "failed",
        "Engine tidak membuka achievement dari sesi yang sudah selesai."
      );
    } else if (coreTestFailed) {
      updateFunctionalTestResult(
        "achievement-engine",
        "skipped",
        "Sesi tidak disimpan karena pengujian lain belum lulus."
      );
    } else {
      const historyUpdate = buildFunctionalTestHistoryUpdate(
        sessionHistoryRef.current,
        completedSession,
        SESSION_HISTORY_LIMIT
      );
      const firstRunUnlocked = historyUpdate.progress.some(
        (entry) =>
          entry.definition.id === "first-run" && entry.unlocked
      );

      try {
        if (!historyUpdate.sessionRecorded || !firstRunUnlocked) {
          throw new Error(
            "Sesi uji tidak masuk ke perhitungan achievement."
          );
        }

        const protectedHistory = await protectSessionHistory(
          historyUpdate.nextHistory,
          SESSION_HISTORY_LIMIT
        );
        const historySaved = writeLocalStorageItem(
          TRACK_KEY,
          protectedHistory
        );
        if (!historySaved) {
          throw new Error("Browser menolak penyimpanan sesi uji.");
        }
        applySessionHistory(historyUpdate.nextHistory);

        const newlyUnlockedTitles = historyUpdate.newlyUnlocked.map(
          (entry) => entry.definition.title
        );
        achievementCompletionMessage =
          newlyUnlockedTitles.length > 0
            ? `Sesi uji disimpan. Achievement terbuka: ${newlyUnlockedTitles.join(", ")}.`
            : `Sesi uji disimpan sebagai run ke-${historyUpdate.summary.completedRuns}; progress achievement bertambah.`;
        setAchievementStatus(achievementCompletionMessage);
        updateFunctionalTestResult(
          "achievement-engine",
          "passed",
          achievementCompletionMessage
        );
      } catch (error) {
        achievementCompletionMessage =
          error instanceof Error
            ? error.message
            : "Progress achievement gagal disimpan.";
        updateFunctionalTestResult(
          "achievement-engine",
          "failed",
          achievementCompletionMessage
        );
      }
    }

    const failed = functionalTestResultsRef.current.some(
      (result) => result.status === "failed"
    );
    functionalTestActiveRef.current = false;
    isSimulatingRef.current = false;
    setIsSimulating(false);
    setFunctionalTestState(failed ? "failed" : "passed");
    setFollowUser(false);
    setActiveTab("settings");
    resetSession();
    setToastQueue([]);
    enqueueToast({
      title: failed ? "Uji Fungsional Menemukan Masalah" : "Semua Uji Fungsional Lulus",
      message: failed
        ? "Buka Setelan untuk melihat komponen yang gagal."
        : achievementCompletionMessage,
      severity: failed ? "warning" : "info",
      autoHideMs: 7000,
    });
  };

  // Automated route simulation and functional test runner.
  const startSimulation = async () => {
    if (!track || track.waypoints.length === 0) {
      return;
    }
    if (
      !isSimulatingRef.current &&
      (sessionRef.current.status === "running" || sessionRef.current.status === "paused")
    ) {
      enqueueToast({
        title: "Sesi Sedang Aktif",
        message: "Selesaikan atau reset sesi lari sebelum menjalankan uji fungsional.",
        severity: "warning",
      });
      return;
    }

    clearFunctionalTestTimers();
    const initialResults = createFunctionalTestResults();
    functionalTestResultsRef.current = initialResults;
    setFunctionalTestResults(initialResults);
    setFunctionalTestState("running");
    functionalTestActiveRef.current = true;
    functionalTestPauseTriggeredRef.current = false;
    functionalTestWarningIdsRef.current = new Set();
    warningStateRef.current = {};
    offRouteStateRef.current = { outside: false, lastShown: 0 };
    simIndexRef.current = 0;
    resetProgressTracking();
    setIsSimulating(true);
    isSimulatingRef.current = true;
    setFollowUser(true);
    setLocationError(null);
    setStartBlockInfo(null);
    setWarningPopup(null);
    setActiveWarningId(null);
    setToastQueue([]);

    const validTrack =
      track.waypoints.length >= 2 &&
      track.checkpoints.length === 8 &&
      trackDistance > 0 &&
      (track.startRadiusMeters ?? DEFAULT_START_RADIUS_METERS) >= 50 &&
      (track.endFinishRadiusMeters ?? DEFAULT_FINISH_RADIUS_METERS) >= 50;
    updateFunctionalTestResult(
      "track-config",
      validTrack ? "passed" : "failed",
      validTrack
        ? `${track.waypoints.length} titik, 8 checkpoint, radius start/finish valid.`
        : "Data rute, checkpoint, atau radius start/finish tidak valid."
    );

    updateFunctionalTestResult(
      "map-render",
      mapRef.current ? "passed" : "running",
      mapRef.current ? "Peta Leaflet aktif." : "Menunggu instance peta."
    );

    const storageTestKey = `joging-track:functional-test:${Date.now()}`;
    let storageWorks = false;
    let storageMessage =
      "Browser menolak localStorage, IndexedDB, atau WebCrypto.";
    try {
      const signedProbe = await protectSessionHistory([], 1);
      const storageWriteWorks = writeLocalStorageItem(
        storageTestKey,
        signedProbe
      );
      const restoredProbe = await restoreProtectedSessionHistory(
        readLocalStorageItem(storageTestKey),
        1
      );
      storageWorks =
        storageWriteWorks && restoredProbe.status === "verified";
      if (storageWorks) {
        storageMessage =
          "Write, read, signature, dan cleanup penyimpanan lokal berhasil.";
      } else if (restoredProbe.message) {
        storageMessage = restoredProbe.message;
      }
    } catch (error) {
      storageMessage =
        error instanceof Error
          ? error.message
          : storageMessage;
    }
    updateFunctionalTestResult(
      "local-storage",
      storageWorks ? "passed" : "failed",
      storageMessage
    );
    removeLocalStorageItem(storageTestKey);

    try {
      const diagnosticDistance = Math.max(1000, Math.round(trackDistance));
      const diagnosticDuration = 600;
      const diagnosticPace = Math.round(
        (diagnosticDuration / diagnosticDistance) * 1000
      );
      const diagnosticUrl = await buildAchievementCollectionShareUrl(
        window.location.href,
        {
          runnerName: "",
          unlockedAchievementIds: ["first-run"],
          completedRuns: 1,
          totalDistanceMeters: diagnosticDistance,
          totalDurationSeconds: diagnosticDuration,
          averagePaceSecondsPerKm: diagnosticPace,
          bestPaceSecondsPerKm: diagnosticPace,
          longestRunMeters: diagnosticDistance,
          latestRunAt: Date.now(),
        }
      );
      const decoded = await decodeAchievementCollectionHash(
        new URL(diagnosticUrl).hash
      );
      const shareProtocolWorks =
        decoded?.completedRuns === 1 &&
        decoded.unlockedAchievementIds.includes("first-run");
      updateFunctionalTestResult(
        "share-protocol",
        shareProtocolWorks ? "passed" : "failed",
        shareProtocolWorks
          ? `URL profil compact berhasil di-encode dan decode (${diagnosticUrl.length} karakter).`
          : "Data profil berubah setelah decode."
      );
    } catch (error) {
      updateFunctionalTestResult(
        "share-protocol",
        "failed",
        error instanceof Error ? error.message : "Protokol share gagal diuji."
      );
    }

    if (!functionalTestActiveRef.current) {
      return;
    }

    const testSession: RunSession = {
      ...createIdleSession(track.id),
      sessionId: `functional-test-${Date.now()}`,
      status: "running",
      startedAt: Date.now(),
      persisted: true,
    };
    const testSessionStarted = applySession(testSession);
    updateFunctionalTestResult(
      "session-start",
      testSessionStarted ? "passed" : "failed",
      testSessionStarted
        ? "State sesi tervalidasi dan berubah menjadi running."
        : "Validator menolak state awal simulasi."
    );
    if (!testSessionStarted) {
      functionalTestActiveRef.current = false;
      isSimulatingRef.current = false;
      setIsSimulating(false);
      setFunctionalTestState("failed");
      return;
    }
    updateFunctionalTestResult("progress-metrics", "running", "Menunggu pergerakan rute.");
    updateFunctionalTestResult("pause-resume", "running", "Dijadwalkan pada sepertiga rute.");
    updateFunctionalTestResult("warning-engine", "running", "Menunggu zona uji.");
    updateFunctionalTestResult(
      "multi-lap-loop",
      "running",
      `Menunggu lap pertama dan progres menuju lap ${FUNCTIONAL_TEST_TARGET_LAPS}.`
    );
    updateFunctionalTestResult(
      "finish-flow",
      "running",
      `Menunggu ${FUNCTIONAL_TEST_TARGET_LAPS} lap selesai sebelum berhenti di luar checkpoint finish.`
    );
    updateFunctionalTestResult("achievement-engine", "running", "Menunggu sesi selesai.");

    const pauseIndex = Math.max(2, Math.floor(track.waypoints.length / 3));
    const warningIndex = Math.max(1, Math.floor(track.waypoints.length / 2));

    const interval = setInterval(() => {
      if (!functionalTestActiveRef.current) {
        return;
      }
      if (sessionRef.current.status !== "running") {
        return;
      }
      if (mapRef.current) {
        updateFunctionalTestResult("map-render", "passed", "Peta Leaflet aktif.");
      }

      const waypoints = track.waypoints;
      const sampleIndex = simIndexRef.current;
      const maximumSimulationSamples =
        waypoints.length +
        FUNCTIONAL_TEST_TARGET_LAPS * Math.max(1, waypoints.length - 1);

      if (sampleIndex >= maximumSimulationSamples) {
        updateFunctionalTestResult(
          "multi-lap-loop",
          "failed",
          `Progres tidak mencapai ${FUNCTIONAL_TEST_TARGET_LAPS} lap dalam batas simulasi.`
        );
        void finishFunctionalTest(sessionRef.current);
        return;
      }

      const idx =
        sampleIndex < waypoints.length
          ? sampleIndex
          : 1 +
            ((sampleIndex - waypoints.length) %
              Math.max(1, waypoints.length - 1));
      const point = waypoints[idx];
      const sample: SessionSample = {
        lat: point.lat,
        lng: point.lng,
        accuracy: 8,
        timestamp: Date.now(),
      };
      const current = sessionRef.current;
      const previous = current.samples.at(-1);
      const configuredCorridor = track.offRouteThresholdMeters ?? 20;
      const simulatedSampleJumpMeters = previous
        ? haversineMeters(previous, sample) + configuredCorridor + 5
        : 80;
      const routeProgressResult = advanceContinuousRouteProgress({
        point: sample,
        previousPoint: previous,
        waypoints,
        cumulativeDistances,
        currentWaypointIndex: maxProgressWaypointIndexRef.current,
        currentTotalProgressMeters: current.routeProgressMeters,
        reachRadiusMeters: Math.max(12, configuredCorridor),
        routeCorridorMeters: configuredCorridor,
        maxSampleJumpMeters: Math.max(80, simulatedSampleJumpMeters),
        isLoop: isLoopTrack,
      });
      const distanceMeters = routeProgressResult.routeProgressMeters;
      const durationSeconds = Math.max(
        0,
        calculateActiveDurationSeconds({
          startedAt: current.startedAt,
          currentTimestamp: sample.timestamp,
          totalPausedMilliseconds: current.totalPausedMilliseconds,
        })
      );
      const pace =
        distanceMeters > 3 && durationSeconds > 0
          ? Number((durationSeconds / 60 / (distanceMeters / 1000)).toFixed(2))
          : 0;
      const maxPace =
        pace > 0 && (current.maxPacePerKm <= 0 || pace < current.maxPacePerKm)
          ? pace
          : current.maxPacePerKm;
      const routeProgressMeters = routeProgressResult.routeProgressMeters;
      const next: RunSession = {
        ...current,
        distanceMeters,
        durationSeconds,
        averagePacePerKm: pace,
        maxPacePerKm: maxPace,
        closestIndex: routeProgressResult.waypointIndex,
        routeProgressMeters,
        samples: [...current.samples.slice(-299), { ...sample, routeProgressMeters }],
        status: "running",
        persisted: true,
      };

      applySession(next);
      setLastPosition(sample);
      lastPositionRef.current = sample;
      maxProgressWaypointIndexRef.current = routeProgressResult.waypointIndex;

      const syntheticWarning: WarningArea = {
        id: "functional-test-zone",
        name: "Zona Uji Otomatis",
        type: "info",
        center: { lat: point.lat, lng: point.lng },
        radiusMeters: 10,
        triggerDistanceMeters: 5,
        message: "Engine geofence berhasil mendeteksi posisi simulasi.",
        cooldownSeconds: 60,
        showOnce: true,
        active: true,
      };
      evaluateWarnings(sample, idx === warningIndex ? [syntheticWarning] : undefined);

      if (distanceMeters > 0 && routeProgressMeters > 0 && durationSeconds > 0 && pace > 0) {
        updateFunctionalTestResult(
          "progress-metrics",
          "passed",
          "Jarak, progress, durasi, dan pace berubah selama simulasi."
        );
      }

      if (idx === pauseIndex && !functionalTestPauseTriggeredRef.current) {
        functionalTestPauseTriggeredRef.current = true;
        simIndexRef.current += 1;
        const paused = pauseSession();
        updateFunctionalTestResult(
          "pause-resume",
          paused ? "running" : "failed",
          paused ? "Pause berhasil; menunggu resume otomatis." : "State tidak berubah menjadi paused."
        );
        simResumeTimeoutRef.current = setTimeout(() => {
          if (!functionalTestActiveRef.current || !paused) {
            return;
          }
          const resumed = resumeSession();
          updateFunctionalTestResult(
            "pause-resume",
            resumed ? "passed" : "failed",
            resumed
              ? "Pause dan resume mempertahankan progres sesi."
              : "State tidak kembali menjadi running."
          );
        }, 700);
        return;
      }

      if (
        routeProgressResult.completedLaps >= 1 &&
        routeProgressMeters > trackDistance &&
        functionalTestResultsRef.current.find(
          (result) => result.id === "multi-lap-loop"
        )?.status !== "passed"
      ) {
        updateFunctionalTestResult(
          "multi-lap-loop",
          "passed",
          `Lap pertama tidak menghentikan sesi; progres berlanjut hingga lap ${routeProgressResult.completedLaps + 1}.`
        );
      }

      const reachedTargetLaps =
        routeProgressResult.completedLaps >= FUNCTIONAL_TEST_TARGET_LAPS;
      const continuedAfterTarget =
        routeProgressMeters >
        trackDistance * FUNCTIONAL_TEST_TARGET_LAPS;

      if (reachedTargetLaps && continuedAfterTarget) {
        void finishFunctionalTest(next);
      } else {
        simIndexRef.current += 1;
      }
    }, FUNCTIONAL_TEST_INTERVAL_MILLISECONDS);

    simIntervalRef.current = interval;
  };

  const stopSimulation = () => {
    const wasRunning = functionalTestActiveRef.current;
    clearFunctionalTestTimers();
    functionalTestActiveRef.current = false;
    isSimulatingRef.current = false;
    setIsSimulating(false);
    resetProgressTracking();

    if (wasRunning) {
      for (const result of functionalTestResultsRef.current) {
        if (result.status === "pending" || result.status === "running") {
          updateFunctionalTestResult(result.id, "skipped", "Tes dihentikan oleh pengguna.");
        }
      }
      setFunctionalTestState("cancelled");
      enqueueToast({
        title: "Uji Fungsional Dihentikan",
        message: "Data pengujian tidak disimpan ke riwayat lari.",
        severity: "info",
      });
    }
    resetSession();
  };

  const evaluateWarnings = (
    sample: SessionSample,
    warningAreasOverride?: WarningArea[]
  ) => {
    if (!track) {
      return;
    }

    const now = sample.timestamp;
    const active: WarningArea[] = (warningAreasOverride ?? track.warningAreas ?? [])
      .filter((entry) => entry.active);
    let winner: WarningEvent | null = null;

    active.forEach((area) => {
      const distanceMeters = haversineMeters(sample, area.center);
      const shouldTrigger = distanceMeters <= area.radiusMeters + area.triggerDistanceMeters;
      if (!shouldTrigger) {
        return;
      }

      const state = warningStateRef.current[area.id] ?? { lastShown: 0, shown: false };
      const cooldownOk = now - state.lastShown >= area.cooldownSeconds * 1000;
      const oneTimeAllowed = !area.showOnce || !state.shown;

      if (!cooldownOk || !oneTimeAllowed) {
        return;
      }

      warningStateRef.current[area.id] = {
        lastShown: now,
        shown: area.showOnce || state.shown,
      };

      const candidate: WarningEvent = {
        areaId: area.id,
        areaName: area.name,
        message: area.message,
        type: area.type,
        distanceMeters,
        timestamp: now,
      };

      if (!winner || distanceMeters < winner.distanceMeters) {
        winner = candidate;
      }
    });

    if (winner) {
      const actualWinner = winner as WarningEvent;
      setWarningPopup(actualWinner);
      setActiveWarningId(actualWinner.areaId);
      if (functionalTestActiveRef.current) {
        functionalTestWarningIdsRef.current.add(actualWinner.areaId);
        updateFunctionalTestResult(
          "warning-engine",
          "passed",
          `Geofence memicu toast "${actualWinner.areaName}".`
        );
      } else {
        setWarningLog((prev) => [actualWinner, ...prev].slice(0, 15));
        void deliverSystemNotification(
          buildRunNotificationPayload({
            kind: "warning",
            title: actualWinner.areaName,
            message: actualWinner.message,
            distanceMeters: actualWinner.distanceMeters,
          })
        );
      }

      if (useSoundAndHapticRef.current) {
        playWarningSound(actualWinner.type);
        triggerVibrate(actualWinner.type);
      }
    }
  };

  const evaluateOffRoute = (
    sample: SessionSample,
    distanceFromRouteMeters: number,
    waypointIndex: number
  ) => {
    if (!track || waypointIndex >= track.waypoints.length - 1) {
      offRouteStateRef.current.outside = false;
      return;
    }

    const thresholdMeters = track.offRouteThresholdMeters ?? 20;
    const accuracyMeters =
      typeof sample.accuracy === "number" && Number.isFinite(sample.accuracy)
        ? Math.max(0, sample.accuracy)
        : 0;

    if (accuracyMeters > Math.max(50, thresholdMeters * 2.5)) {
      return;
    }

    const confirmedDistanceMeters = resolveConfirmedOffRouteDistanceMeters(
      distanceFromRouteMeters,
      accuracyMeters
    );
    if (confirmedDistanceMeters <= thresholdMeters) {
      offRouteStateRef.current.outside = false;
      return;
    }

    const now = sample.timestamp || Date.now();
    const previousState = offRouteStateRef.current;
    if (previousState.outside && now - previousState.lastShown < 30_000) {
      return;
    }

    offRouteStateRef.current = { outside: true, lastShown: now };
    const event: WarningEvent = {
      areaId: "off-route",
      areaName: "Keluar Rute",
      message: `Anda sekitar ${Math.round(confirmedDistanceMeters)}m di luar jalur. Kembali ke garis biru untuk melanjutkan progres.`,
      type: "warning",
      distanceMeters: confirmedDistanceMeters,
      timestamp: now,
    };

    setWarningLog((prev) => [event, ...prev].slice(0, 15));
    enqueueToast({
      title: event.areaName,
      message: event.message,
      severity: event.type,
      distanceMeters: event.distanceMeters,
    });
    void deliverSystemNotification(
      buildRunNotificationPayload({
        kind: "off-route",
        title: event.areaName,
        message: event.message,
        distanceMeters: event.distanceMeters,
      })
    );

    if (useSoundAndHapticRef.current) {
      playWarningSound("warning");
      triggerVibrate("warning");
    }
  };

  // Geolocation updates hook
  useEffect(() => {
    if (!track || isSimulating || permissionStatus !== "granted") {
      return;
    }

    if (!navigator.geolocation) {
      setGpsHealth("provider-off");
      setLocationError("Geolocation tidak didukung browser ini.");
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (position) => {
        const sample = createSessionSample(position);

        setLastPosition(sample);
        lastPositionRef.current = sample;
        setGpsHealth("ready");
        setPermissionStatus("granted");
        setLocationError(null);

        const current = sessionRef.current;
        if (current.status === "running") {
          setLocationError(null);
        }

        if (current.status !== "running" || !track) {
          return;
        }

        const currentAfterValidation = current;
        const previous = currentAfterValidation.samples[currentAfterValidation.samples.length - 1];
        const sampleAccuracy =
          typeof sample.accuracy === "number" && Number.isFinite(sample.accuracy)
            ? sample.accuracy
            : 0;
        const configuredCorridor = track.offRouteThresholdMeters ?? 20;
        const previousAccuracy =
          previous && typeof previous.accuracy === "number" && Number.isFinite(previous.accuracy)
            ? previous.accuracy
            : 0;
        const maxSampleJumpMeters = resolveProgressSampleJumpLimitMeters(
          previous ? sample.timestamp - previous.timestamp : 0,
          sampleAccuracy + previousAccuracy
        );
        const reachRadiusMeters = Math.max(
          12,
          Math.min(30, Math.max(configuredCorridor, sampleAccuracy + 5))
        );
        const completedLapsBefore =
          isLoopTrack && trackDistance > 0
            ? Math.floor(
                currentAfterValidation.routeProgressMeters / trackDistance
              )
            : 0;
        const routeProgressResult = advanceContinuousRouteProgress({
          point: sample,
          previousPoint: previous,
          waypoints: track.waypoints,
          cumulativeDistances,
          currentWaypointIndex: maxProgressWaypointIndexRef.current,
          currentTotalProgressMeters:
            currentAfterValidation.routeProgressMeters,
          reachRadiusMeters,
          routeCorridorMeters: Math.max(configuredCorridor, Math.min(sampleAccuracy + 8, 35)),
          maxSampleJumpMeters,
          isLoop: isLoopTrack,
        });
        const progressWaypointIndex = routeProgressResult.waypointIndex;
        const distanceMeters = routeProgressResult.routeProgressMeters;
        maxProgressWaypointIndexRef.current = progressWaypointIndex;

        const sampleWithProgress: SessionSample = {
          ...sample,
          routeProgressMeters: routeProgressResult.routeProgressMeters,
        };
        const recentSamples = [
          ...currentAfterValidation.samples.slice(-299),
          sampleWithProgress,
        ];

        const durationSeconds = Math.max(
          0,
          calculateActiveDurationSeconds({
            startedAt: currentAfterValidation.startedAt,
            currentTimestamp: sample.timestamp ?? Date.now(),
            totalPausedMilliseconds: currentAfterValidation.totalPausedMilliseconds,
          })
        );

        const pace = calculateRollingPacePerKm(recentSamples);

        const maxPace =
          pace > 0 &&
          (currentAfterValidation.maxPacePerKm <= 0 || pace < currentAfterValidation.maxPacePerKm)
            ? pace
            : currentAfterValidation.maxPacePerKm;

        const next: RunSession = {
          ...currentAfterValidation,
          distanceMeters,
          durationSeconds,
          averagePacePerKm: pace,
          maxPacePerKm: maxPace,
          closestIndex: progressWaypointIndex,
          routeProgressMeters: routeProgressResult.routeProgressMeters,
          samples: recentSamples,
          status: "running",
          persisted: false,
        };

        applySession(next);
        evaluateWarnings(sample);
        evaluateOffRoute(
          sample,
          routeProgressResult.offRouteDistanceMeters,
          progressWaypointIndex
        );

        const notificationMetrics = resolveNotificationMetrics(next);
        const crossedCheckpoint = findLatestCrossedCheckpoint({
          previousProgressMeters:
            currentAfterValidation.routeProgressMeters,
          currentProgressMeters: routeProgressResult.routeProgressMeters,
          lapDistanceMeters: trackDistance,
          isLoop: isLoopTrack,
          cumulativeDistances,
          checkpoints: track.checkpoints,
        });
        if (crossedCheckpoint) {
          void deliverSystemNotification(
            buildRunNotificationPayload({
              kind: "checkpoint",
              checkpointName: crossedCheckpoint.checkpoint.name,
              lapNumber: crossedCheckpoint.lapNumber,
              metrics: notificationMetrics,
            })
          );
        }

        const liveNotificationKey = buildLiveNotificationUpdateKey(
          next.distanceMeters,
          next.durationSeconds
        );
        if (
          liveNotificationKey !== lastLiveNotificationKeyRef.current
        ) {
          lastLiveNotificationKeyRef.current = liveNotificationKey;
          void deliverSystemNotification(
            buildRunNotificationPayload({
              kind: "live",
              trackName: track.name,
              metrics: notificationMetrics,
            })
          );
        }

        if (
          isLoopTrack &&
          routeProgressResult.completedLaps > completedLapsBefore
        ) {
          const distanceToEnd = haversineMeters(sample, track.endAt);
          const completedLap = routeProgressResult.completedLaps;
          const finishPopup: WarningEvent = {
            areaId: `lap-${completedLap}`,
            areaName: `Putaran ${completedLap} Selesai`,
            message:
              "Tracking tetap berjalan. Jarak akan terus bertambah selama Anda mengikuti lintasan, atau tekan Selesai kapan pun.",
            type: "info",
            distanceMeters: distanceToEnd,
            timestamp: Date.now(),
          };
          setWarningPopup(finishPopup);
          setActiveWarningId("finish-line");
          setWarningLog((prev) => [finishPopup, ...prev].slice(0, 15));
          void deliverSystemNotification(
            buildRunNotificationPayload({
              kind: "lap",
              completedLap,
              metrics: notificationMetrics,
            })
          );

          if (useSoundAndHapticRef.current) {
            playWarningSound("info");
            triggerVibrate("info");
          }
        }
      },
      (error) => {
        handleLocationError(error);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 15000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(id);
    };
  }, [
    track,
    cumulativeDistances,
    trackDistance,
    isLoopTrack,
    isSimulating,
    permissionStatus,
  ]);

  useEffect(() => {
    const publishLatestRunStatus = () => {
      if (
        document.visibilityState === "visible" ||
        !track ||
        isSimulatingRef.current
      ) {
        return;
      }

      const current = sessionRef.current;
      if (current.status !== "running") {
        return;
      }

      lastLiveNotificationKeyRef.current = buildLiveNotificationUpdateKey(
        current.distanceMeters,
        current.durationSeconds
      );
      void deliverSystemNotification(
        buildRunNotificationPayload({
          kind: "live",
          trackName: track.name,
          metrics: resolveNotificationMetrics(current),
        })
      );
    };

    document.addEventListener("visibilitychange", publishLatestRunStatus);
    return () => {
      document.removeEventListener(
        "visibilitychange",
        publishLatestRunStatus
      );
    };
  }, [isLoopTrack, track, trackDistance]);

  // Persist paused snapshots and completed sessions in local history.
  useEffect(() => {
    if (session !== sessionRef.current) {
      console.warn(
        "Ignoring a React session value that did not pass the state validator."
      );
      return;
    }
    if (session.sessionId.startsWith("functional-test-")) {
      return;
    }
    const isPersistable = session.status === "paused" || session.status === "finished";
    const hasStatusTimestamp = session.status === "paused"
      ? Boolean(session.pausedAt)
      : Boolean(session.endedAt);

    if (
      !sessionHistoryStorageReady ||
      !isPersistable ||
      session.persisted ||
      !hasStatusTimestamp ||
      !track
    ) {
      return;
    }

    const persistenceKey = `${session.sessionId}:${session.status}:${
      session.pausedAt ?? session.endedAt ?? 0
    }`;
    if (historyPersistenceInFlightRef.current === persistenceKey) {
      return;
    }
    historyPersistenceInFlightRef.current = persistenceKey;
    const persistenceGeneration =
      ++historyPersistenceGenerationRef.current;

    const nextHistory = addSessionToHistory(
      sessionHistoryRef.current,
      session,
      SESSION_HISTORY_LIMIT
    );

    const persistHistory = async () => {
      try {
        const protectedHistory = await protectSessionHistory(
          nextHistory,
          SESSION_HISTORY_LIMIT
        );
        if (
          persistenceGeneration !==
          historyPersistenceGenerationRef.current
        ) {
          return;
        }
        const historySaved = writeLocalStorageItem(
          TRACK_KEY,
          protectedHistory
        );
        if (!historySaved) {
          throw new Error(
            "Penyimpanan browser tidak tersedia atau penuh."
          );
        }

        applySessionHistory(nextHistory);
        const current = sessionRef.current;
        if (
          current.sessionId === session.sessionId &&
          current.status === session.status &&
          current.pausedAt === session.pausedAt &&
          current.endedAt === session.endedAt &&
          !current.persisted
        ) {
          applySession({ ...current, persisted: true });
        }
        enqueueToast({
          title: "Sesi Tersimpan Aman",
          message:
            session.status === "paused"
              ? "Progres jeda ditandatangani dan disimpan di Riwayat."
              : "Hasil lari ditandatangani dan disimpan di Riwayat.",
          severity: "info",
        });
      } catch (error) {
        enqueueToast({
          title: "Riwayat Belum Tersimpan",
          message:
            error instanceof Error
              ? error.message
              : "Kunci perangkat atau penyimpanan browser tidak tersedia.",
          severity: "error",
        });
      } finally {
        if (historyPersistenceInFlightRef.current === persistenceKey) {
          historyPersistenceInFlightRef.current = null;
        }
      }
    };

    void persistHistory();
  }, [
    session,
    sessionHistoryStorageReady,
    track,
  ]);

  const onRecenter = () => {
    setFollowUser(true);
    const target = lastPosition || session.samples[session.samples.length - 1] || null;

    if (target) {
      if (mapRef.current) {
        const map = mapRef.current;
        const targetPosition: [number, number] = [target.lat, target.lng];
        const isMobileViewport = window.matchMedia("(max-width: 900px)").matches;
        const sheetHeight = isMobileViewport
          ? document.querySelector<HTMLElement>(".control-panel")?.getBoundingClientRect().height ?? 0
          : 0;

        map.setView(targetPosition, 18, { animate: false });
        if (sheetHeight > 0) {
          const mapSize = map.getSize();
          const adjustedCenter = map.containerPointToLatLng([
            mapSize.x / 2,
            mapSize.y / 2 + sheetHeight / 2,
          ]);
          map.setView(adjustedCenter, 18, { animate: true });
        } else {
          map.setView(targetPosition, 18, { animate: true });
        }
      }
      return;
    }

    if (navigator.geolocation) {
      setLocationError("Menghubungi GPS...");
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const sample = createSessionSample(position);
          applyLocationPosition(sample);
        },
        (error) => {
          handleLocationError(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
        }
      );
    } else {
      setLocationError("Geolocation tidak didukung browser ini.");
    }
  };

  const onFitRoute = () => {
    if (!mapRef.current || !track) {
      return;
    }

    if (!track.waypoints || track.waypoints.length === 0) {
      return;
    }

    if (track.waypoints.length === 1) {
      mapRef.current.setView([track.waypoints[0].lat, track.waypoints[0].lng], 17, { animate: true });
      return;
    }

    const routeBounds = track.waypoints.map((point) => [point.lat, point.lng] as [number, number]);
    const isMobileViewport = window.matchMedia("(max-width: 900px)").matches;
    const sheetHeight = isMobileViewport
      ? document.querySelector<HTMLElement>(".control-panel")?.getBoundingClientRect().height ?? 0
      : 0;

    mapRef.current.fitBounds(routeBounds, {
      paddingTopLeft: [36, 72],
      paddingBottomRight: [36, Math.max(36, sheetHeight + 28)],
      maxZoom: 18,
    });
  };

  const selectSheetTab = (tab: SheetTab) => {
    setActiveTab(tab);
    setIsSheetCollapsed(false);
  };

  const onSheetHandlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    sheetDragStartYRef.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onSheetHandlePointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    const startY = sheetDragStartYRef.current;
    sheetDragStartYRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (startY === null) {
      return;
    }

    const dragDistance = event.clientY - startY;
    if (Math.abs(dragDistance) < 36) {
      return;
    }

    suppressSheetHandleClickRef.current = true;
    setIsSheetCollapsed(dragDistance > 0);
    window.setTimeout(() => {
      suppressSheetHandleClickRef.current = false;
    }, 0);
  };

  const onSheetHandleClick = () => {
    if (suppressSheetHandleClickRef.current) {
      return;
    }
    setIsSheetCollapsed((current) => !current);
  };

  const primarySessionControl = resolvePrimarySessionControl({
    status: session.status,
    isTesting: isSimulating,
  });
  const canFinishSession =
    !isSimulating &&
    (session.status === "running" || session.status === "paused");

  const onPrimarySessionAction = () => {
    if (isSimulating) {
      stopSimulation();
      return;
    }
    if (sessionRef.current.status === "running") {
      pauseSession();
      return;
    }
    if (sessionRef.current.status === "paused") {
      resumeSession();
      return;
    }
    void startSession();
  };

  const mapWarningAreas = track?.warningAreas ?? [];
  const pageReady = !loadingTrack && track;
  const activeToast = showPermissionSheet || startBlockInfo ? null : toastQueue[0] ?? null;
  const mapStatusLabel =
    session.status === "running"
      ? "Sedang berlari"
      : session.status === "paused"
        ? "Sesi dijeda"
        : session.status === "finished"
          ? "Sesi selesai"
          : "Siap berlari";
  const mapStatusHint =
    session.status === "idle"
      ? isLoopTrack
        ? "Lintasan siap"
        : `${formatDistance(trackDistance)} total`
      : isLoopTrack
        ? `Lap ${routeCycle.currentLapNumber}${
            session.status === "running" && etaRemainingSeconds !== null
              ? ` · ${formatDuration(etaRemainingSeconds)}`
              : ""
          }`
        : session.status === "running" && etaRemainingSeconds !== null
          ? `ETA ${formatDuration(etaRemainingSeconds)}`
          : nextWaypointDistance !== null
            ? `${formatDistance(nextWaypointDistance)} ke CP`
            : `${formatDistance(trackDistance)} total`;
  const compactPace = formatPace(session.averagePacePerKm).replace(" /km", "");

  return (
    <main className={`track-shell ${isSheetCollapsed ? "sheet-collapsed" : ""}`}>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {achievementStatus}
      </span>

      {sharedAchievementCollection ? (
        <section
          className="shared-run-summary-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Profil runner yang dibagikan"
        >
          <button
            type="button"
            className="shared-run-summary-close"
            onClick={closeSharedAchievement}
            aria-label="Tutup profil runner"
          >
            <X size={18} aria-hidden="true" />
          </button>
          <RunnerProfileCard
            runnerName={sharedAchievementCollection.runnerName}
            trackName={track?.name ?? "Singapadu Tengah Run Track"}
            achievements={sharedAchievementCollection.achievements}
            completedRuns={sharedAchievementCollection.completedRuns}
            totalDistanceMeters={sharedAchievementCollection.totalDistanceMeters}
            totalDurationSeconds={sharedAchievementCollection.totalDurationSeconds}
            averagePaceSecondsPerKm={sharedAchievementCollection.averagePaceSecondsPerKm}
            bestPaceSecondsPerKm={sharedAchievementCollection.bestPaceSecondsPerKm}
            longestRunMeters={sharedAchievementCollection.longestRunMeters}
            latestRunAt={sharedAchievementCollection.latestRunAt}
            routePoints={track?.waypoints ?? []}
          />
          <p className="shared-run-summary-note">
            <Shield size={13} aria-hidden="true" />
            <span>
              Signature data utuh · kunci{" "}
              {sharedAchievementCollection.signerFingerprint}. Ini
              memverifikasi payload, bukan identitas pemilik perangkat.
            </span>
          </p>
        </section>
      ) : null}

      {/* Hero: only visible on desktop */}
      <header className="hero">
        <div className="hero-copy">
          <p className="hero-kicker">Single QR Route · Jogging Companion</p>
          <h1>{track ? track.name : "Joging Track Route"}</h1>
          <p>
            {track
              ? `Sesi: ${session.status === "idle" ? "Siap" : session.status === "running" ? "Berjalan" : session.status === "paused" ? "Dijeda" : "Selesai"}`
              : loadingTrack
                ? "Memuat data rute..."
                : "Rute belum tersedia"}
          </p>
        </div>
        <div className="hero-actions">
          {isSimulating ? (
            <span className="status-chip simulation">Uji Otomatis</span>
          ) : null}
          <span className={`status-chip ${statusTone}`}>
            {session.status === "running" ? "Active" : session.status === "paused" ? "Paused" : session.status === "finished" ? "Done" : "Idle"}
          </span>
        </div>
      </header>

      <section className="track-grid">
        <section className="map-stage">
          <div className={`track-map-wrapper theme-${mapTheme}`}>
                {!pageReady ? (
                  <div className="map-placeholder" role="status" aria-live="polite">
                    <Loader2 className="animate-spin" size={32} aria-hidden="true" />
                    <span>{loadingTrack ? "Loading route..." : "Gagal memuat rute."}</span>
                  </div>
                ) : (
                  <>
                <TrackMapDynamic
                  track={track}
                  userPosition={lastPosition}
                  closestIndex={displayClosestIndex}
                  progressPercent={progress}
                  followUser={followUser}
                  activeWarningId={activeWarningId}
                  warningAreas={mapWarningAreas}
                  sessionFinishPosition={
                    session.status === "finished"
                      ? session.finishPosition
                      : null
                  }
                  mapTheme={mapTheme}
                  isSheetCollapsed={isSheetCollapsed}
                  onMapReady={(instance) => {
                    mapRef.current = instance;
                  }}
                  onFollowChange={(follow) => {
                    setFollowUser(follow);
                  }}
                />

                <div
                  className="map-status-card"
                  aria-label={`${mapStatusLabel}. ${routeCycle.completedLaps} lap selesai. Saat ini lap ${routeCycle.currentLapNumber}. Jarak total ${formatDistance(displayedDistance)}. Pace ${compactPace}. ${mapStatusHint}.`}
                >
                  <div className="map-status-heading">
                    <span>
                      <i className={`status-dot ${statusTone} ${isSimulating ? "simulating" : ""}`} />
                      {mapStatusLabel}
                    </span>
                    <strong>{mapStatusHint}</strong>
                  </div>
                  <div className="map-status-metrics">
                    <span>
                      <strong>{routeCycle.completedLaps}</strong>
                      <small>Lap selesai</small>
                    </span>
                    <span>
                      <strong>{formatDistance(displayedDistance)}</strong>
                      <small>Jarak</small>
                    </span>
                    <span>
                      <strong>{compactPace}</strong>
                      <small>Pace /km</small>
                    </span>
                  </div>
                  <span className="map-status-progress" aria-hidden="true">
                    <span style={{ width: `${progress}%` }} />
                  </span>
                </div>

                {/* Floating GPS & Route Control Overlay on Map */}
                <div className="map-actions-overlay">
                  <button 
                    type="button" 
                    className={`overlay-fab ${followUser ? "active" : ""}`} 
                    onClick={onRecenter} 
                    title="Fokus Posisi Saya"
                    aria-label="Pusatkan peta ke posisi saya"
                    aria-pressed={followUser}
                  >
                    <Locate size={20} aria-hidden="true" />
                  </button>
                  <button 
                    type="button" 
                    className="overlay-fab" 
                    onClick={onFitRoute} 
                    title="Lihat Seluruh Rute"
                    aria-label="Tampilkan seluruh rute"
                  >
                    <Map size={20} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={`overlay-fab notification-toggle ${
                      useSystemNotifications ? "active" : ""
                    } ${
                      systemNotificationPermission === "default"
                        ? "needs-permission"
                        : ""
                    } ${
                      systemNotificationPermission === "denied"
                        ? "blocked"
                        : ""
                    }`}
                    onClick={() => {
                      void toggleSystemNotifications();
                    }}
                    disabled={
                      isRequestingSystemNotification ||
                      systemNotificationPermission === "checking"
                    }
                    title={`Notifikasi Sistem: ${systemNotificationActionLabel}`}
                    aria-label={`${systemNotificationActionLabel} notifikasi sistem lari`}
                    aria-pressed={useSystemNotifications}
                  >
                    {useSystemNotifications ? (
                      <Bell size={20} aria-hidden="true" />
                    ) : (
                      <BellOff size={20} aria-hidden="true" />
                    )}
                  </button>
                  <button 
                    type="button" 
                    className="overlay-fab theme-toggle" 
                    onClick={toggleMapTheme} 
                    title={mapTheme === "dark" ? "Mode Terang Peta" : "Mode Gelap Peta"}
                    aria-label={mapTheme === "dark" ? "Gunakan peta terang" : "Gunakan peta gelap"}
                  >
                    {mapTheme === "dark"
                      ? <Sun size={20} aria-hidden="true" />
                      : <Moon size={20} aria-hidden="true" />}
                  </button>
                </div>

                <div className="map-toast-stack">
                  {showPermissionSheet ? (
                    <section
                      className="location-permission-sheet"
                      aria-labelledby="location-permission-title"
                    >
                      <div className="location-permission-content">
                        <h3 id="location-permission-title">Izin Lokasi Diperlukan</h3>
                        <p>{locationPermissionMessage}</p>
                        <button
                          type="button"
                          className="btn-permission-request"
                          onClick={() => requestLocationPermission(true)}
                          disabled={isRequestingPermission}
                        >
                          {isRequestingPermission ? "Meminta Izin..." : "Izinkan Lokasi"}
                        </button>
                        <button
                          type="button"
                          className="btn-permission-cancel"
                          onClick={() => setShowPermissionSheet(false)}
                        >
                          Nanti Saja
                        </button>
                      </div>
                    </section>
                  ) : startBlockInfo ? (
                    <section
                      className="location-permission-sheet"
                      aria-labelledby="start-block-title"
                    >
                      <div className="location-permission-content">
                        <h3 id="start-block-title">{startBlockInfo.title}</h3>
                        <p>{startBlockInfo.message}</p>
                        <button
                          type="button"
                          className="btn-permission-request"
                          onClick={() => {
                            setStartBlockInfo(null);
                            onRecenter();
                          }}
                        >
                          Coba Pusatkan Lokasi Saya
                        </button>
                        <button
                          type="button"
                          className="btn-permission-cancel"
                          onClick={() => setStartBlockInfo(null)}
                        >
                          Mengerti
                        </button>
                      </div>
                    </section>
                  ) : null}

                  {activeToast ? (
                    <div
                      className={`map-warning-toast ${activeToast.severity}`}
                      role={activeToast.severity === "critical" || activeToast.severity === "error" ? "alert" : "status"}
                      aria-live={activeToast.severity === "critical" || activeToast.severity === "error" ? "assertive" : "polite"}
                      aria-atomic="true"
                    >
                      <div className="toast-header">
                        <AlertTriangle size={18} className="toast-icon-svg" aria-hidden="true" />
                        <strong>{activeToast.title}</strong>
                        <button
                          type="button"
                          className="toast-close"
                          onClick={popToast}
                          aria-label="Tutup notifikasi"
                        >
                          <X size={16} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="toast-body">{activeToast.message}</div>
                      {typeof activeToast.distanceMeters === "number" ? (
                        <div className="toast-footer">Jarak: {formatDistance(activeToast.distanceMeters)}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

              </>
            )}
          </div>

          <div className="map-legend">
            <span className="legend-item">
              <i className="legend-dot" style={{ backgroundColor: "#10b981" }} />
              Sisa lintasan berjalan
            </span>
            <span className="legend-item">
              <i className="legend-dot" style={{ backgroundColor: mapTheme === "dark" ? "#0ea5e9" : "#3b82f6" }} />
              Lintasan belum dilewati
            </span>
            <span className="legend-item">
              <i className="legend-dot" style={{ backgroundColor: "#06b6d4" }} />
              Zona info
            </span>
            <span className="legend-item">
              <i className="legend-dot" style={{ backgroundColor: "#f59e0b" }} />
              Zona warning
            </span>
            <span className="legend-item">
              <i className="legend-dot" style={{ backgroundColor: "#f43f5e" }} />
              Zona critical
            </span>
          </div>
        </section>

        {/* Aside Panel / Mobile Bottom Sheet */}
        <aside className={`control-panel ${isSheetCollapsed ? "collapsed" : "expanded"}`}>
          {/* Sheet drag/click handle on Mobile */}
          <button
            type="button"
            className="sheet-handle-container"
            onClick={onSheetHandleClick}
            onPointerDown={onSheetHandlePointerDown}
            onPointerUp={onSheetHandlePointerUp}
            onPointerCancel={() => {
              sheetDragStartYRef.current = null;
            }}
            aria-expanded={!isSheetCollapsed}
            aria-controls="session-panel-content"
            aria-label={isSheetCollapsed ? "Buka detail sesi" : "Tutup detail sesi"}
          >
            <span className="sheet-handle" aria-hidden="true" />
            <span className="sheet-mini-info">
              <span className={`status-dot ${statusTone} ${isSimulating ? "simulating" : ""}`} aria-hidden="true" />
              <span className="mini-track-name">{track?.name ?? "Jogging Route"}</span>
              <span className="mini-stat">{formatDistance(displayedDistance)}</span>
              <span className="mini-stat-sep">•</span>
              <span className="mini-stat">{formatDuration(session.durationSeconds)}</span>
              <span className="mini-chevron" aria-hidden="true">
                {isSheetCollapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </span>
            </span>
          </button>

          {/* Quick Primary Actions at the top of bottom sheet - always visible when expanded */}
          <div className="panel-primary-actions">
            <button
              type="button"
              className={`btn-primary-action ${primarySessionControl.mode}`}
              onClick={onPrimarySessionAction}
              disabled={!track}
              aria-label={primarySessionControl.label}
            >
              {primarySessionControl.mode === "pause" ? (
                <Pause size={20} fill="currentColor" aria-hidden="true" />
              ) : primarySessionControl.mode === "stop" ? (
                <X size={20} aria-hidden="true" />
              ) : (
                <Play size={20} fill="currentColor" aria-hidden="true" />
              )}
              <span>{primarySessionControl.label}</span>
            </button>

            {canFinishSession ? (
              <button
                type="button"
                className="btn-session-finish"
                onClick={finishSession}
                aria-label="Selesaikan sesi di posisi saat ini"
                title="Selesaikan dan simpan titik GPS saat ini"
              >
                <Flag size={18} aria-hidden="true" />
                <span>Selesai</span>
              </button>
            ) : null}

            <button
              type="button"
              className="btn-primary-action-recenter"
              onClick={onRecenter}
              title="Pusatkan GPS"
              aria-label="Pusatkan peta ke GPS"
            >
              <Locate size={20} aria-hidden="true" />
            </button>
          </div>

          {/* TAB SYSTEM FOR MOBILE - Hidden on Desktop */}
          <nav className="sheet-tabs" aria-label="Bagian panel sesi">
            <button 
              type="button"
              className={`sheet-tab-btn ${activeTab === "metrics" ? "active" : ""}`}
              onClick={() => selectSheetTab("metrics")}
              aria-pressed={activeTab === "metrics"}
            >
              <Activity size={18} aria-hidden="true" />
              <span>Metrik</span>
            </button>
            <button 
              type="button"
              className={`sheet-tab-btn ${activeTab === "warnings" ? "active" : ""}`}
              onClick={() => selectSheetTab("warnings")}
              aria-pressed={activeTab === "warnings"}
              aria-label={`Zona peringatan${warningLog.length > 0 ? `, ${warningLog.length} riwayat` : ""}`}
            >
              <AlertTriangle size={18} aria-hidden="true" />
              <span>Zona</span>
              {warningLog.length > 0 && <span className="tab-count">{warningLog.length}</span>}
            </button>
            <button 
              type="button"
              className={`sheet-tab-btn ${activeTab === "history" ? "active" : ""}`}
              onClick={() => selectSheetTab("history")}
              aria-pressed={activeTab === "history"}
            >
              <History size={18} aria-hidden="true" />
              <span>Riwayat</span>
            </button>
            <button 
              type="button"
              className={`sheet-tab-btn ${activeTab === "settings" ? "active" : ""}`}
              onClick={() => selectSheetTab("settings")}
              aria-pressed={activeTab === "settings"}
            >
              <Settings size={18} aria-hidden="true" />
              <span>Setelan</span>
            </button>
          </nav>

          {/* TAB CONTENTS - Desktop displays everything, Mobile renders activeTab */}
          <div className="sheet-scrollable-content" id="session-panel-content">
            
            {/* 1. METRICS SECTION */}
            <div className={`panel-section section-metrics ${activeTab === "metrics" ? "mobile-active" : "mobile-hidden"}`}>
              <div className="panel-section-title">Metrik Live</div>
              
              {/* Completed laps and total distance display */}
              <div className="metrics-dashboard">
                <div className="dashboard-circular-progress">
                  <svg
                    className="progress-ring"
                    viewBox="0 0 120 120"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <circle className="progress-ring-bg" cx="60" cy="60" r="52" />
                    <circle 
                      className="progress-ring-indicator" 
                      cx="60" 
                      cy="60" 
                      r="52" 
                      style={{ strokeDashoffset: String(326.7 - (326.7 * progress) / 100) }} 
                    />
                  </svg>
                  <div className="progress-value-center">
                    <span className="lap-count">{routeCycle.completedLaps}</span>
                    <span className="lbl">Lap selesai</span>
                  </div>
                </div>

                <div className="dashboard-main-stat">
                  <span className="lbl">Jarak Tempuh</span>
                  <strong className="val glow-text">{formatDistance(displayedDistance)}</strong>
                </div>
              </div>

              <div className="grid-stats">
                <div className="metric">
                  <span className="metric-icon timer-icon"><Timer size={20} /></span>
                  <div className="metric-body">
                    <span>Durasi</span>
                    <strong>{formatDuration(session.durationSeconds)}</strong>
                  </div>
                </div>
                <div className="metric">
                  <span className="metric-icon pace-icon"><Zap size={20} /></span>
                  <div className="metric-body">
                    <span>Pace</span>
                    <strong>{formatPace(session.averagePacePerKm)}</strong>
                  </div>
                </div>
                <div className="metric">
                  <span className="metric-icon max-pace-icon"><Flame size={20} /></span>
                  <div className="metric-body">
                    <span>Pace Maks</span>
                    <strong>{formatPace(session.maxPacePerKm)}</strong>
                  </div>
                </div>
                <div className="metric">
                  <span className="metric-icon remain-icon"><Navigation size={20} /></span>
                  <div className="metric-body">
                    <span>{isLoopTrack ? "Sisa Putaran" : "Sisa Rute"}</span>
                    <strong>{formatDistance(remainingDistance)}</strong>
                  </div>
                </div>
                <div className="metric span-2">
                  <span className="metric-icon gps-icon"><MapPin size={20} /></span>
                  <div className="metric-body">
                    <span>Posisi Saat Ini & Akurasi</span>
                    <strong>
                      {lastPosition 
                        ? `${lastPosition.lat.toFixed(6)}, ${lastPosition.lng.toFixed(6)}`
                        : "Menunggu GPS..."}
                    </strong>
                    <span className="accuracy-indicator-text">
                      {lastPosition?.accuracy 
                        ? `Akurasi GPS: ±${lastPosition.accuracy.toFixed(1)}m `
                        : ""}
                      {lastPosition && (
                        <span className={`signal-dot ${
                          (lastPosition.accuracy ?? 99) < 12 ? "good" : (lastPosition.accuracy ?? 99) < 35 ? "fair" : "poor"
                        }`} />
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {session.status === "finished" ? (
                <section className="achievement-completion-card" aria-labelledby="achievement-current-title">
                  <div className="achievement-completion-heading">
                    <Award size={24} aria-hidden="true" />
                    <div>
                      <h2 id="achievement-current-title">Progress Achievement Diperbarui</h2>
                      <p>
                        {achievementSummary.completedRuns} run selesai · total{" "}
                        {formatDistance(achievementSummary.totalDistanceMeters)}
                      </p>
                    </div>
                  </div>

                  {latestUnlockedAchievement ? (
                    <div className={`achievement-latest tier-${latestUnlockedAchievement.definition.tier}`}>
                      <span className="achievement-latest-icon">
                        <AchievementIcon name={latestUnlockedAchievement.definition.icon} size={26} />
                      </span>
                      <span>
                        <small>Achievement terbaru</small>
                        <strong>{latestUnlockedAchievement.definition.title}</strong>
                      </span>
                    </div>
                  ) : (
                    <p className="achievement-completion-note">
                      Selesaikan run pertama untuk membuka achievement.
                    </p>
                  )}

                  <div className="achievement-completion-actions">
                    <button
                      type="button"
                      className="btn-achievement-view"
                      onClick={() => {
                        setActiveTab("history");
                        setIsSheetCollapsed(false);
                      }}
                    >
                      <Trophy size={18} aria-hidden="true" />
                      <span>Lihat Profil Achievement</span>
                    </button>
                  </div>
                </section>
              ) : null}

              {insecureContext ? (
                <div className="alert warning-alert">
                  <AlertTriangle size={18} className="alert-icon-svg" />
                  <div className="alert-content">
                    <strong>Koneksi Tidak Aman (HTTP)</strong>
                    <div>Browser memblokir izin GPS pada HTTP. Silakan gunakan HTTPS (SSL) atau aktifkan fitur Simulasi Rute di tab Setelan untuk mencoba.</div>
                  </div>
                </div>
              ) : locationError ? (
                <div className="alert warning-alert">
                  <AlertTriangle size={18} className="alert-icon-svg" />
                  <div className="alert-content">
                    <strong>Koneksi Geolocation</strong>
                    <div>{locationError}</div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* 2. WARNINGS LOG SECTION */}
            <div className={`panel-section section-warnings ${activeTab === "warnings" ? "mobile-active" : "mobile-hidden"}`}>
              <div className="panel-section-title">Riwayat Deteksi Zona</div>
              <div className="history-list">
                {warningLog.length === 0 ? (
                  <div className="empty-state">
                    <Shield size={36} className="empty-icon-svg" />
                    <span>Belum ada deteksi zona warning. Geofence aktif saat Anda berjalan mendekati area bahaya.</span>
                  </div>
                ) : (
                  warningLog.map((item) => {
                    const when = new Date(item.timestamp).toLocaleTimeString();
                    return (
                      <div key={`${item.areaId}-${item.timestamp}`} className={`warning-item-row ${item.type}`}>
                        <div className="row-meta">
                          <span className={`severity-tag ${item.type}`}>{item.type.toUpperCase()}</span>
                          <span className="time">{when}</span>
                        </div>
                        <strong className="zone-name">{item.areaName}</strong>
                        <p className="zone-msg">{item.message}</p>
                        <span className="zone-dist">Jarak pemicu: {formatDistance(item.distanceMeters)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 3. RUN HISTORY SECTION */}
            <div className={`panel-section section-history ${activeTab === "history" ? "mobile-active" : "mobile-hidden"}`}>
              <div className="panel-section-title">Riwayat Sesi</div>
              <section className="achievement-showcase" aria-labelledby="achievement-showcase-title">
                <div className="achievement-showcase-heading">
                  <div>
                    <span className="achievement-eyebrow">Profil lokal</span>
                    <h2 id="achievement-showcase-title">Profil Lari</h2>
                    <p>
                      Trophy Case · {unlockedAchievements.length} dari {achievementProgress.length} terbuka
                    </p>
                  </div>
                  <Trophy size={28} aria-hidden="true" />
                </div>

                <div className="achievement-summary-grid" aria-label="Ringkasan achievement">
                  <div>
                    <strong>{achievementSummary.completedRuns}</strong>
                    <span>Run selesai</span>
                  </div>
                  <div>
                    <strong>{formatDistance(achievementSummary.totalDistanceMeters)}</strong>
                    <span>Total jarak</span>
                  </div>
                </div>

                <div className="run-summary-share-block">
                  <RunnerProfileCard
                    runnerName=""
                    trackName={track?.name ?? "Singapadu Tengah Run Track"}
                    achievements={unlockedAchievements.map((entry) => entry.definition)}
                    completedRuns={achievementSummary.completedRuns}
                    totalDistanceMeters={achievementSummary.totalDistanceMeters}
                    totalDurationSeconds={achievementSummary.totalDurationSeconds}
                    averagePaceSecondsPerKm={achievementSummary.averagePaceSecondsPerKm}
                    bestPaceSecondsPerKm={achievementSummary.bestPaceSecondsPerKm}
                    longestRunMeters={achievementSummary.longestRunMeters}
                    latestRunAt={achievementSummary.latestRunAt}
                    routePoints={track?.waypoints ?? []}
                  />
                  <div className="runner-profile-share-actions">
                    <button
                      type="button"
                      className="btn-run-summary-share"
                      onClick={onShareRunnerProfile}
                      disabled={
                        unlockedAchievements.length === 0 ||
                        isSharingRunnerProfile ||
                        isSharingProfileImage
                      }
                    >
                      {isSharingRunnerProfile ? (
                        <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Link2 size={18} aria-hidden="true" />
                      )}
                      <span>
                        {isSharingRunnerProfile ? "Menyiapkan..." : "Bagikan Profil"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn-run-summary-share image"
                      onClick={onShareRunnerProfileImage}
                      disabled={
                        unlockedAchievements.length === 0 ||
                        isSharingProfileImage ||
                        isSharingRunnerProfile
                      }
                    >
                      {isSharingProfileImage ? (
                        <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <ImageDown size={18} aria-hidden="true" />
                      )}
                      <span>
                        {isSharingProfileImage ? "Membuat PNG..." : "Bagikan PNG"}
                      </span>
                    </button>
                  </div>
                  <p>
                    Bagikan profil sebagai tautan atau gambar PNG.
                  </p>
                </div>

                <div className="achievement-grid">
                  {achievementProgress.map((entry) => {
                    const definition = entry.definition;
                    const unlockedDate = entry.unlockedAt
                      ? new Date(entry.unlockedAt).toLocaleDateString("id-ID")
                      : null;

                    return (
                      <article
                        key={definition.id}
                        className={`achievement-card tier-${definition.tier} ${entry.unlocked ? "unlocked" : "locked"}`}
                      >
                        <div className="achievement-card-top">
                          <span className="achievement-card-icon">
                            <AchievementIcon name={definition.icon} size={28} />
                          </span>
                          <span className="achievement-tier">
                            {ACHIEVEMENT_TIER_LABELS[definition.tier]}
                          </span>
                        </div>
                        <h3>{definition.title}</h3>
                        <p>{definition.description}</p>
                        <div
                          className="achievement-progress"
                          role="progressbar"
                          aria-label={`Progres ${definition.title}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(entry.progressPercent)}
                        >
                          <span style={{ width: `${entry.progressPercent}%` }} />
                        </div>
                        <span className="achievement-progress-label">{entry.progressLabel}</span>

                        {entry.unlocked ? (
                          <div className="achievement-card-footer">
                            <span className="achievement-unlocked-label">
                              <Medal size={14} aria-hidden="true" />
                              Terbuka {unlockedDate}
                            </span>
                          </div>
                        ) : (
                          <span className="achievement-locked-label">
                            <LockKeyhole size={14} aria-hidden="true" />
                            Terkunci
                          </span>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>

              <h2 className="run-history-title">Riwayat Run</h2>
              <div className="history-list">
                {sessionHistory.length === 0 ? (
                  <div className="empty-state">
                    <Trophy size={36} className="empty-icon-svg" />
                    <span>Belum ada sesi lari yang disimpan. Jeda atau selesaikan lari untuk menyimpan progres di sini.</span>
                  </div>
                ) : (
                  sessionHistory.map((entry, index) => {
                    const savedAt = entry.status === "paused" ? entry.pausedAt : entry.endedAt;
                    const endLabel = savedAt ? new Date(savedAt).toLocaleDateString() + " " + new Date(savedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "-";
                    return (
                      <div key={entry.sessionId} className={`session-history-card ${index === 0 ? "latest" : ""}`}>
                        <div className="card-header">
                          <div className="card-date-group">
                            <span className="card-date">{endLabel}</span>
                            {index === 0 ? <span className="latest-history-badge">Terbaru</span> : null}
                            {entry.sessionId.startsWith("functional-test-") ? (
                              <span className="functional-test-history-badge">
                                Uji Otomatis
                              </span>
                            ) : null}
                            <span className={`session-history-status ${entry.status}`}>
                              {entry.status === "paused" ? "Dijeda" : "Selesai"}
                            </span>
                          </div>
                          <Activity size={16} className="card-icon-svg" />
                        </div>
                        <div className="card-body-grid">
                          <div className="card-metric">
                            <span className="lbl">Jarak</span>
                            <strong>{formatDistance(entry.distanceMeters)}</strong>
                          </div>
                          <div className="card-metric">
                            <span className="lbl">Durasi</span>
                            <strong>{formatDuration(entry.durationSeconds)}</strong>
                          </div>
                          <div className="card-metric">
                            <span className="lbl">Pace</span>
                            <strong>{formatPace(entry.averagePacePerKm)}</strong>
                          </div>
                        </div>
                        {entry.status === "finished" && entry.finishPosition ? (
                          <div className="session-finish-location">
                            <MapPin size={14} aria-hidden="true" />
                            <span>
                              Titik selesai{" "}
                              {entry.finishPosition.lat.toFixed(5)},{" "}
                              {entry.finishPosition.lng.toFixed(5)}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 4. SETTINGS SECTION */}
            <div className={`panel-section section-settings ${activeTab === "settings" ? "mobile-active" : "mobile-hidden"}`}>
              <div className="panel-section-title">Setelan Aplikasi</div>
              
              <div className="settings-options-group">
                <div className="setting-notification-row">
                  <div className="setting-info">
                    <strong>
                      {useSystemNotifications ? (
                        <Bell size={18} className="setting-icon-inline" />
                      ) : (
                        <BellOff size={18} className="setting-icon-inline" />
                      )}
                      <span>Notifikasi Sistem</span>
                    </strong>
                    <span>{systemNotificationHelp}</span>
                  </div>
                  <button
                    type="button"
                    className={`btn-notification-setting ${
                      useSystemNotifications ? "active" : ""
                    } ${
                      systemNotificationPermission === "denied" ||
                      systemNotificationPermission === "error"
                        ? "attention"
                        : ""
                    }`}
                    onClick={() => {
                      void toggleSystemNotifications();
                    }}
                    disabled={
                      isRequestingSystemNotification ||
                      systemNotificationPermission === "checking"
                    }
                    aria-pressed={useSystemNotifications}
                  >
                    {isRequestingSystemNotification ? (
                      <Loader2
                        size={16}
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    ) : useSystemNotifications ? (
                      <Bell size={16} aria-hidden="true" />
                    ) : (
                      <BellOff size={16} aria-hidden="true" />
                    )}
                    <span>{systemNotificationActionLabel}</span>
                  </button>
                </div>

                <div className="settings-divider"></div>

                <div className="setting-toggle-row">
                  <div className="setting-info">
                    <strong>
                      <Volume2 size={18} className="setting-icon-inline" />
                      <span>Suara & Getar</span>
                    </strong>
                    <span>Bunyikan notifikasi lokal dan pola getaran sesuai tingkat bahaya saat geofence terpicu.</span>
                  </div>
                  <label className="toggle-switch">
                    <input 
                      type="checkbox" 
                      checked={useSoundAndHaptic} 
                      onChange={toggleSoundAndHaptic}
                      aria-label="Aktifkan suara dan getar peringatan"
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div className="settings-divider"></div>

                <div className={`functional-test-box state-${functionalTestState}`}>
                  <div className="functional-test-heading">
                    <span className="functional-test-icon">
                      <TestTube2 size={20} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>Uji Fungsional Otomatis</strong>
                      <p>
                        Simulasikan dua lap penuh hingga memasuki lap ketiga dan periksa fungsi utama aplikasi dalam sekitar 10 detik.
                      </p>
                    </div>
                  </div>

                  <div className="functional-test-capabilities" aria-label="Cakupan keamanan pengujian">
                    <span><Database size={13} aria-hidden="true" /> Data uji terisolasi</span>
                    <span><Link2 size={13} aria-hidden="true" /> URL compact diuji</span>
                    <span><RotateCcw size={13} aria-hidden="true" /> Multi-lap diuji</span>
                  </div>

                  <div className="functional-test-overview">
                    <div>
                      <span>Status</span>
                      <strong>
                        {functionalTestState === "idle"
                          ? "Belum diuji"
                          : functionalTestState === "running"
                            ? "Sedang menguji"
                            : functionalTestState === "passed"
                              ? "Semua lulus"
                              : functionalTestState === "failed"
                                ? "Ada masalah"
                                : "Dihentikan"}
                      </strong>
                    </div>
                    <div>
                      <span>Hasil</span>
                      <strong>{functionalTestStats.passed}/{functionalTestResults.length} lulus</strong>
                    </div>
                  </div>

                  <div
                    className="functional-test-progress"
                    role="progressbar"
                    aria-label="Progres uji fungsional"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={functionalTestStats.percent}
                  >
                    <span style={{ width: `${functionalTestStats.percent}%` }} />
                  </div>

                  <div className="functional-test-results" aria-live="polite">
                    {functionalTestResults.map((result) => (
                      <div key={result.id} className={`functional-test-result ${result.status}`}>
                        <span className="functional-test-result-icon">
                          {result.status === "passed" ? (
                            <CheckCircle2 size={17} aria-hidden="true" />
                          ) : result.status === "failed" ? (
                            <XCircle size={17} aria-hidden="true" />
                          ) : result.status === "running" ? (
                            <Loader2 size={17} className="animate-spin" aria-hidden="true" />
                          ) : (
                            <CircleDashed size={17} aria-hidden="true" />
                          )}
                        </span>
                        <span>
                          <strong>{result.label}</strong>
                          <small>{result.message}</small>
                        </span>
                      </div>
                    ))}
                  </div>

                  {isSimulating ? (
                    <button
                      type="button"
                      className="btn-functional-test stop"
                      onClick={stopSimulation}
                    >
                      <X size={17} aria-hidden="true" />
                      Hentikan Pengujian
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-functional-test start"
                      onClick={() => {
                        void startSimulation();
                      }}
                      disabled={!track}
                    >
                      {functionalTestState === "idle" ? (
                        <TestTube2 size={17} aria-hidden="true" />
                      ) : (
                        <RotateCcw size={17} aria-hidden="true" />
                      )}
                      {functionalTestState === "idle"
                        ? "Jalankan Semua Tes"
                        : "Ulangi Semua Tes"}
                    </button>
                  )}
                  <p className="functional-test-footnote">
                    Simulasi melewati dua lap lalu selesai di luar checkpoint finish.
                    Sesi yang lulus dihitung sebagai satu run untuk progress achievement;
                    warning sintetis tetap tidak disimpan.
                  </p>
                </div>

                <div className="settings-divider"></div>

                <div className="danger-actions-box">
                  <strong>
                    <AlertTriangle size={18} className="setting-icon-inline text-danger" />
                    <span>Tindakan Data</span>
                  </strong>
                  <button 
                    type="button"
                    className="btn-danger" 
                    onClick={() => {
                      if (confirm("Apakah Anda yakin ingin menghapus semua riwayat sesi lari lokal?")) {
                        historyPersistenceGenerationRef.current += 1;
                        historyPersistenceInFlightRef.current = null;
                        removeLocalStorageItem(TRACK_KEY);
                        applySessionHistory([]);
                        resetSession();
                      }
                    }}
                  >
                    <Trash2 size={14} className="btn-icon-inline" />
                    <span>Hapus Seluruh Riwayat Lari</span>
                  </button>
                </div>
              </div>
            </div>

            <footer className="app-copyright">
              &copy; 2026 KKN PPM PNB Singapadu Tengah
            </footer>
          </div>
        </aside>
      </section>
    </main>
  );
}
