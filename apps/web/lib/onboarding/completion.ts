import type { OnboardingRequirements } from "./server"

const REQUIREMENT_KEYS: (keyof OnboardingRequirements)[] = [
  "hasCv",
  "hasSalaryRule",
  "hasLanguage",
  "hasWorkModels",
  "hasRegimes",
  "hasAvailability",
]

/** Share of onboarding profile requirements met (0–100). */
export function profileCompletionPercent(
  requirements: OnboardingRequirements
): number {
  const done = REQUIREMENT_KEYS.filter((key) => requirements[key]).length
  return Math.round((done / REQUIREMENT_KEYS.length) * 100)
}
