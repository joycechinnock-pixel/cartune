# CarTune server API (v11)

One contract, two backends. `web/shared/api.js` holds the route table (`ROUTES`) and both
clients: the **local demo store** (IndexedDB/localStorage in the browser, seeded and flagged
DEMO DATA) and the **remote client** for this server. The business rules live in
`web/shared/cartune-core.js` and are the same in both, so they behave the same way.

## Conventions

- Base URL: wherever `server.js` runs, e.g. `https://admin.cartune.example`. Point an app at it with
  `?api=https://admin.cartune.example` (remembered in the browser; `?api=local` goes back to the demo store).
- JSON in, JSON out: `{"result": ...}` on success, `{"error": "...", "code": "..."}` on failure.
- Staff calls need `Authorization: Bearer <token>` from `POST /api/auth/login`. Tokens last 12 h and are
  dropped on suspend or password reset.
- Arguments: anything in the path is `:name`; GET extras are query parameters; everything else is the JSON body
  using the argument names in the table (e.g. `POST /api/auth/login` body `{"email": "...", "password": "..."}`,
  `POST /api/codes` body `{"body": {...code fields...}}`).
- Error codes → HTTP: `auth` 401, `forbidden` 403, `notfound` 404, `invalid` 400, `expired` 410, `used` 409,
  `ratelimit` 429.
