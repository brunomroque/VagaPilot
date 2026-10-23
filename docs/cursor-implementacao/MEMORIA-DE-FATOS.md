# Memória de fatos a partir de respostas em linguagem natural (paridade com o Bot de Vagas)

Tarefa de implementação: **B6** (`FASE-B-cv-e-fatos-no-chat.md`). Usada por C4 (fit), C7 (ajuste livre no card), D2/D3 (perguntas do formulário), E3/F4 (entrevista) e F2 (biblioteca).
Comportamento do Bot (PB-57): quando a vaga pede algo que não está nos CVs, ele pergunta em linguagem natural ("Essa vaga pede PHP e não encontrei nos seus CVs. Como seguimos?"), entende a resposta livre, grava o que o usuário disse (e só isso), reaproveita nas próximas vagas e, se for o caso, propõe atualizar os CVs.

---

## 1. Classificação da resposta livre (intenções)

| Intenção            | Exemplo de resposta                                                                           | O que acontece                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `uso_unico`         | "Põe 2 anos só nesse formulário"                                                              | Valor usado só nesta run; nada gravado (fica em `run_questions`)                                                      |
| `fato_reutilizavel` | "Tenho 2 anos de PHP, na Empresa Alfa, 2015–2017"                                             | Grava fato (escopo global) e usa já                                                                                   |
| `fato_e_cv`         | "Tenho inglês avançado, coloca nos currículos"                                                | Grava fato + `propose_cv_update` com prévia/diff por trilha + OK                                                      |
| `lacuna`            | "Não tenho PHP" / "nunca usei"                                                                | Grava fato com **polaridade negativa** (PHP = Não); pergunta "seguir mesmo assim ou pular?" (ou segue a decisão dada) |
| `preferencia_regra` | "Para gerente, pede 27k" / "não quero vagas da Empresa Beta" / "chama a trilha de Plataforma" | Altera `salary_rules` / exclusões / nomenclatura com `settings_change`                                                |
| `correcao`          | "Na verdade PHP foi 1 ano"                                                                    | Nova versão do fato existente (ver §3.2)                                                                              |
| `revogacao`         | "Esquece aquilo de PHP"                                                                       | Fato revogado                                                                                                         |
| `fora_do_tema`      | "Que horas é a entrevista?"                                                                   | Não grava; responde normalmente                                                                                       |

Uma resposta pode ter várias intenções ("Tenho 2 anos de PHP, mas só usa nesse formulário" ⇒ `uso_unico` vence o "tenho"). Regras:

- **Só grava o que o usuário disse.** Não extrapola ("2 anos de PHP" não vira "Laravel"; "inglês avançado" não vira "fluente"; "sim" sem número não vira anos).
- Ambiguidade de escopo (não ficou claro se é só para esta vaga) ⇒ pergunta "Guardo para as próximas vagas?" com botões.
- **Confiança < 0,85** em qualquer campo extraído ⇒ card de confirmação mostrando exatamente o que seria gravado; nada é gravado até o clique.
- Confiança ≥ 0,85 ⇒ grava como `confirmado` (o usuário afirmou no chat) e mostra o card "Guardei: … [Desfazer] [Editar]".
- Texto do usuário dentro do chat é confiável; texto de vaga/e-mail/CV é `<untrusted>` e nunca vira fato confirmado sem clique.

## 1b. Destino de cada dado (obrigatório)

Toda informação capturada recebe um **destino**, que decide onde ela pode ser usada:

| Destino             | Exemplos                                                                                                                                         | Pode ir ao CV?      | Uso                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `perfil_formulario` | CEP, endereço, CPF/RG, nascimento, telefone, disponibilidade, PCD, dados demográficos (quando o formulário pede), pretensão, aceita viajar/mudar | **Nunca**           | Só formulários futuros. Sensíveis (documentos, PCD, demográficos, nascimento) ficam cifrados e mascarados no chat/tela (LGPD; D5/D6) |
| `cv_elegivel`       | Tecnologia, anos de experiência, idioma, certificação real, conquista, responsabilidade, tamanho de equipe                                       | Sim, **só após OK** | Fit, formulários e CVs. **Só aqui** o app pergunta "Quer que eu atualize seus CVs com isso?"                                         |
| `lacuna`            | PHP = Não                                                                                                                                        | **Nunca**           | Fit e formulário (responde "Não"/"0"); não pergunta de novo                                                                          |
| `preferencia`       | "para gerente, pede 27k", "não quero Empresa Beta", nome de trilha, modo de envio                                                                | Nunca               | Regras (`salary_rules`, exclusões, nomenclatura, F1)                                                                                 |

