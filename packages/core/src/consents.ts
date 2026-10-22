/**
 * Consent purposes (spec 9.3 `consents`) and the latest-decision rule.
 * Diversity data is stored only while the `diversidade` consent is granted (CA1.3).
 */

export const CONSENT_PURPOSES = [
  "termos",
  "privacidade",
  "ia_cv",
  "gmail_leitura",
  "gmail_envio",
  "diversidade",
  "marketing",
  "risk_gmail",
  "risk_extension",
  "risk_linkedin",
] as const

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]

export type ConsentRecord = {
  purpose: string
  granted: boolean
  createdAt: string | Date
}

function timeOf(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value)
}

/** Latest decision for a purpose. Absent consent counts as not granted. */
export function isConsentGranted(
  records: readonly ConsentRecord[],
  purpose: ConsentPurpose
): boolean {
  let latest: ConsentRecord | undefined
  for (const record of records) {
    if (record.purpose !== purpose) continue
    if (!latest || timeOf(record.createdAt) >= timeOf(latest.createdAt)) {
      latest = record
    }
  }
  return latest?.granted === true
}

export function canStoreDiversityData(
  records: readonly ConsentRecord[]
): boolean {
  return isConsentGranted(records, "diversidade")
}
