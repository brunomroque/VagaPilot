import { computeAtsScore } from "@vagapilot/core/ats-score"

const REQUIREMENT_HEADER =
  /^(requisitos|requirements|qualifica|diferenciais|nice to have|o que (buscamos|esperamos)|what we.re looking for|must have|desejavel|conhecimentos|skills|competencias)/
const OTHER_HEADER =
  /^(responsabilidades|responsibilities|atribuicoes|beneficios|benefits|sobre (a empresa|nos|a vaga)|about (us|the company)|como (sera|e) o processo|etapas)/

function foldLine(line: string): string {
  return line
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/^[\s•*\-–#:]+/, "")
    .trim()
}

/** Requirement lines of a job description (falls back to the whole text). */
export function requirementLines(jobText: string): string[] {
  const lines = jobText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const picked: string[] = []
  let inside = false
  for (const line of lines) {
    const folded = foldLine(line)
    if (REQUIREMENT_HEADER.test(folded)) {
      inside = true
      continue
    }
    if (OTHER_HEADER.test(folded)) {
      inside = false
      continue
    }
    if (inside && line.length <= 300) picked.push(line)
  }
  return picked.length > 0 ? picked : lines.filter((line) => line.length <= 300)
}

/** Deterministic ATS score of an attached CV against an attached (or pasted) job description. */
export function attachmentAtsScore(cvText: string, jobText: string) {
  const result = computeAtsScore({
    cvText,
    requirements: requirementLines(jobText),
  })
  // QA 02:18: the card listed ad words ("vaga", "empresa", "exemplo") as missing keywords.
  // Score and lists come from the same filtered keywords so they always agree.
  const covered = skillGaps(result.covered)
  const missing = skillGaps(result.missing)
  const total = covered.length + missing.length
  const score =
    total > 0 ? Math.round((covered.length / total) * 100) : result.score
  return {
    kind: "ats_score" as const,
    jobMatchId: "",
    before: score,
    after: null,
    covered: covered.slice(0, 40),
    missing: missing.slice(0, 40),
    summary: `Score ATS do CV anexado: ${score}% (${covered.length} de ${total} palavras-chave da vaga).`,
  }
}

/** Words of a job ad that are not skills (QA: "vaga", "empresa", "exemplo" were listed as gaps). */
const NOT_A_SKILL = new Set(
  [
    "vaga",
    "vagas",
    "empresa",
    "exemplo",
    "tech",
    "requisitos",
    "requisito",
    "cargo",
    "local",
    "modelo",
    "hibrido",
    "remoto",
    "presencial",
    "sao",
    "paulo",
    "rio",
    "janeiro",
    "brasil",
    "sa",
    "ltda",
    "anos",
    "ano",
    "experiencia",
    "conhecimento",
    "conhecimentos",
    "desejavel",
    "diferencial",
    "diferenciais",
    "nivel",
    "area",
    "time",
    "times",
    "equipe",
    "trabalho",
    "atuar",
    "buscamos",
    "procuramos",
    "sobre",
    "beneficios",
    "empresa:",
    "job",
    "role",
    "years",
    "experience",
    "team",
    "company",
    "requirements",
    "plus",
    "avancado",
    "fluente",
    "intermediario",
    "basico",
    "exemplos",
    "tecnologia",
    "tecnologias",
    "requirement",
    "qualificacoes",
    "qualificacao",
    "responsabilidades",
    "atividades",
    "oportunidade",
    "candidato",
    "candidata",
    "pessoa",
    "profissional",
    "profissionais",
    "cliente",
    "clientes",
    "projeto",
    "projetos",
    "forte",
    "bom",
    "boa",
    "ser",
    "ter",
    "como",
    "para",
    "com",
    "sua",
    "seu",
    "nos",
    "voce",
    "junior",
    "pleno",
    "senior",
    "clt",
    "pj",
    "salario",
    "beneficio",
    "horario",
    "contratacao",
    "regime",
    "etc",
    "the",
    "and",
    "with",
    "skills",
    "knowledge",
    "work",
    "working",
    "strong",
    "ability",
    "nice",
    "have",
    "must",
    "you",
    "our",
    "will",
  ].map(fold)
)

function fold(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

/** Missing keywords worth suggesting: drop generic ad words and bare numbers. */
export function skillGaps(missing: readonly string[]): string[] {
  const seen = new Set<string>()
  return missing
    .map((word) =>
      word
        .trim()
        .replace(/[.,;:!?)]+$/, "")
        .replace(/^[(]+/, "")
    )
    .filter((word) => {
      const folded = fold(word)
      if (seen.has(folded)) return false
      seen.add(folded)
      if (folded.length < 2) return false
      if (/^[\d+%.,\s-]+$/.test(folded)) return false
      return !NOT_A_SKILL.has(folded)
    })
}

export type CvVsJobAttachment = {
  id: string
  name: string
  kind: string
  text: string
}

export const CV_VS_JOB_OPTIONS = [
  "Aplicar estes ajustes numa nova versão",
  "Ajustar só alguns",
  "Não ajustar",
] as const

export type CvVsJobReport = {
  scores: {
    cvAttachmentId: string
    jobAttachmentId: string
    output: ReturnType<typeof attachmentAtsScore>
  }[]
  text: string
  question: string
  options: string[]
}

/**
 * QA: with CV + job and no typed text, the model stopped at "sugiro os seguintes ajustes" with no
 * items and no approval card. The comparison is now written on the server from the ATS result;
 * every suggestion is conditional ("se você tem…"), so nothing is invented.
 */
export function cvVsJobReport(
  attachments: readonly CvVsJobAttachment[]
): CvVsJobReport | null {
  const cvs = attachments.filter((a) => a.kind === "cv" && a.text.trim())
  const jobs = attachments.filter(
    (a) =>
      (a.kind === "job_description" || a.kind === "job_image") && a.text.trim()
  )
  if (cvs.length === 0 || jobs.length === 0) return null
  const scores = cvs.flatMap((cv) =>
    jobs.map((job) => ({
      cvAttachmentId: cv.id,
      jobAttachmentId: job.id,
      cvName: cv.name,
      jobName: job.name,
      output: attachmentAtsScore(cv.text, job.text),
    }))
  )
  const lines: string[] = []
  // QA 02:18: score and keyword lists live only in the ATS card above (shown once).
  if (cvs.length > 1) {
    const best = [...scores].sort(
      (a, b) => b.output.before - a.output.before
    )[0]!
    lines.push(
      `**CV recomendado:** "${best.cvName}" (${best.output.before}%).`,
      ""
    )
  }
  const best = [...scores].sort((a, b) => b.output.before - a.output.before)[0]!
  // At most 6 suggestions in total: up to 5 keyword gaps + 1 general tip.
  const gaps = best.output.missing.slice(0, 5)
  lines.push("**Ajustes sugeridos** (só inclua o que for verdade):")
  if (gaps.length > 0) {
    for (const gap of gaps) {
      lines.push(
        `- Se você tem experiência com **${gap}**, cite isso no CV com onde usou e qual foi o resultado.`
      )
    }
  } else {
    lines.push(
      "- O CV já cobre as palavras-chave da vaga. Reforce resultados com números reais nas experiências mais recentes."
    )
  }
  lines.push(
    "- Use os mesmos termos da vaga no resumo e nas experiências (ATS compara palavras exatas).",
    "",
    "Nada é alterado sem a sua aprovação."
  )
  return {
    scores: scores.map(({ cvAttachmentId, jobAttachmentId, output }) => ({
      cvAttachmentId,
      jobAttachmentId,
      output,
    })),
    text: lines.join("\n"),
    question: "Quer que eu aplique estes ajustes?",
    options: [...CV_VS_JOB_OPTIONS],
  }
}
