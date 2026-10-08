export function variantScore(name: string, peak: boolean): number {
	const lower = name.toLowerCase();
	let score = 0;
	// Prefer the base context tier over the "> 200K" tier.
	if (lower.includes(">")) score += 2;
	const isOff = lower.includes("off-peak");
	const isPeak = !isOff && lower.includes("peak");
	if (peak) score += isPeak ? 0 : 2;
	else score += isOff ? 0 : isPeak ? 2 : 1;
	return score;
}
