# CarTune server (minimal, no dependencies)

```
node server/server.js                      # http://127.0.0.1:8787  (app /, admin /admin/, API /api, WebSocket /ws)
node server/server.js --port 8787 --host 0.0.0.0 --data /var/lib/cartune/cartune.json --static web/dist
```

Build first (`node web/build.js`) so `web/dist/` has the app and `web/dist/admin/`. On first start the server prints a
**one-time setup token**: open `/admin/`, paste it, create the owner. There are no default accounts or passwords.

- Store: one JSON file (default `server/data/cartune.json`, mode 600, atomic writes). `server/data/` is git-ignored.
- Passwords: PBKDF2-SHA256 (120k iterations, per-user salt). Sessions: bearer tokens, 12 h.
- Role checks on every call, rate limits per IP, read-only remote help relay over WebSocket.
- Options can also be set with env vars: `CARTUNE_PORT`, `CARTUNE_HOST`, `CARTUNE_DATA`, `CARTUNE_STATIC`, `CARTUNE_CORS`
  (an allowed origin, if the apps are served from another domain).

The API is documented in [API.md](API.md). Tests: `node mobile/scripts/run-node-tests.js` (test-admin-api.js runs the
same suite against the local demo store and against this server over HTTP + WebSocket).

Before going live: run it behind HTTPS (Caddy or nginx), back up the data file, move to SQLite/Postgres when it
grows (swap the `{load, save}` adapter), add email (password reset links, receipts), and connect the payment provider.
