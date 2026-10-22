# Gap — e2e com extensão Chrome carregada

## Situação (P7)

- **Coberto no CI:** pareamento e pacote via API (`extension.spec.ts`), formulário ATS em `/dev/ats-form`.
- **Não coberto:** build WXT em `.output/`, launch do Chromium com `--disable-extensions-except` + `--load-extension`, side panel MV3 e fluxo fill end-to-end.

## Por quê

Playwright no GitHub Actions não instala a extensão empacotada por padrão; o job `e2e` prioriza estabilidade da web na porta 3100.

## Teste parcial recomendado (local)

```bash
pnpm --filter extension build
# Manual: chrome --load-extension=apps/extension/.output/chrome-mv3
```

## Próximo passo (pós-beta)

Script `apps/web/e2e/extension-loaded.spec.ts` com `test.skip(!process.env.VP_E2E_EXTENSION_PATH)` e documentação de variável no CI opcional.
