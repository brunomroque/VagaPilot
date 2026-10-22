import type { ApplicationPackagePayload } from "@vagapilot/core/application-package"

import { getApiBase, getDeviceToken } from "./storage"

export type PackageResponse = {
  packageId: string
  payload: ApplicationPackagePayload
  cv: { versionId: string; filename: string; downloadUrl: string } | null
  expiresAt: string
}

async function extFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const base = await getApiBase()
  const token = await getDeviceToken()
  if (!token) throw new Error("not_paired")
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)
  headers.set("Content-Type", "application/json")
  return fetch(`${base}${path}`, { ...init, headers })
}

export async function pairDevice(
  code: string,
  deviceName: string
): Promise<string> {
  const base = await getApiBase()
  const response = await fetch(`${base}/api/ext/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, deviceName }),
  })
  if (!response.ok) throw new Error("pair_failed")
  const data = (await response.json()) as { token: string }
  return data.token
}

export async function fetchPackage(
  applicationId: string
): Promise<PackageResponse> {
  const response = await extFetch(`/api/ext/packages/${applicationId}`)
  if (!response.ok) throw new Error("package_failed")
  return (await response.json()) as PackageResponse
}

export type ExtQuestionRow = {
  id: string
  questionText: string
  answer: string | null
  status: string
  answeredAt: string | null
}

export async function listQuestions(
  applicationId: string
): Promise<ExtQuestionRow[]> {
  const response = await extFetch(
    `/api/ext/questions?applicationId=${encodeURIComponent(applicationId)}`
  )
  if (!response.ok) throw new Error("questions_list_failed")
  const data = (await response.json()) as { questions: ExtQuestionRow[] }
  return data.questions
}

export async function postQuestion(
  body: Record<string, unknown>
): Promise<string> {
  const response = await extFetch("/api/ext/questions", {
    method: "POST",
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error("question_failed")
  const data = (await response.json()) as { id: string }
  return data.id
}

export async function confirmApplication(
  applicationId: string,
  body: {
    protocolText: string | null
    pageUrl: string
    confirmedByUser: boolean
  }
): Promise<void> {
  const response = await extFetch(
    `/api/ext/applications/${applicationId}/confirm`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  )
  if (!response.ok) throw new Error("confirm_failed")
}
