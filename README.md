# Painel Vigia — Engel Advogados

Nova versão do Painel Vigia para a Engel: **um único painel** com Comercial e
Sucesso do Cliente, controle de acesso por departamento e as três IAs
supervisoras (SDR, Fechamento de Contratos, Sucesso do Cliente).

Estrutura, componentes e experiência vêm do Painel Vigia da Advocacia
Escalável — `ae-brand.css` e o `styles.css` do Vigia foram copiados e apenas
estendidos. Empacotamento de app Bitrix24 igual ao painel atual da Engel
(`/api/entry` serve o HTML, `/api/install` trata a instalação, Supabase guarda
instalação e acessos).

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.html` | shell: cabeçalho, seletor de IA, abas, filtros, tabela, drawer |
| `ae-brand.css` | sistema de marca da AE (cópia, não editar) |
| `styles.css` | `styles.css` do Vigia + seção 8 com as extensões da Engel |
| `app.js` | permissões, filtros, KPIs, gráficos, atendimentos, feedbacks |
| `demo-data.js` | conjunto de demonstração, só quando a API não responde |
| `api/permissoes.js` | valida o token do Bitrix24 e devolve departamentos + `scope_token` |
| `lib/permissoes.js` | leitura das permissões no Supabase |
| `api/entry.js`, `api/install.js`, `api/session.js`, `lib/supabase.js` | reaproveitados do painel atual |
| `MARCA.md` | o que foi reaproveitado e o que foi acrescentado no visual |

## Navegação

```
Departamento (só os permitidos)  →  Comercial          |  Sucesso do Cliente
IA supervisora                   →  SDR · Fechamento   |  Sucesso do Cliente
Abas                             →  Visão geral · Qualidade da IA · Atendimentos
Filtros principais (globais)     →  Período · Data de referência · Responsável (colaborador/IA)
Mais filtros (globais)           →  Status · Critério da IA · Motivo de falha da IA · Avaliado pela Supervisora
                                    · Componente avaliado (só Sucesso do Cliente)
                                    · Auditoria do colaborador: critério e falha (só Sucesso do Cliente)
                                    · Resultado no critério (aparece quando há critério escolhido)
```

Cada IA tem a sua Visão geral:

- **SDR** — qualificações, taxa de qualificação, atendimentos, desqualificados,
  janela oficial encerrando, sem resposta > 1h; série qualificados x
  desqualificados (taxa no tooltip), composição do período, motivos de
  desqualificação, objeções.
- **Fechamento** — contratos fechados e taxa de fechamento em primeiro lugar,
  depois qualificações e atendimentos; série fechados x qualificados sem
  contrato, funil atendimento → qualificação → contrato, composição,
  objeções, motivos de desqualificação.
- **Sucesso do Cliente** — resumo executivo na sequência
  Resultado → Qualidade → Diagnóstico → Risco → Ação:
  - KPIs separados em **No período** (atendimentos, taxa de resolução,
    atendimentos críticos, falhas críticas da IA, clientes insatisfeitos) e **Agora** (riscos operacionais ativos: janela de 24h
    encerrando + sem resposta há +1h);
  - **Qualidade dos colaboradores** (bloco no topo, no lugar de "Evolução"):
    - *Média geral de avaliação por colaborador* — barras horizontais com a nota
      de 0 a 4 (2 casas), cor pela faixa gerencial, quantidade de avaliações ao
      lado e a **média da equipe** como referência;
    - *Média por critério e colaborador* — matriz colaborador × 6 critérios
      (Objetividade, Simplicidade, Velocidade, Previsibilidade, Coerência do
      atendimento, Checagem de entendimento), nota 0–100 por critério, cor pela
      faixa; critério não aplicável aparece como "—", nunca como zero;
    - *Motivos de falha crítica* (da IA), que segue no bloco;
    - só colaboradores **humanos**; só avaliações da metodologia nova (0–4);
      segue todos os filtros da tela (ver contrato abaixo);
    - saíram da Visão geral: a linha "Evolução da taxa de resolução", a
      distribuição por faixa e o desempenho por critério da IA (a distribuição
      por faixa continua na aba **Qualidade da IA**; o pior critério da IA segue
      em "Onde agir").
  - **Diagnóstico**: efetividade por tipo de atendimento (ou volume por tipo,
    enquanto `nota_media` não vier) e motivos de transferência;
  - **Riscos operacionais** (painel destacado): alertas por tipo e evolução
    dos alertas;
  - **Onde agir**: pontos de atenção derivados dos dados da tela.
  A composição das resoluções e a série em barras resolvidos x transferidos
  saíram da aba — os volumes seguem nos KPIs e no tooltip da linha.

A aba **Qualidade da IA** é a mesma das três: efetividade média, avaliados,
falha crítica, distribuição do score por faixa ao longo do tempo, critérios
avaliados e motivos de falha crítica.

Os KPIs de alerta (janela ≤2h, sem resposta > 1h, falhas da IA) são clicáveis e
abrem a aba Atendimentos já filtrada pelo sinal. Na Visão geral de Sucesso do
Cliente todo KPI, faixa de nota, critério, motivo, tipo de alerta e ponto de
atenção faz o mesmo (`irParaAtendimentos`), com o filtro visível em pílula.

## Controle de acesso (precisa ser fechado no back-end)

1. `POST /api/permissoes` valida o `access_token` em `user.current`, lê
   `painel_vigia_permissoes` no Supabase e assina um `scope_token` HMAC-SHA256
   (`VIGIA_SCOPE_SECRET`, 30 min) com
   `{member_id, bitrix_user_id, departamentos, exp}`.
2. Todo endpoint de dados valida a assinatura e **recusa com 403** quando
   `departamento` da query está fora da lista do token. Sem isso o controle
   seria apenas visual.
3. Sem departamento vinculado, o painel mostra "Sem permissão de acesso".

```sql
create table painel_vigia_permissoes (
  id bigserial primary key,
  member_id text not null,
  bitrix_user_id text not null,
  departamento text not null check (departamento in ('comercial','sucesso_cliente')),
  pode_feedback boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (member_id, bitrix_user_id, departamento)
);
```

Variáveis novas: `VIGIA_SCOPE_SECRET` e, opcionalmente, `VIGIA_DEPT_MAP`
(mapa `id do departamento Bitrix → departamento do painel`).

## Contratos dos endpoints

Base: `https://webhook.prod.advocaciaescalaveldev.shop/webhook`
Comum a todos: `departamento`, `agente` (`sdr` | `fechamento` | `sucesso`),
`periodos` (JSON `[{desde, ate}]`, aceita vários), `status`, `colaborador`
(`ia` | `colaboradores`), `base_data`, `scope_token`, `api_key`.

