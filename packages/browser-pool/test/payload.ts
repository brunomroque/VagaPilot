import type { ApplicationPackagePayload } from "@vagapilot/core/application-package"

export function samplePayload(): ApplicationPackagePayload {
  return {
    version: 1,
    applicationId: "00000000-0000-4000-8000-000000000001",
    jobSource: "gupy",
    company: "ACME",
    roleTitle: "Dev",
    profile: {
      firstName: "Bruno",
      lastName: "Teste",
      displayName: "Bruno Teste",
      email: "bruno@example.com",
      phone: "+55 11 90000-0000",
      city: "São Paulo",
      state: "SP",
      country: "Brasil",
      linkedinUrl: null,
      portfolioUrl: null,
      cpf: null,
      documents: null,
    },
    standardAnswers: [],
    facts: [],
    cvVersionId: null,
    salaryInformed: null,
  } as unknown as ApplicationPackagePayload
}
