# lotwork

*[Bahasa Indonesia below](#lotwork-1)*

Local dashboard for managing Docker Compose projects that live in WSL: start/stop with a button, per-service control and logs, custom localhost domains via Caddy, per-project `.env` editing, saved credentials, GitHub commit/push/pull, and system service monitoring.

## Setup (one time)

Run **`Setup.bat`** (double-click). This automatically:
1. Installs dependencies, including the Electron runtime (if not already installed), and creates `lotwork.exe` — the Electron runtime branded as lotwork, so the Administrator prompt, taskbar and Task Manager all show "lotwork"
2. Installs [Caddy](https://caddyserver.com/) via winget (if missing)
3. Creates a **lotwork** shortcut on the Desktop, set to always run as Administrator (needed for the custom domain feature to write to the hosts file, and for starting/stopping system services)

## Daily use

Double-click the **lotwork** shortcut on your Desktop. Windows will ask for Administrator permission — click **Yes**.

lotwork opens as its own desktop app window (Electron), with the server running inside the app — no separate START/STOP step.

- **Closing the window** only hides it: lotwork keeps running in the **system tray** together with your projects. Click the tray icon to bring the window back.
- **Right-click the tray icon** for: Open lotwork, Open in browser, Stop all projects, Restart lotwork, and Quit lotwork. Quitting (or restarting) stops every running project — you'll be asked to confirm if any are running.
- Opening the shortcut again while lotwork is already running just brings the existing window to the front.
- Links in the dashboard (repo URLs, project domains) open in your normal browser. F5 / Ctrl+R reloads the window, F12 opens DevTools.

The dashboard is still available in any browser at http://localhost:4400 while lotwork is running. On first load, a full-page loading screen appears while initial data is fetched. The header has a language switcher (EN/ID, default English) and a light/dark theme toggle — both remembered per browser.

If Caddy isn't detected (or was just installed but this lotwork process hasn't picked it up yet), a popup explains exactly what to do — install it, or restart lotwork from the tray menu (lotwork re-reads PATH from the registry on every start, so a restart is enough).

## Requirements

- **WSL 2** with a Linux distro (e.g. Ubuntu) where your projects live
- **Docker Desktop** with WSL integration enabled for that distro (so `docker` works both in Windows and inside WSL)
- Each project needs a Docker Compose file (`compose.yml`, `docker-compose.yml`, or any YAML with a top-level `services:`)

The header shows a **Docker** status badge; it turns red if Docker Desktop isn't running.

## Adding a project

Click **Add Project** and fill in:
- **Project name** — free-form label (pre-filled from the folder name)
- **WSL distro** — which distro the project lives in
- **Project folder** — click **Browse** to pick a folder inside WSL (e.g. `/home/you/projects/my-app`). Folders containing a compose file are marked "compose". This folder is used for git, `.env` editing, and WSL shell commands.
- **Compose file** — lotwork lists every compose file in the folder and one level below (so layouts like `repo/docker/api.yml` work). It reads the file with `docker compose config` and shows the compose project name and service count.
- **Custom domain** (optional) — enter a name (`.local` is added automatically) and pick which **container port** it should point to, from the ports the compose file publishes.

There is no port field: ports come from the compose file. One compose project can only be registered once.

If the project is a Next.js app and you set a domain, lotwork automatically adds that domain to `allowedDevOrigins` in `next.config.ts/js/mjs`, so the dev server doesn't block HMR requests coming through the Caddy proxy. If the config file's format isn't recognized (e.g. wrapped in `withPWA()` or similar), lotwork leaves the file untouched and shows an alert with the line to add manually.

## Project cards

Each project is shown as a card with its status (**Running**, **Running 3/5** when only some services are up, or **Stopped**), repo link, last commit, folder, compose file, published ports (clickable while running), domain, branch, and when it was last started.

Panels that expand under each card (click again to collapse):
- **Services** — every service in the compose file with its image, state, ports, and Start / Stop / Restart buttons per service
- **Logs** — `docker compose logs`, for all services or one service, auto-refreshing while open
- **Edit .env** — reads and writes `.env` and `.env.local` in the project folder (`.env.local` wins on key collisions). Click a row's badge to move a variable between files.
- **Credentials** — saved login credentials for the project, with copy buttons
- **Commands** — saved one-off commands, run either inside a service container (`docker compose exec`, e.g. `php artisan migrate` in `backend`) or in a WSL shell in the project folder
- **SSH** — saved SSH targets, opened in a new terminal
- **GitHub** — see below. Git runs inside WSL, not with Windows git.

The **⋮** menu has Edit, Restart, Reload compose file (after you change services/ports in the YAML), Set as Sidejob, **Down** (stop and remove the containers; volumes are kept), and Delete (removes the project from lotwork only — containers and files are untouched).

## Archive

Projects added before the Docker switch (plain Windows processes) are kept in a collapsed **Archive** section at the bottom. They can't be started; their credentials and SSH targets are still available. Delete them from the ⋮ menu when you no longer need them.

## The "LotWork" entry

The first card in the list is always **LotWork** itself — lotwork's own source repo, shown with a "This app" badge and a pink accent stripe. Its status always reads "Running" (you can only be looking at the dashboard if the server is up), and it has no Start/Stop or Delete button since it's controlled from the app/tray, not the dashboard. Only the **GitHub** panel is available, so you can commit/push/pull changes to lotwork's own codebase from the same dashboard you use for your other projects.

## Start/Stop a project

- **Start** runs `docker compose up -d` inside WSL with the project's compose file — exactly as if you ran it yourself, so bind mounts and env files resolve the same way. Image pulls/builds can take a while; the button stays on "Starting..." until it finishes. If it fails, the error is shown and the Logs panel opens.
- **Stop** runs `docker compose stop` (containers are kept, so the next start is fast). Use **Down** in the ⋮ menu to remove them.

Containers belong to Docker, not to lotwork: they keep running when you close or quit lotwork. To stop everything at once, use **Stop all projects** in the tray menu.

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
1. Generates `data/Caddyfile` with a `domain -> localhost:<chosen container port>` reverse proxy per project, with `tls internal` (automatic local HTTPS)
2. Starts/reloads the Caddy process
3. Writes an entry to `C:\Windows\System32\drivers\etc\hosts` (marked with a `# lotwork-managed-start/end` block, safe to re-sync)

This sync runs automatically whenever: lotwork starts up, or a project with a domain is added/edited/deleted. The "Reload Caddy / Sync Domains" button is still available to trigger it manually (e.g. for troubleshooting). You can also install Caddy directly from the dashboard if it's missing — click the red status badge in the header.

**Note:** writing to the hosts file requires lotwork to run as Administrator — this is already handled automatically if you use the Desktop shortcut from `Setup.bat`. If the sync fails, the dashboard shows a clear error alert.

## Manual rebuild (for development)

lotwork runs straight from this folder, so there's nothing to rebuild — after changing the source (`server.js`, `public/`, `electron/main.js`, etc.), use **Restart lotwork** from the tray menu. Changes to `public/` only need a window reload (F5).

```
npm install
npm run app     # desktop app (Electron + tray)
npm run make-exe  # recreate lotwork.exe (needed again after updating Electron)
npm start       # server only, open http://localhost:4400 in a browser
npm run build   # optional: standalone headless lotwork-server.exe (pkg)
```

## Data

- `data/projects.json` — project list (WSL folder, compose file, services/ports read from it, domain), start history, and saved credentials/commands/SSH targets (plain JSON, safe to edit manually if needed)
- `data/Caddyfile`, `data/server.log`, `data/server.pid` — runtime files, regenerated automatically
- The `data/` folder is not committed to git (see `.gitignore`) since its contents are machine-specific

---

# lotwork

Dashboard lokal untuk mengelola project Docker Compose yang ada di WSL: start/stop via tombol, kontrol dan log per service, custom domain di localhost lewat Caddy, edit `.env` per project, penyimpanan credentials, commit/push/pull GitHub, dan monitoring system service.

## Instalasi (sekali saja)

Jalankan **`Setup.bat`** (klik dua kali). Ini otomatis:
1. Install dependencies, termasuk runtime Electron (kalau belum ada), lalu membuat `lotwork.exe` — runtime Electron yang diberi nama lotwork, supaya prompt Administrator, taskbar, dan Task Manager menampilkan "lotwork"
2. Install [Caddy](https://caddyserver.com/) lewat winget (kalau belum ada)
3. Buat shortcut **lotwork** di Desktop, di-set agar selalu jalan sebagai Administrator (dibutuhkan supaya fitur custom domain bisa menulis ke hosts file, dan untuk start/stop system service)

## Menjalankan sehari-hari

Klik dua kali shortcut **lotwork** di Desktop. Windows akan minta izin Administrator — klik **Yes**.

lotwork terbuka sebagai aplikasi desktop dengan jendelanya sendiri (Electron), dan server-nya jalan di dalam aplikasi — tidak perlu klik START/STOP lagi.

- **Menutup jendela** cuma menyembunyikannya: lotwork tetap jalan di **system tray** bersama project-project kamu. Klik ikon tray untuk memunculkan jendelanya lagi.
- **Klik kanan ikon tray** untuk: Open lotwork, Open in browser, Stop all projects, Restart lotwork, dan Quit lotwork. Quit (atau restart) akan menghentikan semua project yang sedang jalan — kalau ada yang jalan, akan diminta konfirmasi dulu.
- Membuka shortcut lagi saat lotwork sudah jalan cuma memunculkan jendela yang sudah ada.
- Link di dashboard (URL repo, domain project) terbuka di browser biasa. F5 / Ctrl+R untuk reload jendela, F12 untuk DevTools.

Selama lotwork jalan, dashboard tetap bisa dibuka di browser mana saja lewat http://localhost:4400. Saat pertama kali dimuat, layar loading fullpage muncul selagi data awal di-fetch. Header punya language switcher (EN/ID, default English) dan toggle tema light/dark — keduanya tersimpan per browser.

Kalau Caddy tidak terdeteksi (atau baru saja terinstall tapi proses lotwork ini belum bisa melihatnya), popup akan menjelaskan persis apa yang perlu dilakukan — install, atau restart lotwork dari menu tray (lotwork membaca ulang PATH dari registry setiap kali start, jadi restart sudah cukup).

## Kebutuhan

- **WSL 2** dengan distro Linux (mis. Ubuntu) tempat project kamu berada
- **Docker Desktop** dengan WSL integration aktif untuk distro itu (supaya `docker` bisa dipakai di Windows maupun di dalam WSL)
- Setiap project butuh Docker Compose file (`compose.yml`, `docker-compose.yml`, atau YAML apa pun yang punya `services:` di level teratas)

Header menampilkan badge status **Docker**; warnanya merah kalau Docker Desktop tidak jalan.

## Menambah project

Klik **Tambah Project** dan isi:
- **Nama project** — label bebas (otomatis diisi dari nama folder)
- **Distro WSL** — distro tempat project berada
- **Folder project** — klik **Pilih** untuk memilih folder di dalam WSL (mis. `/home/kamu/projects/my-app`). Folder yang punya compose file ditandai "compose". Folder ini dipakai untuk git, edit `.env`, dan command shell WSL.
- **Compose file** — lotwork menampilkan semua compose file di folder itu dan satu level di bawahnya (jadi struktur seperti `repo/docker/api.yml` juga terbaca). File dibaca lewat `docker compose config`, lalu nama compose project dan jumlah service-nya ditampilkan.
- **Custom domain** (opsional) — isi nama (`.local` ditambahkan otomatis) lalu pilih **port container** tujuannya, dari port yang di-publish compose file.

Tidak ada field port: port diambil dari compose file. Satu compose project hanya bisa didaftarkan sekali.

Kalau project-nya Next.js dan kamu set domain, lotwork otomatis menambahkan domain itu ke `allowedDevOrigins` di `next.config.ts/js/mjs`, supaya dev server tidak memblokir request HMR yang lewat proxy Caddy. Kalau format file config-nya tidak dikenali (mis. dibungkus `withPWA()` atau sejenisnya), lotwork tidak mengubah file itu dan menampilkan alert berisi baris yang perlu ditambahkan manual.

## Card project

Setiap project tampil sebagai card dengan status (**Berjalan**, **Berjalan 3/5** kalau baru sebagian service yang jalan, atau **Berhenti**), link repo, commit terakhir, folder, compose file, port yang di-publish (bisa diklik saat jalan), domain, branch, dan waktu terakhir di-start.

Panel yang bisa dibuka di bawah card (klik lagi untuk menutup):
- **Services** — semua service di compose file beserta image, status, port, dan tombol Start / Stop / Restart per service
- **Logs** — `docker compose logs`, untuk semua service atau satu service, refresh otomatis selama terbuka
- **Edit .env** — baca dan tulis `.env` dan `.env.local` di folder project (`.env.local` menang kalau key-nya sama). Klik badge di baris untuk memindahkan variabel antar file.
- **Credentials** — credential login yang disimpan, dengan tombol copy
- **Commands** — command sekali jalan yang disimpan, dijalankan di dalam container service (`docker compose exec`, mis. `php artisan migrate` di `backend`) atau di shell WSL di folder project
- **SSH** — target SSH tersimpan, dibuka di terminal baru
- **GitHub** — lihat di bawah. Git dijalankan di dalam WSL, bukan pakai git Windows.

Menu **⋮** berisi Edit, Restart, Muat ulang compose file (setelah kamu mengubah service/port di YAML), Set as Sidejob, **Down** (hentikan dan hapus container; volume tetap aman), dan Delete (hanya menghapus project dari lotwork — container dan file tidak disentuh).

## Arsip

Project yang ditambahkan sebelum pindah ke Docker (proses Windows biasa) disimpan di bagian **Arsip** yang tertutup di paling bawah. Project ini tidak bisa di-start, tapi credentials dan target SSH-nya masih bisa dibuka. Hapus lewat menu ⋮ kalau sudah tidak perlu.

## Entry "LotWork"

Card pertama di daftar selalu **LotWork** itu sendiri — repo source lotwork, ditandai badge "Aplikasi ini" dan garis aksen pink. Statusnya selalu "Running" (kamu cuma bisa lihat dashboard kalau server-nya hidup), dan tidak ada tombol Start/Stop atau Hapus karena dikontrol dari aplikasi/tray, bukan dari dashboard. Cuma panel **GitHub** yang tersedia, jadi kamu bisa commit/push/pull perubahan source code lotwork sendiri dari dashboard yang sama yang kamu pakai untuk project lain.

## Start/Stop project

- **Start** menjalankan `docker compose up -d` di dalam WSL dengan compose file project — sama persis seperti kamu menjalankannya sendiri, jadi bind mount dan env file terbaca dengan cara yang sama. Pull/build image bisa makan waktu; tombol tetap "Memulai..." sampai selesai. Kalau gagal, error-nya ditampilkan dan panel Logs terbuka.
- **Stop** menjalankan `docker compose stop` (container tetap ada, jadi start berikutnya cepat). Pakai **Down** di menu ⋮ untuk menghapusnya.

Container itu milik Docker, bukan lotwork: container tetap jalan saat lotwork ditutup atau di-quit. Untuk menghentikan semuanya sekaligus, pakai **Stop all projects** di menu tray.

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
1. Generate `data/Caddyfile` berisi reverse proxy `domain -> localhost:<port container yang dipilih>` per project dengan `tls internal` (HTTPS lokal otomatis)
2. Menjalankan/reload proses Caddy
3. Menulis entry ke `C:\Windows\System32\drivers\etc\hosts` (block ditandai `# lotwork-managed-start/end`, aman untuk di-sync ulang)

Sync ini berjalan otomatis setiap kali: lotwork baru di-start, project baru ditambah/diedit/dihapus dengan domain. Tombol "Reload Caddy / Sync Domains" tetap tersedia untuk trigger manual (misal untuk troubleshooting). Kamu juga bisa install Caddy langsung dari dashboard kalau belum ada — klik badge status merah di header.

**Catatan:** menulis ke hosts file butuh lotwork dijalankan sebagai Administrator — ini sudah otomatis kalau kamu pakai shortcut Desktop dari `Setup.bat`. Kalau sync gagal, dashboard akan menampilkan alert dengan pesan error yang jelas.

## Build ulang manual (untuk development)

lotwork jalan langsung dari folder ini, jadi tidak ada yang perlu di-build ulang — setelah mengubah source (`server.js`, `public/`, `electron/main.js`, dll), pakai **Restart lotwork** dari menu tray. Perubahan di `public/` cukup reload jendela (F5).

```
npm install
npm run app     # aplikasi desktop (Electron + tray)
npm run make-exe  # buat ulang lotwork.exe (perlu lagi setelah update Electron)
npm start       # server saja, buka http://localhost:4400 di browser
npm run build   # opsional: lotwork-server.exe headless standalone (pkg)
```

## Data

- `data/projects.json` — daftar project (folder WSL, compose file, service/port yang dibaca darinya, domain), histori start, dan credentials/commands/target SSH tersimpan (plain JSON, bisa diedit manual kalau perlu)
- `data/Caddyfile`, `data/server.log`, `data/server.pid` — file runtime, di-generate ulang otomatis
- Folder `data/` tidak ikut di-commit ke git (lihat `.gitignore`) karena isinya spesifik per mesin
