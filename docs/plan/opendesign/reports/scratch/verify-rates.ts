// THROWAWAY — Lane J rate verification. Compares core/od.json against the verbatim
// reference body docs/plan/opendesign/reference/od-model-prices.json.
const od = JSON.parse(await Bun.file("core/od.json").text());
const ref = JSON.parse(await Bun.file("docs/plan/opendesign/reference/od-model-prices.json").text());

const byModel = new Map<string, any>();
for (const row of ref.data) byModel.set(row.model, row);

let mismatches = 0;
const fields = ["input", "output", "cacheRead", "cacheWrite"] as const;
console.log(`od.json models: ${od.models.length}; reference rows: ${byModel.size}`);
for (const m of od.models) {
    const r = byModel.get(m.id);
    if (!r) {
        console.log(`MISSING IN REFERENCE: ${m.id}`);
        mismatches++;
        continue;
    }
    const p = r.pricing;
    for (const f of fields) {
        const ours = m[f];
        const theirs = p[f];
        if (ours === undefined && theirs === undefined) continue;
        if (ours === undefined || theirs === undefined || Math.abs(ours - theirs) > 1e-9) {
            console.log(`MISMATCH ${m.id} ${f}: od.json=${ours} reference=${theirs}`);
            mismatches++;
        }
    }
    if (m.rateSource !== "published") {
        console.log(`RATESOURCE ${m.id}=${m.rateSource}`);
        mismatches++;
    }
    if (m.longContext) {
        const lc = p.longContext;
        if (!lc) {
            console.log(`OD HAS LONGCONTEXT BUT REF DOES NOT: ${m.id}`);
            mismatches++;
        } else {
            for (const f of ["inputTokensAbove", "input", "output", "cacheRead", "cacheWrite"] as const) {
                if (Math.abs(m.longContext[f] - lc[f]) > 1e-9) {
                    console.log(`LC MISMATCH ${m.id} ${f}: od=${m.longContext[f]} ref=${lc[f]}`);
                    mismatches++;
                }
            }
        }
    } else if (p.longContext) {
        console.log(`REF HAS LONGCONTEXT BUT OD DOES NOT: ${m.id}`);
        mismatches++;
    }
}
const odIds = new Set(od.models.map((m: any) => m.id));
for (const id of byModel.keys()) if (!odIds.has(id)) {
    console.log(`REFERENCE ROW NOT IN OD: ${id}`);
    mismatches++;
}
console.log(`TOTAL MISMATCHES: ${mismatches}`);

// Also independently check the multiplier arithmetic on a handful of rows and
// that the harness test constants (RATES in published_rates.rs) match the reference.
const src = await Bun.file("cmduse/src/oduse/tests/published_rates.rs").text();
let checked = 0;
for (const line of src.split("\n")) {
    const m = line.match(/\("([^"]+)",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/);
    if (!m) continue;
    const [, id, i, o, c] = m;
    const r = byModel.get(id);
    if (!r) { console.log(`TEST ID NOT IN REF: ${id}`); mismatches++; continue; }
    if (Math.abs(+i - r.pricing.input) > 1e-9 || Math.abs(+o - r.pricing.output) > 1e-9 || Math.abs(+c - r.pricing.cacheRead) > 1e-9) {
        console.log(`TEST CONST MISMATCH ${id}: (${i},${o},${c}) vs ref (${r.pricing.input},${r.pricing.output},${r.pricing.cacheRead})`);
        mismatches++;
    }
    checked++;
}
console.log(`TEST CONST ROWS CHECKED: ${checked}`);
console.log(`FINAL MISMATCHES: ${mismatches}`);
