# Navegador local (Chrome de vagas)

## Por quê

Sites de vagas (LinkedIn, Gupy etc.) bloqueiam com mais frequência navegadores automatizados em
datacenter. Rodar a automação no **Chrome real do usuário** (IP residencial, perfil e cookies reais)
reduz essa chance. **Não elimina:** a automação age nas contas reais do usuário, que pode ter a conta
limitada ou bloqueada. O usuário é avisado (risco `navegador_local`, termo `termo-riscos-automacao`)
e assume esse risco antes de qualquer busca/candidatura/login.

## Configuração

| Variável                    | Padrão                        | Efeito                                                                    |
| --------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `BROWSER_PROVIDER`          | `local`                       | `local` = Chrome do usuário via CDP; `browserbase` = pool na nuvem direto |
| `LOCAL_BROWSER_CDP_URL`     | `http://127.0.0.1:9223`       | Endpoint de remote debugging (http ou ws)                                 |
| `LOCAL_BROWSER_PROFILE_DIR` | `C:\Users\bruno\chrome-vagas` | Perfil dedicado (Windows); sobrescreva se usar outro perfil (ex.: QA)     |

Fluxo (`acquireTrackedBrowser`, `packages/browser-pool/src/pool/supabase.ts`):

1. Com `BROWSER_PROVIDER=local` (padrão): testa `GET {LOCAL_BROWSER_CDP_URL}/json/version` (2 s). Se
   responder, conecta via CDP no Chrome do usuário. Nunca fecha o Chrome dele; não grava
   `browser_sessions`.
2. Se o local não responder, a execução **falha** com mensagem clara — **não** há fallback automático
   para Browserbase. Use `BROWSER_PROVIDER=browserbase` apenas se quiser rodar só na nuvem.
3. Se o local falhar no meio da execução, o id `local` entra em `exclude`; com provider `local`, o
   próximo segmento também falha até o Chrome voltar.

## Subir o Chrome local (Windows)

Use um perfil dedicado (não o perfil principal). Repositório: `scripts/start-chrome-debug.bat` ou:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9223 `
  --user-data-dir="$env:LOCAL_BROWSER_PROFILE_DIR"
```

Se `LOCAL_BROWSER_PROFILE_DIR` não estiver definida, o padrão é `C:\Users\bruno\chrome-vagas`.

Faça login manualmente nesse Chrome (LinkedIn, Gupy...). Nunca informe senhas ao VagaPilot.

**Importante:** o worker precisa rodar **na mesma máquina** (ou alcançar a porta via túnel seguro).
Funções Netlify não alcançam `127.0.0.1` do usuário — nelas o local fica indisponível até você
usar um worker na sua máquina ou `BROWSER_PROVIDER=browserbase`. Não exponha a porta 9223 na
internet: ela dá controle total do navegador.
