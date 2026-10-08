/**
 * `--shape` specs. `auto` (the default) measures with reqshape but only trusts
 * it once the sample is big enough; `measured` forces it; `off` keeps the fixed
 * workload. Anything else is a path to a saved payload.
 */
export const SHAPE_AUTO = "auto";
export const SHAPE_MEASURED = "measured";
export const SHAPE_OFF = "off";

/** Fewest reqs for `auto` to prefer reqshape's profile over the fixed workload. */
export const SHAPE_MIN_REQS = 500;

/**
 * Env marker set on the reqshape child. reqshape runs `mpc --json`, so without
 * it a nested mpc would measure all over again; a process that sees it keeps
 * the fixed workload. This breaks the cycle for callers that do not pass
 * `--shape off` (e.g. a published sibling still pinned to the old default).
 */
export const SHAPE_GUARD_ENV = "MPC_SHAPE_RESOLVING";
