# Integrasi domain `joging.1pc.tf` (Traefik homelab)

Tujuan: deploy aplikasi `joging-track` di domain `joging.1pc.tf` menggunakan pola Traefik yang sama seperti stack homelab.

## 1) Prasyarat

- Stack Traefik homelab sudah jalan (port `80/443`, entrypoint `websecure`, resolvers TLS aktif).
- Network Docker `traefik` sudah tersedia (`docker network ls`).
- DNS `joging.1pc.tf` mengarah ke publik IP homelab.

## 2) Bangun dan jalankan service

Di folder project:

```bash
docker compose -f compose.yml up -d --build
```

Perintah ini membuat container dengan port aplikasi internal `3000`, lalu di-route Traefik ke host `joging.1pc.tf` lewat router:

- `traefik.http.routers.joging-track.rule=Host(`joging.1pc.tf`)`
- `traefik.http.routers.joging-track.entrypoints=websecure`
- `traefik.http.routers.joging-track.tls.certresolver=letsencrypt`

## 3) Verifikasi

- Buka `https://joging.1pc.tf`
- Pastikan DNS valid dan response HTTPS sertifikat valid.
- Jika akses 404/502 dari Traefik, cek `docker logs joging-track` dan `docker network ls`.

## 4) Catatan

- Jika Traefik di homelab Anda juga menargetkan satu domain berbeda (misalnya subdomain wildcard), ganti host di label compose lalu deploy ulang.
- Untuk update deploy selanjutnya, jalankan:

```bash
docker compose -f compose.yml up -d --build
```
