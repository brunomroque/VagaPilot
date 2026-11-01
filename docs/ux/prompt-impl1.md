Implemente, de forma cirurgica, os achados UX01, UX04, UX07, UX08, UX12, UX13, UX21, UX23 e UX26 descritos em docs/ux/UX_LAWS_AUDIT.md (leia o detalhe de cada um e o codigo real antes).
Regras:

- Somente apps/web. Nao mexa em .env, secrets, migrations de banco, dependencias ou config do Next.
- UX01: use apenas dados reais ja disponiveis no servidor (perfil/onboarding). Se nao houver metrica confiavel, OCULTE a linha de percentual. Nunca mostre demoProfile para usuario autenticado.
- Mantenha o texto em pt-BR, acessibilidade (aria, foco, alvos de toque >= 44px quando mexer em botoes).
- Preserve finais de linha existentes dos arquivos (CRLF/LF). Confirme com git diff que cada edicao realmente aplicou.
- Ajuste/adicione testes unitarios existentes se quebrarem. Rode: pnpm --filter web typecheck e pnpm --filter web lint (ou os scripts equivalentes do package.json de apps/web) e corrija erros.
- Faca UM commit por achado, mensagem: "ux(UXnn): <resumo em pt-BR>". Nao faca push.
- No fim, atualize docs/ux/UX_LAWS_AUDIT.md adicionando uma coluna/linha "Status: feito" nos achados implementados, e commite isso como "docs(ux): auditoria leis de UX e status". Inclua tambem docs/ux/prompt-*.md nesse commit.
  Se algum item exigir decisao de produto, pule e explique no final.
