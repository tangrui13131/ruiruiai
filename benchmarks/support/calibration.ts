/** Shared conversion from reference-machine expectations to CI time budgets. */

/**
 * Measured wall-time ratio between the two-core hosted CI runner and the arm64
 * reference machine. The ratio was first measured on the repository's
 * sixteen-core self-hosted runners, which this fork no longer uses.
 */
export const CI_TIME_SCALE = 2.5
/** Allowed variance above the calibrated expectation. */
export const PERFORMANCE_BUDGET_HEADROOM = 1.25

/**
 * Convert a reference-machine duration into its CI wall-time budget.
 * @param expectedMs - Expected duration on the reference machine.
 * @returns Integer CI budget including machine scaling and variance headroom.
 */
export function ciTimeBudget(expectedMs: number): number {
  return Math.ceil(expectedMs * CI_TIME_SCALE * PERFORMANCE_BUDGET_HEADROOM)
}
