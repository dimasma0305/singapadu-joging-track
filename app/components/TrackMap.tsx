"use client";

import { useEffect, useMemo, useRef } from "react";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import type { SessionSample, Track, WarningArea } from "../lib/types";
import { createGoogleStreetViewUrl, haversineMeters } from "../lib/track-utils";

const warningStyles: Record<WarningArea["type"], { color: string; fillColor: string }> = {
  info: { color: "#06b6d4", fillColor: "#0891b2" },
  warning: { color: "#f59e0b", fillColor: "#d97706" },
  critical: { color: "#f43f5e", fillColor: "#e11d48" },
};

function createBadgeIcon(label: string, color: string, pulse: boolean = false) {
  const pulseHtml = pulse 
    ? `<div class="marker-pulse-glow" style="background-color: ${color}; box-shadow: 0 0 12px ${color};"></div>` 
    : "";
  return L.divIcon({
    html: `
      <div class="custom-track-marker">
        ${pulseHtml}
        <div class="marker-body" style="background-color: ${color}; border-color: rgba(255,255,255,0.85); box-shadow: 0 4px 12px ${color}60;">
          <span class="marker-label">${label}</span>
        </div>
      </div>
    `,
    className: "leaflet-custom-marker",
    iconSize: [64, 30],
    iconAnchor: [32, 15],
  });
}

function createUserBadge() {
  return L.divIcon({
    html: `
      <div class="user-beacon-container">
        <div class="user-beacon-radar"></div>
        <div class="user-beacon-pulse"></div>
        <div class="user-beacon-core"></div>
        <div class="user-beacon-label">Anda</div>
      </div>
    `,
    className: "leaflet-user-beacon",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

type TrackMapProps = {
  track: Track;
  userPosition: SessionSample | null;
  closestIndex: number;
  progressPercent: number;
  followUser: boolean;
  activeWarningId: string | null;
  warningAreas: WarningArea[];
  mapTheme?: "dark" | "light";
  isSheetCollapsed?: boolean;
  onMapReady?: (map: L.Map) => void;
  onFollowChange?: (follow: boolean) => void;
};

type MapRuntimeProps = {
  userPosition: SessionSample | null;
  currentTrackCenter: [number, number];
  followUser: boolean;
  isSheetCollapsed: boolean;
  onMapReady?: (map: L.Map) => void;
  onFollowChange?: (follow: boolean) => void;
};

function MapRuntime({
  userPosition,
  currentTrackCenter,
  followUser,
  isSheetCollapsed,
  onMapReady,
  onFollowChange,
}: MapRuntimeProps) {
  const map = useMap();
  const latestTargetRef = useRef<[number, number]>(currentTrackCenter);
  latestTargetRef.current = userPosition
    ? [userPosition.lat, userPosition.lng]
    : currentTrackCenter;

  useEffect(() => {
    onMapReady?.(map);
  }, [map, onMapReady]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 900px)").matches) {
      return;
    }

    const refreshMapAfterSheetTransition = () => {
      map.stop();
      map.invalidateSize({ animate: false, pan: false });
      const [latitude, longitude] = latestTargetRef.current;
      const currentPoint = map.latLngToContainerPoint([latitude, longitude]);
      const offsetY = isSheetCollapsed ? 0 : 64;
      const adjustedLatLng = map.containerPointToLatLng(
        L.point(currentPoint.x, currentPoint.y + offsetY)
      );
      map.setView(adjustedLatLng, map.getZoom() || 16, { animate: false });
      map.invalidateSize({ animate: false, pan: false });
    };

    const transitionTimer = window.setTimeout(refreshMapAfterSheetTransition, 420);
    const settleTimer = window.setTimeout(() => {
      map.invalidateSize({ animate: false, pan: false });
    }, 720);

    return () => {
      window.clearTimeout(transitionTimer);
      window.clearTimeout(settleTimer);
    };
  }, [map, isSheetCollapsed]);

  useEffect(() => {
    if (!followUser || !userPosition) {
      return;
    }

    const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;
    const currentPoint = map.latLngToContainerPoint([userPosition.lat, userPosition.lng]);
    const offsetY = isMobile && !isSheetCollapsed ? 64 : 0;
    const adjustedLatLng = map.containerPointToLatLng(
      L.point(currentPoint.x, currentPoint.y + offsetY)
    );
    map.setView(adjustedLatLng, map.getZoom() || 16, { animate: true });
  }, [map, followUser, isSheetCollapsed, userPosition?.lat, userPosition?.lng]);

  useEffect(() => {
    if (!onFollowChange) {
      return;
    }

    const disableFollow = () => onFollowChange(false);
    const disableFollowOnUserZoom = (event: L.LeafletEvent & { originalEvent?: unknown }) => {
      if (event.originalEvent) {
        onFollowChange(false);
      }
    };
    map.on("dragstart", disableFollow);
    map.on("zoomstart", disableFollowOnUserZoom);
    return () => {
      map.off("dragstart", disableFollow);
      map.off("zoomstart", disableFollowOnUserZoom);
    };
  }, [map, onFollowChange]);

  return null;
}

