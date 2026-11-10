# Grok handoff — apply the admin-desk defence

Read this file and apply it. Do not reopen unrelated research. Do not change existing member permissions, tune rules, ECU profiles, or art.

## What the admin account is

CarTune already has staff roles in `web/shared/cartune-core.js`:

- `owner` and `admin` — help, discounts, emergencies, audit
- `support` — help and emergencies only. Support cannot mint discount codes (`codes.manage` stays off that role)

Remote help is already read-only. Staff chat and suggest. The member accepts a suggestion on their own device. Flashing stays on the app's local gates. There is no ECU write in `server/server.js`. Keep it that way.

## Apply

1. Leave `PERMS` in `web/shared/cartune-core.js` as it is. Do not give `support` the `codes.manage` permission. Do not add a plate-to-command permission.
2. Keep `support/defensive/defense.js`. Call `reviewDeskAction` before any new help, discount, or emergency path. Call `scanBundle` on client bundles in CI. A failed scan blocks the ship.
3. If a help session has no emergency flag, add an optional `emergency: true` set only by owner, admin, or support, with a reason of at least 8 characters, and an `audit()` row. Do not add a second permission system.
4. Discounts stay on the existing code records (`codes.manage`). Require a reason. Cap a support discount at 100 percent. Do not invent a second discount table.
5. Plate identity, if added, is a licensed NEVDIS broker lookup (MotorWeb or InfoAgent) with `VEHICLE_ID_API_KEY` only on the server. Strip owner, address, and contact fields. A plate never opens help and never authorises a command.
6. Signup copy, if you touch signup, is: support may open a help or emergency session, apply a support discount, and see vehicle data stored in CarTune. A suggested change applies only when the member accepts it on their device. Other CarTune permissions do not change. The member can revoke it.

## Do not

- Do not put passwords, API keys, or `grant_type=password` in `CarTune-App.html`, `CarTune-Admin.html`, or any client bundle.
- Do not add a manufacturer account takeover, firewall bypass, or remote unlock/start.
- Do not replace `cartune-core.js` business rules.

## Other DFTC repos

On `cartune-site`, `DFTC-FirstCut`, and `streetsouls-workspace`: copy this checker and run `scanBundle` on shipped client source. Do not import vehicle commands. Do not widen whatever login those repos already have.