- Rate limits per IP: 240 requests/min overall; 10 logins and 10 setup tries per 10 min; 30 code redeems or help
  joins per 10 min (so 6-digit help codes and discount codes can't be guessed); 20 tune submissions / help opens per 10 min.

## Roles

| Role | Can |
|---|---|
| owner | everything, including staff accounts (`staff.manage`) |
| admin | users (view, edit, suspend, reset password), comps, discount and demo codes, orders, presets, vault review, stats, audit, remote help |
| support | view users and orders, remote help (join, chat, suggest), catalogue, stats |

## First run (one-time setup)

The server starts with an empty store and **no accounts or credentials**. It prints a one-time setup token. Open
`/admin/`, choose Set up, paste the token, and create the owner. `POST /api/setup` is refused once an owner exists.

## Routes

| Method | Path | Call | Auth | Body / query |
|---|---|---|---|---|
| GET | `/api/info` | info | public |  |
| POST | `/api/setup` | setupOwner | public | body |
| POST | `/api/auth/login` | login | public | email, password |
| POST | `/api/auth/logout` | logout | staff |  |
| GET | `/api/auth/me` | me | staff |  |
| POST | `/api/auth/password` | changePassword | staff | oldPassword, newPassword |
| POST | `/api/staff` | createStaff | staff | body |
| GET | `/api/users` | listUsers | staff | q |
| GET | `/api/users/:id` | getUser | staff |  |
| PATCH | `/api/users/:id` | updateUser | staff | body |
| POST | `/api/users/:id/suspend` | setSuspended | staff | suspended, reason |
| POST | `/api/users/:id/reset-password` | resetPassword | staff |  |
| POST | `/api/users/:id/package` | grantPackage | staff | body |
| POST | `/api/users/:id/package/revoke` | revokePackage | staff | reason |
| GET | `/api/presence` | presence | staff |  |
| POST | `/api/presence` | heartbeat | public | who |
| GET | `/api/codes` | listCodes | staff |  |
| POST | `/api/codes` | createCode | staff | body |
| POST | `/api/codes/:code/disabled` | setCodeDisabled | staff | disabled |
| POST | `/api/redeem` | redeemCode | public | code, who |
| POST | `/api/orders` | createOrder | public | body |
| GET | `/api/orders` | listOrders | staff | status |
| PATCH | `/api/orders/:id` | updateOrder | staff | body |
| GET | `/api/presets` | listPresetOverrides | staff |  |
| PUT | `/api/presets/:id` | savePreset | staff | body |
| GET | `/api/public/presets` | publicPresets | public |  |
| POST | `/api/help` | openHelp | public | body |
| POST | `/api/help/:code/snapshot` | pushSnapshot | public | key, snapshot |
| GET | `/api/help/:code/customer` | customerView | public | key |
| POST | `/api/help/:code/customer-chat` | customerChat | public | key, text |
| POST | `/api/help/:code/suggestions/:sid` | respondSuggestion | public | key, accept |
| POST | `/api/help/:code/end` | endHelp | staff | key |
| GET | `/api/help` | listHelp | staff |  |
| POST | `/api/help/:code/join` | joinHelp | staff |  |
| GET | `/api/help/:code` | staffView | staff |  |
| POST | `/api/help/:code/chat` | staffChat | staff | text |
| POST | `/api/help/:code/suggest` | suggest | staff | suggestion |
| POST | `/api/vault/submissions` | submitTune | public | tune |
| GET | `/api/vault/submissions` | listSubmissions | staff | status |
| POST | `/api/vault/submissions/:id/review` | reviewSubmission | staff | review |
| GET | `/api/vault` | vault | public |  |
| POST | `/api/vault/:id/download` | vaultDownload | public |  |
| GET | `/api/stats` | stats | staff |  |
| GET | `/api/audit` | listAudit | staff | q |

## Remote help (read-only on the car)

1. The customer taps **Get help**; the app calls `POST /api/help` and gets `{code, key, expiresAt}`. It shows the
   6-digit code, keeps the private `key`, and pushes a snapshot every 5 s (`POST /api/help/:code/snapshot`):
   vehicle, live data (read-only Mode 01 reads), fault codes, saved diagnostic tests, app settings, and the tune on
   screen.
2. Staff join with the code (`POST /api/help/:code/join`) and watch over WebSocket:
   `GET /ws?code=<code>&token=<staff token>` (the customer uses `&key=<key>`). Events:
   `{type: "hello" | "snapshot" | "chat" | "suggestion" | "joined" | "end", code, at, data}`.
3. Staff can **chat** and **suggest** `{kind: "tune", name, note, values: {settingId: number}}` or
   `{kind: "settings", values: {skill|theme|fuel|upgrades|pkg}}`. Any other kind is refused.
4. Only the holder of `key` (the customer's own app) can update the snapshot or accept/decline a suggestion. An accepted
   tune is saved in the app as one of the customer's tunes, re-filed at its permission level. **Nothing is flashed.**
   Flashing still goes through the app's own gates (car connected, stock backup, pull log, user agreement for
   emissions changes, the off-road acknowledgement, typing FLASH). There is no route that writes to an ECU.

## Tune Library Vault

- `POST /api/vault/submissions`: a customer submits a tune with its app filing level (0 Factory, 1 Road, 2 Sport,
  3 Competition and off-road) and whether it changes emissions systems.
- Staff review (`POST /api/vault/submissions/:id/review`, `review: {decision: "accept"|"reject"|"note", note,
  roadLegal, verified: {level, reasons, emissions}}`). Accepting needs `verified` (the admin app re-files the tune
  with the same rules); the higher level wins. Rejecting needs a note. A Competition (level 3) or emissions-off tune
  **can't be published as road-legal**, and it carries `gates: {competitionAck, agreement, pullLog}`.
- `GET /api/vault` lists accepted tunes (no emails). `POST /api/vault/:id/download` returns the values; the app
  saves them as the customer's own tune, re-files it, and applies every flash gate.

## Presence

The customer app sends `POST /api/presence` about once a minute while it's open (`{device, email, car}`). A user is
**online** if seen in the last 2 minutes. `GET /api/presence` (staff) returns `{users: {id: {online, lastSeen}}, anonymousOnline}`.

## Payments

There is no payment processing. Orders are pre-orders. Statuses (`pre-ordered`, `pay link sent`, `paid`, `shipped`,
`cancelled`, `refund noted`) and notes are records only. Refunds happen in the payment provider once it's connected
(Stripe is the plan, per the 30 Sept site's `CONFIG.payments`), then get noted here.
