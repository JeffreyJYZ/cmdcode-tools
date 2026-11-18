# OpenDesign usage API hunt

Date: 2026-11-17. Goal: prove from the network (not docs) whether a per-window usage API exists.

## Verdict

**Yes, a usage API exists.** The web console's Usage page calls:

```
GET https://amr-api.open-design.ai/api/v1/workspaces/{workspaceId}/billing/usage
      ?limit=&cursor=&initiator=&actorMemberId=&runtime=&from=&to=
```

Unauthenticated it returns `401 {"error":"unauthenticated"}`; a garbage sibling path returns `404 404 Not Found`. The path is real and auth-gated.

We cannot reach it from `oduse` today because:
- It lives on the **control plane** `amr-api.open-design.ai`, not the model API host `amr-link.open-design.ai`.
- Auth is a **console session cookie** (`credentials: "include"`), optionally a `x-vela-workspace-id` header — not a bearer model key. Our `OD_KEY` gets `401` on it.
- It needs a **workspace id** we do not have from the model API key.

The desktop daemon *can* proxy any `/api/v1/*` path to `amr-api` and injects its stored Vela **control key** (`Authorization: Bearer <controlKey>`) for some routes, so reaching it from `oduse` is plausible but requires the control key + workspace id, which are app-internal, not `OD_KEY`.

## 1. Console JavaScript

`https://open-design.ai/cloud/usage` and `/cloud/dashboard` are the same 1365-byte Vite SPA shell (Cloudflare `200`, `cache-control: no-store`). It references:
- `/cloud/assets/index-CPqPOhNj.js` (199 KB) — React entry; only React internals + locale packs (`/cloud/assets/{de,es,fr,...}.js`). No API paths.
- `/cloud/environment.js` — `window.__VELA_ENVIRONMENT__ = null;` (Helm replaces this in real deployments).
- `/cloud/assets/cloud-root-BKuUQ-h_.js` (179 KB) — workspace/auth/referral shell.
- `/cloud/assets/app-JNytMCVq.js` (1.25 MB) — billing/usage pages. **All usage calls live here.**
- `/cloud/assets/browser-CZ8sffH1.js`, `useInfiniteQuery-D5ublBGW.js`, `button-18MQA6CT.js` — utilities.

### The real usage call (app chunk)

```js
function Cg(e,n){const a=new URLSearchParams;
  (n==null?void 0:n.limit)!==void 0&&a.set("limit",String(n.limit)),
  n!=null&&n.cursor&&a.set("cursor",n.cursor),
  n!=null&&n.initiator&&a.set("initiator",n.initiator),
  n!=null&&n.actorMemberId&&a.set("actorMemberId",n.actorMemberId),
  n!=null&&n.runtime&&a.set("runtime",n.runtime),
  n!=null&&n.from&&a.set("from",n.from),
  n!=null&&n.to&&a.set("to",n.to);
  const r=a.size>0?`?${a.toString()}`:"";
  return Lt(`/v1/workspaces/${encodeURIComponent(e)}/billing/usage${r}`,
    {signal:n==null?void 0:n.signal,workspaceId:e})}
```

`n` carries exactly the console's filters (initiator / model / time), matching the user's observation that the Usage page filters by initiator/model/time. Query key builder:
`function Fg(e){return["usage-records","team",e.userId,e.workspaceId,e.role,e.workspaceMemberId,e.initiator,e.runtime,e.time,e.pageSize??10,e.cursor]}`

Transport helper (app chunk):
```js
function Lt(e,n={}){const a=n.method??"GET",
  r=await fetch(xt(e),{method:a,credentials:"include",
    headers:{Accept:"application/json",...Xv(),...Ga(n.workspaceId),
      ...n.body===void 0?{}:{"Content-Type":"application/json"}},
    body:n.body===void 0?void 0:JSON.stringify(n.body),signal:n.signal}), ...}
```

`credentials:"include"` = console session cookie. `xt(e)`/`Ae(e)` resolve `/v1/...` to the control plane; probing confirms `/v1/me` → `amr-api.open-design.ai/api/v1/me`.

### Every endpoint found in the bundles