Em Sucesso do Cliente o período pode se apoiar na **data de criação** ou na
**data de conclusão** do atendimento (`base_data`), e o filtro de status separa
atendimentos em andamento dos concluídos — `concluido` agrega resolvidos,
transferidos e transferidos sem atendimento. Com `base_data=conclusao` os
atendimentos ainda em andamento ficam fora do resultado e a opção "Em
andamento" some do filtro.

### `GET /painel-vigia-engel-metricas`

```jsonc
{
  "granularidade": "dia|mes",
  "serie": [{ "bucket": "2026-08-25", "atendimentos": 0, "qualificados": 0,
              "desqualificados": 0, "fechados": 0, "nao_fechados": 0,
              "resolvidos": 0, "transferidos": 0 }],
  "criterios": [{ "criterio": "…", "media": 0 }],
  "falha_critica": [{ "motivo": "…", "quantidade": 0 }],
  "distribuicao_score_faixas": [{ "chave": "f0_59", "rotulo": "0–59" }],
  "distribuicao_score_serie": [{ "bucket": "…", "f0_59": 0, "f60_74": 0, "f75_89": 0, "f90_100": 0 }],
  "kpis": {
    "total_atendimentos": 0, "avaliados": 0, "com_falha_critica": 0,
    "janela_2h_agora": 0, "sem_resposta_60min_agora": 0, "efetividade_media_pct": 0,
    // sdr e fechamento
    "qualificacoes": 0, "taxa_qualificacao_pct": 0, "desqualificados": 0,
    // fechamento
    "fechamentos": 0, "taxa_fechamento_pct": 0,
    // sucesso
    "resolvidos": 0, "taxa_resolucao_pct": 0, "transferidos": 0,
    "transferidos_sem_atendimento": 0, "clientes_insatisfeitos": 0, "falhas_ia": 0
  },
  // conforme o agente
  "motivos_desqualificacao": [{ "motivo": "…", "quantidade": 0 }],
  "objecoes": [{ "objecao": "…", "quantidade": 0 }],
  "motivos_transferencia": [{ "motivo": "…", "quantidade": 0 }],
  "tipos_atendimento": [{ "tipo": "…", "quantidade": 0 }]
}
```

`janela_2h_agora` e `sem_resposta_60min_agora` são estados do momento, não do
período — a interface os marca com a tag "agora".

#### Extensões da Visão geral de Sucesso do Cliente (opcionais)

