# FASE B — CV e fatos no chat (6 tarefas)

---

## B1. Anexar CV no composer do chat

**Objetivo:** o usuário arrasta/anexa PDF ou DOCX no chat e o processamento é o mesmo de `/app/cvs`. **PB:** base de 41 e da jornada J0.
**Arquivos:** criar `apps/web/app/api/chat/attachments/route.ts`, `apps/web/components/chat/composer-attachments.tsx`; alterar `chat-view.tsx`; reusar `apps/web/lib/cv-files.ts` (validação magic bytes, 10 MB) e `packages/jobs/src/process-cv.ts`. Pacote opcional `react-dropzone` (justificar se usar).
**Contrato**

```ts
// POST multipart: file
type AttachmentResponse = {
  cvVersionId: string
  fileName: string
  status: "processando"
}
```

```sql
alter table public.cv_versions add column source_message_id uuid references public.messages(id) on delete set null;
```

**Regras:** só PDF/DOCX; arquivo vai ao bucket `cvs` com caminho por usuário; o texto do CV entra no LLM como `<untrusted>`.
**Bordas:** PDF sem texto (escaneado) → mensagem "não consegui ler o texto; envie PDF com texto ou DOCX" (DA-08); arquivo > 10 MB; dois anexos ao mesmo tempo (processa em sequência).
**Aceite:** Dado um CV fictício em PDF, Quando anexado no chat, Então aparece `file_upload` e, em seguida, `progress` até "fatos prontos para conferir", e `/app/cvs` mostra a mesma versão.
**Testes:** `attachments.route.test.ts`, e2e `cv-no-chat.spec.ts`.

---

## B2. Confirmação de fatos no chat

**Objetivo:** fatos propostos (com trecho do CV) confirmados em blocos no próprio chat. **PB:** 15, 23, 47.
**Arquivos:** criar `packages/ui/src/chat/FactConfirmationCard.tsx`; alterar `apps/web/components/facts/fact-review.tsx` (extrair ações para `apps/web/lib/facts/actions.ts` usadas pelo card e pela tela); evento A2.
**Contrato:** grupos `experiencia | tecnologia | idioma | formacao | certificacao | gestao | outro`; ações `confirmar(ids)`, `editar(id, statement)`, `rejeitar(ids)`; **só por clique** (server action) — nenhuma tool do LLM confirma fato.
**Regras:** certificação só vira fato se o trecho do CV a contém; edição gera fato novo `confirmado` com `source_ref.origin='usuario'`.
**Bordas:** fato duplicado com outro já confirmado → mostra "já confirmado" e não duplica.
**Aceite**

- Dado 12 fatos propostos, Quando o usuário confirma o bloco "tecnologia", Então só esses viram `confirmado` e `/app/fatos` atualiza em ≤ 2 s.
- Dado qualquer chamada de tool, Então nenhum fato muda de status (teste de banco).
  **Testes:** `facts-actions.test.ts`, RLS, eval `no-fabrication` com certificação inexistente.

---

## B3. Perguntas de lacuna (onboarding conversacional)

**Objetivo:** depois do CV, o chat pergunta o que falta para operar como o Bot. **PB:** 20, 28.
**Arquivos:** criar `packages/ai/src/onboarding/gaps.ts`; alterar `apps/web/app/app/onboarding/*` (mesmos campos), `lib/settings/server.ts`.
**Contrato:** `computeGaps(profile, facts, settings): Gap[]` com `Gap = { key: "pretensao_coordenador"|"pretensao_gerente"|"pretensao_pj_diretoria"|"regime_aceito"|"modelo_trabalho"|"cidade"|"idiomas"|"vinculo_atual"|"portfolio_url"|"disponibilidade_inicio"|"dados_cadastrais"; question: QuestionPart }`.
**Regras:** "sem vínculo" ⇒ `remuneracao_atual = 0` automático; valores salvos em `salary_rules`/`standard_answers` (cifrado).
**Aceite:** Dado perfil sem pretensões, Quando o CV termina, Então o chat pergunta as 3 pretensões por nível e salva; `/app/perfil` mostra os valores.
**Testes:** `gaps.test.ts`, e2e `onboarding-chat.spec.ts`.

---

## B4. Propagação de fato novo (CVs e perfis externos)

**Objetivo:** como o Bot ("inglês Avançado nos 6 CVs… Quer que eu atualize LinkedIn e Gupy?"). **PB:** 41.
**Arquivos:** criar `packages/jobs/src/functions/cv-regenerate.ts`, `packages/core/src/cv-impact.ts`; alterar ações de B2.
**Contrato:** `cvImpact(fact): { affectsCv: boolean; sections: string[] }`; função Inngest `cv/regenerate.requested` → gera nova versão de **todas** as `cv_versions` ativas (PT/EN, todas as trilhas) via B5; lista `applications` não enviadas cujo pacote usa versão antiga.
**Regras (DA-11):** nunca regenerar sem OK: mostrar prévia/diff das trilhas afetadas, inclusive em lote; após OK gerar versão nova (antiga preservada); **perguntar** antes de mexer em perfil externo (cria `pending_item` "atualizar LinkedIn/Gupy"); avisar candidaturas em andamento com versão antiga (oferecer troca, D11).
**Aceite:** Dado fato "inglês: Avançado" confirmado, Quando a função roda, Então existem novas versões dos 6 CVs com o texto novo (verificado relendo o PDF com `unpdf`) e o chat lista onde a versão antiga já foi usada.
**Testes:** `cv-impact.test.ts`, `cv-regenerate.test.ts` (fake Inngest).

