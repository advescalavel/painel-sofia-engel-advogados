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
Filtros (globais)                →  Período · Colaborador/IA · Status
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
- **Sucesso do Cliente** — atendimentos, taxa de resolução, transferidos e não
  atendidos, clientes insatisfeitos, falhas da IA; série resolvidos x
  transferidos, composição, tipos de atendimento (andamento processual,
  dúvidas gerais, golpe do falso advogado), motivos de transferência.

A aba **Qualidade da IA** é a mesma das três: efetividade média, avaliados,
falha crítica, distribuição do score por faixa ao longo do tempo, critérios
avaliados e motivos de falha crítica.

Os KPIs de alerta (janela ≤2h, sem resposta > 1h, falhas da IA) são clicáveis e
abrem a aba Atendimentos já filtrada pelo sinal.

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

### `GET /painel-vigia-engel-atendimentos`

Query adicional: `limite`, `pagina`, `base_data` (`criacao` | `conclusao` — em
qual data o período se apoia; só Sucesso do Cliente) e os sinais de auditoria
`sem_resposta_60min`, `falha_ia`, `janela_2h`, `com_feedback` — booleanos,
combináveis entre si e com os filtros globais.

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

### Feedbacks da Laila — histórico preservado

- `GET /painel-vigia-engel-feedbacks?session_id=…&departamento=…&scope_token=…`
  → `{ session_id, itens: [{ id, autor, criado_em, texto }] }` em ordem
  cronológica, nunca truncado.
- `POST /painel-vigia-engel-feedback`
  → `{ session_id, departamento, texto, autor, scope_token }`. Sempre
  **append**: insere uma linha nova, nunca altera as anteriores.

Na listagem, a coluna mostra a contagem e o trecho do último feedback; o
drawer abre o histórico completo com campo para nova mensagem. A coluna e o
chip "Com feedback da Laila" só aparecem para quem tem `pode_dar_feedback` em
Sucesso do Cliente.

## Modo demonstração

Sem sessão Bitrix24, com `?demo=1`, ou quando a API não responde, o painel
carrega `demo-data.js` e exibe o aviso "Dados de demonstração". O formato é
idêntico ao contrato acima — trocar por dados reais não muda o `app.js`.

## Pendências para produção

- Publicar os quatro endpoints com validação do `scope_token` (403 fora do
  escopo).
- Popular `painel_vigia_permissoes` e definir `VIGIA_SCOPE_SECRET`.
- Confirmar a origem dos indicadores da IA de Fechamento (hoje o exemplo deriva
  `fechamentos` de `qualificacoes`).
- Confirmar se o filtro Colaborador/IA deve listar pessoas nominalmente ou
  seguir com origem (IA x colaboradores), como está.
