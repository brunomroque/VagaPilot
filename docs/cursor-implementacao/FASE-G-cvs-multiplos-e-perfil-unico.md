# Fase G: CVs múltiplos, CV Híbrido e perfil único

Leia antes: `CVS-MULTIPLOS-E-PERFIL-UNICO.md`.
Referências: B4/B5, B6 (`MEMORIA-DE-FATOS.md`), C3, C5, D11, E1, F6, DA-01, DA-11 (revisada: sempre OK com prévia/diff, inclusive em lote).
Testes de paridade: TP-36..TP-41. Dados de teste sempre fictícios.

---

## G1: Trilhas por área (onboarding para qualquer usuário)

**Objetivo:** sugerir 1 a 3 trilhas a partir do histórico; aceitar, renomear, juntar, remover e criar pelo chat; PT/EN por trilha, mais a Híbrida fixa.

**Modelo de dados**

```sql
create table cv_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users,
  slug text not null,
  name text not null,
  kind text not null check (kind in ('trilha','hibrido')),
  rationale jsonb not null default '{}',
  target_titles text[] not null default '{}',
  status text not null default 'ativa' check (status in ('sugerida','ativa','arquivada')),
  created_at timestamptz default now(),
  unique (user_id, slug)
);
create unique index one_hybrid_per_user on cv_tracks(user_id) where kind='hibrido' and status<>'arquivada';
-- RLS: user_id = auth.uid()
alter table cv_versions add column track_id uuid references cv_tracks, add column lang text check (lang in ('pt','en'));
```

```ts
export const TrackSuggestion = z.object({
  name: z.string().min(2).max(40),
  rationale: z.object({
    experienceIds: z.array(z.string()).min(1),
    skills: z.array(z.string()),
  }),
  targetTitles: z.array(z.string()).max(6),
})
export const TrackSuggestions = z.array(TrackSuggestion).min(1).max(3)
```

**Tools:** `suggest_tracks()` (só fatos confirmados e experiências extraídas), `upsert_track({id?, name, targetTitles})`, `merge_tracks({ids, name})`, `archive_track({id})` (recusa a Híbrida).
**Chat:** sugestão de trilhas e texto "Por quê?" como part `decision_card`; renomear gera part `settings_change`.
**Casos de borda:** histórico pobre → 1 trilha e pergunta a área-alvo; 4ª trilha → oferece juntar/trocar; remover Híbrida → recusa com explicação; renomear não altera versões já geradas.
**Critérios**

- Dado usuário com experiências em duas áreas, quando termina o onboarding, então sugere 2 trilhas com justificativa e a Híbrida existe.
- Dado "cria uma trilha de Produto" com 3 trilhas, então pede para juntar/trocar e não cria a 4ª.
- Dado "remove o Híbrido", então recusa com o texto da §2.1.
- Dada trilha aceita, então CVs PT/EN são gerados **só após prévia + OK**.
  **Testes:** unit zod; eval com 3 históricos fictícios (Ops, Dados, Produto); e2e aceitar/renomear; TP-36.

---

## G2: CV Híbrido obrigatório + catálogo de plataformas

**Objetivo:** plataformas de perfil único sempre recebem Híbrido PT; o usuário entende por quê.

```sql
create table platform_catalog (
  slug text primary key,
  name text not null,
  profile_mode text not null check (profile_mode in ('perfil_unico_retroativo','perfil_unico_prospectivo','por_candidatura')),
  warn_as_retroactive boolean not null default false,
  verified boolean not null default false,
  source_url text, verified_at date, domains text[] not null
);
-- seed: gupy(retroativo, verified), indeed(prospectivo, verified), catho(prospectivo, warn_as_retroactive),
-- empregos(prospectivo, verified=false), infojobs(prospectivo, verified=false), linkedin(por_candidatura, verified=false),
-- greenhouse/lever/inhire/workday(por_candidatura)
```

