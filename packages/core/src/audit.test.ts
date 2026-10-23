import { describe, expect, it } from "vitest"

import {
  AUDIT_ACTIONS,
  createAuditLogger,
  InMemoryAuditSink,
  isAuditAction,
  logAudit,
  type AuditAction,
  type AuditActor,
  type AuditRecord,
  type AuditSink,
} from "./audit.js"
import { REDACTED_CPF, REDACTED_EMAIL, REDACTED_PHONE } from "./redact.js"

const USER_ID = "00000000-0000-4000-8000-00000000000a"

describe("logAudit", () => {
  it("redacts details before they reach the sink", async () => {
    const written: AuditRecord[] = []
    const sink: AuditSink = {
      async write(record) {
        written.push(structuredClone(record))
      },
    }

    await logAudit(sink, {
      userId: USER_ID,
      actor: "agente",
      action: "form.field_filled",
      targetType: "application",
      targetId: "00000000-0000-4000-8000-000000000001",
      details: {
        field: "email",
        value: "ana@exemplo.com",
        nested: [{ cpf: "529.982.247-25" }, "tel (11) 98765-4321"],
      },
      userAgent: "Mozilla/5.0 contato ana@exemplo.com",
    })

    expect(written).toHaveLength(1)
    const [record] = written
    expect(record).toMatchObject({
      userId: USER_ID,
      actor: "agente",
      action: "form.field_filled",
      targetType: "application",
      targetId: "00000000-0000-4000-8000-000000000001",
      approvalId: null,
      ip: null,
      details: {
        field: "email",
        value: REDACTED_EMAIL,
        nested: [{ cpf: REDACTED_CPF }, `tel ${REDACTED_PHONE}`],
      },
      userAgent: `Mozilla/5.0 contato ${REDACTED_EMAIL}`,
    })
    expect(JSON.stringify(record)).not.toMatch(/ana@exemplo|529\.982|98765/)
    expect(record?.occurredAt).toBeInstanceOf(Date)
  })

  it("defaults details to an empty object", async () => {
    const sink = new InMemoryAuditSink()
    await logAudit(sink, {
      userId: null,
      actor: "sistema",
      action: "killswitch.toggled",
    })
    expect(sink.records[0]?.details).toEqual({})
  })

  it("rejects actors and actions outside the spec", async () => {
    const sink = new InMemoryAuditSink()
    await expect(
      logAudit(sink, {
        userId: USER_ID,
        actor: "hacker" as AuditActor,
        action: "email.sent",
      })
    ).rejects.toThrow(/actor/)
    await expect(
      logAudit(sink, {
        userId: USER_ID,
        actor: "usuario",
        action: "email.read" as AuditAction,
      })
    ).rejects.toThrow(/action/)
    expect(sink.records).toHaveLength(0)
  })

  it("binds a sink with createAuditLogger", async () => {
    const sink = new InMemoryAuditSink()
    const log = createAuditLogger(sink)
    await log({ userId: USER_ID, actor: "usuario", action: "data.exported" })
    expect(sink.records.map((r) => r.action)).toEqual(["data.exported"])
  })
})

describe("AUDIT_ACTIONS", () => {
  it("covers spec 10.7 without duplicates", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
    expect(AUDIT_ACTIONS).toHaveLength(50)
    expect(isAuditAction("account.deletion_cancelled")).toBe(true)
    expect(isAuditAction("risk.reconsent_required")).toBe(true)
    expect(isAuditAction("browser_pool.provider_tested")).toBe(true)
    expect(isAuditAction("risk.unknown")).toBe(false)
  })
})
