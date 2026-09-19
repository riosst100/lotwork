# lotwork

Dashboard lokal untuk mengelola banyak project development: start/stop via tombol, cek konflik port, dan custom domain di localhost lewat Caddy.

## Menjalankan

```
npm install
npm start
```

Buka http://localhost:4400

## Menambah project

Klik "+ Tambah Project" dan isi:
- **Nama** — label bebas
- **Folder (cwd)** — path absolut ke folder project, mis. `D:\kerjaan-2026\projects\my-app`
- **Command** — perintah start, mis. `npm run dev`, `php -S localhost:%PORT% -t public`, `python app.py`
- **Port** — port yang dipakai project. lotwork otomatis mengisi env var `PORT` dengan nilai ini saat start, dan menolak start kalau port sudah dipakai proses lain di luar lotwork, atau sudah didaftarkan project lain.
- **Custom domain** (opsional) — mis. `my-app.local`

## Start/Stop

Klik tombol Start/Stop di tabel. Proses berjalan sebagai child process dari lotwork; log stdout/stderr bisa dilihat lewat tombol "Logs". Menutup lotwork (Ctrl+C) akan menghentikan semua project yang sedang berjalan.

## Custom domain (opsional)

Butuh [Caddy](https://caddyserver.com/) terinstall:

```
winget install CaddyServer.Caddy
```

Setelah isi field domain pada project, klik "Reload Caddy / Sync Domains". Ini akan:
1. Generate `data/Caddyfile` berisi reverse proxy `domain -> localhost:port` per project dengan `tls internal` (HTTPS lokal otomatis).
2. Menjalankan/reload proses Caddy.
3. Menulis entry ke `C:\Windows\System32\drivers\etc\hosts` (block ditandai `# lotwork-managed-start/end`, aman untuk di-sync ulang).

**Catatan:** menulis ke hosts file butuh lotwork dijalankan sebagai Administrator. Kalau tidak berjalan sebagai admin, sync domain lewat tombol akan gagal dan perlu edit hosts manual atau jalankan ulang terminal sebagai admin.

## Data

Semua konfigurasi project disimpan di `data/projects.json` (plain JSON, bisa diedit manual kalau perlu).
