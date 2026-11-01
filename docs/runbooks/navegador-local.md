# Navegador local (padrão) + Browserbase (fallback)

## Por quê

Sites de vagas (LinkedIn, Gupy etc.) bloqueiam com mais frequência navegadores automatizados em
datacenter. Rodar a automação no **Chrome real do usuário** (IP residencial, perfil e cookies reais)
reduz essa chance. **Não elimina:** a automação age nas contas reais do usuário, que pode ter a conta
limitada ou bloqueada. O usuário é avisado (risco `navegador_local`, termo `termo-riscos-automacao`)
e assume esse risco antes de qualquer busca/candidatura/login.

## Configuração

| Variável                | Padrão                  | Efeito                                                                    |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `BROWSER_PROVIDER`      | `local`                 | `local` = Chrome do usuário via CDP; `browserbase` = pool na nuvem direto |
| `BROWSER_FALLBACK`      | `browserbase`           | `none` desliga o fallback para a nuvem                                    |
| `LOCAL_BROWSER_CDP_URL` | `http://127.0.0.1:9222` | Endpoint de remote debugging (http ou ws)                                 |

Fluxo (`acquireTrackedBrowser`, `packages/browser-pool/src/pool/supabase.ts`):

1. `local`: testa `GET {LOCAL_BROWSER_CDP_URL}/json/version` (2 s). Se responder, conecta via CDP
   no Chrome do usuário. Nunca fecha o Chrome dele; não grava `browser_sessions`.
2. Sem resposta: cai no pool de nuvem (`BROWSER_POOL_ENABLED=true`), preferindo Browserbase.
3. Se o local falhar no meio da execução, o id `local` entra em `exclude` e o próximo segmento usa a nuvem.

## Subir o Chrome local (Windows)

Use um perfil dedicado (não o perfil principal) — igual ao `Start-ChromeDebug.ps1` dos bots:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:LOCALAPPDATA\VagaPilot\chrome-profile"
```

Faça login manualmente nesse Chrome (LinkedIn, Gupy...). Nunca informe senhas ao VagaPilot.

**Importante:** o worker precisa rodar **na mesma máquina** (ou alcançar a porta via túnel seguro).
Funções Netlify não alcançam `127.0.0.1` do usuário — nelas o local fica indisponível e o fallback
Browserbase assume. Não exponha a porta 9222 na internet: ela dá controle total do navegador.
