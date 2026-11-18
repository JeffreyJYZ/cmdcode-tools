# Lane brief — wire the real balance endpoint into oduse

OpenDesign **does** expose a server number. We proved it from the console session:

```
GET https://amr-api.open-design.ai/api/v1/wallet/balance   (cookie session)
200 {"balanceUsd":"1.0000","expiresAt":"2026-12-16T13:21:22.000Z",
     "updatedAt":"2026-11-16T13:21:30.404Z","billingScopeVersion":2,
     "workspaceId":"bojo3mq722vsvbiblclo937fxu","workspaceMemberId":"ugsd2d1w72keawcgq07nh1dx"}
```

`GET /api/v1/workspaces/current` with the same cookie returns `planId:"go"`, `providerMode:"platform_credits"`, `role:"owner"`, `canViewUsage:true`. There is **no** per-window usage endpoint: `/api/v1/usage`, `/api/v1/credits`, `/api/v1/usage/records`, `/api/v1/workspaces/<id>/usage` and `/api/v1/billing/usage` are all `404`.

Today `oduse`'s only meter is the desktop app's local daemon wallet (`127.0.0.1:7456`), which needs the app running and holds a Vela key we must not touch.

## Task

Add the balance endpoint as a second meter path, in `cmduse/src/oduse/**` only.

1. **Credential.** It takes the console session cookie, not the model API key. Do **not** read, copy, log or store a cookie from the browser. Instead support an explicit, user-supplied token: `OD_SESSION` / `OD_SESSION_COOKIE` env var or `--session-cookie <path>` pointing at a file the user creates (mode 0600). Absent credential = today's behaviour, one dim line, never an error.
2. **Order.** Prefer the HTTP meter when a credential exists (it works with the app closed and is the account's own figure); fall back to the local daemon wallet, then to no meter. Say which source produced the number in the frame and in `--json` (`walletSource: "api" | "daemon" | null`).
3. **Shape.** Parse `balanceUsd` as a decimal string (do not lose the string→f64 precision trap: `"1.0000"`), carry `expiresAt` and `updatedAt` through, and treat a non-200 or an unparseable body as a named failure, not a zero.
4. **Never invent a window.** `balanceUsd` is a balance, not a 5-hour/7-day meter — keep it beside the windows, never as one.
5. **Tests.** A stub server covering: 200 with the real body above, 401, 404, garbage body, timeout; plus "no credential → no request at all". Use an injected base URL so the test never hits the network.
6. **Docs.** `cmduse/README.md` and `cmduse/cmduse.1`: where the cookie comes from, that it is read-only, that it expires, and how to refresh it. `--json` gains `walletSource`.
7. **Proof on the real account** if `OD_SESSION` is present in the environment: show the balance, the expiry and the frame line. If it is not, say so and prove the stub path instead.

Gate: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`.

House rules: `rg`, `fd`, `sd`, no Python, no agent-desktop, bound every TUI with `timeout`, files under 200 lines. No commit, push, branch or stash — leave the tree dirty. Do not touch `opencode-plugin/` or `oc-cmd-compare/`.
