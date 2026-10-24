/**
 * QA 02:18: "Avalie" on a CV returned suggestions with no score. This is a deterministic
 * quality / ATS-readiness score (same input, same result) plus a short assessment.
 */
type Check = {
  id: string
  ok: boolean
  weight: number
  good: string
  bad: string
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

const has = (folded: string, re: RegExp) => re.test(folded)

export function cvQualityScore(text: string) {
  const folded = fold(text)
  const words = folded.split(/\s+/).filter(Boolean).length
  const bullets = text
    .split(/\r?\n/)
    .filter((l) => /^\s*[•\-*–▪●]\s+/.test(l)).length
  const metrics = (
    text.match(
      /\d+(?:[.,]\d+)?\s?(%|k\b|mil\b|x\b|r\$|us\$|pessoas|clientes|users|horas)/gi
    ) ?? []
  ).length
  const years = new Set(text.match(/\b(19[89]\d|20[0-3]\d)\b/g) ?? []).size
  const checks: Check[] = [
    {
      id: "email",
      weight: 10,
      ok: has(folded, /[\w.+-]+@[\w-]+\.[\w.-]+/),
      good: "e-mail de contato",
      bad: "falta e-mail de contato",
    },
    {
      id: "phone",
      weight: 5,
      ok: has(folded, /(\+?\d[\d\s().-]{8,}\d)/),
      good: "telefone",
      bad: "falta telefone",
    },
    {
      id: "linkedin",
      weight: 5,
      ok: has(folded, /linkedin\.com\/in\//),
      good: "link do LinkedIn",
      bad: "falta o link do LinkedIn",
    },
    {
      id: "summary",
      weight: 10,
      ok: has(
        folded,
        /\b(resumo|perfil profissional|sobre mim|objetivo|summary|profile|about me)\b/
      ),
      good: "resumo profissional",
      bad: "falta um resumo profissional no topo",
    },
    {
      id: "experience",
      weight: 15,
      ok: has(
        folded,
        /\b(experiencia|experiencias|historico profissional|experience|work history|employment)\b/
      ),
      good: "seção de experiência",
      bad: 'seção de experiência não identificada (use o título "Experiência")',
    },
    {
      id: "education",
      weight: 10,
      ok: has(
        folded,
        /\b(formacao|educacao|escolaridade|education|academic)\b/
      ),
      good: "seção de formação",
      bad: "seção de formação não identificada",
    },
    {
      id: "skills",
      weight: 10,
      ok: has(
        folded,
        /\b(competencias|habilidades|skills|tecnologias|ferramentas|conhecimentos)\b/
      ),
      good: "seção de competências",
      bad: "falta uma seção de competências com as palavras-chave da área",
    },
    {
      id: "languages",
      weight: 5,
      ok: has(
        folded,
        /\b(idiomas|languages|ingles|english|espanhol|spanish)\b/
      ),
      good: "idiomas",
      bad: "idiomas não informados",
    },
    {
      id: "dates",
      weight: 10,
      ok: years >= 2,
      good: "datas nas experiências",
      bad: "faltam datas (mês/ano) nas experiências",
    },
    {
      id: "metrics",
      weight: 10,
      ok: metrics >= 2,
      good: "resultados com números",
      bad: "poucos resultados com números (%, volumes, prazos)",
    },
    {
      id: "length",
      weight: 5,
      ok: words >= 200 && words <= 1100,
      good: "tamanho adequado",
      bad:
        words < 200
          ? "texto curto demais para o ATS ler bem"
          : "texto longo: procure ficar em 1–2 páginas",
    },
    {
      id: "bullets",
      weight: 5,
      ok: bullets >= 3,
      good: "tópicos (bullets) nas experiências",
      bad: "use tópicos curtos nas experiências",
    },
  ]
  const total = checks.reduce((sum, c) => sum + c.weight, 0)
  const score = Math.round(
    (checks.filter((c) => c.ok).reduce((sum, c) => sum + c.weight, 0) / total) *
      100
  )
  const verdict =
    score >= 80
      ? "bem preparado para ATS"
      : score >= 60
        ? "razoável, com ajustes importantes"
        : "precisa de ajustes para passar bem em ATS"
  return {
    score,
    verdict,
    strengths: checks.filter((c) => c.ok).map((c) => c.good),
    gaps: checks.filter((c) => !c.ok).map((c) => c.bad),
  }
}

export function cvQualityText(name: string, text: string): string {
  const q = cvQualityScore(text)
  const lines = [
    `**Nota de qualidade / prontidão para ATS: ${q.score}/100** (CV "${name}"): ${q.verdict}.`,
  ]
  if (q.strengths.length)
    lines.push(`**Pontos fortes:** ${q.strengths.slice(0, 6).join(", ")}.`)
  if (q.gaps.length)
    lines.push(`**A melhorar:** ${q.gaps.slice(0, 6).join("; ")}.`)
  lines.push(
    "_Nota calculada por regras fixas (estrutura, contato, datas, resultados); não compara com uma vaga._"
  )
  return lines.join("\n")
}
