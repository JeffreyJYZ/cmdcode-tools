import type { Options } from "#~/cli/options.ts";
import { loadOcGoModelIds } from "#~/data/sources/opencode.ts";
import { normalizeKey } from "#~/keys.ts";
import type { CatalogEntry, CompareRow } from "#~/types.ts";

export interface AbilityInfo {
	label: string;
	note?: string;
	intelligence: Map<string, number>;
	tps: Map<string, number>;
}

export async function runCheck(
	_options: Options,
	ocEntries: CatalogEntry[],
	ccEntries: CatalogEntry[],
	rows: CompareRow[],
	ability: AbilityInfo,
): Promise<number> {
	const ocKeys = new Set(ocEntries.map((e) => e.key));
	const ccKeys = new Set(ccEntries.map((e) => e.key));
	const onlyOc = [...ocKeys].filter((k) => !ccKeys.has(k));
	const onlyCc = [...ccKeys].filter((k) => !ocKeys.has(k));

	console.log(`OpenCode entries parsed: ${ocEntries.length}`);
	console.log(`CommandCode entries:     ${ccEntries.length}`);
	console.log(
		`matched models:          ${rows.filter((r) => r.oc && r.cc).length}`,
	);
	console.log(
		`free OpenCode models:    ${ocEntries.filter((e) => e.allowance === 0).length}`,
	);

	const scored = rows.filter(
		(r) => r.oc?.ability != null || r.cc?.ability != null,
	).length;
	console.log(
		`ability source:          ${ability.label || "disabled"} (${ability.intelligence.size} scores, ${ability.tps.size} speed, ${scored}/${rows.length} rows scored)`,
	);
	if (ability.note) console.log(`ability note:            ${ability.note}`);

	const unscored = rows
		.filter((r) => (r.oc?.ability ?? r.cc?.ability ?? null) === null)
		.map((r) => r.key);
	if (unscored.length > 0) {
		const head = unscored.slice(0, 20).join(", ");
		const more =
			unscored.length > 20 ? `  +${unscored.length - 20} more` : "";
		console.log(`ability missing (${unscored.length}): ${head}${more}`);
	}

	const modelIds = await loadOcGoModelIds();
	console.log(`OpenCode /zen/go/v1/models ids: ${modelIds.length}`);
	const unpriced = modelIds.filter((id) => !ocKeys.has(normalizeKey(id)));
	console.log(
		`OpenCode ids missing from docs table (${unpriced.length}): ${unpriced.join(", ") || "—"}`,
	);

	console.log(
		`\nonly in OpenCode (${onlyOc.length}): ${onlyOc.join(", ") || "—"}`,
	);
	console.log(
		`only in CommandCode (${onlyCc.length}): ${onlyCc.join(", ") || "—"}`,
	);
	return 0;
}
