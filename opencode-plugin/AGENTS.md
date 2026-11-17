# AGENTS.md

## The sidebar's four families

- **The sidebar has four families**: `rows.ts` (Command Code), `zen.ts` (Go/Zen), `ark.ts` (ARK), `od-rows.ts` (OpenDesign, alongside `od.ts` for the projection); `useRows` keys the OpenDesign family by `isOpenDesignProvider` (a prefix on `OPEN_DESIGN_PROVIDER_ID`, so both `open-design` and the hand-written `open-design-tmp` count — an equality match left every turn on the hand-written spelling with no section), and only that kind spawns `oduse`.
