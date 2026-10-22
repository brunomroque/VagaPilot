import { formatDateTimeBR } from "@vagapilot/core/dates"

import type { FixtureMessage } from "../mock.js"
import {
  ambiguousRejectionEmail,
  confirmationEmail,
  injectionEmails,
  interviewEmail,
  linkedInAlertEmail,
  newsletterEmail,
  stageEmail,
  verificationCodeEmail,
} from "./templates.js"

const HOUR = 3_600_000

/**
 * Demo mailbox for the fictitious seed user Marina (supabase/seeds/tracker.sql), used by the dev
 * mock ("Simular e-mails de exemplo"). Covers every path: automatic update with deadline,
 * interview, low confidence, terminal status, confirmation without application (RF11.7), LinkedIn
 * alert, verification code, prompt injection and mail outside the filter. Stone and Creditas are
 * left alone (shell smoke test reads them).
 */
export function buildDemoMailbox(now: Date): FixtureMessage[] {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR)
  const inHours = (hours: number) =>
    formatDateTimeBR(new Date(now.getTime() + hours * HOUR))
  return [
    newsletterEmail({ id: "demo-newsletter", date: at(30) }),
    confirmationEmail({
      id: "demo-alice-confirmacao",
      date: at(26),
      company: "Alice",
      role: "Head of Technology",
    }),
    confirmationEmail({
      id: "demo-acme-confirmacao",
      date: at(20),
      company: "Acme Pagamentos",
      role: "Gerente de Engenharia",
    }),
    stageEmail({
      id: "demo-loft-teste",
      date: at(8),
      company: "Loft",
      role: "Gerente de Plataforma",
      deadlineText: inHours(36),
    }),
    interviewEmail({
      id: "demo-ifood-convite",
      date: at(6),
      company: "iFood",
      role: "Tech Lead Manager",
      whenText: `${inHours(72).slice(0, 5)} às 14h`,
    }),
    ambiguousRejectionEmail({
      id: "demo-quintoandar-retorno",
      date: at(5),
      company: "QuintoAndar",
      role: "Engineering Manager",
    }),
    interviewEmail({
      id: "demo-picpay-convite",
      date: at(4),
      company: "PicPay",
      role: "Engineering Manager",
      whenText: `${inHours(96).slice(0, 5)} às 10h`,
    }),
    linkedInAlertEmail({
      id: "demo-alerta",
      date: at(3),
      jobIds: ["4012345678", "4012345679", "4012345680"],
    }),
    verificationCodeEmail({ id: "demo-codigo", date: at(2), code: "482913" }),
    ...injectionEmails(at(1), "Loft")
      .slice(0, 1)
      .map((message) => ({ ...message, id: "demo-injecao" })),
  ]
}