**Pergunta de CV (só `cv_elegivel`):** "Quer que eu atualize seus CVs com isso?". A sugestão lista as trilhas afetadas (A/B/C, PT/EN) com prévia/diff. Opções:

- **[Atualizar estes CVs]** (o usuário pode desmarcar trilhas): regenera só após o clique.
- **[Guardar só para formulários]**: grava o fato com `cv_allowed=false`.
- **[Não guardar]**: vira `uso_unico`.

**Classificação:** um classificador (LLM + regras) devolve `destino` e `destinoConfidence`.

- Regras fixas vencem o modelo: documentos, CEP, telefone e nascimento ⇒ sempre `perfil_formulario`; fato com `polarity='negativo'` ⇒ sempre `lacuna`.
- `destinoConfidence < 0,85` ⇒ pergunta "Isso é algo para o seu CV ou só para formulários?".
- O usuário reclassifica a qualquer momento ("isso não é para o CV", ou pela tela). A reclassificação cria uma nova versão.
- Se o dado sai de `cv_elegivel`, o app propõe remover dos CVs (prévia + OK).

**Exemplos**

- "Meu CEP é 01000-000" ⇒ `perfil_formulario`, cifrado; resposta "Guardei seu CEP para formulários (não vai para o CV)."
- "Inglês avançado" ⇒ `cv_elegivel` ⇒ "Quer que eu atualize seus CVs com isso? Afeta 6 CVs: Trilhas A/B/C, PT/EN" + diff.
- "Não tenho PHP" ⇒ `lacuna` ⇒ "Guardei: sem PHP. Uso isso no fit e nos formulários; não entra no CV."
- "Gerenciei 40 pessoas na Empresa Alfa" ⇒ `cv_elegivel` (tamanho de equipe, vinculado à experiência Alfa) ⇒ sugere só as trilhas de gestão (ex.: B PT/EN) com bullet novo no diff.

**Casos de borda (destino)**

- "Tenho disponibilidade para viajar e sou certificado AZ-104" ⇒ dois dados, dois destinos.
- Certificação dita sem evidência (só a fala) ⇒ `cv_elegivel`, mas o diff marca "declarada no chat" e não há prévia sem OK.
- Pretensão dita no meio de um fato de CV ⇒ separada em `preferencia`; nunca entra no CV.
- PCD/demográficos ⇒ `perfil_formulario` com consentimento explícito para guardar; senão é `uso_unico`.
- Usuário pede "coloca meu telefone no CV" ⇒ permitido só no cabeçalho de contato do CV (dado de contato), com OK. É a única exceção, registrada.
- Fato `cv_elegivel` que já aparece igual em todos os CVs ⇒ não pergunta de atualizar.
- `lacuna` revertida ("agora sei PHP, 1 ano") ⇒ novo fato positivo `cv_elegivel`, que dispara a pergunta de CV.

## 2. Modelo de dados

