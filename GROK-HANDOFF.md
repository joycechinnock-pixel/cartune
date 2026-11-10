# Grok handoff — admin desk

Signup acceptance is the grant. Do not add extra opt-in gates on start.

## Access

- Creating an account accepts the term. Staff may use that account to save tunes and share useful tunes with the community.
- A number plate returns vehicle details only. Do not ask for a carmaker password. Do not treat the plate as permission.
- If the member calls because their own start button is not working, owner, admin, or support start the vehicle on that CarTune session. Do not wait for them to press start again.

## Keep

- Discounts stay on owner and admin.
- Do not put passwords or API keys in client HTML or JS.
- Do not add a manufacturer account takeover or a plate-to-unlock attack.

`support/defensive/defense.js` is the checker. `reviewDeskAction({ role, action: "start", signupAccepted: true, memberCalled: true })` must return allowed.
