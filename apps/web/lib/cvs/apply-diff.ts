import "server-only"

import type { CvProfileDiffItem } from "@vagapilot/jobs"

import {
  addSkill,
  saveEducation,
  saveExperience,
  saveLanguage,
} from "@/app/app/perfil/actions"
import { fail, type ActionResult } from "@/lib/server/context"

/** Experiences need a start month to be valid profile rows; otherwise the user completes them. */
export function diffItemNeedsDetails(item: CvProfileDiffItem): boolean {
  return item.kind === "experience" && !item.value.startMonth
}

/** Writes one approved CV item to the profile through the regular, validated profile actions. */
export async function applyDiffItemToProfile(
  item: CvProfileDiffItem
): Promise<ActionResult<unknown>> {
  switch (item.kind) {
    case "experience": {
      const e = item.value
      if (!e.startMonth) return fail("invalid_request", "Start month missing.")
      const isCurrent = e.isCurrent || !e.endMonth
      return saveExperience({
        company: e.company,
        title: e.title,
        employmentType: "outro",
        startMonth: e.startMonth,
        endMonth: isCurrent ? "" : e.endMonth,
        isCurrent,
        location: "",
        description: e.description ?? "",
      })
    }
    case "education": {
      const e = item.value
      return saveEducation({
        institution: e.institution,
        degree: e.degree ?? "",
        field: e.field ?? "",
        level: e.level,
        status:
          e.endYear && e.endYear <= new Date().getFullYear()
            ? "concluido"
            : "cursando",
        startYear: e.startYear ? String(e.startYear) : "",
        endYear: e.endYear ? String(e.endYear) : "",
      })
    }
    case "language":
      return saveLanguage({
        language: item.value.language,
        level: item.value.level,
        cefr: "",
      })
    case "skill":
      return addSkill({ name: item.value.name })
    case "certification":
      return addSkill({ name: item.value.name.slice(0, 80) })
  }
}