```sql
-- Evolui public.facts (P1) sem quebrar dados existentes
alter table public.facts
  add column canonical_text text,                       -- "2 anos de experiência com PHP na Empresa Alfa (2015–2017)"
  add column competency text,                           -- normalizada: "php"
  add column competency_kind text check (competency_kind in ('tecnologia','idioma','certificacao','gestao','dominio','soft','formacao','outro')),
  add column value text,                                -- "sim" | "não" | "avancado" | texto livre curto
  add column level text,                                -- básico/intermediário/avançado/fluente/nativo (idiomas) ou júnior..especialista
  add column years numeric(4,1),
  add column experience_id uuid references public.experiences(id) on delete set null,
  add column company text,
  add column period_start date, add column period_end date,
  add column polarity text not null default 'positivo' check (polarity in ('positivo','negativo')),
  add column scope text not null default 'global' check (scope in ('global','vaga')),
  add column scope_job_posting_id uuid references public.job_postings(id) on delete cascade,
  add column origin text not null default 'cv' check (origin in ('cv','chat','formulario','email','tela')),
  add column quote text,                                -- citação literal da fonte
  add column source_message_id uuid references public.messages(id) on delete set null,
  add column status_v2 text not null default 'proposto' check (status_v2 in ('proposto','confirmado','revogado')),
  add column version int not null default 1,
  add column supersedes uuid references public.facts(id),
  add column confirmed_at timestamptz, add column revoked_at timestamptz,
  add column destino text not null default 'cv_elegivel' check (destino in ('perfil_formulario','cv_elegivel','lacuna','preferencia')),
  add column destino_confidence real,
  add column cv_allowed boolean not null default false,   -- true só após "Atualizar estes CVs"
  add column sensitive boolean not null default false,    -- cifrado + mascarado
  add column embedding vector(1536);
alter table public.facts add constraint destino_cv check (cv_allowed = false or destino = 'cv_elegivel');                    -- opcional
create unique index facts_active_competency on public.facts(user_id, competency, coalesce(experience_id,'00000000-0000-0000-0000-000000000000'::uuid))
  where status_v2 = 'confirmado' and scope = 'global' and competency is not null;

create table public.fact_versions (id bigint generated always as identity primary key, fact_id uuid not null references public.facts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, version int not null, snapshot jsonb not null, changed_by text not null check (changed_by in ('chat','tela','extensao','sistema')),
  reason text, source_message_id uuid, created_at timestamptz not null default now(), unique(fact_id, version));

create table public.fact_usages (id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade,
  fact_id uuid not null references public.facts(id) on delete cascade, fact_version int not null,
  target text not null check (target in ('cv_version','application','standard_answer','run_answer','cover_letter','interview')),
  target_id uuid not null, used_at timestamptz not null default now());
-- RLS dono nas três tabelas; status_v2 substitui status antigo após backfill (proposto→proposto, confirmado→confirmado, rejeitado→revogado)
```

```ts
export const FactIntent = z.enum([
  "uso_unico",
  "fato_reutilizavel",
  "fato_e_cv",
  "lacuna",
  "preferencia_regra",
  "correcao",
  "revogacao",
  "fora_do_tema",
])
export const ExtractedFact = z.object({
  canonicalText: z.string().max(300),
  competency: z.string().nullable(),
  competencyKind: z.enum([
    "tecnologia",
    "idioma",
    "certificacao",
    "gestao",
    "dominio",
    "soft",
    "formacao",
    "outro",
  ]),
  value: z.string().nullable(),
  level: z.string().nullable(),
  years: z.number().min(0).max(60).nullable(),
  company: z.string().nullable(),
  experienceId: z.string().uuid().nullable(),
  periodStart: z.string().date().nullable(),
  periodEnd: z.string().date().nullable(),
  polarity: z.enum(["positivo", "negativo"]),
  scope: z.enum(["global", "vaga"]),
  destino: z.enum([
    "perfil_formulario",
    "cv_elegivel",
    "lacuna",
    "preferencia",
  ]),
  destinoConfidence: z.number().min(0).max(1),
  sensitive: z.boolean(),
  quote: z.string(), // trecho literal da mensagem do usuário que sustenta TODOS os campos
  fieldConfidence: z.record(z.string(), z.number().min(0).max(1)),
})
export const IntentResult = z.object({
  intents: z.array(FactIntent).min(1),
  facts: z.array(ExtractedFact),
  preference: PreferenceChange.nullable(),
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean(),
})
```

Validação pós-LLM (código, não prompt): cada campo não nulo precisa ter evidência no `quote` (número de anos aparece literalmente; empresa citada; nível citado). Campo sem evidência ⇒ `null`. Se o `quote` não for substring da mensagem ⇒ descarta a extração.

## 3. Fluxos

### 3.1 Dedupe e conflito

- Mesmo `competency` + mesma experiência + mesmos valores ⇒ não cria; registra uso.
- Valores diferentes (ex.: 2 anos × 1 ano de PHP) ⇒ card "Você já tinha dito X em dd/mm. Qual vale?" [Novo] [Antigo] [Os dois, em experiências diferentes].
- Positivo × negativo ("não tenho PHP" × fato do CV com PHP) ⇒ mesmo card, mostrando a citação do CV.

### 3.2 Edição e revogação (tela e chat)

- Chat: "na verdade PHP foi 1 ano" ⇒ `correcao` ⇒ nova versão (`version+1`, `supersedes`), `fact_versions` grava o snapshot anterior, card "Atualizei: PHP 2 → 1 ano [Desfazer]".
- Tela `/app/fatos` (e F2): editar/revogar com o mesmo serviço (`apps/web/lib/facts/actions.ts`); `domain_events` sincroniza o chat (A2).
- Revogar ⇒ `status_v2='revogado'`; deixa de ser usado; histórico preservado.

