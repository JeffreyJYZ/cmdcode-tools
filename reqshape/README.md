# reqshape

Measure the shape of your requests from opencode's own history, then price that shape against any model.

[![CI](https://img.shields.io/github/actions/workflow/status/JeffreyJYZ/cmdcode-tools/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/JeffreyJYZ/cmdcode-tools/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

## What it is

A **req** is one model call — the same unit the opencode sidebar counts: a single
`assistant` row in opencode's store. An agentic ask is many reqs, because the
model is called again after every tool result.

`reqshape` reads that history, drops the requests that ask for nothing, averages
the rest, and hands you the answer as a token vector: *one of my requests is
8.2K input, 309 output, 139 reasoning, 248K cache read*. Then it prices that
vector on every model OpenCode Go and CommandCode sell, and divides each plan's
allowance and window caps by the result.

`mpc` answers the same question with a fixed assumption (800 in / 50K cache / 200
out). This answers it with your actual traffic — and usually disagrees, because
context is re-read on every call and yours is deep.

## Install

Not published to npm — run it from a checkout and link the binary:

```sh
bun install
bun link
```

## Usage

```sh
reqshape
```

```text
reqshape  7.3K reqs · every req weighted equally
measured from the opencode v2 store · priced by mpc

MEASURED  1,084 asks · 38 sessions · 12 projects · 2026-07-10 → 2026-09-29
DROPPED   synthetic prompt 260 · trivial prompt 138 · system prompt 130 · empty prompt 14 · compaction prompt 9 · shell prompt 7

PER REQ   input 8.2K · output 309 · reasoning 139 · cache read 248.0K · cache write 8.1
          p10/p90  input 67/9.2K · output 46/701 · cache read 1.9K/648.7K
          one vote per conversation instead: cache read 64.0K · input 10.4K · output 216

PER SIDE  each side priced on its own traffic
          OpenCode Go   input     7.2K  output     296  cache read    134.8K  3,684 reqs
          CommandCode   input     3.7K  output     337  cache read    397.0K  3,360 reqs

POSITION  how far into its session the req sat — every call re-reads the context
          pos 1        cache read      579  input    8.5K  output     75  28 reqs
          pos 2-5      cache read     9.9K  input    4.9K  output    180  107 reqs
          pos 6-20     cache read    21.5K  input    8.2K  output    279  356 reqs
          pos 21-100   cache read    62.2K  input   10.9K  output    388  1,043 reqs
          pos 101+     cache read   301.5K  input    7.8K  output    301  5,737 reqs

MODELS    deepseek-v4.1-flash 2.8K · minimax-m3 1.7K · glm-5.2 1.4K · best-coding 447 · hy3-free 391 · big-pickle 140 …2 more

PROJECTED what the plan's allowance buys at the measured shape

MODEL                       PLAN                $/req      req/mo      req/5h      req/wk
──────────────────────────  ───────────  ────────────  ──────────  ──────────  ──────────
Jev                         CC GOAT       $0.00034461       58.0K       11.6K       29.0K
Muse Spark 1.3 Contributor  OC Go         $0.00140623       42.7K        8.5K       21.3K
MiMo V2.6 Flash             OC Go         $0.00197864       30.3K        6.1K       15.2K
DeepSeek V4.1 Flash         OC Go          $0.0022531       26.6K        5.3K       13.3K
...
Grok 4.6                    OC Go             $0.1431         105          21          52

CC account  1,898 reqs this period · GOAT · ends 2026-10-27
```

## Why "cache read" is the whole story

Every request re-sends the conversation, and providers bill the re-sent part as
cached tokens. So cache read is not a property of how you prompt; it is a
function of **how far into the conversation you are**:

| position in its session | reqs | cache read / req |
| --- | --- | --- |
| 1st | 28 | 579 |
| 2–5 | 107 | 9.9K |
| 6–20 | 356 | 21.5K |
| 21–100 | 1,043 | 62.2K |
| 101+ | 5,737 | 301.5K |

The first request of a conversation is essentially free to re-send; the hundredth
re-sends 300K tokens. On this history **78% of all requests sit at 101+**, which
is why the per-request average (248K) is four times the per-conversation average
(64K) — one enormous session otherwise sets the profile.

`--weight turn` (the default) treats every req as one data point, because that is
the unit you are billed in. `--weight session` gives each conversation one vote
and prices that instead. Both are printed either way, so you can see the gap.

A model with no published cache-read rate is billed for that context at its
**input** rate, and flagged with `*`. This is the single biggest swing in the
table: a model with no caching support is not slightly more expensive for this
traffic, it is unusable.

## Noise filtering

"hi", "thanks", "ok", "continue" are real requests but say nothing about the work
you do. `reqshape` drops an ask — the prompt *and* every req it drove — when:

- its prompt normalises to a keyword (`hi`, `hey there`, `thanks`, `great`,
  `lgtm`, `continue please`, …) — edit the list with `--keywords`
- its prompt is nothing but emoji or punctuation (`--min-chars` adds a length
  floor)
- it produced almost no output (`--min-output N`)

Structural noise is always dropped: auto-generated `synthetic` prompts, the
`compaction` summary turn, `shell` commands, and `system` rows are not requests
you made. `--keep-trivial` turns off the prompt filters and keeps everything else
the same, and `--explain` prints every reason with its count — nothing is
silently discarded.

## Options

| flag | default | meaning |
| --- | --- | --- |
| `--weight <mode>` | `turn` | `turn` (every req equal) or `session` (one vote per conversation) |
| `--sessions <mode>` | `all` | `all` includes subagent sessions; `user` drops them |
| `--keywords <list>` | built-in list | comma-separated prompts to treat as noise (replaces the list) |
| `--min-chars <n>` | `0` | also drop prompts shorter than this |
| `--min-output <n>` | `0` | also drop asks that produced fewer output tokens |
| `--keep-trivial` | off | keep every prompt; only structural noise is dropped |
| `--since <date>` | all time | only asks on or after this date |
| `--project <dir>` | all | only sessions whose directory contains this |
| `--model <text>` | all | only model rows whose name contains this |
| `--limit <n>` | all | cap the number of model rows |
| `--sort <key>` | `reqmo` | `reqmo` (most requests first), `cost`, `name` |
| `--explain` | off | list every drop reason rather than the top six |
| `--format <mode>` | `text` | `text` or `json` |
| `--db <path>` | opencode's store | where the history lives (`OPENCODE_DB`) |
| `--mpc <bin>` | `mpc` | catalogue source (`MPC_BIN`) |
| `--cmduse <bin>` | `cmduse` | account line (`CMDUSE_BIN`) |
| `--no-account` | off | skip the `cmduse` account line |
| `--no-color` | off | plain output (also honours `NO_COLOR`) |

### A model nobody sells

```sh
reqshape --in 0.15 --out 0.6 --cache-read 0.003 --budget 60 --five-hour 12 --weekly 30
```

`--budget` is the monthly allowance; `--five-hour` and `--weekly` are the plan's
caps, and without them those two columns show `—` rather than inventing a window.
Omit `--cache-read` and the context is billed at the input rate, flagged `*`.

## Where the numbers come from

- **Your traffic** — opencode's own store, read-only (`~/.local/share/opencode/opencode.db`).
  v2's `session_message` is read when present, the pre-v2 `message` table otherwise,
  and session metadata is joined across `session` and `session_v2`.
- **Model rates, allowances and window caps** — `mpc --json`. The 5-hour and weekly
  caps are read back from mpc's own figures, so the provider's window rule is not
  restated here where it could drift.
- **The account line** — `cmduse -1 --json`, purely as context for how much of
  your usage this profile covers. If it cannot answer, the line is simply absent.

### Per side, and back into `mpc`

`--format json` carries `sides.oc` and `sides.cc`: the same measured profile
split by whose traffic it is (requests to `opencode*` vs the `CC_PREFIXES`
ids), with each side's own request count. `mpc --shape measured` reads exactly that
payload and prices each plan on its side's shape, so its estimated `req/mo` is
"how many of *my* requests fit" instead of a fixed 800-in / 50K-cache /
200-out assumption.

Runs take about 20 seconds: both `mpc` and `cmduse` go to the network.

## Links

- [Source (GitHub)](https://github.com/JeffreyJYZ/cmdcode-tools/tree/main/reqshape)
- [MIT license](LICENSE)