Query nova: `componente` (`ambos` | `ia` | `humano`) — quais avaliações entram
nas notas, faixas e critérios. Enquanto o endpoint ignorar o parâmetro, o
painel mostra o que vier hoje. Todos os campos abaixo são opcionais: sem
eles a Visão geral cai no comportamento descrito entre parênteses.

```jsonc
{
  "serie": [{
    // nota média por desfecho no bucket (sem eles: só a taxa de resolução)
    "nota_media_resolvidos": 84, "nota_media_transferidos": 71, "nota_media_humano": 78,
    "atendidos_humano": 3,   // iniciados e atendidos por humano (peso da média)
    // alertas disparados no bucket (sem eles: "histórico indisponível" e o
    // gráfico por tipo usa os estados *_agora)
    "alertas_janela_24h": 1, "alertas_sem_resposta": 2, "alertas_insatisfacao": 0
  }],
  // faixas gerenciais (sem ele: usa distribuicao_score_faixas/serie)
  "distribuicao_classificacao_serie": [{ "bucket": "…", "critico": 0, "regular": 0, "bom": 0, "excelente": 0 }],
  "kpis": { "atendimentos_criticos": 0 },   // sem ele: soma de "critico" acima
  "criterios": [{ "criterio": "…", "componente": "ia|humano", "taxa_aprovacao_pct": 0, "quantidade_avaliada": 0 }],
  "tipos_atendimento": [{ "tipo": "…", "quantidade": 0, "nota_media": 0 }]  // sem nota: volume por tipo
}
```

### `colaboradores_qualidade` (métricas · só Sucesso do Cliente)

Alimenta os dois gráficos de Qualidade dos colaboradores. Vem da mesma view da
aba Atendimentos (`vw_qualidade_humana_sucesso_cliente`), com o mesmo join ao
atendimento e os mesmos filtros (período + `base_data`, `status`, `avaliado`,
`tipo_atendimento`, `motivo_transferencia`, `motivo_falha`, `criterio`,
`criterio_colaborador`, `criterio_resultado`, `falha_colaborador`,
`score_min`/`score_max`). `colaborador=ia` ou `componente=ia` devolvem lista
vazia. Nada é recalculado: a nota geral é a média de `nota_colaborador_4pts`
(0–4, já com pesos e renormalização do Vigia) e cada critério é a média do seu
`*_score` (0–100) **só dos atendimentos em que foi avaliado**.

```jsonc
"colaboradores_qualidade": {
  "escala_max": 4,
  "criterios": ["Objetividade", "Simplicidade", "Velocidade", "Previsibilidade",
                "Coerência do atendimento", "Checagem de entendimento"],
  "colaboradores": [{
    "colaborador": "…", "avaliacoes": 95, "media_nota": 2.84,
    "criterios": [{ "criterio": "Objetividade", "media": 69.6, "quantidade": 85 }]  // media null = não aplicável
  }],
  "equipe": { "avaliacoes": 497, "media_nota": 3.36, "criterios": [ … ] },        // mesma base dos colaboradores listados
  "fora_do_grafico": { "sem_colaborador_identificado": 46, "escala_anterior": 65 }
}
```

Entram só avaliações da metodologia nova (`escala_score = 4`) já auditadas
(as de escala 0–100 não se misturam com 0–4; as "aguardando prazo" ainda não têm
nota). Ficam fora, e são contadas em `fora_do_grafico`, as avaliações sem nome de
colaborador ou com a conta genérica do portal (`NOMES_NAO_COLABORADOR` no node
"Montar SQL Métricas"). Sem o campo na resposta (API antiga), o painel mostra
um aviso em vez dos gráficos.

Sinalização visual (não exclui dado): colaborador com menos de 5 avaliações e
critério com menos de 3 aparecem esmaecidos (`MIN_AVALIACOES_COLABORADOR` e
`MIN_AVALIACOES_CRITERIO` no `app.js`).

## Nova metodologia do colaborador (Sucesso do Cliente) — vigia-cs-v8.0

A nota do **colaborador** passa a ter **máximo de 4 pontos**, calculada por 6 critérios. A nota da **IA (Sofia)
segue em 0–100**, sem alteração.

| Critério | Peso | Aplicabilidade |
|---|---|---|
| Objetividade | 15% | só quando o colaborador repassou andamento processual |
| Simplicidade | 10% | quando o colaborador explicou algo ao cliente |
| Velocidade | 30% | calculada pelo sistema: segunda a sexta, 08h–17h, prazo de 1 dia útil |
| Previsibilidade | 15% | só quando houve repasse de andamento em que cabe estimativa de prazo |
| Coerência do atendimento | 20% | quando houve dúvida/solicitação que coube ao colaborador |
| Checagem de entendimento | 10% | quando o colaborador transmitiu informação que exigia compreensão |