### 3.3 Propagação

- Só fatos `destino='cv_elegivel'` e `cv_allowed=true` entram em CV (garantido pelo gerador B5 e pela constraint). Fato com `competency_kind` que aparece em CV ⇒ `cvImpact` (B4) decide as **trilhas certas** (pela relação competência × trilha e pelas experiências vinculadas).
- `propose_cv_update` gera prévia + diff por CV; só regenera após OK, em todos os fluxos, inclusive confirmação em lote ao anexar CV (DA-11). Para inglês Avançado: todas as trilhas, PT e EN.
- Respostas salvas (`standard_answers`) e respostas de formulário derivadas são atualizadas.
- **Candidaturas enviadas não mudam**; o chat lista as que usaram a versão antiga e oferece D11 quando fizer sentido.
- Toda mudança gera `fact_versions` + `domain_events` + `audit_log`.

### 3.4 Recuperação (consultar antes de perguntar)

`resolveFacts({ competencies, questionText?, jobPostingId? })`: 1) busca exata por `competency` normalizada (sinônimos: "php"="PHP 7"; "azure devops"="ADO"); 2) fatos de escopo `vaga` daquela vaga; 3) opcional, similaridade por embedding ≥ 0,85; 4) só `confirmado`. Usado por:

- **Fit (C4):** requisito com fato negativo ⇒ "lacuna confirmada" (não pergunta de novo); positivo ⇒ conta como atendido.
- **Preenchimento (D2/D3):** antes de `perguntar`.
- **Chat:** antes de `ask_clarification` sobre competência.
- **Card de decisão (C7):** ajuste livre que contém fato passa por B6.

## 4. Tools

```ts
propose_fact(input: { messageId: string; text: string; context?: { jobPostingId?: string; runId?: string; requirement?: string } }) // → IntentResult + part fact_capture
confirm_fact(input: { proposalId: string; edits?: Partial<ExtractedFact> })   // só por clique (token de UI) quando needsConfirmation
revoke_fact(input: { factId: string; reason?: string })                       // chat "esquece" ou tela
search_facts(input: { q?: string; competency?: string; includeRevoked?: boolean }) // já existe; ganha filtros
reclassify_fact(input: { factId: string; destino: "perfil_formulario"|"cv_elegivel"|"lacuna"|"preferencia" }) // cria versão; se sair de cv_elegivel propõe remoção dos CVs
propose_cv_update(input: { factIds: string[] }) // recusa se algum fato não for cv_elegivel // → part cv_update_preview { cvVersionId, track, lang, diff: { before: string; after: string }[] }[]
apply_cv_update(input: { previewId: string })   // clique
```

Parts novas (A1): `fact_capture` (o que foi entendido + botões Guardar/Só nesta vaga/Editar/Desfazer), `fact_conflict`, `cv_update_preview`.

## 5. Diálogos de exemplo (fictícios)

**PHP (lacuna)**

> Bot: Essa vaga pede PHP e não encontrei nos seus CVs. Como seguimos?
> Usuário: não tenho PHP, segue assim mesmo
> Bot: Guardei: **PHP — não tenho** (vale para as próximas vagas). Sigo com esta candidatura; o fit fica "bom" com essa lacuna. [Desfazer]
> (Próxima vaga com PHP) Bot: PHP é requisito e você me disse em 22/10 que não tem. Sigo, pulo ou ajusto?

**Anos de Azure DevOps (fato + experiência)**

> Formulário: "Years of experience with Azure DevOps?" — sem fato.
> Bot: O formulário pergunta quantos anos de Azure DevOps você tem. Não achei nos CVs.
> Usuário: uns 3 anos, na Empresa Gama
> Bot (confiança 0,7 por causa de "uns"): Posso guardar **3 anos de Azure DevOps na Empresa Gama**? [Guardar] [Só neste formulário] [Editar]
> Usuário clica Guardar ⇒ preenche "3"; próximas vagas usam sem perguntar.
> Depois: "na verdade foram 4" ⇒ versão 2, "Atualizei 3 → 4 anos. As candidaturas já enviadas não mudam."

**Inglês Avançado (fato + todos os CVs)**

