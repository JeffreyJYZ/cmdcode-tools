# Lane brief — the real meter: `billing/snapshot`

We found OpenDesign's actual server-side usage meter, and it is what the console shows. Verified on this account with the console session (200):

```
GET https://amr-api.open-design.ai/api/v1/workspaces/bojo3mq722vsiblclo937fxu/billing/snapshot
```

```json
{"schemaVersion":1,"billingScopeVersion":2,"billingMode":"shared",
 "billing":{"billingState":"active","planId":"go"},
 "plan":{"tier":"go","interval":"month","currentPeriodStart":"2026-11-16T13:21:22.000Z",
         "currentPeriodEnd":"2026-12-16T13:21:22.000Z","cancelAtPeriodEnd":false,"status":"active"},
 "wallet":{"balanceUsd":"1.0000","expiresAt":"2026-12-16T13:21:22.000Z"},
 "walletBreakdown":[{"kind":"plan_grant","amountUsd":"1.0000","expiresAt":"..."}],
 "designPlanWindows":[
   {"kind":"5h","windowStart":"2026-11-17T09:21:22.000Z","resetsAt":"2026-11-17T14:21:22.000Z",
    "remainingCredits":"4149","limitCredits":"50000"},
   {"kind":"7d","windowStart":"2026-11-16T13:21:22.000Z","resetsAt":"2026-11-23T13:21:22.000Z",
    "remainingCredits":"29491","limitCredits":"150000"}],
 "permissions":{"canUpgrade":true,"canRecharge":true,...}}
```

Read off that: **5-hour 8.3% left (4,149 / 50,000)**, **weekly 19.7% left (29,491 / 150,000)** — which is the "20% left" the console told the user, so the numbers are right and ours were wrong.

Units: one credit is $0.0001. The ledger proves it (`listChargedUsd 0.0043` ↔ `listChargeCredits 43`). `50,000` and `150,000` are therefore `$5.00` and `$15.00` — the published `$18`/`$55` multiplied by Eco's `0.27`. **The windows are denominated in Eco-equivalent credits**, not the Flash figures we print.

## Task

Make this the meter in `cmduse/src/oduse/**`.

1. Fetch `billing/snapshot` when a session credential is available (see the balance brief: explicit user-supplied cookie, never scraped). One request gives plan, wallet, both windows and their `resetsAt`.
2. When the snapshot answers, its `designPlanWindows` **win** over the locally computed windows, exactly as `ocuse` lets the account meter win over its local estimate. Print remaining and used: `$0.41 used of $5.00 · 8.3% left · resets 14:21Z`.
3. Say which source produced each figure. `--json` gains a meter source (`"snapshot" | "local"`), keeping every existing key.
4. Do not silently convert units: expose the raw `remainingCredits`/`limitCredits` alongside the dollars, and put the credit-to-dollar factor in one named constant with a comment citing the ledger observation above.
5. Crash-safe: no credential → today's local estimate, one dim line saying so. 401/403/404 → named reason, never a zero, never a crash. Timeout ≤ 2 s so a watch frame cannot stall.
6. Tests against a stub: the real body above; 401; 404; malformed; timeout; and one proving the snapshot numbers beat the local ones when both exist.
7. Docs: `cmduse/README.md`, `cmduse/cmduse.1` — where the number comes from, what a credit is, and that the windows reset at the times the server reports, not on a local schedule.

Gate: `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`.

House rules: `rg`, `fd`, `sd`, no Python, no agent-desktop, bound every TUI with `timeout`, files under 200 lines, no commit/push/branch — leave the tree dirty. Do not touch `opencode-plugin/` or `oc-cmd-compare/`, and do not touch the rates (`core/od.json`) — another lane owns those.