- Cada critério vale 0–100; a nota final é `Σ(nota × peso) ÷ Σ(pesos aplicáveis) ÷ 100 × 4`, com 2 casas.
  Critério **não aplicável** (`null`) sai do cálculo e os pesos são redistribuídos; **falha** é nota baixa.
- Velocidade por espera: dentro do prazo = 100; até 2× o prazo = 50; acima disso ou sem resposta = 0.
  Caso urgente: 100 só até 4 h úteis. Sessão com pendência ainda dentro do prazo fica "Aguardando prazo de
  resposta" (`aguardando_prazo: true`) e é reavaliada quando o prazo vence.
- Transferido e sem resposta humana: entra na nota (só Velocidade) **se havia pendência**; sem pendência fica fora.
- Faixas (mesma proporção das da IA): Excelente ≥ 3,40 · Bom ≥ 2,80 · Regular ≥ 2,00 · Crítico < 2,00.
- **Histórico:** avaliações anteriores não foram recalculadas. Cada linha traz `escala_score` (`4` = nova, `100` =
  anterior); o painel mostra "x,xx / 4" ou o valor antigo com a marca "escala anterior". Não comparar as duas.
  Sessões abertas e já avaliadas que forem reavaliadas depois da atualização passam para a nova metodologia.

Campos novos no item da lista (modo colaboradores e `avaliacao_colaborador`): `escala_score` e `aguardando_prazo`.

### `GET /painel-vigia-engel-atendimentos`

Query adicional: `limite`, `pagina`, `base_data` (`criacao` | `conclusao` — em
qual data o período se apoia; só Sucesso do Cliente) e os sinais de auditoria
`sem_resposta_60min`, `falha_ia`, `janela_2h`, `insatisfacao`, `com_feedback` —
booleanos, combináveis entre si e com os filtros globais. O drill-down por faixa
de nota envia `score_min` e `score_max` (inclusivos, **em % da nota máxima**: para a IA a
nota arredondada 0–100; para o colaborador, `nota ÷ 4 × 100` nas avaliações novas e a
nota 0–100 nas anteriores). O endpoint aplica todos os filtros — total,
contadores e paginação já chegam consistentes; o painel não recorta a página.

Regras (v3 do endpoint):

- Todo filtro vale nos três modos de origem (Colaboradores e IA, Somente IA,
  Somente colaboradores). Em Sucesso do Cliente + Somente colaboradores a fonte é
  a auditoria humana (`vw_qualidade_humana_sucesso_cliente`) e os dados de sessão
  (status, sinais, tipo, falha da IA) vêm do atendimento correspondente.
- Recorte de tempo: o período selecionado. Os sinais **agora** (`janela_2h`,
  `sem_resposta_60min`) seguem os KPIs `*_agora`: atendimentos em aberto,
  independentemente do período — a resposta traz `"recorte": "alertas_agora"`.
- Contador de cada chip = quantos atendimentos a lista teria com o chip ligado.
- Com filtro de status ativo, o badge da linha é o status filtrado; sem filtro,
  vale a ordem de precedência do departamento (`concluido` quando nenhum se aplica).

Filtros da auditoria (critérios e falhas):

| Parâmetro | Valores | Aplica sobre |
|---|---|---|
| `criterio` | nome do critério da IA | nota do critério (IA), só em atendimento avaliado |
| `criterio_colaborador` | `Objetividade` · `Simplicidade` · `Velocidade` · `Previsibilidade` · `Coerência do atendimento` · `Checagem de entendimento` | nota do critério (0–100) na auditoria humana, só com `auditado = true` |
| `criterio_resultado` | `nao_atendido` (padrão) · `atendido` · `avaliado` | os dois filtros de critério; corte de aprovação 90, o mesmo do ✓/✕ da coluna Sinais |
| `motivo_falha` | `falha_critica` da IA | igualdade exata |
| `falha_colaborador` | `categoria_erro_humano` ou `__qualquer__` | igualdade exata; `__qualquer__` = qualquer valor diferente de vazio/`nenhuma` |

Nome de critério desconhecido devolve lista vazia (não é ignorado).

```jsonc
{
  "recorte": "periodo|alertas_agora",
  // opções dos selects, só por departamento + período (independem dos demais filtros)
  "opcoes_filtro": {
    "criterios_ia": ["…"], "criterios_colaborador": ["…"],
    "falhas_ia": [{ "motivo": "…", "quantidade": 0 }],
    "falhas_colaborador": [{ "motivo": "…", "quantidade": 0 }]
  }
}
```

