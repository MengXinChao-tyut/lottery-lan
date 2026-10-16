# LAN Signup Lottery Implementation Plan

> **For agentic workers:** Use subagent-driven-development in this session. The user already approved the design and requested implementation; proceed through all tasks without another permission gate.

**Goal:** Deliver a Windows-ready, same-Wi-Fi QR registration and 3D drawing app based on moshang-ax/lottery.

**Architecture:** Keep upstream Vue 3/Three.js display. Replace Excel startup roster and deferred client-side winner saving with a durable server-owned event and immediate draw transaction. Admin is local-computer-only; guests use /join over LAN.

**Tech Stack:** Node.js >=20, Express 4 and ExcelJS 4, Vue 3/Vite, existing local Three.js libraries, QR encoding bundled in frontend.

## Global Constraints

- Participants enter name and mainland-China phone; normalize spaces, hyphens, +86/0086; accept /^1[3-9]\d{9}$/ after normalization. Name 1–30 printable characters, reject controls.
- One active event, around 10–20 people, same Wi-Fi, no cloud deployment, no SMS verification.
- Default 3 prizes: type 1 一等奖 count 1 perDraw 1; type 2 二等奖 count 2 perDraw 1; type 3 三等奖 count 3 perDraw 1. Title 现场幸运抽奖.
- Persist server/data/lan-event.json atomically; never publish or commit personal/runtime data. Empty event initially; upstream Excel sample is not included in the active roster.
- Admin APIs and full phones restricted to actual loopback connections, plus same-origin Origin check for mutation. Never trust spoofed forwarding headers. Public endpoints expose no roster.
- Close registration before drawing; store locked participant IDs. No auto-reintroduction of already-won people. No drawings beyond prize inventory/eligible participants.
- Preserve upstream MIT attribution, existing 3D motion and local assets; safely render untrusted names with textContent/Vue interpolation.
- No system firewall changes. Detect current LAN IPv4s and actual bound port; choose correct Wi-Fi URL in UI.

## Interfaces shared by Tasks 1 and 2

Admin snapshot from GET /api/admin/status:
```js
({
  event: { id, title, registrationOpen, createdAt },
  participants: [{ id, name, phone, joinedAt }],
  prizes: [{ type, text, title, count, perDraw, img }],
  rounds: [{ id, requestId, prizeType, prizeName, winners: [{ id, name, phone }], createdAt }],
  availableCount, version
})
```
Error JSON: `{error: 'human-readable Chinese message'}` with appropriate 4xx/5xx HTTP status. Return snapshots from mutations except draw/register.

```js
GET  /api/public/status?event=<id> // {event:{id,title,registrationOpen},count}
POST /api/public/register // {eventId,name,phone} -> 201 {participant:{id,name,phoneMasked,joinedAt}}
POST /api/admin/registration // {open:boolean} -> snapshot
POST /api/admin/config // {title,prizes:[{type,text,title,count,perDraw,img}]} -> snapshot
DELETE /api/admin/participants/:id // only while registration open -> snapshot
POST /api/admin/draw // {prizeType,count,requestId} -> {round,snapshot}; retry requestId returns existing round
POST /api/admin/reset // {scope:'results'|'all'} -> snapshot; results retains roster and reopens; all creates new event ID and clears roster/results, retains title/prizes
GET /api/admin/export?kind=participants|winners // attachment application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
GET /api/admin/network // {port,addresses:[{name,address,joinUrl}],joinPath}
GET /health // {ok:true}
POST /getTempData // compatibility {cfgData:{prizes,EACH_COUNT,COMPANY},luckyData,leftUsers,version}; tuples [id,name,maskedPhone]
POST /getUsers // compatibility tuples [id,name,maskedPhone]
```

Old /saveData /errorData /reset /export must not allow public mutation or arbitrary client chosen winners. No unknown POST endpoint returns fake success.

### Task 1: Server registration and durable drawing

**Files:** create server/event-store.js, server/lan-app.js, server/test/event-store.test.js, server/test/http.test.js; replace server/server.js to keep exported run(port,noOpen) entry; adjust server/package.json scripts; preserve upstream help/config as references if unused.

