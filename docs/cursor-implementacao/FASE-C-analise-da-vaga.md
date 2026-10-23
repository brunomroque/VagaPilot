# FASE C — Análise da vaga e card de decisão (9 tarefas)

---

## C1. Resumo da vaga (`job_summary`)

**Objetivo:** etapa 1 com o mesmo conteúdo do Bot. **PB:** 01, 10.
**Arquivos:** alterar `packages/ai/src/extract-job.ts` (campos `postedBy`, `postedAt`, `sector`), `packages/ats-adapters/src/adapters/linkedin.ts`, criar `packages/ui/src/chat/JobSummaryCard.tsx`.
**Contrato:** `JobSummary = { title; company; clientIfAgency?: string; location; workModel; regime; language; required: string[]; niceToHave: string[]; salaryRange?: {min?:number;max?:number;currency:"BRL"|"USD"}; postedBy?: { name: string; role?: string }; postedAt?: string; source: string; url: string }`.
**Regras:** recrutadora ≠ empregadora (campo `clientIfAgency`, "NÃO VERIFICADO" quando inferido).
**Bordas:** vaga sem descrição pública → pede o texto colado.
**Aceite:** Dado fixture LinkedIn guest, Quando ingerida, Então o card mostra obrigatórios × desejáveis, idioma, regime e quem publicou.
**Testes:** fixtures por fonte em `ats-adapters/src/__fixtures__`, `extract-job.eval.ts`.

---

## C2. Duplicidade completa + histórico da empresa + limites do ATS

**Objetivo:** etapa 2 igual ao Bot. **PB:** 11, 12, 13, 14.
**Arquivos:** alterar `packages/core/src/job-rules.ts`, `packages/gmail/src/duplicates.ts`; criar `packages/core/src/ats-limits.ts`, `packages/ui/src/chat/DuplicateAlertCard.tsx`; migração `ats_limits`.
**Contrato**

```ts
type DuplicateMatch = {
  kind: "mesma_vaga" | "mesmo_cargo_outro_anuncio" | "mesma_empresa"
  applicationId?: string
  title: string
  appliedAt?: string
  status: DisplayStatus
  source: "planilha" | "gmail"
  evidence?: string
}
type AtsLimit = {
  company: string
  max: number
  windowMonths: number
  used: number
}
```

```sql
create table public.ats_limits (company_norm text primary key, max_applications int not null, window_months int not null, source_url text); -- catálogo global, select para authenticated
```

**Regras:** mesma URL canônica ⇒ bloqueia com "Continuar mesmo assim"; mesmo cargo com outro id de anúncio ⇒ aviso, não bloqueio; empresa ⇒ lista as 5 mais recentes; blocklist ⇒ alerta bloqueante.
**Aceite:** Dado candidatura recusada à Empresa Alfa há 4 meses (cargo diferente), Quando colo vaga nova da Alfa, Então o card diz "Você não se candidatou a esta vaga. Há 1 candidatura anterior na empresa (cargo X, mês/ano), recusada."
**Testes:** `job-rules.duplicate.test.ts`, `ats-limits.test.ts`.

---

## C3. Score ATS por CV

**Objetivo:** palavras-chave da vaga × cada CV, só para desempate/ajuste. **PB:** 18.
**Arquivos:** criar `packages/core/src/ats-score.ts`; alterar `packages/jobs/src/match.ts`; migração `job_matches.ats_scores jsonb`.
**Contrato:** `atsScore(jobKeywords: string[], cvText: string): { score: number /*0..100*/; matched: string[]; missing: string[] }` (normalização com `normalize` existente, sinônimos de `core/job-text.ts`).
**Regras:** nunca altera o nível de fit; desempata C5 quando similaridade empata (`TRACK_TIE_EPSILON`).
**Aceite:** Dado 3 CVs e uma vaga, Então os 3 scores aparecem no `fit_card` e o fit não muda se os scores mudarem (teste de propriedade).
**Testes:** `ats-score.test.ts` (fast-check se já houver; senão casos fixos).

---

## C4. Fit card: alto/bom/baixo, recomendação e elegibilidade

**Objetivo:** etapa 3 com a linguagem do Bot. **PB:** 15, 16, 17.
**Arquivos:** alterar `packages/ai/src/assess-fit.ts` (campo `recommendation: "recomendo"|"vale_se_quiser"|"nao_recomendo"`, `eligibility?: { ok: boolean; reason: string }`), `packages/core/src/job-rules.ts` (alerta `elegibilidade`), `packages/ui` FitCard; `messages/pt-BR.json` ("bom").
**Regras (DA-06):** exibir "bom" para `medio`; elegibilidade só com dado explícito do perfil; se o perfil não tem o dado, o texto é "talvez não seja elegível — confira".
**Memória de fatos (B6):** requisitos sem fato disparam a pergunta "Essa vaga pede X e não encontrei nos seus CVs. Como seguimos?"; a resposta passa por `propose_fact`; fato negativo vira "lacuna confirmada" e não é perguntado de novo; `resolveFacts` é chamado antes de qualquer pergunta.
**Aceite:** Dado vaga afirmativa para um grupo e perfil sem essa informação, Então aparece o aviso de elegibilidade e a recomendação não é "recomendo".
**Testes:** `assess-fit.eval.ts` (casos de paridade), `fit-labels.test.ts`.

---

## C5. Roteamento de CV (perfil único, idioma)

**Objetivo:** etapa 4 exata. **PB:** 19.
**Arquivos:** criar `packages/core/src/cv-routing.ts`; migração `cv_tracks.routing_role`, tabela `single_profile_sources`; alterar `recommendCv` para chamar o roteamento primeiro.
**Contrato**