```jsonc
{
  "total": 96,
  "contadores": { "sem_resposta_60min": 12, "falha_ia": 25, "janela_2h": 10, "com_feedback": 35 },
  "itens": [{
    "session_id": "…", "chat_id": "41007", "contact_name": "…", "responsavel": "…",
    "origem": "ia|colaboradores", "started_at": "ISO", "finished_at": "ISO|null",
    "status": "em_andamento|resolvido|transferido|transferido_sem_atendimento|qualificado|fechado|desqualificado",
    "score_efetividade": 82, "falha_critica": null,
    "janela_2h": false, "sem_resposta_60min": true,
    "justificativa_avaliacao": "…",
    // Sucesso do Cliente
    "tipo_atendimento": "Andamento processual", "motivo_transferencia": null, "insatisfacao": false,
    "feedbacks": { "total": 3, "ultimo": { "autor": "…", "criado_em": "ISO", "texto": "…" } },
    // Comercial
    "motivo_desqualificacao": null, "objecao": "Preço / honorários"
  }]
}
```

#### Critérios por atendimento (coluna Sinais)

A coluna **Sinais** mostra, abaixo dos alertas, os critérios avaliados naquele
atendimento: ✓ atendido, ✕ não atendido (em destaque) e – não se aplica
(critério excluído do cálculo), com o placar `atendidos/aplicáveis`. Há um
grupo para o colaborador e outro para a IA, conforme o filtro "Componente
avaliado". Campos opcionais no item — sem eles a coluna fica como antes:

```jsonc
{
  // critérios da IA (ou de ambos, marcando componente)
  "criterios": [{ "criterio": "Compreensão da demanda", "atendido": true, "componente": "ia" }],
  "avaliacao_colaborador": {
    "responsavel": "…", "score_efetividade": 67, "justificativa_avaliacao": "…",
    // critérios da auditoria humana
    "criterios": [{ "criterio": "Tempo de resposta", "atendido": false, "nota": 40, "justificativa": "…" }]
  }
}
```

`atendido` é `true`, `false` ou `null` (não se aplica). Se vier só `nota`, o
painel considera atendido a partir de 70. `nota` e `justificativa` aparecem
no tooltip do critério.

### Feedbacks da Laila — histórico preservado

- `GET /painel-vigia-engel-feedbacks?session_id=…&departamento=…&scope_token=…`
  → `{ session_id, itens: [{ id, autor, criado_em, texto }] }` em ordem
  cronológica, nunca truncado.
- `POST /painel-vigia-engel-feedback`
  → `{ session_id, departamento, texto, autor, scope_token }`. Sempre
  **append**: insere uma linha nova, nunca altera as anteriores. O
  `scope_token` é validado pelo mesmo código dos endpoints GET.

O `scope_token` vale 30 min. O painel renova o token quando faltam menos de 2
min e, se um endpoint responder 403, renova uma vez (`/api/permissoes`, com
`BX24.refreshAuth` quando o access_token do Bitrix24 venceu) e repete a chamada.

Na listagem, a coluna mostra a contagem e o trecho do último feedback; o
drawer abre o histórico completo com campo para nova mensagem. A coluna e o
chip "Com feedback da Laila" só aparecem para quem tem `pode_dar_feedback` em
Sucesso do Cliente.

## Modo demonstração

Sem sessão Bitrix24, com `?demo=1`, ou quando a API não responde (falha de rede
ou 502/503/504), o painel carrega `demo-data.js` e exibe o aviso "Dados de
demonstração". Com sessão real, erro HTTP do endpoint (403, 500…) aparece como
estado de erro na tela — dados de exemplo não seguiriam os filtros. O formato é
idêntico ao contrato acima — trocar por dados reais não muda o `app.js`.

## Pendências para produção

- Publicar os quatro endpoints com validação do `scope_token` (403 fora do
  escopo).
- Popular `painel_vigia_permissoes` e definir `VIGIA_SCOPE_SECRET`.
- Confirmar a origem dos indicadores da IA de Fechamento (hoje o exemplo deriva
  `fechamentos` de `qualificacoes`).
- Confirmar se o filtro Colaborador/IA deve listar pessoas nominalmente ou
  seguir com origem (IA x colaboradores), como está.
- Visão geral de Sucesso do Cliente: publicar no endpoint de métricas o
  parâmetro `componente` e os campos opcionais da seção "Extensões"; no de
  atendimentos, `componente`.
- Métricas em Sucesso do Cliente + Somente colaboradores ainda definem
  "colaborador" por `resolved_by`/`had_human`, enquanto a lista usa a auditoria
  humana; os KPIs desse recorte podem diferir do total da lista.