**Produces:** all interfaces above, admin only from loopback; run defaults 8888, uses absolute product/dist and data paths regardless of cwd, retries occupied port with actual port in network endpoint/log; createApp({dataFile, staticDir, ...}) exported for HTTP integration tests.

- [ ] Add real node:test behavior tests before server implementation; show initial missing module failure.
- [ ] Implement normalization, event store transactions, cryptographic randomInt selection, per-event phone uniqueness, locked IDs, inventory, requestId validation/idempotency (detect same ID with different payload), atomic writes and restart loading.
- [ ] Implement Express API and local-admin boundary without permissive CORS; same-origin mutation check compares host and port; reject LAN peers even if forwarding header claims localhost.
- [ ] Serve /join and local /, /display SPA paths, compiled local assets only. Public root may redirect to current join path. Never serve runtime data or original source tree.
- [ ] Excel attachments direct from buffers; escape formula-leading cells. No export files left in public dist.
- [ ] Run node --test server/test/*.test.js. Cover simultaneous HTTP registrations/draws, duplicate and invalid input, closure, lock, count limits, original API bypass, remote admin restriction, persistence and stale event IDs.
- [ ] Write report with test commands/output to work/task-1-report.md; commit only server code/tests/package changes, never root/frontend files.

### Task 2: Phone, admin and original 3D display integration

**Files:** modify product/src/App.vue, product/src/api/index.js, product/src/lottery/engine.js and store.js; create product/src/components/RegistrationPage.vue, HostDashboard.vue, DrawPage.vue and styles; simplify control panel to new server-owned flows; adjust vite.config.js proxy for /api and bind host for dev; add QR encoder package.

**Consumes:** Task 1 exact JSON interfaces; product route selects /join, /display, / admin dashboard, without Vue Router dependency.

- [ ] Phone: validate form, pending state, server authoritative errors, public status polling and registration closure; store only own result in browser with event ID, no full roster. Responsive readable Chinese layout and keyboard-friendly phone field.
- [ ] Admin: poll every 2s; visible pending/error state; no overwrite of prize/title form while edited; live list/count, delete with confirmation, configuration, network address selector and bundled QR, reopen before drawings only; close-and-draw transition uses returned locked snapshot; start new event/reset confirm destructive scope.
- [ ] Draw: retain local Three.js scene; initialize with masked roster and safe empty roster; server draw on stop, idempotent requestId kept across failed retries; no client random winner, no deferred save. Results overlay and immediate saved snapshot; preserve name/phone mask safely, no injecting guest values into innerHTML.
- [ ] Reset/restart derive remaining people and prize inventory from server; no duplicate auto refill. Accurate controls disabled during requests/animations.
- [ ] Poll stale/network states do not erase prior snapshot or own registration; after reset detect event ID change, refresh QR/roster.
- [ ] Build with npm run build; verify desktop and phone pages, QR decode target and complete signup/draw/reload flow in browser.

### Task 3: Windows deliverable and final review

**Files:** root 启动抽奖.cmd, root 使用说明.md, root package.json convenience scripts; output outputs/lottery-lan/ and outputs/lottery-lan.zip.

- [ ] Provide double-click launcher from any folder, uses installed Node >=20, starts server, opens only local admin page; if port occupied uses server detected address. Keep console for stopping via Ctrl+C.
- [ ] Include built product/dist, server runtime dependencies and editable source. Exclude .git, product/node_modules, test runtime/guest data, .env, intermediate reports.
- [ ] Write concise Chinese instructions: connect Wi-Fi, launch, select Wi-Fi IP, allow Windows private-network prompt if shown, scan, lock, draw, export, backup data file; troubleshooting mobile inability to reach, AP isolation, wrong adapter and changed IP.
- [ ] Independent review of APIs, concurrency, privacy boundary, engine contracts and launch paths; fix important findings.
- [ ] Verify tests/build once after final changes; launch packaged copy with empty event, confirm HTML/assets and API; show admin preview to user; finish with folder/ZIP/instructions and actual tested limitations.