```ts
type RoutingRole = "platform_ops" | "engenharia" | "hibrido"
function routeCv(i: {
  source: string
  jobLanguage: JobLanguage
  trackScores: { trackId: string; similarity: number }[]
  versions: CvVersionOption[]
  atsScores?: Record<string, number>
}): {
  cvVersionId: string | null
  role: RoutingRole
  language: "pt-BR" | "en"
  reason:
    "perfil_unico" | "idioma" | "similaridade" | "desempate_ats" | "padrao"
}
```

```sql
create table public.single_profile_sources (source text primary key); insert into public.single_profile_sources values ('gupy'),('catho'),('indeed');
```

**Regras:** fonte de perfil único ⇒ `hibrido` + `pt-BR` sempre; vaga em inglês fora de perfil único ⇒ versão EN da trilha; sem versão EN ⇒ PT + aviso.
**Aceite:** Dado vaga Gupy em inglês, Então CV Híbrido PT (razão `perfil_unico`); Dado vaga LinkedIn Easy Apply em inglês de gestão de engenharia, Então CV Engenharia EN.
**Testes:** `cv-routing.test.ts` (tabela de casos), `parity: PB-19`.

---

## C6. Pretensão por nível

**Objetivo:** etapa 5. **PB:** 20, 04.
**Arquivos:** alterar `packages/core/src/job-rules.ts` `suggestSalary` (níveis nomeados), `salary_rules` (seed presets `coordenador|gerente|pj_diretoria`), `lib/settings/server.ts`.
**Regras:** nível inferido pelo cargo (`inferSeniority`); PJ ⇒ `pj_diretoria`; vaga com faixa publicada abaixo da pretensão ⇒ alerta `salario_fora`; `vinculo_atual=false` ⇒ remuneração atual 0.
**Aceite:** Dado pretensões fictícias 20k/25k/35k, Quando a vaga é "Gerente", Então o card sugere 25k; Quando "Altere para 22k" no chat, Então só aquela vaga muda (e oferece salvar como regra).
**Testes:** `suggest-salary.test.ts`.

---

## C7. Card de decisão com 3 opções e ajuste livre

**Objetivo:** etapa 6 idêntica. **PB:** 04, 08, 09, 21.
**Arquivos:** criar `packages/ui/src/chat/DecisionCard.tsx`, `apps/web/lib/chat/decision.ts`; alterar `record_decision` em `apps/web/lib/chat/tools.ts`; tool nova `apply_decision_adjustment`.
**Contrato**

```ts
type DecisionOption = {
  id: "envie_direto" | "pare_antes" | "pular"
  label: string /* "Sim, CV Eng EN, R$ 25k, envie direto" */
  cvVersionId?: string
  salary?: number
}
type Decision = {
  jobMatchId: string
  choice: DecisionOption["id"]
  cvVersionId?: string
  salary?: number
  freeText?: string
}
```

**Regras:** texto livre com informação sobre o usuário passa por B6 (`propose_fact`) antes de ajustar o card; rótulos montados com CV e pretensão atuais; texto livre interpretado (LLM + Zod) e reapresentado como card atualizado antes de valer; `envie_direto` cria approval **pré-aprovada só daquela vaga** (DA-02), com hash do pacote; sem resposta ⇒ `aguardando_decisao` (DA-04); 👍 nunca aprova envio (DA-05); "pular" ⇒ `descartada` + nota.
**Aceite**

- Dado o card, Quando escolho "Não, pule essa", Então a linha "Pulada a pedido do usuário" aparece na planilha em ≤ 1 s.
- Dado o card, Quando escrevo "sim, CV B e 22k", Então aparece card atualizado com CV B e R$ 22k e nada é executado até eu clicar.
- Dado o card sem resposta e outro link colado, Então a primeira vaga fica "Aguardando decisão" e a segunda é analisada.
  **Testes:** `decision.test.ts`, e2e `decision-card.spec.ts`, `parity: PB-08/09/21`.

---

## C8. Vaga fechada ou republicada

**Objetivo:** PB-40, PB-14.
**Arquivos:** criar `packages/core/src/job-liveness.ts`, `packages/jobs/src/functions/job-revalidate.ts`; migração `job_postings.liveness text check (liveness in ('aberta','fechada','desconhecida'))`, `republished_of uuid`.
**Regras:** fechada se HTTP 404/410, texto "não aceita mais candidaturas"/"vaga encerrada"/"no longer accepting"; revalida antes de D1 e diariamente as `aguardando_decisao`; republicação = mesma empresa normalizada + título ≥ 0,9 + descrição ≥ 0,9 com id diferente ⇒ liga `republished_of` e mostra histórico.
**Aceite:** Dado fixture 404, Quando a vaga ia para preenchimento, Então não abre formulário, status Encerrada (ou Teste/Etapa pendente com `vaga_fechada` se já iniciada) e o chat avisa.
**Testes:** `job-liveness.test.ts`.

---

## C9. Fila de decisões com vários links

**Objetivo:** PB-03.
**Arquivos:** alterar `apps/web/lib/chat/tools.ts` (`ingest_job_postings`), `ingest-batch.tsx`.
**Regras:** cada link gera seu card independente; a preenchimento (D1) só pega vagas decididas; o chat lembra as pendentes no fim da resposta.
**Aceite:** Dado 3 links colados, Então 3 cards; respondendo só o 2º, Então só o 2º entra na fila de execução.
**Testes:** e2e `multi-links.spec.ts`.
