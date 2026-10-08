import type { CompareRow, PlanInfo, ProviderId, Workload } from "~/types.ts";

export type Row = CompareRow;

/** One table column. */
export interface Column {
	header: string;
	value: (row: Row) => string;
	right?: boolean;
	/** Optional SGR code applied to the padded cell (green 32, dim 2, ...). */
	style?: (row: Row) => string | undefined;
	/** Lower values are dropped first when the table is too wide. */
	drop?: number;
	/** When false the cell is not padded to the column width. */
	pad?: boolean;
}

export type GroupKey = "model" | "oc" | "cc" | "misc";

export interface GroupLabel {
	title: string;
	color: string;
}

/** A contiguous run of columns belonging to one group. */
export interface Segment {
	key: GroupKey;
	columns: Column[];
	widths: number[];
	/** Total printed width including the gaps between columns. */
	width: number;
}

export interface FitResult {
	ids: string[];
	dropped: string[];
	width: number;
}

export interface Tally {
	/** Rows present on both sides. */
	headToHead: number;
	ocWins: number;
	ccWins: number;
	ties: number;
	ocOnly: number;
	ccOnly: number;
}

export interface ReportMeta {
	ocPlan: PlanInfo;
	ccPlan: PlanInfo;
	/** The request shape actually priced — one per side when a shape was measured. */
	workloads: Record<ProviderId, Workload>;
	/** Ability source label, e.g. "CommandCode Intelligence". */
	abilityLabel?: string;
	abilityNote?: string;
	/** Whether reqshape was used for the workload, and the alternative flags. */
	shapeNote?: string;
	/** Override for the rolling-window ratios, five-hour then weekly. */
	window?: [number, number];
}

import { CC_COLUMNS } from "./columns/cc.ts";
import { META_COLUMNS } from "./columns/meta.ts";
import { OC_COLUMNS } from "./columns/oc.ts";

/** Every column the table can render, keyed by the id used with --columns. */
const COLUMNS: Record<string, Column> = {
	...META_COLUMNS,
	...OC_COLUMNS,
	...CC_COLUMNS,
};

export function columns(ids: string[]): Column[] {
	return ids.map((id) => {
		const column = COLUMNS[id];
		if (!column) throw new Error(`unknown column "${id}"`);
		return column;
	});
}
