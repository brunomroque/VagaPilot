# Tags dos textos legais

Os textos em `docs/legal/*.md` usam tags `{{UPPER_SNAKE}}`. Os valores ficam em **um só lugar**: `packages/core/src/legal.ts` (constante `LEGAL_VARS`). O app renderiza os textos com esses valores em tempo de execução, e **o hash do aceite é calculado sobre o texto renderizado** (o que o usuário viu).

Enquanto alguma tag estiver vazia ou com valor `{{...}}`, a versão é considerada **não publicável**: o aceite fica bloqueado em produção (`LEGAL_ALLOW_DRAFT` diferente de `true`) e o painel de administração mostra um aviso com as tags pendentes.

| Tag | Significado |
|---|---|
| `{{RAZAO_SOCIAL}}` | Razão social da empresa |
| `{{NOME_FANTASIA}}` | Nome do produto/marca |
| `{{CNPJ}}` | CNPJ |
| `{{ENDERECO}}` | Endereço completo da sede |
| `{{CIDADE_UF}}` | Cidade/UF da sede (foro para relações não consumeristas) |
| `{{EMAIL_CONTATO}}` | Canal de atendimento |
| `{{EMAIL_ENCARREGADO}}` | E-mail do Encarregado (DPO) |
| `{{NOME_ENCARREGADO}}` | Nome do Encarregado (DPO) |
| `{{SITE_URL}}` | URL pública do site (sem barra final) |
| `{{DATA_VIGENCIA}}` | Data de vigência (preenchida por documento) |
| `{{VERSAO}}` | Versão (preenchida por documento) |

`{{VERSAO}}` e `{{DATA_VIGENCIA}}` vêm do próprio documento (`legal_documents.version` / `effective_date`); as demais, do JSON.
