/** Outcome carrying a non-negative relative selection weight. */
export interface Weighted {
	readonly weight: number;
}

/**
 * Selects one candidate in proportion to its relative weight.
 *
 * @param candidates - Eligible outcomes with non-negative relative weights.
 * @param rng - Supplies a value in the half-open interval `[0, 1)`.
 * @returns The selected candidate without modifying the input collection.
 * @throws If the pool is empty, a weight is invalid, total weight is zero, or
 * the random-number generator returns a value outside `[0, 1)`.
 */
export function selectWeighted<T extends Weighted>(candidates: readonly T[], rng = Math.random): T {
	if (!candidates.length) throw new Error("Cannot select from an empty modifier pool");
	const total = candidates.reduce((sum, candidate) => {
		if (!Number.isFinite(candidate.weight) || candidate.weight < 0) {
			throw new Error(`Invalid modifier weight: ${candidate.weight}`);
		}
		return sum + candidate.weight;
	}, 0);
	if (total <= 0) throw new Error("Modifier pool has no positive weight");
	const roll = rng();
	if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
		throw new Error("Random-number generator must return a value in [0, 1)");
	}
	let cursor = roll * total;
	for (const candidate of candidates) {
		cursor -= candidate.weight;
		if (cursor < 0) return candidate;
	}
	return candidates[candidates.length - 1] as T;
}
