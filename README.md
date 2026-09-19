# lotwork

*[Bahasa Indonesia below](#lotwork-1)*

Local dashboard for managing multiple dev projects: start/stop with a button, port conflict checks, and custom localhost domains via Caddy.

## Setup (one time)

Run **`Setup.bat`** (double-click). This automatically:
1. Installs dependencies & builds `lotwork-server.exe` + `lotwork-control.exe` (if not already built)
2. Installs [Caddy](https://caddyserver.com/) via winget (if missing)
3. Creates a **lotwork** shortcut on the Desktop, set to always run as Administrator (needed for the custom domain feature to write to the hosts file)

## Daily use

Double-click the **lotwork** shortcut on your Desktop. Windows will ask for Administrator permission — click **Yes**.

A small window appears with **START/STOP** buttons:
- **START** — runs `lotwork-server.exe` in the background, then opens the dashboard in your browser via the "Open Dashboard" link
- **STOP** — stops the server and every project currently running

The dashboard can also be opened manually at http://localhost:4400

## Adding a project

Click "+ Tambah Project" and fill in:
- **Nama** — free-form label
- **Folder (cwd)** — absolute path to the project folder, e.g. `D:\kerjaan-2026\projects\my-app`
- **Stack** (optional) — pick from the dropdown (Node.js, Laravel, Django, Flask, etc.) to auto-fill the Command field with a template that already includes the right port flag
- **Command** — the start command; fill in manually if your stack isn't in the list
- **Port** — the port the project uses. lotwork sets the `PORT` env var to this value on start (read automatically by Node.js/Vite/etc.), and for commands that don't read env vars (`php artisan serve`, `python manage.py runserver`, `flask run`, etc.) lotwork automatically appends the matching port flag. lotwork also refuses to start if the port is already in use by another process outside lotwork, or already registered to another project.
- **Custom domain** (optional) — just enter a name (e.g. `my-app`), the `.local` suffix is added automatically

## Start/Stop a project

Click the Start/Stop button in the table. The button disables itself and shows "Starting.../Stopping..." while in progress, to prevent double-clicks. If a project fails to start (e.g. missing dependencies), the Logs panel opens automatically showing the error output.

Each project runs as a child process of lotwork; stdout/stderr logs can be viewed anytime via the "Logs" button. Clicking STOP in the control GUI stops every running project.

## Custom domains

Once Caddy is installed (via `Setup.bat`) and a project has a domain set, lotwork automatically:
1. Generates `data/Caddyfile` with a `domain -> localhost:port` reverse proxy per project, with `tls internal` (automatic local HTTPS)
2. Starts/reloads the Caddy process
3. Writes an entry to `C:\Windows\System32\drivers\etc\hosts` (marked with a `# lotwork-managed-start/end` block, safe to re-sync)

This sync runs automatically whenever: lotwork starts up, or a project with a domain is added/edited/deleted. The "Reload Caddy / Sync Domains" button is still available to trigger it manually (e.g. for troubleshooting).

**Note:** writing to the hosts file requires lotwork to run as Administrator — this is already handled automatically if you use the Desktop shortcut from `Setup.bat`. If the sync fails, the dashboard shows a clear error alert.

## Manual rebuild (for development)

If you change the source code (`server.js`, `public/`, `scripts/gui.ps1`, etc.), rebuild the exes with:

```
npm run build       # rebuild lotwork-server.exe
npm run build:gui   # rebuild lotwork-control.exe
npm run build:all   # both at once
```

To run straight from source without building (dev mode):

```
npm install
npm start
```

## Data

- `data/projects.json` — project list (plain JSON, safe to edit manually if needed)
- `data/Caddyfile`, `data/server.log`, `data/server.pid` — runtime files, regenerated automatically
- The `data/` folder is not committed to git (see `.gitignore`) since its contents are machine-specific

## Moving to another PC

1. Copy/clone the whole `lotwork` folder (you can skip `node_modules/`, it's reinstalled automatically)
2. Run `Setup.bat` on the new PC — it rebuilds the exes, installs Caddy, and creates the Desktop shortcut
3. Re-register your projects through the dashboard (project folder paths are usually different per PC)

---

# lotwork

Dashboard lokal untuk mengelola banyak project development: start/stop via tombol, cek konflik port, dan custom domain di localhost lewat Caddy.

## Instalasi (sekali saja)

Jalankan **`Setup.bat`** (klik dua kali). Ini otomatis:
1. Install dependencies & build `lotwork-server.exe` + `lotwork-control.exe` (kalau belum ada)
2. Install [Caddy](https://caddyserver.com/) lewat winget (kalau belum ada)
3. Buat shortcut **lotwork** di Desktop, di-set agar selalu jalan sebagai Administrator (dibutuhkan supaya fitur custom domain bisa menulis ke hosts file)

## Menjalankan sehari-hari

Klik dua kali shortcut **lotwork** di Desktop. Windows akan minta izin Administrator — klik **Yes**.

Muncul jendela kecil dengan tombol **START/STOP**:
- **START** — menjalankan `lotwork-server.exe` di background, tunggu sebentar lalu buka dashboard di browser via link "Open Dashboard"
- **STOP** — mematikan server beserta semua project yang sedang berjalan

Dashboard bisa dibuka manual di http://localhost:4400

## Menambah project

Klik "+ Tambah Project" dan isi:
- **Nama** — label bebas
- **Folder (cwd)** — path absolut ke folder project, mis. `D:\kerjaan-2026\projects\my-app`
- **Stack** (opsional) — pilih dari dropdown (Node.js, Laravel, Django, Flask, dll) untuk auto-isi field Command dengan template yang sudah include flag port yang benar
- **Command** — perintah start, bisa diisi manual kalau stack tidak ada di daftar
- **Port** — port yang dipakai project. lotwork mengisi env var `PORT` dengan nilai ini saat start (dipakai otomatis oleh Node.js/Vite/dll), dan untuk command yang tidak baca env var (`php artisan serve`, `python manage.py runserver`, `flask run`, dst) lotwork otomatis menambahkan flag port yang sesuai. lotwork juga menolak start kalau port sudah dipakai proses lain di luar lotwork, atau sudah didaftarkan project lain.
- **Custom domain** (opsional) — cukup isi nama (mis. `my-app`), suffix `.local` ditambahkan otomatis

## Start/Stop project

Klik tombol Start/Stop di tabel. Tombol otomatis disabled + menampilkan status "Starting.../Stopping..." selagi diproses, supaya tidak double klik. Kalau project gagal start (mis. dependencies belum diinstall), panel Logs otomatis terbuka menampilkan output error-nya.

Proses berjalan sebagai child process dari lotwork; log stdout/stderr bisa dilihat lewat tombol "Logs" kapan saja. Klik STOP di GUI kontrol akan menghentikan semua project yang sedang berjalan.

## Custom domain

Begitu Caddy terinstall (lewat `Setup.bat`) dan project punya domain terisi, lotwork otomatis:
1. Generate `data/Caddyfile` berisi reverse proxy `domain -> localhost:port` per project dengan `tls internal` (HTTPS lokal otomatis)
2. Menjalankan/reload proses Caddy
3. Menulis entry ke `C:\Windows\System32\drivers\etc\hosts` (block ditandai `# lotwork-managed-start/end`, aman untuk di-sync ulang)

Sync ini berjalan otomatis setiap kali: lotwork baru di-start, project baru ditambah/diedit/dihapus dengan domain. Tombol "Reload Caddy / Sync Domains" tetap tersedia untuk trigger manual (misal untuk troubleshooting).

**Catatan:** menulis ke hosts file butuh lotwork dijalankan sebagai Administrator — ini sudah otomatis kalau kamu pakai shortcut Desktop dari `Setup.bat`. Kalau sync gagal, dashboard akan menampilkan alert dengan pesan error yang jelas.

## Build ulang manual (untuk development)

Kalau mengubah source code (`server.js`, `public/`, `scripts/gui.ps1`, dll), rebuild exe dengan:

```
npm run build       # rebuild lotwork-server.exe
npm run build:gui   # rebuild lotwork-control.exe
npm run build:all   # keduanya sekaligus
```

Untuk jalankan langsung dari source tanpa build (mode dev):

```
npm install
npm start
```

## Data

- `data/projects.json` — daftar project (plain JSON, bisa diedit manual kalau perlu)
- `data/Caddyfile`, `data/server.log`, `data/server.pid` — file runtime, di-generate ulang otomatis
- Folder `data/` tidak ikut di-commit ke git (lihat `.gitignore`) karena isinya spesifik per mesin

## Memindahkan ke PC lain

1. Copy/clone seluruh folder `lotwork` (boleh skip `node_modules/`, akan diinstall ulang otomatis)
2. Jalankan `Setup.bat` di PC baru — akan build ulang exe, install Caddy, dan buat shortcut Desktop
3. Daftarkan ulang project lewat dashboard (path folder project biasanya berbeda per PC)
