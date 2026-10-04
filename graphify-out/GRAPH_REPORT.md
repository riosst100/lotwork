# Graph Report - lotwork  (2026-10-04)

## Corpus Check
- Corpus is ~31,353 words - fits in a single context window. You may not need a graph.

## Summary
- 319 nodes · 574 edges · 16 communities (12 shown, 4 thin omitted)
- Extraction: 81% EXTRACTED · 19% INFERRED · 0% AMBIGUOUS · INFERRED: 110 edges (avg confidence: 0.85)
- Token cost: 87,750 input · 0 output

## Community Hubs (Navigation)
- Dashboard UI & Features
- Express API Server
- Caddy & Env Config
- Project Data Store
- Docker Compose Manager
- Git Operations
- Package Manifest
- System Services Detection
- Electron Desktop Shell
- Hosts File Manager
- Build & SSH Launcher
- WSL Integration

## God Nodes (most connected - your core abstractions)
1. `index.html (lotwork dashboard UI)` - 40 edges
2. `lotwork (Local Docker Compose Dashboard)` - 27 edges
3. `loadProjects()` - 20 edges
4. `saveProjects()` - 18 edges
5. `run()` - 12 edges
6. `renderPanel()` - 10 edges
7. `isGitRepo()` - 9 edges
8. `Project Cards` - 9 edges
9. `main()` - 8 edges
10. `findGitDir()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `fetchProjects()` --shares_data_with--> `data/projects.json`  [INFERRED]
  public/index.html → README.md
- `installCaddy()` --implements--> `Caddy Reverse Proxy (tls internal)`  [INFERRED]
  public/index.html → README.md
- `reloadCaddy()` --implements--> `Caddy Reverse Proxy (tls internal)`  [INFERRED]
  public/index.html → README.md
- `renderDomainsPanel()` --implements--> `Custom .local Domains`  [INFERRED]
  public/index.html → README.md
- `renderHostsPage()` --implements--> `Hosts File Managed Block`  [INFERRED]
  public/index.html → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Custom domain pipeline (Caddy + hosts + Next.js origins)** — readme_custom_domains, readme_caddy_reverse_proxy, readme_hosts_file_sync, readme_nextjs_allowed_dev_origins, readme_administrator_privileges [EXTRACTED 1.00]
- **Project card panel renderers dispatched by renderPanel** — public_index_renderservicespanel, public_index_renderlogspanel, public_index_renderenvpanel, public_index_rendercredentialspanel, public_index_rendercommandspanel, public_index_rendersshpanel, public_index_rendergitpanel, public_index_renderdomainspanel [EXTRACTED 1.00]
- **Caddy detection and install flow** — public_index_checkcaddystatus, public_index_handlecaddymissing, public_index_installcaddy, public_index_reloadcaddy [EXTRACTED 1.00]

## Communities (16 total, 4 thin omitted)

### Community 0 - "Dashboard UI & Features"
Cohesion: 0.06
Nodes (69): index.html (lotwork dashboard UI), addHostsEntry(), applyRoute(), applyTheme(), browseTo(), checkCaddyStatus(), checkDockerStatus(), confirmGitPush() (+61 more)

### Community 1 - "Express API Server"
Cohesion: 0.07
Nodes (26): app, caddy, { dataDir, publicDir, appRoot }, docker, domainTargets(), envFile, express, fs (+18 more)

### Community 2 - "Caddy & Env Config"
Cohesion: 0.08
Nodes (24): CADDYFILE, checkCaddyAvailability(), { dataDir }, { execSync, spawn }, fs, generateCaddyfile(), isCaddyInstalled(), path (+16 more)

### Community 3 - "Project Data Store"
Cohesion: 0.16
Nodes (26): addCommand(), addCredential(), addDomain(), addProject(), addSshTarget(), CONFIG_FILE, DATA_FILE, { dataDir } (+18 more)

### Community 4 - "Docker Compose Manager"
Cohesion: 0.14
Nodes (21): byName(), cache, composeTarget(), down(), { execFile }, getProjectStatus(), invalidate(), labelValue() (+13 more)

### Community 5 - "Git Operations"
Cohesion: 0.22
Nodes (23): checkAheadBehindMain(), commitAndPush(), { execFile }, findGitDir(), fs, getChangeSummary(), getCurrentBranchSync(), getDefaultBranchSync() (+15 more)

### Community 6 - "Package Manifest"
Cohesion: 0.09
Nodes (21): dependencies, express, description, devDependencies, electron, rcedit, @yao-pkg/pkg, main (+13 more)

### Community 7 - "System Services Detection"
Cohesion: 0.18
Nodes (18): buildManualMysqlDef(), buildXamppDefs(), detectRuntimes(), detectServices(), { execFile, execFileSync, spawn }, findManualMysqlRoots(), findProcessDef(), findXamppRoot() (+10 more)

### Community 8 - "Electron Desktop Shell"
Cohesion: 0.18
Nodes (14): { app, BrowserWindow, Tray, Menu, dialog, shell }, { execFileSync }, ICON, main(), createTray(), createWindow(), dashboardUrl(), restart() (+6 more)

### Community 9 - "Hosts File Manager"
Cohesion: 0.24
Nodes (14): addEntry(), deleteEntry(), { exec }, formatEntry(), fs, listEntries(), mutateLine(), net (+6 more)

### Community 10 - "Build & SSH Launcher"
Cohesion: 0.14
Nodes (12): distDir, { execFileSync }, fs, path, rcedit, root, source, target (+4 more)

### Community 11 - "WSL Integration"
Cohesion: 0.21
Nodes (11): { execFile }, findComposeFiles(), fs, getHomeDir(), homeCache, isWslPath(), listDirectory(), parseUnc() (+3 more)

## Knowledge Gaps
- **84 isolated node(s):** `fs`, `path`, `{ execSync, spawn }`, `{ dataDir }`, `CADDYFILE` (+79 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 105 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `express` connect `Package Manifest` to `Express API Server`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `loadProjects()` (e.g. with `store.js` and `migrateDomains()`) actually correct?**
  _`loadProjects()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `fs`, `path`, `{ execSync, spawn }` to the rest of the system?**
  _84 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dashboard UI & Features` be split into smaller, more focused modules?**
  _Cohesion score 0.06265984654731457 - nodes in this community are weakly interconnected._
- **Should `Express API Server` be split into smaller, more focused modules?**
  _Cohesion score 0.07130124777183601 - nodes in this community are weakly interconnected._
- **Should `Caddy & Env Config` be split into smaller, more focused modules?**
  _Cohesion score 0.0846774193548387 - nodes in this community are weakly interconnected._
- **Should `Docker Compose Manager` be split into smaller, more focused modules?**
  _Cohesion score 0.14492753623188406 - nodes in this community are weakly interconnected._