export default function TrackMap({
  track,
  userPosition,
  closestIndex,
  progressPercent,
  followUser,
  activeWarningId,
  warningAreas,
  mapTheme = "dark",
  isSheetCollapsed = false,
  onMapReady,
  onFollowChange,
}: TrackMapProps) {
  const routePositions = useMemo(
    () => track.waypoints.map((point) => [point.lat, point.lng] as [number, number]),
    [track.waypoints]
  );

  const traveledRoute = useMemo(() => {
    const end = Math.min(Math.max(closestIndex, 0), routePositions.length - 1);
    return routePositions.slice(0, end + 1);
  }, [routePositions, closestIndex]);

  const remainingRoute = useMemo(() => {
    const start = Math.min(Math.max(closestIndex, 0), routePositions.length - 1);
    return routePositions.slice(start);
  }, [routePositions, closestIndex]);

  const isLoop = useMemo(() => {
    return haversineMeters(track.startAt, track.endAt) < 35;
  }, [track.startAt, track.endAt]);
  const startRadiusMeters = Math.max(1, track.startRadiusMeters ?? 50);
  const finishRadiusMeters = Math.max(1, track.endFinishRadiusMeters ?? 50);
  const showFinishArea = progressPercent >= 75;

  const currentTrackCenter: [number, number] = [
    track.startAt.lat,
    track.startAt.lng,
  ];

  const orderedCheckpoints = useMemo(
    () => [...track.checkpoints].sort((a, b) => a.routeIndex - b.routeIndex),
    [track.checkpoints]
  );
  const nextCheckpoint = orderedCheckpoints.find(
    (checkpoint) => checkpoint.routeIndex > closestIndex
  );

  const tileUrl = mapTheme === "dark"
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

  return (
    <MapContainer
      center={currentTrackCenter}
      zoom={16}
      scrollWheelZoom
      zoomControl={false}
      className="track-map"
    >
      <MapRuntime
        userPosition={userPosition}
        currentTrackCenter={currentTrackCenter}
        followUser={followUser}
        isSheetCollapsed={isSheetCollapsed}
        onMapReady={onMapReady}
        onFollowChange={onFollowChange}
      />
      <TileLayer
        attribution='&copy; OpenStreetMap contributors &copy; CARTO'
        url={tileUrl}
        className="carto-map-tiles"
        maxZoom={20}
        subdomains="abcd"
      />

      {routePositions.length >= 2 && (
        <>
          <Polyline
            positions={routePositions}
            pathOptions={{
              color: mapTheme === "dark" ? "#202124" : "#ffffff",
              weight: 11,
              lineCap: "round",
              lineJoin: "round",
              opacity: 0.96,
              className: "route-casing",
            }}
          />
          {traveledRoute.length >= 2 ? (
            <Polyline
              positions={traveledRoute}
              pathOptions={{
                color: "#1a73e8",
                weight: 7,
                lineCap: "round",
                lineJoin: "round",
                opacity: 1,
                className: "route-completed",
              }}
            />
          ) : null}
          <Polyline
            positions={remainingRoute}
            pathOptions={{
              color: mapTheme === "dark" ? "#8ab4f8" : "#4285f4",
              weight: 7,
              opacity: 0.96,
              lineCap: "round",
              lineJoin: "round",
              className: "route-remaining",
            }}
          />
        </>
      )}

      {/* Start & Finish Points */}
      {isLoop ? (
        // For loop track: show single marker starting as START and transitioning to FINISH at 75% progress
        <>
          <Circle
            center={[track.startAt.lat, track.startAt.lng]}
            radius={showFinishArea ? finishRadiusMeters : startRadiusMeters}
            interactive={false}
            pathOptions={{
              color: showFinishArea ? "#ef4444" : "#10b981",
              fillColor: showFinishArea ? "#ef4444" : "#10b981",
              fillOpacity: 0.1,
              weight: 2,
              opacity: 0.85,
              dashArray: "8, 8",
              className: `area-effect-circle ${showFinishArea ? "finish-area-circle" : "start-area-circle"}`,
            }}
          >
            <Tooltip
              permanent
              direction="bottom"
              offset={[0, 18]}
              opacity={1}
              className={`area-effect-label ${showFinishArea ? "finish" : "start"}`}
            >
              {showFinishArea
                ? `Area Finish · ${Math.round(finishRadiusMeters)} m`
                : `Area Start · ${Math.round(startRadiusMeters)} m`}
            </Tooltip>
          </Circle>
          <Marker
            position={[track.startAt.lat, track.startAt.lng]}
            icon={
              showFinishArea
                ? createBadgeIcon("FINISH", "#ef4444", true)
                : createBadgeIcon("START", "#10b981", false)
            }
          />
        </>
      ) : (
        // For point-to-point track: show START at startAt, and at endAt show START at first, changing to FINISH at 50%
        <>
          <Circle
            center={[track.startAt.lat, track.startAt.lng]}
            radius={startRadiusMeters}
            interactive={false}
            pathOptions={{
              color: "#10b981",
              fillColor: "#10b981",
              fillOpacity: 0.1,
              weight: 2,
              opacity: 0.85,
              dashArray: "8, 8",
              className: "area-effect-circle start-area-circle",
            }}
          >
            <Tooltip
              permanent
              direction="bottom"
              offset={[0, 18]}
              opacity={1}
              className="area-effect-label start"
            >
              Area Start · {Math.round(startRadiusMeters)} m
            </Tooltip>
          </Circle>
          <Marker
            position={[track.startAt.lat, track.startAt.lng]}
            icon={createBadgeIcon("START", "#10b981", false)}
          />
          <Circle
            center={[track.endAt.lat, track.endAt.lng]}
            radius={finishRadiusMeters}
            interactive={false}
            pathOptions={{
              color: "#ef4444",
              fillColor: "#ef4444",
              fillOpacity: 0.1,
              weight: 2,
              opacity: 0.85,
              dashArray: "8, 8",
              className: "area-effect-circle finish-area-circle",
            }}
          >
            <Tooltip
              permanent
              direction="bottom"
              offset={[0, 18]}
              opacity={1}
              className="area-effect-label finish"
            >
              Area Finish · {Math.round(finishRadiusMeters)} m
            </Tooltip>
          </Circle>
          <Marker
            position={[track.endAt.lat, track.endAt.lng]}
            icon={createBadgeIcon("FINISH", "#ef4444", showFinishArea)}
          />
        </>
      )}

      {/* Ordered route checkpoints */}
      {orderedCheckpoints
        .filter((checkpoint) => checkpoint.routeIndex > 0)
        .map((checkpoint) => {
          const isNext = checkpoint.id === nextCheckpoint?.id;
          const isPassed = closestIndex >= checkpoint.routeIndex;
          const color = isNext
            ? "#1a73e8"
            : isPassed
              ? "#10b981"
              : checkpoint.streetView
                ? "#f59e0b"
                : "#64748b";
          const compactLabel = checkpoint.name.replace(/\s+/g, "");
          const checkpointIcon = createBadgeIcon(compactLabel, color, isNext);
          checkpointIcon.options.html = `<div class="checkpoint-flag${isNext ? " checkpoint-flag-next" : ""}" style="--checkpoint-flag-color: ${color}"><span>${compactLabel}</span></div>`;
          checkpointIcon.options.className = "checkpoint-flag-icon";
          checkpointIcon.options.iconSize = [50, 42];
          checkpointIcon.options.iconAnchor = [3, 40];

          return (
            <Marker
              key={checkpoint.id}
              position={[checkpoint.lat, checkpoint.lng]}
              icon={checkpointIcon}
              title={`${checkpoint.name}${checkpoint.streetView ? " - Street View" : ""}`}
            >
              <Popup className="checkpoint-popup">
                <div className="checkpoint-popup-content">
                  <strong>{checkpoint.name}</strong>
                  <span>{isPassed ? "Sudah dilewati" : isNext ? "Checkpoint berikutnya" : "Checkpoint rute"}</span>
                  {checkpoint.streetView ? (
                    <a
                      className="street-view-link"
                      href={createGoogleStreetViewUrl(checkpoint)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Buka Street View
                    </a>
                  ) : null}
                </div>
              </Popup>
            </Marker>
          );
        })}

      {/* Warning/Proximity Areas */}
      {warningAreas.map((area) => {
        const style = warningStyles[area.type] || warningStyles.info;
        const isActive = area.id === activeWarningId;
        return (
          <Circle
            key={area.id}
            center={[area.center.lat, area.center.lng]}
            radius={area.radiusMeters}
            pathOptions={{
              color: style.color,
              fillColor: style.fillColor,
              fillOpacity: isActive ? 0.3 : 0.15,
              weight: isActive ? 4 : 2,
              opacity: isActive ? 0.95 : 0.6,
              dashArray: isActive ? "6, 6" : undefined,
              className: `warning-area-circle ${area.type} ${isActive ? "active-geofence" : ""}`,
            }}
          />
        );
      })}

      {/* User Current Position */}
      {userPosition ? (
        <>
          <Circle
            center={[userPosition.lat, userPosition.lng]}
            radius={Math.max(userPosition.accuracy ?? 25, 10)}
            pathOptions={{
              color: "#06b6d4", // Cyan
              fillColor: "#06b6d4",
              fillOpacity: 0.12,
              weight: 1,
              dashArray: "4, 4",
              className: "user-accuracy-circle",
            }}
          />
          <Marker
            position={[userPosition.lat, userPosition.lng]}
            icon={createUserBadge()}
          />
        </>
      ) : null}
    </MapContainer>
  );
}