From `app-JNytMCVq.js`:
| path | role |
|---|---|
| `/v1/workspaces/{id}/billing/usage` | **REAL usage endpoint** (`Cg`, above) |
| `/v1/billing/ledger` | **REAL** ledger (`Ig`) |
| `/v1/workspaces/{id}/billing/ledger` | **REAL** workspace ledger (`y1`) |
| `/v1/billing/summary?{tz...}` | **REAL** billing summary (`Lt(\`/v1/billing/summary${a}\`,e)`) |
| `/v1/wallet/recharges` | REAL recharges (`Sg`) |
| `/v1/workspaces/{id}/wallet/balance` | REAL balance (`b1`) |
| `/v1/public/model-prices` | public price list (no auth; 200) |
| `/v1/runtime-api-keys`, `/v1/collab/events?codingPlanUsageEvents=1`, `/v1/touchpoints/runtime/*`, `/v1/reset-cards?*`, `/v1/quick-setup/models?*`, `/v1/billing/coupons/redeem`, `/v1/billing/auto-topup`, `/v1/billing/model-discounts`, `/v1/billing/portal-sessions`, `/v1/billing/subscription/*`, `/v1/billing/team-plans`, `/v1/wallet/checkout-sessions` | unrelated (keys, telemetry, checkout, plans) |

From `cloud-root-BKuUQ-h_.js`:
| path | role |
|---|---|
| `/v1/me` | account (`ca`) |
| `/v1/workspaces`, `/v1/workspaces/current`, `/v1/workspaces/{id}`, `/v1/workspaces/{id}/profile` | workspace management |
| `/v1/workspaces/{id}/dashboard` | **REAL** dashboard summary (`Il`) |
| `/v1/workspaces/{id}/credits/me` | **REAL** credits (`Rl`) |
| `/v1/workspaces/{id}/billing/team-plans`, `/billing/team-submission/*` | team plan admin |
| `/v1/referrals/me`, `/v1/referrals/me/records?*`, `/v1/referrals/me/copy-links`, `/v1/public/referral-*`, `/v1/workspaces/{id}/invites/*`, `/v1/workspaces/{id}/members/*`, `/v1/workspaces/{id}/seat-capacity/notify-owner`, `/v1/workspaces/{id}/auto-recharge`, `/v1/workspaces/{id}/member-directory` | unrelated (referrals, members, billing admin) |