- `routeCv` (C5) lê `platform_catalog`. Para `profile_mode <> 'por_candidatura'`: Híbrido, `lang='pt'`, sem exceção, `reason='perfil_unico:<slug>'`. F6 continua bloqueando EN.
  **Tools:** `get_platform_mode({urlOrSlug})`, `explain_hybrid()`.
  **Casos de borda:** domínio desconhecido → `por_candidatura`; se houver "Meu currículo", pergunta e sugere atualizar o catálogo (admin); EN pedido na Gupy → recusa e explica; vaga Gupy em inglês → Híbrido PT com aviso.
  **Critérios**
- Dada vaga Gupy, Indeed, Catho, Empregos ou InfoJobs, então rota = Híbrido PT.
- Dada vaga Greenhouse da trilha Ops, então Ops/Platform no idioma da vaga.
- Dado "manda em inglês" numa vaga Indeed, então recusa com motivo.
  **Testes:** unit matriz plataforma × idioma × trilha; paridade com C5; TP-37.

---

## G3: Controle de cadastros e detecção

```sql
create table platform_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users,
  platform_slug text not null references platform_catalog,
  account_hint text not null,
  cv_version_id uuid references cv_versions,
  status text not null default 'desconhecido'
    check (status in ('atualizado','desatualizado','desconhecido','atualizando','erro','arquivado')),
  last_synced_at timestamptz,
  detected_via text not null check (detected_via in ('email_boas_vindas','candidatura','chat','manual')),
  detection_evidence jsonb,
  unique (user_id, platform_slug, account_hint)
);
create view platform_profiles_view as
  select p.*, (select count(*) from applications a where a.user_id=p.user_id and a.source=p.platform_slug
     and a.status_normalized in ('Enviada','Em análise','Teste/Etapa pendente','Entrevista','Aguardando decisão')) as active_dependents
  from platform_profiles p;
-- RLS em ambos
```

**Detecção:** E1 ganha classe `boas_vindas_plataforma` e handler `platform/welcome.detected` faz upsert; candidatura em perfil único sem cadastro faz upsert; chat via `register_platform_profile`.
**Tools:** `list_platform_profiles()`, `register_platform_profile({platform, accountHint, cvVersionId?})`, `set_profile_cv({profileId, cvVersionId})`.
**Casos de borda:** boas-vindas duplicadas (unique); marketing parecido com boas-vindas (confiança < 0,85 → pergunta); "não é meu" → `arquivado` sem pendência; duas contas → dois cadastros.
**Critérios**

- Dado e-mail fictício "Bem-vindo à InfoJobs", então cadastro InfoJobs `desconhecido` e pergunta no chat.
- Dada candidatura Gupy sem cadastro, então cadastro com `detected_via='candidatura'`.
- Dado "onde tenho cadastro?", então tabela com dependentes e status.
  **Testes:** unit dedupe; eval boas-vindas vs. marketing; TP-38.

---

## G4: Híbrido mudou → desatualizado, pendências e atualização só com OK

**Fluxo**

1. `cv/version.published` com `track.kind='hibrido'` marca `desatualizado` todo cadastro com versão antiga.
2. Cria `pending_item` por cadastro com contagem de dependentes; Gupy ou `warn_as_retroactive` avisam sobre candidaturas em triagem.
3. "Preparar" cria run `application_runs.kind='atualizar_perfil'` (lock e evidência de D1/D9/D11): extensão vai a "Meu currículo", sobe PDF ou edita blocos do diff, **para antes de salvar** e emite part `approval` com `packageHash` = hash(versão + plataforma + conta).
4. Com OK válido: salva, `captureVisibleTab`, grava `submission_evidence`, marca `atualizado` com `last_synced_at`.
5. Modo manual: passo a passo; "atualizei" → pede confirmação/screenshot e marca `atualizado` com `evidence='declarado'`.
   **Tools:** `prepare_profile_update({profileId})`, `confirm_profile_update({profileId, approvalToken})`, `mark_profile_updated_manual({profileId, evidence?})`.
   **Casos de borda:** login/OTP expirado → `blocked_reason='login'` e retomada; campo não editável → avisa e segue; nova versão durante a run → cancela e recomeça; card ignorado → pendência aberta (DA-04); 👍 não é OK de salvar (DA-05).
   **Critérios**