---

## B5. Gerador de CV ATS-friendly + backup

**Objetivo:** CVs gerados pelo app (não só upload), uma coluna, texto extraível, PT/EN por trilha; backup datado. **PB:** 42, 43.
**Arquivos:** criar `packages/cv/` (ou `apps/web/lib/cv/`) com `render-cv.tsx` (`@react-pdf/renderer`, já instalado), `cv-model.ts`, `ats-check.ts`; `packages/jobs/src/functions/cv-backup.ts` (ZIP com `fflate`, já instalado).
**Contrato**

```ts
type CvModel = { trackId: string; language: "pt-BR"|"en"; header: {...}; summary: string; experiences: { company: string; title: string; start: string; end: string|null; bullets: { text: string; factIds: string[] }[] }[]; education: ...; languages: ...; certifications: { name: string; factId: string }[] }
function atsCheck(pdf: Uint8Array): { extractable: boolean; singleColumn: boolean; issues: string[] }
```

**Regras:** todo bullet tem `factIds` confirmados (grounding); nomes de arquivo `<Nome>_CV_<Trilha>[_EN].pdf`; aplica regras de nomenclatura (E6); backup semanal e antes de toda regeneração (`exports/cv-backups/AAAA-MM-DD.zip`).
**Aceite:** Dado fatos confirmados fictícios, Quando gero CV Ops PT, Então `atsCheck` retorna `extractable=true` e todo bullet tem `factIds`; backup ZIP contém todas as versões ativas.
**Testes:** `render-cv.test.ts`, `ats-check.test.ts`, `cv-backup.test.ts`.

---

## B6. Memória de fatos a partir de respostas em linguagem natural

**Objetivo:** paridade com o Bot ("Essa vaga pede PHP e não encontrei nos seus CVs. Como seguimos?"): entender a resposta livre, gravar só o que foi dito, reaproveitar e propor atualização de CVs. **PB:** 57, 27, 41. **Especificação completa:** `MEMORIA-DE-FATOS.md` (intenções, modelo, fluxos, tools, diálogos).

**Arquivos**

- Criar `packages/ai/src/facts/classify-intent.ts`, `packages/ai/src/prompts/fact-intent.md`, `packages/core/src/facts/{evidence-guard.ts,normalize-competency.ts,resolve-facts.ts,conflict.ts}`, `apps/web/lib/facts/{memory-service.ts,versioning.ts,propagate.ts}`, `packages/ui/src/chat/{FactCaptureCard,FactConflictCard,CvUpdatePreviewCard}.tsx`.
- Alterar `apps/web/lib/chat/tools.ts` (`propose_fact`, `search_facts`; novas `confirm_fact`, `revoke_fact`, `propose_cv_update`, `apply_cv_update`), `packages/ai/src/chat/parts.ts` (A1), `apps/web/app/app/fatos/*` (histórico de versões e usos), `packages/jobs/src/functions/cv-regenerate.ts` (B4).
- Migração `<ts>_b6_fact_memory.sql` (SQL em MEMORIA-DE-FATOS §2, com backfill de `status` → `status_v2`).

**Contratos:** `FactIntent`, `ExtractedFact`, `IntentResult` (MEMORIA §2); tools (§4); parts `fact_capture`, `fact_conflict`, `cv_update_preview`.

**Regras:** todo dado recebe `destino` (MEMORIA §1b): `perfil_formulario` e `lacuna` nunca vão ao CV; só `cv_elegivel` dispara "Quer que eu atualize seus CVs com isso?" (opções Atualizar estes CVs / Guardar só para formulários / Não guardar); na dúvida pergunta; reclassificável. Só grava o que foi dito (guarda de evidência em código); confiança < 0,85 ⇒ confirmação antes de gravar; `uso_unico` não grava; `lacuna` grava fato negativo; conflito ⇒ pergunta qual vale; correção cria versão; revogação preserva histórico; candidaturas enviadas não mudam; fatos de escopo `vaga` não vazam.

**Casos de borda:** MEMORIA §6 (sim sem número, faixa, ironia, empresa desconhecida, duas competências, dado sensível, injeção vinda de vaga/e-mail).

**Aceite:** MEMORIA §7, mais:

- Dado C7 com ajuste livre "sim, e eu tenho 2 anos de PHP", Então o card atualiza e o fato passa por B6 (captura + desfazer).
- Dado D2 com pergunta de PHP e fato negativo salvo, Então o campo recebe "Não"/"0" sem pausar e o resumo mostra origem `fato`.

**Testes:** MEMORIA §8; `parity: PB-57`.