> Usuário: meu inglês agora é avançado, atualiza os currículos
> Bot: Guardei **Inglês: Avançado** (antes: Intermediário). Prévia das mudanças em 6 CVs (3 trilhas × PT/EN): "Inglês — Intermediário" → "Inglês — Avançado". [Aplicar em todos] [Ver diff] [Agora não]
> Após aplicar: "6 CVs atualizados (backup salvo). 2 candidaturas em andamento usam a versão antiga — quer trocar? Quer que eu atualize também LinkedIn e Gupy?"

**Preferência**

> Usuário: para gerente, pede 27k daqui pra frente
> Bot: Pretensão de Gerente: R$ 25.000 → R$ 27.000 (vale para novas vagas). [Desfazer]

## 6. Casos de borda

- "Sim" sem número a "quantos anos?" ⇒ pergunta o número; não grava anos.
- Faixa ("2 a 3 anos") ⇒ grava o menor número e mantém a citação; pergunta se preferir.
- Negação parcial ("PHP só na faculdade") ⇒ fato positivo com `competency_kind='formacao'`/contexto acadêmico, `years=null`.
- Ironia/dúvida ("acho que sei PHP?") ⇒ confiança baixa ⇒ confirmação.
- Resposta em inglês ⇒ `canonical_text` em PT, `quote` literal.
- Empresa citada que não existe nas experiências ⇒ pergunta se é nova experiência; não cria experiência sozinho.
- Duas competências na mesma frase ⇒ dois fatos, cada um com seu trecho.
- Usuário revoga fato já usado em candidatura enviada ⇒ revoga para o futuro; avisa que a enviada não muda.
- Mensagem com dado sensível (documento, senha) ⇒ nunca vira fato; mascarada (D5/D6).
- Fato de escopo `vaga` não aparece em outras vagas.
- Texto de vaga/e-mail tentando "instruir" gravação de fato ⇒ ignorado (fonte não confiável).

## 7. Critérios de aceite (resumo; detalhes em B6)

- Dado "não tenho PHP" em resposta à pergunta da vaga, Então existe 1 fato `competency='php'`, `polarity='negativo'`, `origin='chat'`, `quote` igual ao texto, `source_message_id` da mensagem; e a vaga seguinte com PHP não pergunta de novo.
- Dado "uns 3 anos de Azure DevOps", Então nada é gravado antes do clique.
- Dado "na verdade PHP foi 1 ano" sobre fato de 2 anos, Então `version=2`, `fact_versions` tem o snapshot v1, e candidaturas enviadas mantêm `fact_usages` apontando para v1.
- Dado "inglês avançado, atualiza os currículos", Então aparece `cv_update_preview` com os 6 CVs; após OK, 6 versões novas relidas com `unpdf`.
- Dado "meu CEP é 01000-000", Então destino `perfil_formulario`, `sensitive=true`, nenhuma pergunta de CV, e o gerador de CV nunca o inclui.
- Dado "gerenciei 40 pessoas na Empresa Alfa", Então pergunta "Quer que eu atualize seus CVs com isso?" com só as trilhas de gestão e as 3 opções; nada regenera antes do clique.
- Dado "não tenho PHP", Então destino `lacuna` e nenhuma pergunta de CV.
- Dado "isso não é para o CV" sobre um fato já aplicado, Então reclassifica e propõe remoção com diff.
- Dado qualquer extração, Então nenhum campo gravado deixa de ter evidência no `quote` (teste de propriedade).

## 8. Testes

- `packages/ai/src/facts/classify-intent.eval.ts`: 60 respostas fictícias rotuladas (intenções, escopo, polaridade) — meta ≥ 95% nas intenções que gravam, 100% de "não grava o que não foi dito".
- `packages/core/src/facts/evidence-guard.test.ts` (campos sem evidência viram null).
- `facts-dedupe-conflict.test.ts`, `facts-versioning.test.ts`, `fact-usages.test.ts`, `resolve-facts.test.ts` (sinônimos, escopo, revogados ignorados).
- `propose-cv-update.test.ts` (trilhas certas, diff, nada sem OK).
- `classify-destino.test.ts` (regras fixas vencem o LLM; 40 frases rotuladas, meta 100% para documentos/CEP/telefone/lacuna e ≥ 95% no geral); `cv-render-excludes-non-cv.test.ts` (propriedade: nenhum fato com destino diferente de `cv_elegivel`, nem com `cv_allowed=false`, aparece no PDF relido); `reclassify.test.ts`.
- RLS das 3 tabelas; e2e `memoria-fatos.spec.ts` com os 3 diálogos; `parity: PB-57`.
