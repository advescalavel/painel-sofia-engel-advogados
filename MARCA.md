# MARCA — Painel Vigia · Engel Advogados

O painel usa o **mesmo sistema visual do Painel Vigia da Advocacia Escalável**:
`ae-brand.css` (tokens, botões, chips, badges, logo, tema claro/escuro) e o
`styles.css` do Vigia com a seção 8 acrescentada para o que é próprio da Engel.

## Reaproveitado sem alteração

- `ae-brand.css`, `assets/logo-completo.svg`, `assets/isotipo-gradiente.svg`,
  `favicon.svg` — copiados do painel da AE.
- Barra pegajosa com abas e filtros, popover de período multi-seleção,
  pílulas de filtro ativo, cards de KPI, gráficos `vg-plot` com eixo, grade e
  tooltip, tabela, paginação, toast, estados de carregando/vazio/erro.
- Escala tipográfica Geologica e a paleta de séries `--ae-serie-1..7`.

## Acrescentado (seção 8 do `styles.css`)

- `.vg-cliente-nome` — "Engel Advogados" como subtítulo do nome do produto,
  conforme a regra LOGO / PRODUTOS. A logo do cliente não entra no cabeçalho.
- `.vg-agente` — seletor de IA supervisora em pílulas, com marca em gradiente.
- `button.vg-kpi` / `.vg-kpi__ir` — KPI de alerta que leva à aba Atendimentos
  já filtrada.
- `.vg-sinais-filtro` — chips de auditoria dentro do card da tabela.
- `.vg-fb`, `.vg-drawer*`, `.vg-msg*`, `.vg-textarea`, `.vg-status` — célula de
  feedback e drawer de histórico da Laila.
- `.vg-sem-acesso` — tela de permissão negada, com o `ae-appicon`.

Tudo em cima dos tokens `--ae-*`: nenhuma cor, sombra, raio ou fonte nova foi
introduzida.

## Conferido

- Tema claro por padrão, alternador persistido em `localStorage`
  (`ae-tema:painel-vigia-engel`), sem flash no carregamento.
- `body { margin: 0 }`, sem `100vh`, `BX24.fitWindow()` após cada render.
- Logo semipositiva no claro e seminegativa no escuro via `currentColor` do
  `ae-brand.css`; isotipo abaixo de 700px (`vg-so-compacto`).
- Favicon com o isotipo sobre o gradiente.
