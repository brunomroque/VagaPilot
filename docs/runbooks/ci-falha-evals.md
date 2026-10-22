# Runbook — falha de evals no CI

## Sintoma

Job `evals` ou `eval:no-fabrication` vermelho no GitHub Actions.

## Passos

1. Reproduzir localmente (sem rede para o fake provider):
   ```bash
   pnpm eval:no-fabrication
   pnpm evals
   pnpm eval:email
   ```
2. Se `no-fabrication` falhou: revisar `evals/no-fabrication/cases.json` e `packages/core/grounding.ts`. Meta: **0** afirmações sem suporte aceitas.
3. Se `prompt-injection` / `off-topic` falhou: revisar regras em `packages/core/guardrails.ts` e o dataset em `evals/`.
4. Se `fit` falhou com `AI_GATEWAY_API_KEY` setada: rodar sem a chave (fake) ou atualizar rótulos em `evals/fit/pairs.json`.
5. Se `email-classify` falhou com gateway: rodar sem `EVAL_EMAIL_PROVIDER=gateway` ou corrigir corpus fictício em `evals/email/emails.json`.

## Regenerar datasets fictícios expandidos

```bash
node scripts/generate-no-fabrication-eval.mjs
node scripts/expand-fictitious-evals.mjs
```

Nunca incluir dados pessoais reais nos JSON de `evals/`.
