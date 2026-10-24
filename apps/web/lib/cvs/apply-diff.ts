import "server-only"

import type { CvProfileDiffItem } from "@vagapilot/jobs"

import {
  addSkill,
  saveEducation,
  saveExperience,
  saveLanguage,
} from "@/app/app/perfil/actions"
import type { ActionResult } from "@/lib/server/context"

/** Experiences without dates are saved as is; the profile then shows a pending start date. */
export function diffItemNeedsDetails(_item: CvProfileDiffItem): boolean {
  return false
}

/** Writes one approved CV item to the profile through the regular, validated profile actions. */
export async function applyDiffItemToProfile(
  item: CvProfileDiffItem
): Promise<ActionResult<unknown>> {
  switch (item.kind) {
    case "experience": {
      const e = item.value
      const isCurrent = e.startMonth ? e.isCurrent || !e.endMonth : e.isCurrent
      return saveExperience({
        company: e.company,
        title: e.title,
        employmentType: "outro",
        startMonth: e.startMonth ?? "",
        endMonth: isCurrent ? "" : (e.endMonth ?? ""),
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
