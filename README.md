# lotwork

*[Bahasa Indonesia below](#lotwork-1)*

Local dashboard for managing multiple dev projects: start/stop with a button, port conflict checks, custom localhost domains via Caddy, per-project `.env` editing, saved credentials, GitHub commit/push/pull, and system service monitoring.

## Setup (one time)

Run **`Setup.bat`** (double-click). This automatically:
1. Installs dependencies & builds `lotwork-server.exe` + `lotwork-control.exe` (if not already built)
2. Installs [Caddy](https://caddyserver.com/) via winget (if missing)
3. Creates a **lotwork** shortcut on the Desktop, set to always run as Administrator (needed for the custom domain feature to write to the hosts file, and for starting/stopping system services)

## Daily use

Double-click the **lotwork** shortcut on your Desktop. Windows will ask for Administrator permission — click **Yes**.

A small window appears with **START/STOP** buttons:
- **START** — runs `lotwork-server.exe` in the background, then opens the dashboard in your browser via the "Open Dashboard" link
- **STOP** — stops the server and every project currently running

The dashboard can also be opened manually at http://localhost:4400. On first load, a full-page loading screen appears while initial data is fetched. The header has a language switcher (EN/ID, default English) and a light/dark theme toggle — both remembered per browser.

If Caddy isn't detected (or was just installed but this lotwork process hasn't picked it up yet), a popup explains exactly what to do — install it, or restart lotwork via the control window.

## Adding a project

Click "+ Add Project" and fill in:
- **Project name** — free-form label
- **Folder (cwd)** — absolute path to the project folder, e.g. `D:\kerjaan-2026\projects\my-app`
- **Stack** (optional) — pick from the dropdown (Node.js, Laravel, Django, Flask, etc.) to auto-fill the Command field with a template that already includes the right port flag. If Port is still empty, lotwork also auto-fills it with the next free port for that stack (Node.js from 3001, Laravel/Django from 8001, Flask from 5001, PHP built-in from 8081 — the round-number base itself is always skipped since it's commonly used by other tools). The chosen stack is remembered and re-selected when you edit the project later.
- **Command** — the start command; fill in manually if your stack isn't in the list
- **Port** — the port the project uses. lotwork sets the `PORT` env var to this value on start (read automatically by Node.js/Vite/etc.), and for commands that don't read env vars (`php artisan serve`, `python manage.py runserver`, `flask run`, etc.) lotwork automatically appends the matching port flag. lotwork also refuses to start if the port is already in use by another process outside lotwork, or already registered to another project.
- **Custom domain** (optional) — just enter a name (e.g. `my-app`), the `.local` suffix is added automatically. Subdomains work too — e.g. entering `api.my-app` gives you `api.my-app.local`.

If the project is a Next.js app and you set a domain, lotwork automatically adds that domain to `allowedDevOrigins` in `next.config.ts/js/mjs`, so the dev server doesn't block HMR requests coming through the Caddy proxy. If the config file's format isn't recognized (e.g. wrapped in `withPWA()` or similar), lotwork leaves the file untouched and shows an alert with the line to add manually.

## Project cards

Each project is shown as a card with its status, repo link (or "No remote repo found" if none is configured), last commit message and date, current/main branch, port, domain, command, and when it was last started. Projects are sorted with the most recently started (within the last 8 hours) at the top, then by total start count for the rest.

Four panels can be expanded inline under each card (click again to collapse):
- **Logs** — live stdout/stderr, auto-refreshing every 1.5s while open
- **Edit .env** — reads and writes both `.env` and `.env.local` in the project folder as a key/value list (`.env.local` wins on key collisions, matching Next.js/Vite behavior). Each row shows which file it belongs to; click the badge to move a variable between files.
- **Credentials** — a saved list of login credentials for that project (label, username/email, password, shown in plain text). Click "+ Add Credential" to add one via a popup form, or "Edit"/"Delete" on an existing entry. Copy buttons next to username and password copy the value to your clipboard.
- **GitHub** — see below.

## The "LotWork" entry

The first card in the list is always **LotWork** itself — lotwork's own source repo, shown with a "This app" badge and a pink accent stripe. Its status always reads "Running" (you can only be looking at the dashboard if the server is up), and it has no Start/Stop or Delete button since it's controlled from the control GUI, not the dashboard. Only the **GitHub** panel is available, so you can commit/push/pull changes to lotwork's own codebase from the same dashboard you use for your other projects.

## Start/Stop a project

Click Start/Stop on the card. The button disables itself and polls the project's port until it actually accepts connections (or the process crashes, or ~20s pass), showing "Starting.../Stopping..." the whole time — so the button doesn't turn "Running" before the app can really be opened. If a project fails to start (e.g. missing dependencies), the Logs panel opens automatically showing the error output.

Each project runs as a child process of lotwork. Clicking STOP in the control GUI stops every running project.

## GitHub panel

Click "GitHub" on a card to expand it. If the project has no remote configured yet, you'll first be asked to set one (a plain `git remote add origin <url>`) before anything else is available.

Once a remote exists, the panel shows **Current Branch** and **Master Branch** dropdowns at the top, followed by two mode buttons:
- **Pull Master** — runs, in order: checkout master branch → pull latest from origin → checkout current branch → merge master into current → push current branch. A confirmation dialog lists the exact steps before anything runs. Refuses to start if there are uncommitted changes (commit or stash first). If the merge conflicts, the branch is left in the conflicted state for you to resolve manually — lotwork doesn't try to auto-abort it.
- **Push/Commit Changes** — lists every changed file with a checkbox (checked by default); uncheck anything you don't want included. "Commit & Push" shows a confirmation listing exactly which files will be committed and to which branch before doing anything; the commit message defaults to "Update" if left blank.

## System Services sidebar

Next to the project list, a sidebar shows:
- **Database services** (MySQL, PostgreSQL) — detected as Windows Services, if installed. Each has a Start/Stop toggle. Starting/stopping a service requires Administrator privileges (already the case if you're using the Desktop shortcut).
- **Runtimes** (Node.js, PHP) — shown as installed-version info only, no start/stop (these aren't services).

The sidebar refreshes automatically every 8 seconds.

## Custom domains

Once Caddy is installed (via `Setup.bat`) and a project has a domain set, lotwork automatically:
1. Generates `data/Caddyfile` with a `domain -> localhost:port` reverse proxy per project, with `tls internal` (automatic local HTTPS)
2. Starts/reloads the Caddy process
3. Writes an entry to `C:\Windows\System32\drivers\etc\hosts` (marked with a `# lotwork-managed-start/end` block, safe to re-sync)

This sync runs automatically whenever: lotwork starts up, or a project with a domain is added/edited/deleted. The "Reload Caddy / Sync Domains" button is still available to trigger it manually (e.g. for troubleshooting). You can also install Caddy directly from the dashboard if it's missing — click the red status badge in the header.

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

- `data/projects.json` — project list, including stack choice, start history, and saved credentials (plain JSON, safe to edit manually if needed)
- `data/Caddyfile`, `data/server.log`, `data/server.pid` — runtime files, regenerated automatically
- The `data/` folder is not committed to git (see `.gitignore`) since its contents are machine-specific

---

# lotwork

Dashboard lokal untuk mengelola banyak project development: start/stop via tombol, cek konflik port, custom domain di localhost lewat Caddy, edit `.env` per project, penyimpanan credentials, commit/push/pull GitHub, dan monitoring system service.

## Instalasi (sekali saja)

Jalankan **`Setup.bat`** (klik dua kali). Ini otomatis:
1. Install dependencies & build `lotwork-server.exe` + `lotwork-control.exe` (kalau belum ada)
2. Install [Caddy](https://caddyserver.com/) lewat winget (kalau belum ada)
3. Buat shortcut **lotwork** di Desktop, di-set agar selalu jalan sebagai Administrator (dibutuhkan supaya fitur custom domain bisa menulis ke hosts file, dan untuk start/stop system service)

## Menjalankan sehari-hari

Klik dua kali shortcut **lotwork** di Desktop. Windows akan minta izin Administrator — klik **Yes**.

Muncul jendela kecil dengan tombol **START/STOP**:
- **START** — menjalankan `lotwork-server.exe` di background, tunggu sebentar lalu buka dashboard di browser via link "Open Dashboard"
- **STOP** — mematikan server beserta semua project yang sedang berjalan

Dashboard bisa dibuka manual di http://localhost:4400. Saat pertama kali dimuat, layar loading fullpage muncul selagi data awal di-fetch. Header punya language switcher (EN/ID, default English) dan toggle tema light/dark — keduanya tersimpan per browser.

Kalau Caddy tidak terdeteksi (atau baru saja terinstall tapi proses lotwork ini belum bisa melihatnya), popup akan menjelaskan persis apa yang perlu dilakukan — install, atau restart lotwork lewat window kontrol.

## Menambah project

Klik "+ Tambah Project" dan isi:
- **Nama project** — label bebas
- **Folder (cwd)** — path absolut ke folder project, mis. `D:\kerjaan-2026\projects\my-app`
- **Stack** (opsional) — pilih dari dropdown (Node.js, Laravel, Django, Flask, dll) untuk auto-isi field Command dengan template yang sudah include flag port yang benar. Kalau field Port masih kosong, lotwork juga otomatis mengisinya dengan port kosong berikutnya untuk stack itu (Node.js dari 3001, Laravel/Django dari 8001, Flask dari 5001, PHP built-in dari 8081 — angka basis bulatnya sendiri selalu dilewati karena sering dipakai tool lain). Pilihan stack ini tersimpan dan otomatis ter-pilih lagi saat kamu edit project di kemudian hari.
- **Command** — perintah start, bisa diisi manual kalau stack tidak ada di daftar
- **Port** — port yang dipakai project. lotwork mengisi env var `PORT` dengan nilai ini saat start (dipakai otomatis oleh Node.js/Vite/dll), dan untuk command yang tidak baca env var (`php artisan serve`, `python manage.py runserver`, `flask run`, dst) lotwork otomatis menambahkan flag port yang sesuai. lotwork juga menolak start kalau port sudah dipakai proses lain di luar lotwork, atau sudah didaftarkan project lain.
- **Custom domain** (opsional) — cukup isi nama (mis. `my-app`), suffix `.local` ditambahkan otomatis. Subdomain juga bisa — mis. isi `api.my-app` jadinya `api.my-app.local`.

Kalau project itu Next.js dan kamu isi domain, lotwork otomatis menambahkan domain itu ke `allowedDevOrigins` di `next.config.ts/js/mjs`, supaya dev server tidak memblokir request HMR yang lewat proxy Caddy. Kalau format config-nya tidak dikenali (misal dibungkus `withPWA()` atau sejenisnya), lotwork tidak menyentuh file itu dan menampilkan alert dengan baris yang perlu ditambahkan manual.

## Card project

Tiap project ditampilkan sebagai card berisi status, link repo (atau "Belum ada remote repo" kalau belum diset), pesan & tanggal commit terakhir, branch saat ini/main, port, domain, command, dan kapan terakhir di-start. Project diurutkan dari yang paling baru di-start (dalam 8 jam terakhir) di paling atas, lalu sisanya berdasarkan total jumlah start terbanyak.

Empat panel bisa dibuka langsung di bawah tiap card (klik lagi untuk tutup):
- **Logs** — stdout/stderr live, auto-refresh tiap 1.5 detik selagi terbuka
- **Edit .env** — membaca & menulis `.env` dan `.env.local` di folder project sebagai list key/value (`.env.local` menang kalau ada key yang sama, mengikuti perilaku Next.js/Vite). Tiap baris menampilkan file asalnya; klik badge untuk pindahkan variable ke file lain.
- **Credentials** — daftar credential login tersimpan untuk project itu (label, username/email, password, ditampilkan polos). Klik "+ Tambah Credential" untuk tambah lewat popup form, atau "Edit"/"Hapus" pada entry yang ada. Tombol copy di sebelah username dan password untuk copy value ke clipboard.
- **GitHub** — lihat bagian di bawah.

## Entry "LotWork"

Card pertama di daftar selalu **LotWork** itu sendiri — repo source lotwork, ditandai badge "Aplikasi ini" dan garis aksen pink. Statusnya selalu "Running" (kamu cuma bisa lihat dashboard kalau server-nya hidup), dan tidak ada tombol Start/Stop atau Hapus karena dikontrol dari GUI kontrol, bukan dari dashboard. Cuma panel **GitHub** yang tersedia, jadi kamu bisa commit/push/pull perubahan source code lotwork sendiri dari dashboard yang sama yang kamu pakai untuk project lain.

## Start/Stop project

Klik Start/Stop di card. Tombol otomatis disabled dan melakukan polling ke port project sampai benar-benar bisa dikoneksi (atau proses crash, atau ~20 detik berlalu), menampilkan "Starting.../Stopping..." selama itu — jadi tombol tidak langsung jadi "Running" sebelum aplikasinya benar-benar bisa dibuka. Kalau project gagal start (mis. dependencies belum diinstall), panel Logs otomatis terbuka menampilkan output error-nya.

Proses berjalan sebagai child process dari lotwork. Klik STOP di GUI kontrol akan menghentikan semua project yang sedang berjalan.

## Panel GitHub

Klik "GitHub" di card untuk membuka panel. Kalau project belum punya remote, kamu akan diminta set dulu (`git remote add origin <url>`) sebelum fitur lain bisa dipakai.

Setelah remote ada, panel menampilkan dropdown **Current Branch** dan **Master Branch** di atas, diikuti dua tombol mode:
- **Pull Master** — menjalankan berurutan: checkout master branch → pull terbaru dari origin → checkout current branch → merge master ke current → push current branch. Dialog konfirmasi menampilkan langkah persis sebelum eksekusi. Ditolak kalau ada perubahan belum di-commit (commit atau stash dulu). Kalau merge menghasilkan conflict, branch dibiarkan dalam kondisi conflict untuk kamu resolve manual — lotwork tidak auto-abort.
- **Push/Commit Changes** — menampilkan tiap file yang berubah lengkap dengan checkbox (tercentang default); hilangkan centang file yang tidak mau disertakan. "Commit & Push" menampilkan konfirmasi berisi daftar persis file yang akan di-commit dan ke branch mana sebelum eksekusi; pesan commit default-nya "Update" kalau dikosongkan.

## Sidebar System Services

Di samping daftar project, ada sidebar yang menampilkan:
- **Service database** (MySQL, PostgreSQL) — terdeteksi sebagai Windows Service, kalau terinstall. Tiap service punya toggle Start/Stop. Start/stop service butuh privilege Administrator (sudah otomatis kalau pakai shortcut Desktop).
- **Runtime** (Node.js, PHP) — cuma info versi terinstall, tanpa start/stop (karena bukan service).

Sidebar auto-refresh tiap 8 detik.

## Custom domain

Begitu Caddy terinstall (lewat `Setup.bat`) dan project punya domain terisi, lotwork otomatis:
1. Generate `data/Caddyfile` berisi reverse proxy `domain -> localhost:port` per project dengan `tls internal` (HTTPS lokal otomatis)
2. Menjalankan/reload proses Caddy
3. Menulis entry ke `C:\Windows\System32\drivers\etc\hosts` (block ditandai `# lotwork-managed-start/end`, aman untuk di-sync ulang)

Sync ini berjalan otomatis setiap kali: lotwork baru di-start, project baru ditambah/diedit/dihapus dengan domain. Tombol "Reload Caddy / Sync Domains" tetap tersedia untuk trigger manual (misal untuk troubleshooting). Kamu juga bisa install Caddy langsung dari dashboard kalau belum ada — klik badge status merah di header.

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

- `data/projects.json` — daftar project, termasuk pilihan stack, histori start, dan credentials tersimpan (plain JSON, bisa diedit manual kalau perlu)
- `data/Caddyfile`, `data/server.log`, `data/server.pid` — file runtime, di-generate ulang otomatis
- Folder `data/` tidak ikut di-commit ke git (lihat `.gitignore`) karena isinya spesifik per mesin
