# AI Agents Specification: Joging Track Web App

## Tujuan
Mendeskripsikan rancangan implementasi aplikasi jogging web untuk skenario **single QR route** dengan orientasi utama **smartphone-first**.

## Konteks Produk
- Aplikasi berbasis web dipakai di browser mobile setelah pemindaian QR pada satu plang denah.
- QR bersifat tunggal, sehingga URL dan lintasan yang ditampilkan sama untuk semua user.
- Semua fitur inti berjalan di sisi klien (no backend).
- Stack utama yang dipilih: `Next.js` + `Leaflet`.

## Peran Agen
- Menjaga konsistensi implementasi fitur dari desain ke code.
- Memastikan UX bekerja dengan baik pada layar smartphone terlebih dahulu.
- Menghindari perubahan besar yang berisiko memecah alur lari utama.

## Scope Produk
- Single track route (`trackId=main`).
- Satu halaman landing yang otomatis mengarah ke rute default.
- Real-time navigation map, progress, metrik sesi, pause/resume, dan riwayat sesi.
- Delapan checkpoint eksplisit; CP3, CP5, dan CP8 menyediakan tautan Street View.
- Notifikasi peringatan berbasis kedekatan jarak terhadap area yang dikonfigurasi.
- Offline-light / local-first behavior menggunakan `public/track.json` + `localStorage`.

## Non-goal (Untuk fase sekarang)
- Tidak ada autentikasi user.
- Tidak ada multi-route/ multi-QR.
- Tidak ada backend tracking cloud real-time.
- Tidak ada leaderboard sosial.

## Arsitektur
- `app/page.tsx`
  - Orkestrasi state sesi, loading data track, geolocation lifecycle, hitung progress.
- `app/components/TrackMap.tsx`
  - Render peta Leaflet (client-only), rute, posisi pengguna, titik start/finish, dan orientasi heading-up tanpa visual zona warning.
- `app/lib/track-utils.ts`
  - Helper geospasial (`haversine`, jarak kumulatif, durasi/pacing, resolve distance).
- `public/track.json`
  - Sumber data lintasan + area warning.
- `localStorage`
  - Menyimpan sesi selesai dan riwayat lokal.

## Data Model
- `Track`
  - `id`, `name`, `distanceMeters`, `startAt`, `endAt`, `endFinishRadiusMeters`, `offRouteThresholdMeters`, `waypoints`, `checkpoints`, `warningAreas`.
- `TrackCheckpoint`
  - `id`, `name`, `lat`, `lng`, `routeIndex`, `streetView`.
- `WarningArea`
  - `id`, `name`, `type` (`info|warning|critical`), `center`, `radiusMeters`, `triggerDistanceMeters`, `cooldownSeconds`, `showOnce`, `active`, `message`.
- `RunSession`
  - `sessionId`, `trackId`, `status` (`idle|running|paused|finished`), `startedAt`, `endedAt`, `pausedAt`, `totalPausedMilliseconds`, `distanceMeters`, `durationSeconds`, `averagePacePerKm`, `maxPacePerKm`, `samples`, `closestIndex`.

## UX — Smartphone-First
- Layout utama harus map-first di layar portrait:
  - Peta full viewport.
  - Panel kontrol sebagai “bottom sheet” menutup sebagian bawah.
  - Elemen overlay ringkas dan tidak menutupi area peta kritis.
- Kontrol penting tetap besar dan satu-tangan:
  - Start/stop, recenter, fokus route, follow toggle, dan heading-up/utara-di-atas.
- Prioritas visual:
  - Progress, jarak tempuh, pace, ETA tetap terlihat cepat.
  - Warning muncul sebagai toast yang tidak menghalangi gesture peta.
- Hindari tumpang-tindih:
  - Overlay map berada di atas layer peta.
- warning toast selalu di atas panel tindakan ketika aktif.

## Spesifikasi Fitur
- F01 QR entry
  - Buka halaman peta dari URL same-route.
  - Jika track tidak ada, fallback ke `main`.
- F02 Peta navigasi
  - Tampilkan `Polyline` rute, marker start/finish, dan posisi user real-time.
  - Saat sesi dimulai, aktifkan heading-up agar arah lintasan berikutnya berada di atas layar.
  - Prioritaskan heading GPS saat bergerak, lalu bearing pergerakan dan arah waypoint berikutnya sebagai fallback.
  - Sediakan tombol kompas untuk beralih kembali ke orientasi utara-di-atas.
- F03 Tracking sesi
  - Update berdasarkan geolocation.
  - Hitung progress berdasarkan closet index + cumulative distance.
  - Hitung pace dan ETA dari kecepatan historis sesi.
  - Pause membekukan metrik; resume memakai posisi terbaru sebagai baseline.
- F04 Off-route & finish detection
  - Detections berbasis threshold dari konfigurasi track.
- F05 Notifikasi warning proximity
  - Trigger saat posisi masuk radius sesuai `triggerDistanceMeters`.
  - Cegah spam dengan `cooldownSeconds` dan `showOnce`.
  - Area tidak digambar sebagai zona di peta; event ditampilkan sebagai toast dan, jika diizinkan, notifikasi sistem.
  - Mendekati CP5 memicu peringatan “Jalan sempit, awas motor” untuk ruas CP5–CP8.
  - Mendekati CP8 memicu peringatan “Awas, ada anjing” untuk ruas CP8 menuju finish.
- F06 Sesi lokal
  - Simpan histori sesi dan event warning ke localStorage.
- F07 Checkpoint & Street View
  - Tampilkan CP1–CP8 secara berurutan.
  - CP3, CP5, dan CP8 membuka panorama melalui Google Maps URL resmi.

## Kebutuhan Teknik
- Seluruh komponen Leaflet dijalankan client-side:
  - `dynamic(() => import("./components/TrackMap"), { ssr: false })`.
- Rotasi peta menggunakan `leaflet-rotate` yang dimuat client-side.
- Import `leaflet/dist/leaflet.css`.
- Tile map untuk produk awal: OpenStreetMap/CARTO (sesuai legal usage).

## Acceptance Criteria
- Aplikasi terbuka dari QR di smartphone dalam waktu singkat.
- Peta tampil penuh layar.
- Arah awal lintasan selatan tampil menuju atas layar setelah sesi dimulai.
- Posisi pengguna muncul dan diperbarui saat sesi berjalan.
- Progress, jarak tempuh, dan pace tidak freeze.
- Notifikasi warning muncul dalam <1s dari update lokasi dan tidak spam.
- Panel status/sesi tidak menghalangi interaksi peta utama.

## State dan Error Handling
- Izin lokasi ditolak → tampilkan prompt yang jelas dan tindakan lanjut.
- Geolocation hilang/signal jelek → fallback mode tracking terkini, tanpa crash.
- Data rute invalid → fallback default track dan notifikasi.

## Implementasi Saat Ini (Checklist)
- Track source: `public/track.json`.
- Proximity warning: aktif sebagai toast/notifikasi tanpa zona visual di peta.
- Fullscreen map sudah aktif.
- Smartphone mode sebagai mode primer (overlay minim dan panel bawah).

## Lokasi Dokumen
- Spesifikasi sekarang berada di file root:
  - `./AGENTS.md`