No `usage`, `credits`, `quota`, `ledger`, `balance`, `spend` strings in `index-CPqPOhNj.js` (the 31 `spend` hits there are React's `suspendedLanes`). The app shell's only fetch is locale packs.

## 2. Unauthenticated probes (status lines, verbatim)

Control-plane host `https://amr-api.open-design.ai`:
```
[404] /api/v1/this-path-does-not-exist-xyzabc        body=404 Not Found
[401] /api/v1/workspaces/current/billing/usage?limit=1   body={"error":"unauthenticated"}
[401] /api/v1/me                                    body={"error":"unauthenticated"}
[401] /api/v1/billing/ledger                        body={"error":"unauthenticated"}
[401] /api/v1/workspaces/current/wallet/balance     body={"error":"unauthenticated"}
[401] /api/v1/workspaces/current/credits/me         body={"error":"unauthenticated"}
[401] /api/v1/workspaces/current/dashboard          body={"error":"unauthenticated"}
[401] /api/v1/workspaces/current/billing/ledger     body={"error":"unauthenticated"}
[401] /api/v1/wallet/recharges                      body={"error":"unauthenticated"}
[401] /api/v1/billing/summary                       body={"error":"unauthenticated"}
[401] /api/v1/runtime-api-keys                      body={"error":"unauthenticated"}
[200] /api/v1/public/model-prices                   body={"data":[{"model":"claude-fable-5",...}]}
[404] /api/v1/credits                               body=404 Not Found
[404] /api/v1/workspaces/current/billing/summary    body=404 Not Found
```
Control proves the 401 is meaningful: unknown routes 404, known-but-auth-gated routes 401 JSON, public routes 200.

Wrong hosts (path does not exist there):
```
[404] https://open-design.ai/v1/me                                  (HTML page)
[404] https://open-design.ai/v1/workspaces/current/billing/usage    (HTML page)
[404] https://amr-api.open-design.ai/v1/workspaces/current/billing/usage  (plain text)
[404] https://amr-link.open-design.ai/v1/workspaces/current/billing/usage  body=404 page not found
```
So the console uses the `/api/v1/` prefix on `amr-api`, not a bare `/v1/`.

The model key does **not** authenticate there (all `401 {"error":"unauthenticated"}`):
```
[401] /api/v1/workspaces/current/billing/usage?limit=1   (with Authorization: Bearer OD_KEY)
[401] /api/v1/wallet/balance                            (with OD_KEY)
[401] /api/v1/me                                        (with OD_KEY)
```

## 3. OpenAPI / schema surfaces

```
[404] https://amr-api.open-design.ai/openapi.json            (text/plain, empty)
[404] https://amr-api.open-design.ai/api/v1/openapi.json     body=404 Not Found
[404] https://amr-api.open-design.ai/api/v1/swagger.json     body=404 Not Found
[404] https://amr-api.open-design.ai/docs                    (text/plain, empty)
[404] https://amr-api.open-design.ai/redoc                   (text/plain, empty)
[404] https://amr-api.open-design.ai/llms.txt                (text/plain, empty)
[404] https://amr-link.open-design.ai/llms.txt               (text/plain, empty)
[200] https://open-design.ai/llms.txt  (101 lines; no usage/quota API, only "you pay only your own model API")
```
No machine-readable schema is published.

## 4. Desktop app bundle

`rg -n 'api/v1/[a-z/-]*' "/Applications/Open Design.app/Contents/Resources/app" -g '*.mjs'` yields only:
- `prebundled/daemon/chunks/chunk-5Q3RRGK4.mjs:1139`: `${origin}/api/v1/models?type=${type}` (model list)
- `...:1761`: `AMR_ANALYTICS_EVENTS_URL = "https://amr-api.open-design.ai/api/v1/analytics/events"` (telemetry)
- `server-WTGXM3LB.mjs:213334`: `new URL("/api/v1/wallet/balance", ...)` then `authorization: Bearer ${input2.controlKey}` — **balance only, with the Vela control key**
- `server-WTGXM3LB.mjs:214007/214012`: api-proxy guard — only `/api/v1/*` allowed
- `server-WTGXM3LB.mjs:214096-214109`: message-center proxy injects `headers.authorization = Bearer ${context2.controlKey}`
- others: `/api/v1/open-design/telemetry`, `/api/v1/collab/*`, `/api/v1/touchpoints/*`, `/api/v1/public/snapshots/*`, `/api/v1/workspace-invites/*`, `/api/v1/workspaces/{id}/invites`.

No `billing/usage`, `credits/me`, `billing/ledger`, or `billing/summary` anywhere in the desktop bundle. Every `quota` hit is rate-limit error text (`ANTIGRAVITY_QUOTA_GUIDANCE`, `isHardQuotaText`, `HARD_QUOTA_MESSAGE_RE`) or chat-artifact storage quota (`DEFAULT_CHAT_ARTIFACT_QUOTA`) — not an API meter.

`readVelaControlApiContext()` supplies `controlKey` + `apiUrl` to these calls; it is app-internal. The daemon was not running at probe time (`curl 127.0.0.1:7456/.../wallet` → connection refused), so the proxy path was not live-tested; the code proves it forwards caller headers to `https://amr-api.open-design.ai/api/v1/*` and can inject the control key on some routes.

## 5. Model API host (`amr-link.open-design.ai`)

Unauthenticated:
```
[401] /v1/models   body={"error":{"code":"missing_api_key",...}}
[404] /v1/usage
[404] /v1/credits
[404] /v1/me
[404] /v1/billing/usage
[404] /v1/workspaces/current/billing/usage
```
`GET /v1/models` with `OD_KEY`: `200`, 14 models (`claude-haiku-5.5`, `deepseek-v4-flash`, ...).

One real chat completion (`deepseek-v4-flash`, `max_tokens:5`) returned `200` with **no quota headers**:
```
HTTP/2 200
content-type: application/json
content-length: 529
x-request-id: 8cd882a3-b0ed-4a66-9d80-65786454d50c
cf-cache-status: DYNAMIC
report-to: ...
nel: ...
server: cloudflare
cf-ray: a5bef84be9586dc3-LAX
alt-svc: h3=":443"; ma=86400
```
No `x-ratelimit-*`, `x-quota-*`, `x-balance-*` or similar. Body usage is per-call only: `{"prompt_tokens":32,...,"completion_tokens":5,...,"total_tokens":37}`. The model endpoint is a pure inference API with no account/quota surface.

## 6. Answer to "r u sure theres no api for the usage?"

There **is** one: the console itself calls `GET /api/v1/workspaces/{id}/billing/usage` on `amr-api.open-design.ai`, with cookie session auth and a workspace id. What we proved absent is any usage API reachable with the `OD_KEY` model key: the model host has no such route and returns no quota headers, and the control-plane route rejects the model key. `oduse` estimates from local stores because that is the only credential we hold. Reaching the real API would require the app's Vela control key (or a console session cookie) plus the workspace id; both are accessible only inside the app, and the daemon proxy exists but was not running during this probe.

Reproduce with:
```
curl https://amr-api.open-design.ai/api/v1/this-path-does-not-exist-xyzabc   # 404
curl https://amr-api.open-design.ai/api/v1/workspaces/current/billing/usage  # 401 {"error":"unauthenticated"}
```