- Dado Híbrido v8 aprovado e Gupy v7 com 4 dependentes, então Gupy `desatualizado` e pendência cita as 4.
- Dada run preparada sem OK, então nada é salvo.
- Dado OK, então salvo, screenshot e `atualizado` v8.
  **Testes:** e2e com página fictícia "Meu currículo"; teste "sem OK não salva"; TP-39.

---

## G5: CV/versão por candidatura (ATS por vaga)

```sql
create table application_cv_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users,
  application_id uuid not null references applications,
  cv_version_id uuid not null references cv_versions,
  track_id uuid not null references cv_tracks,
  lang text not null, pdf_sha256 text not null,
  route_reason text not null,
  sent_at timestamptz not null default now(),
  replaced_by uuid references application_cv_snapshots
);
-- RLS
```

**Regras:** snapshot no envio confirmado (D9); troca via D11 cria snapshot novo e preenche `replaced_by`; perfil único aponta para a versão publicada no cadastro; itens enviados por versão alimentam o validador G6.
**Tools:** `get_application_cv({applicationId})`, `list_versions_sent({cvVersionId})`.
**Casos de borda:** envio sem screenshot → snapshot com `evidence=false` e aviso; versão com snapshot não pode ser apagada (só arquivada).
**Critérios**

- Dado envio Greenhouse confirmado, então snapshot com versão, hash e `route_reason`.
- Dada troca via D11, então snapshot antigo aponta para o novo.
- Dado "qual CV mandei pra Empresa X?", então responde versão e data.
  **Testes:** unit e integração D9/D11; TP-40.

---

## G6: Mudança apenas incremental (validador, score ATS, histórico)

Toda regeneração (B4, B6 `propose_cv_update`/`apply_cv_update`, F6, G1, G4) passa por prévia/diff + OK (DA-11) e pelo validador.

```sql
alter table cv_versions add column parent_version_id uuid references cv_versions,
  add column diff jsonb, add column validation jsonb,
  add column ats_before numeric, add column ats_after numeric,
  add column facts_used uuid[] not null default '{}',
  add column correction boolean not null default false;
```

```ts
export const IMMUTABLE = ["company", "title", "start", "end"] as const // + education.*, contact.*
export function validateIncremental(
  prev: CvDoc,
  next: CvDoc,
  sentItems: Set<string>
): {
  status: "ok" | "blocked"
  reasons: {
    path: string
    rule:
      "imutavel" | "remocao_enviado" | "idioma_rebaixado" | "fato_nao_elegivel"
  }[]
}
```

**Regras:** casamento por id estável; todo item acrescentado aponta para `fact_id` confirmado com `destino='cv_elegivel'` e `cv_allowed` (senão `fato_nao_elegivel`); `correction=true` libera imutáveis só com OK específico "Corrigir dado" e lista candidaturas/plataformas afetadas (G5/G3).
**Prévia em lote:** um card `cv_update_preview` com um item por CV (diff, ATS antes/depois, validação) e opções [Aplicar nos N] / [Escolher CVs] / [Agora não]; nada é gerado antes do OK.
**Tools:** `propose_cv_update` (retorna validação e scores), `apply_cv_update` (recusa `blocked` ou sem approval), `request_correction({field, from, to})`, `list_cv_history({trackId})`.
**Casos de borda:** só reordenar → ok, ATS igual; fato revogado já usado → remoção só por correção; score cai após acréscimo → aviso, permitido; lote com 1 `blocked` e 2 `ok` → aplica os 2 com OK e mostra o motivo.
**Critérios**

- Dado diff que muda `start` da Empresa Alfa, então `blocked/imutavel` e sem "Aplicar".
- Dado diff que remove bullet já enviado, então `blocked/remocao_enviado`.
- Dada confirmação em lote de 3 fatos afetando 4 CVs, então um card de prévia e nada regenerado antes do OK.
- Dado OK, então versões novas com `parent_version_id`, diff, ATS antes/depois e `facts_used`; antiga preservada.
- Dada correção com OK específico, então `correction=true` e inconsistências registradas.
  **Testes:** unit matriz do validador (property-based com fast-check); eval "LLM não propõe remoção"; e2e lote; TP-41.
