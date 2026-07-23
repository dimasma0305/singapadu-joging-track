# Joging Track (Next.js + Leaflet)

Aplikasi web untuk single-QR jogging track:
- scan QR -> buka route yang sama
- map visual dengan Leaflet
- tracking real-time posisi
- progress & pace
- area warning berbasis jarak (info/warning/critical)
- achievement lokal berdasarkan jumlah run, total jarak, dan pace
- profil runner dengan Trophy Case dan statistik all-time
- share profil lengkap melalui URL ringkas atau PNG sosial 1080 × 1350
- satu tombol sesi kontekstual untuk start, pause, resume, dan finish
- uji fungsional otomatis dari menu Setelan

## Menjalankan

```bash
npm install
npm run dev
```

Buka: `http://localhost:3000/?track=main`

### Jalankan dengan bun

```bash
bun install
bun run dev
```

Buka: `http://localhost:3000/?track=main`

## File penting

- `public/track.json` → konfigurasi rute dan area warning (saat ini mendukung format JSON lintas-lintas, termasuk GeoJSON `FeatureCollection` LineString)
- `app/page.tsx` → halaman utama + engine tracking
- `app/components/TrackMap.tsx` → visualisasi Leaflet
- `app/lib/track-utils.ts` → kalkulasi geospasial dasar
- `app/lib/achievement-utils.ts` → milestone achievement dan protokol URL share
- `app/lib/runner-profile-image.ts` → generator dan share PNG profil

## Profil achievement yang dapat dibagikan

Tombol share hanya tersedia pada profil lengkap, bukan pada achievement
individual. Fragmen `#p=<token>` membawa seluruh Trophy Case, jumlah run, total
kilometer, durasi, pace rata-rata, best pace, run terjauh, dan tanggal.
Profil memakai identitas netral **Pelari Singapadu** dan tidak memiliki input nama.

Payload memakai protokol biner versi 1 dengan varint, bitmask achievement,
kuantisasi angka, checksum CRC-16, dan Base64URL tanpa padding. Fragmen tidak
dikirim ke server dan dapat dibaca sepenuhnya di browser penerima. Tombol
**Bagikan PNG** membuat artwork portrait 1080 × 1350; di perangkat yang mendukung
Web Share file akan diteruskan ke aplikasi sosial, sedangkan browser lain
mengunduh berkas PNG.

## Uji fungsional otomatis

Buka tab **Setelan**, lalu tekan **Jalankan Semua Tes**. Runner menjalankan satu
sesi rute sintetis dan melaporkan 10 pemeriksaan: konfigurasi rute, render peta,
localStorage, protokol share, start, progress/metrik, pause/resume, warning
geofence, finish, dan achievement. Sesi serta warning uji diisolasi dan tidak
masuk ke riwayat pengguna.

Unit test dan production build dapat dijalankan dengan:

```bash
npm test -- --runInBand
npm run build
```

## Deploy ke domain `joging.1pc.tf` (Traefik)

- Build dan jalankan lewat `compose.yml`

```bash
docker compose -f compose.yml up -d --build
```

Dokumen detail deploy: [docs/joging-1pc.tf-deploy.md](./docs/joging-1pc.tf-deploy.md)

## Deploy ke GitHub Pages

Workflow [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml) membangun static export dan melakukan deploy otomatis setiap ada push ke branch `main`.

1. Push repository ke GitHub dengan branch default `main`.
2. Buka **Settings → Pages** pada repository.
3. Pada **Build and deployment → Source**, pilih **GitHub Actions**.
4. Jalankan workflow secara manual atau push commit baru ke `main`.

Konfigurasi build otomatis menangani base path untuk project site (`/<nama-repository>/`) dan root path untuk repository `<user>.github.io`.

Dokumen rancang teknis agent sekarang disimpan di:
- `./AGENTS.md`

## Catatan

- Tidak ada backend/API. Semua state sesi disimpan di `localStorage` browser.
- Untuk produksi, bisa tambah geofence berbentuk poligon dengan mengganti logika evaluasi warning.
