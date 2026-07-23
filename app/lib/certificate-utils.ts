import type { RunSession } from "./types";
import { formatDistance, formatDuration, formatPace } from "./track-utils";

export type CompletionCertificateInput = {
  participantName: string;
  trackName: string;
  session: RunSession;
};

export type CompletionCertificateDetails = {
  participantName: string;
  trackName: string;
  completionLabel: string;
  distanceLabel: string;
  durationLabel: string;
  paceLabel: string;
  certificateId: string;
  filename: string;
};

export const normalizeCertificateName = (value: string): string =>
  value.trim().replace(/\s+/g, " ").slice(0, 60);

const createCertificateId = (sessionId: string): string => {
  const compactId = sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(-12).toUpperCase();
  return `JT-${compactId || "SESSION"}`;
};

const createCertificateFilename = (participantName: string, endedAt: number): string => {
  const safeName = participantName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "peserta";
  const completionDate = new Date(endedAt).toISOString().slice(0, 10);
  return `sertifikat-joging-${safeName}-${completionDate}.png`;
};

export const buildCompletionCertificateDetails = ({
  participantName,
  trackName,
  session,
}: CompletionCertificateInput): CompletionCertificateDetails => {
  const normalizedName = normalizeCertificateName(participantName);
  if (!normalizedName) {
    throw new Error("Nama peserta diperlukan untuk membuat sertifikat.");
  }
  if (session.status !== "finished" || !session.endedAt) {
    throw new Error("Sertifikat hanya tersedia untuk sesi yang sudah selesai.");
  }

  return {
    participantName: normalizedName,
    trackName: trackName.trim() || "Singapadu Jogging Track",
    completionLabel: new Intl.DateTimeFormat("id-ID", {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(session.endedAt)),
    distanceLabel: formatDistance(session.distanceMeters),
    durationLabel: formatDuration(session.durationSeconds),
    paceLabel: formatPace(session.averagePacePerKm),
    certificateId: createCertificateId(session.sessionId),
    filename: createCertificateFilename(normalizedName, session.endedAt),
  };
};

const drawRoundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
};

const setFittedFont = (
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  weight = 700
) => {
  let size = maxSize;
  while (size > minSize) {
    context.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
    if (context.measureText(text).width <= maxWidth) {
      return;
    }
    size -= 2;
  }
  context.font = `${weight} ${minSize}px Arial, Helvetica, sans-serif`;
};

const renderCertificate = (details: CompletionCertificateDetails): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 1131;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Browser tidak mendukung pembuatan gambar sertifikat.");
  }

  const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, "#f8fafc");
  background.addColorStop(0.52, "#ffffff");
  background.addColorStop(1, "#eff6ff");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "#0f172a";
  context.lineWidth = 22;
  context.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);
  context.strokeStyle = "#d4a72c";
  context.lineWidth = 5;
  context.strokeRect(48, 48, canvas.width - 96, canvas.height - 96);
  context.strokeStyle = "#1d4ed8";
  context.lineWidth = 2;
  context.strokeRect(64, 64, canvas.width - 128, canvas.height - 128);

  context.globalAlpha = 0.06;
  context.strokeStyle = "#1d4ed8";
  context.lineWidth = 3;
  for (let offset = -300; offset < 1700; offset += 90) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset + 700, canvas.height);
    context.stroke();
  }
  context.globalAlpha = 1;

  context.beginPath();
  context.arc(800, 155, 66, 0, Math.PI * 2);
  context.fillStyle = "#1d4ed8";
  context.fill();
  context.beginPath();
  context.arc(800, 155, 50, 0, Math.PI * 2);
  context.strokeStyle = "#facc15";
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = "700 34px Arial, Helvetica, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("JT", 800, 156);

  context.fillStyle = "#1e3a8a";
  context.font = "700 27px Arial, Helvetica, sans-serif";
  context.fillText("SINGAPADU JOGGING TRACK", 800, 255);

  context.fillStyle = "#0f172a";
  context.font = "700 58px Georgia, 'Times New Roman', serif";
  context.fillText("SERTIFIKAT PENYELESAIAN RUTE", 800, 337);

  context.fillStyle = "#475569";
  context.font = "400 25px Arial, Helvetica, sans-serif";
  context.fillText("Diberikan kepada", 800, 407);

  context.fillStyle = "#1d4ed8";
  setFittedFont(context, details.participantName, 1250, 76, 42, 700);
  context.fillText(details.participantName, 800, 492);

  const nameWidth = Math.min(900, Math.max(420, context.measureText(details.participantName).width + 80));
  context.strokeStyle = "#d4a72c";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(800 - nameWidth / 2, 535);
  context.lineTo(800 + nameWidth / 2, 535);
  context.stroke();

  context.fillStyle = "#334155";
  context.font = "400 25px Arial, Helvetica, sans-serif";
  context.fillText("telah menyelesaikan seluruh rute", 800, 596);
  context.fillStyle = "#0f172a";
  setFittedFont(context, details.trackName, 1100, 38, 28, 700);
  context.fillText(details.trackName, 800, 647);

  const metrics = [
    ["JARAK", details.distanceLabel],
    ["DURASI", details.durationLabel],
    ["PACE RATA-RATA", details.paceLabel],
  ];
  const metricWidth = 360;
  const metricGap = 36;
  const metricsStartX = (canvas.width - (metricWidth * 3 + metricGap * 2)) / 2;
  metrics.forEach(([label, value], index) => {
    const x = metricsStartX + index * (metricWidth + metricGap);
    drawRoundedRect(context, x, 710, metricWidth, 128, 18);
    context.fillStyle = "#eff6ff";
    context.fill();
    context.strokeStyle = "#bfdbfe";
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = "#475569";
    context.font = "700 17px Arial, Helvetica, sans-serif";
    context.fillText(label, x + metricWidth / 2, 748);
    context.fillStyle = "#0f172a";
    context.font = "700 31px Arial, Helvetica, sans-serif";
    context.fillText(value, x + metricWidth / 2, 796);
  });

  context.fillStyle = "#334155";
  context.font = "400 22px Arial, Helvetica, sans-serif";
  context.fillText(`Diselesaikan pada ${details.completionLabel}`, 800, 897);

  context.strokeStyle = "#cbd5e1";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(220, 948);
  context.lineTo(1380, 948);
  context.stroke();

  context.textAlign = "left";
  context.fillStyle = "#64748b";
  context.font = "400 17px Arial, Helvetica, sans-serif";
  context.fillText(`ID Sertifikat: ${details.certificateId}`, 220, 990);
  context.fillText("Dibuat secara lokal dari riwayat sesi pada perangkat pengguna.", 220, 1024);

  context.textAlign = "right";
  context.fillStyle = "#1e3a8a";
  context.font = "700 22px Arial, Helvetica, sans-serif";
  context.fillText("Singapadu Jogging Track", 1380, 990);
  context.fillStyle = "#64748b";
  context.font = "400 17px Arial, Helvetica, sans-serif";
  context.fillText("Single QR Route • Local-first", 1380, 1024);

  return canvas;
};

export const downloadCompletionCertificate = async (
  input: CompletionCertificateInput
): Promise<string> => {
  if (typeof document === "undefined") {
    throw new Error("Sertifikat hanya dapat dibuat di browser.");
  }

  const details = buildCompletionCertificateDetails(input);
  const canvas = renderCertificate(details);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("Gagal membuat file sertifikat.");
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = details.filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return details.filename;
};
