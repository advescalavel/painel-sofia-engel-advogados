// =============================================================================
// app.js — Painel Vigia · Engel Advogados
//
// Mesma arquitetura de UI do Painel Vigia da Advocacia Escalável (barra
// pegajosa, popover de período, gráficos com eixo/grade/tooltip, estados de
// carregando/vazio/erro, toast). O que é próprio da Engel:
//
//  - painel único com controle de acesso por departamento (Comercial /
//    Sucesso do Cliente), resolvido no back-end por /api/permissoes;
//  - seletor de IA supervisora dentro do departamento (SDR, Fechamento de
//    Contratos, Sucesso do Cliente);
//  - aba Atendimentos com filtros de auditoria (sem resposta > 1h, falhas da
//    IA, janela oficial encerrando) e histórico de feedbacks da Laila.
// =============================================================================

const API_BASE = 'https://webhook.prod.advocaciaescalaveldev.shop/webhook';
const API_KEY = 'vigia-engel-k7x9mP2qL8wZ4nR1';
const URL_PERMISSOES = '/api/permissoes';
const SUPORTE_URL = 'https://engeladvogados.bitrix24.com.br/online/?IM_DIALOG=67807';
const CHAT_BASE = 'https://engeladvogados.bitrix24.com.br/online/?IM_DIALOG=chat';
const TEMA_STORAGE_KEY = 'ae-tema:painel-vigia-engel';

const DEPARTAMENTOS = {
  comercial: {
    nome: 'Comercial',
    agentes: [
      { id: 'sdr', nome: 'IA Supervisora SDR', papel: 'Qualificação', marca: 'S' },
      { id: 'fechamento', nome: 'IA Supervisora de Fechamento', papel: 'Contratos', marca: 'F' }
    ],
    status: [
      ['todos', 'Todos os status'], ['qualificado', 'Qualificado'],
      ['fechado', 'Contrato fechado'], ['desqualificado', 'Desqualificado']
    ]
  },
  sucesso_cliente: {
    nome: 'Sucesso do Cliente',
    agentes: [
      { id: 'sucesso', nome: 'IA Supervisora de Sucesso do Cliente', papel: 'Pós-venda', marca: 'C' }
    ],
    status: [
      ['todos', 'Todos os status'], ['em_andamento', 'Em andamento (criado, não concluído)'],
      ['concluido', 'Concluído'], ['resolvido', 'Concluído — resolvido pela IA'],
      ['transferido', 'Concluído — transferido'], ['transferido_sem_atendimento', 'Transferido e não atendido']
    ]
  }
};

const CHIPS_AUDITORIA = [
  { chave: 'sem_resposta_60min', rotulo: 'Sem resposta há +1h' },
  { chave: 'falha_ia', rotulo: 'Falhas da IA' },
  { chave: 'janela_2h', rotulo: 'Janela oficial encerrando' },
  { chave: 'com_feedback', rotulo: 'Com feedback da Laila', soSucesso: true }
];

const nf = new Intl.NumberFormat('pt-BR');
const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const df = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const hf = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const $ = (id) => document.getElementById(id);
function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function num(v) { return Number(v) || 0; }
function pct(parte, total) { return total > 0 ? (parte / total) * 100 : 0; }

const estado = {
  permissoes: null,
  demo: false,
  departamento: null,
  agente: null,
  secao: 'visao',
  colaborador: null,
  status: 'todos',
  avaliado: 'sim', // 'sim' | 'nao' | 'todos' - só afeta a aba Atendimentos
  baseData: 'criacao',
  periodos: [],
  periodoRotulo: 'Hoje',
  periodoPreset: 'hoje',
  sinais: { sem_resposta_60min: false, falha_ia: false, janela_2h: false, com_feedback: false },
  pagina: 1,
  limite: 25,
  dados: null,
  lista: null,
  sessaoDrawer: null
};

function dep() { return DEPARTAMENTOS[estado.departamento]; }
function podeDarFeedback() {
  return !!(estado.permissoes && estado.permissoes.pode_dar_feedback) && estado.departamento === 'sucesso_cliente';
}

// =============================================================================
// Períodos
// =============================================================================
function periodoDia(d) {
  return {
    desde: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString(),
    ate: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString()
  };
}
function periodoMes(ano, mes) {
  return {
    desde: new Date(ano, mes, 1).toISOString(),
    ate: new Date(ano, mes + 1, 0, 23, 59, 59, 999).toISOString()
  };
}
function periodoAno(ano) {
  return { desde: new Date(ano, 0, 1).toISOString(), ate: new Date(ano, 11, 31, 23, 59, 59, 999).toISOString() };
}
function segundaDaSemana(d) {
  const dia = d.getDay();
  const seg = new Date(d);
  seg.setDate(d.getDate() + ((dia === 0 ? -6 : 1) - dia));
  seg.setHours(0, 0, 0, 0);
  return seg;
}
function periodoSemana(ref) {
  const seg = segundaDaSemana(ref);
  const dom = new Date(seg);
  dom.setDate(seg.getDate() + 6);
  dom.setHours(23, 59, 59, 999);
  return { desde: seg.toISOString(), ate: dom.toISOString() };
}

const PRESETS = {
  'hoje': { rotulo: 'Hoje', calcular: () => periodoDia(new Date()) },
  'semana-atual': { rotulo: 'Semana atual', calcular: () => periodoSemana(new Date()) },
  'semana-anterior': { rotulo: 'Semana anterior', calcular: () => periodoSemana(new Date(Date.now() - 7 * 86400000)) },
  'mes-atual': { rotulo: 'Mês atual', calcular: () => { const a = new Date(); return periodoMes(a.getFullYear(), a.getMonth()); } },
  'mes-anterior': { rotulo: 'Mês anterior', calcular: () => { const a = new Date(); const m = a.getMonth() - 1; return m < 0 ? periodoMes(a.getFullYear() - 1, 11) : periodoMes(a.getFullYear(), m); } },
  'trimestre-atual': { rotulo: 'Trimestre atual', calcular: () => { const a = new Date(); const i = Math.floor(a.getMonth() / 3) * 3; return { desde: new Date(a.getFullYear(), i, 1).toISOString(), ate: new Date(a.getFullYear(), i + 3, 0, 23, 59, 59, 999).toISOString() }; } },
  'semestre-atual': { rotulo: 'Semestre atual', calcular: () => { const a = new Date(); const i = a.getMonth() < 6 ? 0 : 6; return { desde: new Date(a.getFullYear(), i, 1).toISOString(), ate: new Date(a.getFullYear(), i + 6, 0, 23, 59, 59, 999).toISOString() }; } },
  'ano-atual': { rotulo: 'Ano atual', calcular: () => periodoAno(new Date().getFullYear()) }
};

function formatarBucket(bucket, granularidade) {
  if (!bucket) return '';
  const p = String(bucket).split('-');
  if (granularidade === 'mes') return NOMES_MES[Number(p[1]) - 1] + '/' + p[0].slice(2);
  return p[2] + '/' + p[1];
}

// =============================================================================
// Tooltip / toast
// =============================================================================
function mostrarTip(html, evento) {
  const tip = $('vg-tip');
  tip.hidden = false;
  tip.innerHTML = html;
  posicionarTip(evento);
  requestAnimationFrame(() => tip.classList.add('is-visivel'));
}
function posicionarTip(evento) {
  const tip = $('vg-tip');
  const caixa = tip.getBoundingClientRect();
  let x = evento.clientX + 14;
  let y = evento.clientY - caixa.height - 12;
  if (x + caixa.width > window.innerWidth - 8) x = evento.clientX - caixa.width - 14;
  if (y < 8) y = evento.clientY + 18;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = y + 'px';
}
function esconderTip() {
  const tip = $('vg-tip');
  tip.classList.remove('is-visivel');
  tip.hidden = true;
}

let toastTimer = null;
function mostrarToast(msg) {
  const el = $('vg-toast');
  el.hidden = false;
  el.innerHTML = '<span class="vg-toast__ponto"></span><span>' + escapeHtml(msg) + '</span>';
  requestAnimationFrame(() => el.classList.add('is-visivel'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-visivel');
    setTimeout(() => { el.hidden = true; }, 250);
  }, 5000);
}

// =============================================================================
// Estados
// =============================================================================
function blocoVazio(titulo, texto) {
  return `<div class="vg-estado">
    <span class="vg-estado__icone" aria-hidden="true">—</span>
    <p class="vg-estado__titulo">${escapeHtml(titulo)}</p>
    <p class="vg-estado__texto">${escapeHtml(texto || '')}</p>
  </div>`;
}
function blocoErro(texto, comCard) {
  return `<div class="vg-estado vg-estado--erro${comCard ? ' vg-estado--card' : ''}">
    <span class="vg-estado__icone" aria-hidden="true">!</span>
    <p class="vg-estado__titulo">Não foi possível carregar os dados</p>
    <p class="vg-estado__texto">${escapeHtml(texto || 'Tente novamente em alguns instantes.')}</p>
    <button class="ae-btn" type="button" data-acao="recarregar">↻ Tentar de novo</button>
  </div>`;
}
function skeletonKpis(q) {
  let h = '';
  for (let i = 0; i < q; i++) h += '<div class="vg-kpi"><div class="vg-skel vg-skel--rotulo"></div><div class="vg-skel vg-skel--valor"></div></div>';
  return h;
}
function skeletonGraficos(q) {
  let h = '';
  for (let i = 0; i < q; i++) h += `<div class="vg-card${i === 0 ? ' vg-card--largo' : ''}"><div class="vg-skel vg-skel--titulo"></div><div class="vg-skel vg-skel--plot"></div></div>`;
  return h;
}
function pintarCarregandoMetricas() {
  const secao = estado.secao === 'qualidade' ? 'qualidade' : 'visao';
  $('kpis-' + secao).innerHTML = skeletonKpis(secao === 'visao' ? 5 : 3);
  $('graficos-' + secao).innerHTML = skeletonGraficos(3);
}

// =============================================================================
// KPI
// =============================================================================
function cardKpi({ rotulo, valor, apoio, tag, alerta, medidorPct, sinal }) {
  const tagEl = tag ? `<span class="vg-kpi__tag">${escapeHtml(tag)}</span>` : '';
  const medidor = medidorPct != null ? `<span class="vg-kpi__medidor"><i style="width:${Math.max(0, Math.min(100, medidorPct))}%"></i></span>` : '';
  const apoioEl = apoio ? `<span class="vg-kpi__apoio">${escapeHtml(apoio)}</span>` : '';
  const miolo = `<div class="vg-kpi__topo">
      <span class="vg-kpi__rotulo" title="${escapeHtml(rotulo)}">${escapeHtml(rotulo)}</span>${tagEl}
    </div>
    <span class="vg-kpi__valor">${valor}</span>${medidor}${apoioEl}`;

  if (sinal) {
    return `<button class="vg-kpi${alerta ? ' vg-kpi--alerta' : ''}" type="button" data-sinal="${sinal}">
      ${miolo}<span class="vg-kpi__ir">ver atendimentos →</span></button>`;
  }
  return `<div class="vg-kpi${alerta ? ' vg-kpi--alerta' : ''}">${miolo}</div>`;
}

// =============================================================================
// Gráficos
// =============================================================================
function ticksEixo(max) {
  const passos = 4;
  const bruto = max / passos;
  const magnitude = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
  const passo = Math.max(1, Math.ceil(bruto / magnitude) * magnitude);
  const ticks = [];
  for (let v = 0; v <= passo * passos; v += passo) ticks.push(v);
  return { ticks, topo: passo * passos };
}

function graficoBarras(container, dados, series, granularidade, opcoes) {
  const el = typeof container === 'string' ? $(container) : container;
  if (!el) return;
  const cfg = opcoes || {};
  if (!dados || !dados.length) {
    el.innerHTML = blocoVazio('Sem dados nesse período', 'Amplie o período ou revise os filtros.');
    return;
  }
  const totais = dados.map(d => series.reduce((acc, s) => acc + num(d[s.chave]), 0));
  const { ticks, topo } = ticksEixo(Math.max(...totais, 1));

  const legenda = series.map(s => {
    const soma = dados.reduce((acc, d) => acc + num(d[s.chave]), 0);
    return `<span class="vg-legenda__item"><span class="vg-legenda__cor" style="background:${s.cor}"></span>${escapeHtml(s.rotulo)} <b>${nf.format(soma)}</b></span>`;
  }).join('') + (cfg.taxaRotulo ? `<span class="vg-legenda__item">${escapeHtml(cfg.taxaRotulo)} <b>${nf1.format(cfg.taxaValor)}%</b></span>` : '');

  const linhas = ticks.map(v => `<div class="vg-plot__linha${v === 0 ? ' vg-plot__linha--base' : ''}" style="bottom:${pct(v, topo)}%">
      <span class="vg-plot__tick">${nf.format(v)}</span></div>`).join('');

  const trilhas = dados.map((d, i) => {
    const total = totais[i];
    const segs = series.map(s => {
      const valor = num(d[s.chave]);
      if (!valor || !total) return '';
      return `<span class="vg-coluna__seg" style="height:${pct(valor, total)}%;background:${s.cor}"></span>`;
    }).join('');
    return `<div class="vg-trilha" data-i="${i}">
      <span class="vg-trilha__total">${total ? nf.format(total) : ''}</span>
      <span class="vg-coluna" style="height:${pct(total, topo)}%">${segs}</span>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="vg-legenda">${legenda}</div>
    <div class="vg-plot"><div class="vg-plot__area">${linhas}<div class="vg-trilhas">${trilhas}</div></div></div>
    <div class="vg-xrow">${dados.map(d => `<span class="vg-xlab">${escapeHtml(formatarBucket(d.bucket, granularidade))}</span>`).join('')}</div>`;

  el.querySelectorAll('.vg-trilha').forEach(trilha => {
    const i = Number(trilha.dataset.i);
    const d = dados[i];
    const conteudo = () => {
      const linhasTip = series.filter(s => num(d[s.chave]) > 0).map(s =>
        `<span class="vg-tip__linha"><span class="vg-tip__ponto" style="background:${s.cor}"></span><span>${escapeHtml(s.rotulo)}</span><b>${nf.format(num(d[s.chave]))}</b></span>`
      ).join('');
      const taxa = cfg.taxaBucket
        ? `<div class="vg-tip__total"><span>${escapeHtml(cfg.taxaRotulo || 'Taxa')}</span><b>${nf1.format(cfg.taxaBucket(d))}%</b></div>`
        : '';
      return `<div class="vg-tip__titulo">${escapeHtml(formatarBucket(d.bucket, granularidade))}</div>
        ${linhasTip || '<span class="vg-tip__linha"><span></span><span>Sem registros</span><b>0</b></span>'}
        <div class="vg-tip__total"><span>Total</span><b>${nf.format(totais[i])}</b></div>${taxa}`;
    };
    trilha.addEventListener('mouseenter', (e) => mostrarTip(conteudo(), e));
    trilha.addEventListener('mousemove', posicionarTip);
    trilha.addEventListener('mouseleave', esconderTip);
  });
}

function graficoComposicao(container, partes, opcoes) {
  const el = typeof container === 'string' ? $(container) : container;
  if (!el) return;
  const total = partes.reduce((acc, p) => acc + num(p.valor), 0);
  if (!total) {
    el.innerHTML = blocoVazio('Sem dados nesse período', 'Amplie o período ou revise os filtros.');
    return;
  }
  const segs = partes.filter(p => num(p.valor) > 0).map(p =>
    `<span class="vg-comp__seg" style="width:${pct(num(p.valor), total)}%;background:${p.cor}" title="${escapeHtml(p.rotulo)}: ${nf.format(num(p.valor))}"></span>`
  ).join('');
  const linhas = partes.map(p =>
    `<span class="vg-comp__linha">
      <span class="vg-comp__ponto" style="background:${p.cor}"></span>
      <span class="vg-comp__nome">${escapeHtml(p.rotulo)}</span>
      <span class="vg-comp__valor">${nf.format(num(p.valor))}</span>
      <span class="vg-comp__pct">${nf1.format(pct(num(p.valor), total))}%</span>
    </span>`).join('');
  el.innerHTML = `<div class="vg-comp">${segs}</div><div class="vg-comp__legenda">${linhas}</div>
    ${(opcoes && opcoes.rodape) ? `<p class="vg-card__apoio" style="margin-top:12px">${escapeHtml(opcoes.rodape)}</p>` : ''}`;
}

function graficoBarrasH(container, dados, campoRotulo, campoValor, opcoes) {
  const el = typeof container === 'string' ? $(container) : container;
  if (!el) return;
  const cfg = opcoes || {};
  if (!dados || !dados.length) {
    el.innerHTML = blocoVazio('Sem dados nesse período', 'Amplie o período ou revise os filtros.');
    return;
  }
  const itens = dados.slice().sort((a, b) => num(b[campoValor]) - num(a[campoValor]));
  const max = Math.max(...itens.map(d => num(d[campoValor])), 1);
  const soma = itens.reduce((acc, d) => acc + num(d[campoValor]), 0);
  el.innerHTML = '<div class="vg-barras">' + itens.map(d => {
    const valor = num(d[campoValor]);
    const rotulo = String(d[campoRotulo] == null ? '—' : d[campoRotulo]);
    const parte = cfg.semParticipacao ? '' : ` <span class="vg-comp__pct">${nf1.format(pct(valor, soma))}%</span>`;
    return `<div class="vg-barras__linha">
      <span class="vg-barras__rotulo" title="${escapeHtml(rotulo)}">${escapeHtml(rotulo)}</span>
      <span class="vg-barras__trilha"><i class="vg-barras__preenchido" style="width:${pct(valor, max)}%;${cfg.cor ? 'background:' + cfg.cor : ''}"></i></span>
      <span class="vg-barras__valor">${cfg.formatador ? cfg.formatador(valor) : nf.format(valor)}${parte}</span>
    </div>`;
  }).join('') + '</div>';
}

function cardGrafico(id, titulo, apoio, largo, nota) {
  return `<div class="vg-card${largo ? ' vg-card--largo' : ''}">
    <div class="vg-card__cabecalho">
      <div>
        <h2 class="vg-card__titulo">${escapeHtml(titulo)}</h2>
        ${apoio ? `<p class="vg-card__apoio">${escapeHtml(apoio)}</p>` : ''}
      </div>
      ${nota ? `<span class="vg-card__nota">${escapeHtml(nota)}</span>` : ''}
    </div>
    <div id="${id}"></div>
  </div>`;
}

function notaGranularidade(dados) { return dados.granularidade === 'mes' ? 'por mês' : 'por dia'; }

// =============================================================================
// Visão geral por IA supervisora
// =============================================================================
const KPI_ALERTAS = (k) => [
  cardKpi({
    rotulo: 'Janela oficial encerrando',
    valor: nf.format(num(k.janela_2h_agora)),
    tag: 'agora',
    alerta: num(k.janela_2h_agora) > 0,
    apoio: 'faltam 2h ou menos para o fim da janela da API oficial',
    sinal: 'janela_2h'
  }),
  cardKpi({
    rotulo: 'Sem resposta > 1h',
    valor: nf.format(num(k.sem_resposta_60min_agora)),
    tag: 'agora',
    alerta: num(k.sem_resposta_60min_agora) > 0,
    apoio: 'cliente aguardando resposta, independe do período',
    sinal: 'sem_resposta_60min'
  })
];

function pintarVisaoSdr(dados) {
  const k = dados.kpis || {};
  $('kpis-visao').innerHTML = [
    cardKpi({ rotulo: 'Qualificações', valor: nf.format(num(k.qualificacoes)), apoio: 'leads qualificados no período' }),
    cardKpi({
      rotulo: 'Taxa de qualificação',
      valor: nf1.format(num(k.taxa_qualificacao_pct)) + '%',
      medidorPct: num(k.taxa_qualificacao_pct),
      apoio: nf.format(num(k.qualificacoes)) + ' de ' + nf.format(num(k.total_atendimentos)) + ' atendimentos'
    }),
    cardKpi({ rotulo: 'Atendimentos', valor: nf.format(num(k.total_atendimentos)), apoio: 'conversas iniciadas no período' }),
    cardKpi({ rotulo: 'Desqualificados', valor: nf.format(num(k.desqualificados)), apoio: 'motivos no gráfico abaixo' })
  ].concat(KPI_ALERTAS(k)).join('');

  $('graficos-visao').innerHTML =
    cardGrafico('g-serie', 'Qualificações x desqualificações', 'volume por desfecho, com a taxa de qualificação no tooltip', true, notaGranularidade(dados)) +
    cardGrafico('g-composicao', 'Composição do período', 'participação de cada desfecho') +
    cardGrafico('g-motivos', 'Motivos de desqualificação', 'quantidade por motivo') +
    cardGrafico('g-objecoes', 'Objeções identificadas', 'menções nas conversas do período', true);

  graficoBarras('g-serie', dados.serie, [
    { chave: 'qualificados', rotulo: 'Qualificados', cor: 'var(--ae-serie-2)' },
    { chave: 'desqualificados', rotulo: 'Desqualificados', cor: 'var(--ae-serie-1)' }
  ], dados.granularidade, {
    taxaRotulo: 'Taxa de qualificação',
    taxaValor: num(k.taxa_qualificacao_pct),
    taxaBucket: (d) => pct(num(d.qualificados), num(d.qualificados) + num(d.desqualificados))
  });

  graficoComposicao('g-composicao', [
    { rotulo: 'Qualificados', valor: num(k.qualificacoes), cor: 'var(--ae-serie-2)' },
    { rotulo: 'Desqualificados', valor: num(k.desqualificados), cor: 'var(--ae-serie-1)' }
  ], { rodape: nf.format(num(k.total_atendimentos)) + ' atendimentos no período' });

  graficoBarrasH('g-motivos', dados.motivos_desqualificacao, 'motivo', 'quantidade', { cor: 'var(--ae-serie-1)' });
  graficoBarrasH('g-objecoes', dados.objecoes, 'objecao', 'quantidade', { cor: 'var(--ae-serie-3)' });
}

function pintarVisaoFechamento(dados) {
  const k = dados.kpis || {};
  $('kpis-visao').innerHTML = [
    cardKpi({ rotulo: 'Contratos fechados', valor: nf.format(num(k.fechamentos)), apoio: 'no período selecionado' }),
    cardKpi({
      rotulo: 'Taxa de fechamento',
      valor: nf1.format(num(k.taxa_fechamento_pct)) + '%',
      medidorPct: num(k.taxa_fechamento_pct),
      apoio: nf.format(num(k.fechamentos)) + ' de ' + nf.format(num(k.qualificacoes)) + ' qualificações'
    }),
    cardKpi({
      rotulo: 'Qualificações',
      valor: nf.format(num(k.qualificacoes)),
      apoio: 'taxa de qualificação ' + nf1.format(num(k.taxa_qualificacao_pct)) + '%',
      medidorPct: num(k.taxa_qualificacao_pct)
    }),
    cardKpi({ rotulo: 'Atendimentos', valor: nf.format(num(k.total_atendimentos)), apoio: 'conversas iniciadas no período' }),
    cardKpi({ rotulo: 'Desqualificados', valor: nf.format(num(k.desqualificados)), apoio: 'motivos no gráfico abaixo' })
  ].concat(KPI_ALERTAS(k)).join('');

  $('graficos-visao').innerHTML =
    cardGrafico('g-serie', 'Fechamentos x qualificações sem contrato', 'volume por desfecho, com a taxa de fechamento no tooltip', true, notaGranularidade(dados)) +
    cardGrafico('g-funil', 'Do atendimento ao contrato', 'funil do período') +
    cardGrafico('g-composicao', 'Composição das qualificações', 'fechado x em aberto') +
    cardGrafico('g-objecoes', 'Objeções identificadas', 'o que travou o fechamento') +
    cardGrafico('g-motivos', 'Motivos de desqualificação', 'quantidade por motivo');

  graficoBarras('g-serie', dados.serie, [
    { chave: 'fechados', rotulo: 'Contratos fechados', cor: 'var(--ae-serie-2)' },
    { chave: 'nao_fechados', rotulo: 'Qualificados sem contrato', cor: 'var(--ae-serie-1)' }
  ], dados.granularidade, {
    taxaRotulo: 'Taxa de fechamento',
    taxaValor: num(k.taxa_fechamento_pct),
    taxaBucket: (d) => pct(num(d.fechados), num(d.qualificados))
  });

  graficoBarrasH('g-funil', [
    { etapa: 'Atendimentos', quantidade: num(k.total_atendimentos) },
    { etapa: 'Qualificações', quantidade: num(k.qualificacoes) },
    { etapa: 'Contratos fechados', quantidade: num(k.fechamentos) }
  ], 'etapa', 'quantidade', { cor: 'var(--ae-serie-4)', semParticipacao: true });

  graficoComposicao('g-composicao', [
    { rotulo: 'Com contrato fechado', valor: num(k.fechamentos), cor: 'var(--ae-serie-2)' },
    { rotulo: 'Qualificados sem contrato', valor: Math.max(0, num(k.qualificacoes) - num(k.fechamentos)), cor: 'var(--ae-serie-1)' }
  ], { rodape: nf.format(num(k.qualificacoes)) + ' qualificações no período' });

  graficoBarrasH('g-objecoes', dados.objecoes, 'objecao', 'quantidade', { cor: 'var(--ae-serie-3)' });
  graficoBarrasH('g-motivos', dados.motivos_desqualificacao, 'motivo', 'quantidade', { cor: 'var(--ae-serie-1)' });
}

function pintarVisaoSucesso(dados) {
  const k = dados.kpis || {};
  $('kpis-visao').innerHTML = [
    cardKpi({ rotulo: 'Atendimentos realizados', valor: nf.format(num(k.total_atendimentos)), apoio: 'no período selecionado' }),
    cardKpi({
      rotulo: 'Taxa de resolução',
      valor: nf1.format(num(k.taxa_resolucao_pct)) + '%',
      medidorPct: num(k.taxa_resolucao_pct),
      apoio: nf.format(num(k.resolvidos)) + ' resolvidos sem humano'
    }),
    cardKpi({
      rotulo: 'Transferidos e não atendidos',
      valor: nf.format(num(k.transferidos_sem_atendimento)),
      alerta: num(k.transferidos_sem_atendimento) > 0,
      apoio: 'colaborador humano não assumiu'
    }),
    cardKpi({
      rotulo: 'Clientes insatisfeitos',
      valor: nf.format(num(k.clientes_insatisfeitos)),
      alerta: num(k.clientes_insatisfeitos) > 0,
      apoio: 'insatisfação detectada pelo Vigia'
    }),
    cardKpi({
      rotulo: 'Falhas da IA',
      valor: nf.format(num(k.falhas_ia)),
      alerta: num(k.falhas_ia) > 0,
      apoio: 'atendimentos com falha crítica',
      sinal: 'falha_ia'
    })
  ].concat(KPI_ALERTAS(k)).join('');

  $('graficos-visao').innerHTML =
    cardGrafico('g-serie', 'Resolvidos pela IA x transferidos', 'volume por desfecho, com a taxa de resolução no tooltip', true, notaGranularidade(dados)) +
    cardGrafico('g-composicao', 'Composição das resoluções', 'participação de cada desfecho') +
    cardGrafico('g-tipos', 'Tipos de atendimento', 'andamento processual, dúvidas gerais e golpe do falso advogado') +
    cardGrafico('g-transferencia', 'Motivos de transferência', 'quantidade por motivo', true);

  graficoBarras('g-serie', dados.serie, [
    { chave: 'resolvidos', rotulo: 'Resolvidos pela IA', cor: 'var(--ae-serie-2)' },
    { chave: 'transferidos', rotulo: 'Transferidos', cor: 'var(--ae-serie-1)' }
  ], dados.granularidade, {
    taxaRotulo: 'Taxa de resolução',
    taxaValor: num(k.taxa_resolucao_pct),
    taxaBucket: (d) => pct(num(d.resolvidos), num(d.atendimentos))
  });

  graficoComposicao('g-composicao', [
    { rotulo: 'Resolvido só pela IA', valor: num(k.resolvidos), cor: 'var(--ae-serie-2)' },
    { rotulo: 'Transferido para humano', valor: num(k.transferidos), cor: 'var(--ae-serie-1)' }
  ], { rodape: nf.format(num(k.total_atendimentos)) + ' atendimentos no período' });

  graficoBarrasH('g-tipos', dados.tipos_atendimento, 'tipo', 'quantidade', { cor: 'var(--ae-serie-4)' });
  graficoBarrasH('g-transferencia', dados.motivos_transferencia, 'motivo', 'quantidade', { cor: 'var(--ae-serie-3)' });
}

// =============================================================================
// Qualidade da IA
// =============================================================================
const CORES_FAIXA = ['var(--ae-serie-7)', 'var(--ae-serie-1)', 'var(--ae-serie-3)', 'var(--ae-serie-2)', 'var(--ae-serie-5)'];

function pintarQualidade(dados) {
  const k = dados.kpis || {};
  const faixas = (dados.distribuicao_score_faixas || []).map((f, i) => ({ chave: f.chave, rotulo: f.rotulo, cor: CORES_FAIXA[i % CORES_FAIXA.length] }));

  $('kpis-qualidade').innerHTML = [
    cardKpi({
      rotulo: 'Efetividade média da IA',
      valor: k.efetividade_media_pct != null ? nf.format(num(k.efetividade_media_pct)) + '%' : '—',
      apoio: 'score do Vigia no período',
      medidorPct: num(k.efetividade_media_pct)
    }),
    cardKpi({ rotulo: 'Atendimentos avaliados', valor: nf.format(num(k.avaliados)), apoio: 'com score do Vigia no período' }),
    cardKpi({
      rotulo: 'Com falha crítica',
      valor: nf.format(num(k.com_falha_critica)),
      alerta: num(k.com_falha_critica) > 0,
      apoio: num(k.avaliados) ? nf1.format(pct(num(k.com_falha_critica), num(k.avaliados))) + '% dos avaliados' : '—',
      sinal: 'falha_ia'
    })
  ].join('');

  $('graficos-qualidade').innerHTML =
    cardGrafico('q-distribuicao', 'Distribuição do score de efetividade', 'atendimentos por faixa de nota, ao longo do tempo', true, notaGranularidade(dados)) +
    cardGrafico('q-criterios', 'Critérios avaliados', 'média por critério') +
    cardGrafico('q-falha', 'Motivo de falha crítica', 'quantidade por motivo');

  graficoBarras('q-distribuicao', dados.distribuicao_score_serie, faixas, dados.granularidade);
  graficoBarrasH('q-criterios', dados.criterios, 'criterio', 'media', { formatador: v => nf1.format(v), semParticipacao: true, cor: 'var(--ae-serie-2)' });
  graficoBarrasH('q-falha', dados.falha_critica, 'motivo', 'quantidade', { cor: 'var(--ae-serie-7)' });
}

// =============================================================================
// Atendimentos (auditoria)
// =============================================================================
const LARGURAS_COLUNA = {
  'Cliente': 16, 'Responsável': 10, 'Tipo': 8, 'Criado em': 9, 'Concluído em': 9,
  'Status': 8, 'Score': 6, 'Avaliação do Vigia': 28, 'Sinais': 6, 'Feedbacks (Laila)': 10
};

function pintarColgroup() {
  $('tabela-colgroup').innerHTML = colunas()
    .map((nome) => `<col style="width:${LARGURAS_COLUNA[nome] || 10}%">`)
    .join('');
}

function colunas() {
  const base = ['Cliente', 'Responsável'];
  if (estado.departamento === 'sucesso_cliente') base.push('Tipo');
  base.push('Criado em');
  if (estado.departamento === 'sucesso_cliente') base.push('Concluído em');
  base.push('Status', 'Score', 'Avaliação do Vigia', 'Sinais');
  if (podeDarFeedback()) base.push('Feedbacks (Laila)');
  return base;
}

function pintarChipsAuditoria(contadores) {
  const chips = CHIPS_AUDITORIA.filter(c => !c.soSucesso || podeDarFeedback());
  $('chips-auditoria').innerHTML = chips.map(c => {
    const qtd = contadores && contadores[c.chave] != null ? `<span class="ae-chip__cont">${nf.format(contadores[c.chave])}</span>` : '';
    return `<button class="ae-chip${estado.sinais[c.chave] ? ' is-ativo' : ''}" type="button" data-sinal="${c.chave}">${escapeHtml(c.rotulo)}${qtd}</button>`;
  }).join('');
}

function skeletonTabela() {
  const total = colunas().length;
  pintarColgroup();
  $('tabela-cabecalho').innerHTML = '<tr>' + colunas().map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr>';
  let html = '';
  for (let i = 0; i < 6; i++) {
    html += '<tr>' + Array.from({ length: total }, () => '<td><div class="vg-skel" style="height:13px"></div></td>').join('') + '</tr>';
  }
  $('tabela-corpo').innerHTML = html;
  $('tabela-meta').textContent = 'Carregando…';
  $('paginacao').innerHTML = '';
}

function badgeStatus(status) {
  const mapa = {
    qualificado: ['ae-badge--ok', 'Qualificado'],
    fechado: ['ae-badge--ok', 'Contrato fechado'],
    desqualificado: ['ae-badge--erro', 'Desqualificado'],
    resolvido: ['ae-badge--ok', 'Resolvido pela IA'],
    transferido: ['ae-badge--info', 'Transferido'],
    transferido_sem_atendimento: ['ae-badge--erro', 'Transferido e não atendido'],
    em_andamento: ['ae-badge--alerta', 'Em andamento']
  };
  const b = mapa[status];
  return b ? `<span class="ae-badge ${b[0]}">${b[1]}</span>` : '<span class="vg-vazio-celula">—</span>';
}

function celulaScore(item) {
  if (item.score_efetividade == null) return '<span class="vg-vazio-celula">—</span>';
  const v = num(item.score_efetividade);
  return `<span class="vg-score"><span class="vg-score__valor">${nf.format(v)}</span>
    <span class="vg-score__medidor"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span></span>`;
}

function celulaSinais(item) {
  const chips = [];
  if (item.falha_critica) chips.push(`<span class="ae-badge ae-badge--erro">${escapeHtml(item.falha_critica)}</span>`);
  if (item.sem_resposta_60min) chips.push('<span class="ae-badge ae-badge--alerta">+1h sem resposta</span>');
  if (item.janela_2h) chips.push('<span class="ae-badge ae-badge--alerta">janela ≤2h</span>');
  if (item.insatisfacao) chips.push('<span class="ae-badge ae-badge--erro">insatisfeito</span>');
  return chips.length ? '<div class="vg-sinais">' + chips.join('') + '</div>' : '<span class="vg-vazio-celula">—</span>';
}

function celulaFeedback(item) {
  const total = num(item.feedbacks && item.feedbacks.total);
  const ultimo = item.feedbacks && item.feedbacks.ultimo;
  const texto = total ? total + ' feedback' + (total > 1 ? 's' : '') : 'Sem feedback';
  return `<button class="vg-fb${total ? '' : ' vg-fb--vazio'}" type="button" data-sessao="${escapeHtml(item.session_id)}" data-cliente="${escapeHtml(item.contact_name || '')}">${texto}</button>
    ${ultimo ? `<span class="vg-fb__ultimo">último: ${escapeHtml(String(ultimo.texto).slice(0, 68))}${String(ultimo.texto).length > 68 ? '…' : ''}</span>` : ''}`;
}

function renderizarTabela(dados) {
  pintarChipsAuditoria(dados.contadores);
  const cols = colunas();
  pintarColgroup();
  $('tabela-cabecalho').innerHTML = '<tr>' + cols.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr>';
  $('tabela-meta').textContent = num(dados.total) ? nf.format(num(dados.total)) + ' no filtro atual' : '';

  if (!dados.itens || !dados.itens.length) {
    $('tabela-corpo').innerHTML = `<tr><td colspan="${cols.length}">${blocoVazio('Nenhum atendimento encontrado', 'Nenhum atendimento nesse período com esses filtros. Amplie o período ou remova um sinal.')}</td></tr>`;
    renderizarPaginacao(dados);
    return;
  }

  $('tabela-corpo').innerHTML = dados.itens.map(item => {
    const nome = escapeHtml(item.contact_name || 'Não informado');
    const cliente = item.chat_id
      ? `<a class="vg-cliente__nome" title="Abrir a conversa no Bitrix24" href="${CHAT_BASE}${encodeURIComponent(item.chat_id)}" target="_blank" rel="noopener">${nome}</a>`
      : `<span class="vg-cliente__nome">${nome}</span>`;
    let tr = `<td><span class="vg-cliente">${cliente}<span class="vg-cliente__meta">${escapeHtml(item.session_id || '')}</span></span></td>
      <td>${escapeHtml(item.responsavel || '—')}</td>`;
    if (estado.departamento === 'sucesso_cliente') tr += `<td>${escapeHtml(item.tipo_atendimento || '—')}</td>`;
    tr += `<td>${item.started_at ? df.format(new Date(item.started_at)) : '<span class="vg-vazio-celula">—</span>'}</td>`;
    if (estado.departamento === 'sucesso_cliente') {
      tr += `<td>${item.finished_at ? df.format(new Date(item.finished_at)) : '<span class="vg-vazio-celula">em andamento</span>'}</td>`;
    }
    tr += `<td>${badgeStatus(item.status)}${item.motivo_transferencia ? `<span class="vg-cliente__meta">${escapeHtml(item.motivo_transferencia)}</span>` : ''}${item.motivo_desqualificacao ? `<span class="vg-cliente__meta">${escapeHtml(item.motivo_desqualificacao)}</span>` : ''}</td>
      <td class="vg-tabela__num">${celulaScore(item)}</td>
      <td>${item.justificativa_avaliacao ? `<span class="vg-avaliacao" title="Clique para expandir">${escapeHtml(item.justificativa_avaliacao)}</span>` : '<span class="vg-vazio-celula">—</span>'}</td>
      <td>${celulaSinais(item)}</td>`;
    if (podeDarFeedback()) tr += `<td>${celulaFeedback(item)}</td>`;
    return '<tr>' + tr + '</tr>';
  }).join('');

  renderizarPaginacao(dados);
}

function renderizarPaginacao(dados) {
  const total = num(dados.total);
  const totalPaginas = Math.max(1, Math.ceil(total / estado.limite));
  const inicio = total ? (estado.pagina - 1) * estado.limite + 1 : 0;
  const fim = Math.min(total, estado.pagina * estado.limite);
  $('paginacao').innerHTML = `
    <span class="vg-paginacao__info">${total ? nf.format(inicio) + '–' + nf.format(fim) + ' de ' + nf.format(total) : 'Nenhum resultado'}</span>
    <span class="vg-paginacao__nav">
      <span class="vg-paginacao__info">Página ${estado.pagina} de ${totalPaginas}</span>
      <button class="ae-btn" id="pg-anterior" type="button" ${estado.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
      <button class="ae-btn" id="pg-proxima" type="button" ${estado.pagina >= totalPaginas ? 'disabled' : ''}>Próxima ›</button>
    </span>`;
  const a = $('pg-anterior'), p = $('pg-proxima');
  if (a) a.addEventListener('click', () => { estado.pagina--; carregarAtendimentos(); });
  if (p) p.addEventListener('click', () => { estado.pagina++; carregarAtendimentos(); });
}

// =============================================================================
// API + modo demonstração
// =============================================================================
function ativarDemo(motivo) {
  if (!estado.demo) {
    estado.demo = true;
    $('aviso-demo').hidden = false;
    if (motivo) $('aviso-demo-texto').textContent = motivo;
  }
}

function parametrosFiltro() {
  return {
    departamento: estado.departamento,
    agente: estado.agente,
    periodos: JSON.stringify(estado.periodos),
    status: estado.status,
    avaliado: estado.avaliado,
    base_data: estado.baseData,
    scope_token: (estado.permissoes && estado.permissoes.scope_token) || '',
    ...(estado.colaborador ? { colaborador: estado.colaborador } : {})
  };
}

function sinaisAtivos() {
  const out = {};
  Object.keys(estado.sinais).forEach(k => { if (estado.sinais[k]) out[k] = '1'; });
  return out;
}

async function chamarApi(path, params) {
  const query = new URLSearchParams({ ...params, api_key: API_KEY }).toString();
  const resposta = await fetch(API_BASE.replace(/\/$/, '') + '/' + path + '?' + query, { method: 'GET' });
  if (resposta.status === 403) throw new Error('sem permissão para este departamento');
  if (!resposta.ok) throw new Error('Falha na API (' + resposta.status + ')');
  return resposta.json();
}

async function carregarMetricas(forcar) {
  if (estado.dados && !forcar) { pintarMetricas(); return; }
  pintarCarregandoMetricas();
  marcarCarregando(true);
  try {
    estado.dados = estado.demo
      ? window.VigiaDemo.metricas(estado.agente, estado.periodos)
      : await chamarApi('painel-vigia-engel-metricas', parametrosFiltro());
    pintarMetricas();
    marcarAtualizado();
  } catch (e) {
    ativarDemo('A API do Vigia não respondeu (' + e.message + '), então o painel exibe um conjunto de exemplo. Nenhum número aqui é dado real da operação.');
    try {
      estado.dados = window.VigiaDemo.metricas(estado.agente, estado.periodos);
      pintarMetricas();
      marcarAtualizado();
    } catch (e2) {
      const secao = estado.secao === 'qualidade' ? 'qualidade' : 'visao';
      $('kpis-' + secao).innerHTML = '';
      $('graficos-' + secao).innerHTML = `<div class="vg-card vg-card--largo">${blocoErro(e.message)}</div>`;
      mostrarToast('Erro ao carregar as métricas: ' + e.message);
    }
  }
  marcarCarregando(false);
}

function pintarMetricas() {
  const dados = estado.dados;
  if (!dados) return;
  if (estado.secao === 'qualidade') pintarQualidade(dados);
  else if (estado.agente === 'sdr') pintarVisaoSdr(dados);
  else if (estado.agente === 'fechamento') pintarVisaoFechamento(dados);
  else pintarVisaoSucesso(dados);
  if (window.BX24 && BX24.fitWindow) BX24.fitWindow();
}

async function carregarAtendimentos() {
  skeletonTabela();
  marcarCarregando(true);
  const params = { ...parametrosFiltro(), ...sinaisAtivos(), limite: estado.limite, pagina: estado.pagina };
  try {
    estado.lista = estado.demo
      ? window.VigiaDemo.atendimentos(estado.agente, { ...params, colaborador: estado.colaborador, base_data: estado.baseData })
      : await chamarApi('painel-vigia-engel-atendimentos', params);
    renderizarTabela(estado.lista);
    marcarAtualizado();
  } catch (e) {
    ativarDemo('A API do Vigia não respondeu (' + e.message + '), então o painel exibe um conjunto de exemplo. Nenhum número aqui é dado real da operação.');
    try {
      estado.lista = window.VigiaDemo.atendimentos(estado.agente, { ...params, colaborador: estado.colaborador, base_data: estado.baseData });
      renderizarTabela(estado.lista);
    } catch (e2) {
      $('tabela-meta').textContent = '';
      $('tabela-corpo').innerHTML = `<tr><td colspan="${colunas().length}">${blocoErro(e.message)}</td></tr>`;
      $('paginacao').innerHTML = '';
      mostrarToast('Erro ao carregar os atendimentos: ' + e.message);
    }
  }
  marcarCarregando(false);
  if (window.BX24 && BX24.fitWindow) BX24.fitWindow();
}

// =============================================================================
// Feedbacks da Laila — histórico append-only
// =============================================================================
function totalFeedbacks(sessionId) {
  const item = ((estado.lista && estado.lista.itens) || []).find(a => a.session_id === sessionId);
  return item && item.feedbacks ? num(item.feedbacks.total) : 0;
}

async function abrirDrawer(sessionId, cliente) {
  estado.sessaoDrawer = sessionId;
  $('drawer-fundo').hidden = false;
  $('drawer-titulo').textContent = 'Feedbacks — ' + (cliente || sessionId);
  $('drawer-status').textContent = '';
  $('drawer-status').className = 'vg-status';
  $('drawer-texto').value = '';
  $('drawer-corpo').innerHTML = '<div class="vg-skel" style="height:70px"></div>';
  try {
    const dados = estado.demo
      ? window.VigiaDemo.feedbacks(sessionId, totalFeedbacks(sessionId))
      : await chamarApi('painel-vigia-engel-feedbacks', { session_id: sessionId, departamento: estado.departamento, scope_token: (estado.permissoes && estado.permissoes.scope_token) || '' });
    renderThread(dados.itens || []);
  } catch (e) {
    renderThread(window.VigiaDemo.feedbacks(sessionId, totalFeedbacks(sessionId)).itens);
  }
}

function renderThread(itens) {
  if (!itens.length) {
    $('drawer-corpo').innerHTML = blocoVazio('Nenhum feedback ainda', 'Este atendimento não tem feedback registrado.');
    return;
  }
  $('drawer-corpo').innerHTML = itens.map(f => `<article class="vg-msg">
      <div class="vg-msg__topo">
        <span class="vg-msg__autor">${escapeHtml(f.autor || 'Laila Oliveira')}</span>
        <span class="vg-msg__data">${f.criado_em ? df.format(new Date(f.criado_em)) : ''}</span>
      </div>
      <p class="vg-msg__texto">${escapeHtml(f.texto)}</p>
    </article>`).join('');
}

async function enviarFeedback() {
  const texto = ($('drawer-texto').value || '').trim();
  const status = $('drawer-status');
  if (!texto) {
    status.textContent = 'Escreva a mensagem antes de enviar.';
    status.className = 'vg-status vg-status--erro';
    return;
  }
  const botao = $('drawer-enviar');
  botao.disabled = true;
  status.textContent = 'Enviando…';
  status.className = 'vg-status';

  const autor = (estado.permissoes && estado.permissoes.usuario && estado.permissoes.usuario.nome) || 'Laila Oliveira';
  try {
    if (estado.demo) {
      window.VigiaDemo.novoFeedback(estado.sessaoDrawer, texto, autor);
    } else {
      const resposta = await fetch(API_BASE + '/painel-vigia-engel-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: estado.sessaoDrawer,
          departamento: estado.departamento,
          texto, autor,
          scope_token: (estado.permissoes && estado.permissoes.scope_token) || ''
        })
      });
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
    }
    status.textContent = 'Feedback registrado. O histórico anterior foi preservado.';
    status.className = 'vg-status vg-status--ok';
    $('drawer-texto').value = '';
    const dados = estado.demo
      ? window.VigiaDemo.feedbacks(estado.sessaoDrawer, 0)
      : await chamarApi('painel-vigia-engel-feedbacks', { session_id: estado.sessaoDrawer, departamento: estado.departamento, scope_token: (estado.permissoes && estado.permissoes.scope_token) || '' });
    renderThread(dados.itens || []);
    const corpo = $('drawer-corpo');
    corpo.scrollTop = corpo.scrollHeight;
    carregarAtendimentos();
  } catch (e) {
    status.textContent = 'Não foi possível enviar (' + e.message + ').';
    status.className = 'vg-status vg-status--erro';
  }
  botao.disabled = false;
}

function fecharDrawer() { $('drawer-fundo').hidden = true; estado.sessaoDrawer = null; }

// =============================================================================
// Feedback de carregamento
// =============================================================================
function marcarCarregando(ligado) { $('btn-atualizar').classList.toggle('is-carregando', ligado); }
function marcarAtualizado() { $('atualizado').textContent = 'Atualizado às ' + hf.format(new Date()); }

// =============================================================================
// Filtros
// =============================================================================
const ROTULOS_COLABORADOR = { ia: 'Somente IA', colaboradores: 'Somente colaboradores' };

function rotuloStatus(valor) {
  const item = (dep().status || []).find(s => s[0] === valor);
  return item ? item[1] : valor;
}

function atualizarResumoFiltros() {
  const pilulas = [];
  if (estado.colaborador) {
    pilulas.push(`<span class="vg-pilula">Origem: <b>${escapeHtml(ROTULOS_COLABORADOR[estado.colaborador] || estado.colaborador)}</b>
      <button class="vg-pilula__x" type="button" data-limpar="colaborador" aria-label="Remover filtro de origem">×</button></span>`);
  }
  if (estado.departamento === 'sucesso_cliente' && estado.baseData !== 'criacao') {
    pilulas.push(`<span class="vg-pilula">Período por: <b>data de conclusão</b>
      <button class="vg-pilula__x" type="button" data-limpar="base-data" aria-label="Voltar para data de criação">×</button></span>`);
  }
  if (estado.status !== 'todos') {
    pilulas.push(`<span class="vg-pilula">Status: <b>${escapeHtml(rotuloStatus(estado.status))}</b>
      <button class="vg-pilula__x" type="button" data-limpar="status" aria-label="Remover filtro de status">×</button></span>`);
  }
  if (!estado.periodoPreset) {
    pilulas.push(`<span class="vg-pilula">Período: <b>${escapeHtml(estado.periodoRotulo)}</b>
      <button class="vg-pilula__x" type="button" data-limpar="periodo" aria-label="Voltar período para hoje">×</button></span>`);
  }
  Object.keys(estado.sinais).filter(k => estado.sinais[k]).forEach(k => {
    const chip = CHIPS_AUDITORIA.find(c => c.chave === k);
    pilulas.push(`<span class="vg-pilula">Sinal: <b>${escapeHtml(chip ? chip.rotulo : k)}</b>
      <button class="vg-pilula__x" type="button" data-limpar="sinal:${k}" aria-label="Remover sinal">×</button></span>`);
  });

  $('filtros-resumo').innerHTML = pilulas.join('') + (pilulas.length ? '<button class="vg-limpar" type="button" data-limpar="tudo">Limpar filtros</button>' : '');
  $('filtro-colaborador').classList.toggle('is-alterado', !!estado.colaborador);
  $('filtro-status').classList.toggle('is-alterado', estado.status !== 'todos');
  $('filtro-base-data').classList.toggle('is-alterado', estado.baseData !== 'criacao');
  $('btn-periodo').classList.toggle('is-alterado', !estado.periodoPreset);
}

function aplicarPreset(chave, semRecarregar) {
  const preset = PRESETS[chave];
  estado.periodos = [preset.calcular()];
  estado.periodoRotulo = preset.rotulo;
  estado.periodoPreset = chave;
  $('periodo-rotulo').textContent = preset.rotulo;
  document.querySelectorAll('.vg-opcao').forEach(b => b.classList.toggle('is-ativo', b.dataset.preset === chave));
  limparMarcacoesPeriodo();
  if (!semRecarregar) recarregarPorFiltro();
}

function limparMarcacoesPeriodo() {
  document.querySelectorAll('#periodo-popup input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  $('periodo-custom-desde').value = '';
  $('periodo-custom-ate').value = '';
  atualizarContagemPeriodo();
}

function atualizarContagemPeriodo() {
  const marcados = document.querySelectorAll('#periodo-popup input[type="checkbox"]:checked').length;
  const temData = !!($('periodo-custom-desde').value || $('periodo-custom-ate').value);
  const total = marcados + (temData ? 1 : 0);
  $('periodo-contagem').textContent = total ? total + (total === 1 ? ' período marcado' : ' períodos marcados') : 'Nenhum conjunto marcado';
}

function recarregarPorFiltro() {
  estado.dados = null;
  estado.pagina = 1;
  atualizarResumoFiltros();
  atualizarTudo();
}

// =============================================================================
// Popover de período
// =============================================================================
function abrirPopupPeriodo() { $('periodo-popup').hidden = false; $('btn-periodo').setAttribute('aria-expanded', 'true'); }
function fecharPopupPeriodo() { $('periodo-popup').hidden = true; $('btn-periodo').setAttribute('aria-expanded', 'false'); }

function popularListasPeriodo() {
  const agora = new Date();
  const meses = $('lista-meses');
  for (let i = 0; i < 24; i++) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" data-tipo="mes" data-ano="${d.getFullYear()}" data-mes="${d.getMonth()}"> ${NOMES_MES[d.getMonth()]}/${d.getFullYear()}`;
    meses.appendChild(l);
  }
  const semanas = $('lista-semanas');
  for (let i = 0; i < 12; i++) {
    const seg = segundaDaSemana(new Date(Date.now() - i * 7 * 86400000));
    const dom = new Date(seg);
    dom.setDate(seg.getDate() + 6);
    const rotulo = `${String(seg.getDate()).padStart(2, '0')}/${String(seg.getMonth() + 1).padStart(2, '0')} – ${String(dom.getDate()).padStart(2, '0')}/${String(dom.getMonth() + 1).padStart(2, '0')}`;
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" data-tipo="semana" data-inicio="${seg.toISOString()}"> ${rotulo}`;
    semanas.appendChild(l);
  }
  const anos = $('lista-anos');
  for (let i = 0; i < 5; i++) {
    const ano = agora.getFullYear() - i;
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" data-tipo="ano" data-ano="${ano}"> ${ano}`;
    anos.appendChild(l);
  }
}

function ligarPopupPeriodo() {
  popularListasPeriodo();
  $('btn-periodo').addEventListener('click', (e) => {
    e.stopPropagation();
    if ($('periodo-popup').hidden) abrirPopupPeriodo(); else fecharPopupPeriodo();
  });
  $('periodo-popup').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => fecharPopupPeriodo());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fecharPopupPeriodo(); fecharDrawer(); } });
  $('btn-periodo-cancelar').addEventListener('click', fecharPopupPeriodo);
  $('btn-periodo-limpar').addEventListener('click', limparMarcacoesPeriodo);
  $('periodo-popup').addEventListener('change', atualizarContagemPeriodo);

  document.querySelectorAll('.vg-opcao').forEach(botao => {
    botao.addEventListener('click', () => { aplicarPreset(botao.dataset.preset); fecharPopupPeriodo(); });
  });

  $('btn-periodo-aplicar').addEventListener('click', () => {
    const periodos = [];
    document.querySelectorAll('#lista-meses input:checked').forEach(cb => periodos.push(periodoMes(Number(cb.dataset.ano), Number(cb.dataset.mes))));
    document.querySelectorAll('#lista-semanas input:checked').forEach(cb => periodos.push(periodoSemana(new Date(cb.dataset.inicio))));
    document.querySelectorAll('#lista-anos input:checked').forEach(cb => periodos.push(periodoAno(Number(cb.dataset.ano))));
    const desde = $('periodo-custom-desde').value;
    const ate = $('periodo-custom-ate').value;
    if (desde && ate) periodos.push({ desde: new Date(desde + 'T00:00:00').toISOString(), ate: new Date(ate + 'T23:59:59').toISOString() });
    else if (desde) periodos.push(periodoDia(new Date(desde + 'T00:00:00')));
    else if (ate) periodos.push(periodoDia(new Date(ate + 'T00:00:00')));
    if (!periodos.length) { fecharPopupPeriodo(); return; }

    estado.periodos = periodos;
    estado.periodoPreset = null;
    estado.periodoRotulo = periodos.length === 1 ? 'Período personalizado' : periodos.length + ' períodos';
    $('periodo-rotulo').textContent = estado.periodoRotulo;
    document.querySelectorAll('.vg-opcao').forEach(b => b.classList.remove('is-ativo'));
    fecharPopupPeriodo();
    recarregarPorFiltro();
  });
}

// =============================================================================
// Logo e tema
// =============================================================================
async function carregarLogos() {
  try {
    const [completo, isotipo] = await Promise.all([
      fetch('assets/logo-completo.svg').then(r => r.text()),
      fetch('assets/isotipo-gradiente.svg').then(r => r.text())
    ]);
    $('logo-completo').innerHTML = completo;
    $('logo-rodape').innerHTML = completo;
    $('logo-isotipo').innerHTML = isotipo;
    const appicon = $('logo-appicon');
    if (appicon) appicon.innerHTML = isotipo;
  } catch (e) {
    console.warn('Não foi possível carregar os SVGs da marca.', e);
  }
}

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-tema', tema);
  try { localStorage.setItem(TEMA_STORAGE_KEY, tema); } catch (e) {}
  if (estado.dados && estado.secao !== 'auditoria') pintarMetricas();
}
function alternarTema() {
  const atual = document.documentElement.getAttribute('data-tema') || 'claro';
  aplicarTema(atual === 'claro' ? 'escuro' : 'claro');
}

// =============================================================================
// Permissões
// =============================================================================
function authBitrix() {
  try {
    if (window.BX24 && typeof BX24.getAuth === 'function') return BX24.getAuth();
  } catch (e) { /* fora do portal */ }
  return null;
}

async function carregarPermissoes() {
  const auth = authBitrix();
  if (/[?&]demo=1/.test(location.search) || !auth || !auth.member_id) {
    ativarDemo('O painel está fora do Bitrix24 (ou sem sessão válida), então exibe um conjunto de exemplo. Nenhum número aqui é dado real da operação.');
    return window.VigiaDemo.permissoes;
  }
  try {
    const resposta = await fetch(URL_PERMISSOES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: auth.member_id, domain: auth.domain,
        accessToken: auth.access_token, refreshToken: auth.refresh_token, expiresIn: auth.expires_in
      })
    });
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
    return resposta.json();
  } catch (e) {
    ativarDemo('Não foi possível confirmar suas permissões na API do Vigia, então o painel exibe um conjunto de exemplo. Nenhum número aqui é dado real da operação.');
    return window.VigiaDemo.permissoes;
  }
}

function departamentosPermitidos() {
  const lista = (estado.permissoes && estado.permissoes.departamentos) || [];
  return Object.keys(DEPARTAMENTOS).filter(d => lista.indexOf(d) !== -1);
}

// =============================================================================
// Shell: departamento, IA, seção
// =============================================================================
function pintarSegDepartamento() {
  const deps = departamentosPermitidos();
  $('seg-departamento').innerHTML = deps.map(d =>
    `<button class="vg-seg__item${d === estado.departamento ? ' is-ativo' : ''}" type="button" data-departamento="${d}" aria-pressed="${d === estado.departamento}">${escapeHtml(DEPARTAMENTOS[d].nome)}</button>`
  ).join('');
  $('seg-departamento').hidden = deps.length < 2;
}

function pintarSegAgente() {
  const agentes = dep().agentes;
  $('seg-agente').innerHTML = agentes.map(a =>
    `<button class="vg-agente${a.id === estado.agente ? ' is-ativo' : ''}" type="button" data-agente="${a.id}">
      <span class="vg-agente__marca" aria-hidden="true">${a.marca}</span>
      <span><span class="vg-agente__nome">${escapeHtml(a.nome)}</span><span class="vg-agente__papel">${escapeHtml(a.papel)}</span></span>
    </button>`).join('');
  $('seg-agente').hidden = agentes.length < 2;
}

function pintarFiltrosDoDepartamento() {
  const origens = [['todos', 'Colaboradores e IA'], ['ia', 'Somente IA'], ['colaboradores', 'Somente colaboradores']];
  $('filtro-colaborador').innerHTML = origens.map(o =>
    `<option value="${o[0]}"${(estado.colaborador || 'todos') === o[0] ? ' selected' : ''}>${escapeHtml(o[1])}</option>`).join('');
  $('filtro-base-data').hidden = estado.departamento !== 'sucesso_cliente';
  $('filtro-base-data').value = estado.baseData;
  // Com o período apoiado na data de conclusão, "em andamento" não existe.
  const statusDisponiveis = dep().status.filter(s => !(estado.baseData === 'conclusao' && s[0] === 'em_andamento'));
  if (estado.status === 'em_andamento' && estado.baseData === 'conclusao') estado.status = 'todos';
  $('filtro-status').innerHTML = statusDisponiveis.map(s =>
    `<option value="${s[0]}"${estado.status === s[0] ? ' selected' : ''}>${escapeHtml(s[1])}</option>`).join('');
}

function selecionarDepartamento(departamento) {
  if (departamentosPermitidos().indexOf(departamento) === -1) return;
  estado.departamento = departamento;
  estado.agente = DEPARTAMENTOS[departamento].agentes[0].id;
  estado.status = 'todos';
  estado.colaborador = null;
  estado.baseData = departamento === 'sucesso_cliente' ? 'conclusao' : 'criacao';
  Object.keys(estado.sinais).forEach(k => { estado.sinais[k] = false; });
  estado.dados = null;
  estado.pagina = 1;
  pintarSegDepartamento();
  pintarSegAgente();
  pintarFiltrosDoDepartamento();
  atualizarResumoFiltros();
  atualizarTudo();
}

function selecionarAgente(agente) {
  estado.agente = agente;
  estado.dados = null;
  estado.pagina = 1;
  pintarSegAgente();
  atualizarTudo();
}

function selecionarSecao(secao) {
  document.querySelectorAll('.vg-abas__item').forEach(b => {
    const ativo = b.dataset.secao === secao;
    b.classList.toggle('is-ativo', ativo);
    b.setAttribute('aria-selected', ativo ? 'true' : 'false');
  });
  $('secao-visao').hidden = secao !== 'visao';
  $('secao-qualidade').hidden = secao !== 'qualidade';
  $('secao-auditoria').hidden = secao !== 'auditoria';
  estado.secao = secao;
  esconderTip();
  atualizarTudo();
}

async function atualizarTudo(forcar) {
  if (estado.secao === 'auditoria') await carregarAtendimentos();
  else await carregarMetricas(forcar);
}

// =============================================================================
// Eventos
// =============================================================================
function ligarNavegacao() {
  $('seg-departamento').addEventListener('click', (e) => {
    const b = e.target.closest('[data-departamento]');
    if (b) selecionarDepartamento(b.dataset.departamento);
  });
  $('seg-agente').addEventListener('click', (e) => {
    const b = e.target.closest('[data-agente]');
    if (b) selecionarAgente(b.dataset.agente);
  });
  document.querySelectorAll('.vg-abas__item').forEach(b => {
    b.addEventListener('click', () => selecionarSecao(b.dataset.secao));
  });

  $('filtro-colaborador').addEventListener('change', (e) => {
    estado.colaborador = e.target.value === 'todos' ? null : e.target.value;
    recarregarPorFiltro();
  });
  $('filtro-status').addEventListener('change', (e) => {
    estado.status = e.target.value;
    recarregarPorFiltro();
  });
  $('filtro-avaliado').addEventListener('change', (e) => {
    estado.avaliado = e.target.value;
    recarregarPorFiltro();
  });
  $('filtro-base-data').addEventListener('change', (e) => {
    estado.baseData = e.target.value;
    pintarFiltrosDoDepartamento();
    recarregarPorFiltro();
  });
  $('filtro-limite').addEventListener('change', (e) => {
    estado.limite = Number(e.target.value);
    estado.pagina = 1;
    carregarAtendimentos();
  });

  $('filtros-resumo').addEventListener('click', (e) => {
    const alvo = e.target.closest('[data-limpar]');
    if (!alvo) return;
    const qual = alvo.dataset.limpar;
    if (qual === 'colaborador' || qual === 'tudo') { estado.colaborador = null; $('filtro-colaborador').value = 'todos'; }
    if (qual === 'status' || qual === 'tudo') { estado.status = 'todos'; $('filtro-status').value = 'todos'; }
    if (qual === 'avaliado' || qual === 'tudo') { estado.avaliado = 'sim'; $('filtro-avaliado').value = 'sim'; }
    if (qual === 'base-data' || qual === 'tudo') {
      estado.baseData = estado.departamento === 'sucesso_cliente' ? 'conclusao' : 'criacao';
      $('filtro-base-data').value = estado.baseData;
    }
    if (qual === 'periodo' || qual === 'tudo') aplicarPreset('hoje', true);
    if (qual === 'tudo') Object.keys(estado.sinais).forEach(k => { estado.sinais[k] = false; });
    if (qual.indexOf('sinal:') === 0) estado.sinais[qual.split(':')[1]] = false;
    recarregarPorFiltro();
  });

  $('chips-auditoria').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sinal]');
    if (!b) return;
    estado.sinais[b.dataset.sinal] = !estado.sinais[b.dataset.sinal];
    estado.pagina = 1;
    atualizarResumoFiltros();
    carregarAtendimentos();
  });

  document.querySelectorAll('#kpis-visao, #kpis-qualidade').forEach(el => {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sinal]');
      if (!b) return;
      Object.keys(estado.sinais).forEach(k => { estado.sinais[k] = false; });
      estado.sinais[b.dataset.sinal] = true;
      estado.pagina = 1;
      atualizarResumoFiltros();
      selecionarSecao('auditoria');
    });
  });

  $('tabela-corpo').addEventListener('click', (e) => {
    const fb = e.target.closest('.vg-fb');
    if (fb) { abrirDrawer(fb.dataset.sessao, fb.dataset.cliente); return; }
    const avaliacao = e.target.closest('.vg-avaliacao');
    if (avaliacao) avaliacao.classList.toggle('is-expandida');
  });

  $('drawer-enviar').addEventListener('click', enviarFeedback);
  $('drawer-fechar').addEventListener('click', fecharDrawer);
  $('drawer-cancelar').addEventListener('click', fecharDrawer);
  $('drawer-fundo').addEventListener('click', (e) => { if (e.target === $('drawer-fundo')) fecharDrawer(); });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-acao="recarregar"]')) atualizarTudo(true);
  });

  $('btn-atualizar').addEventListener('click', () => atualizarTudo(true));
  $('btn-tema').addEventListener('click', alternarTema);
}

// =============================================================================
// Inicialização
// =============================================================================
async function iniciar() {
  $('btn-suporte').href = SUPORTE_URL;
  $('btn-suporte-negado').href = SUPORTE_URL;
  carregarLogos();
  ligarNavegacao();
  ligarPopupPeriodo();
  aplicarPreset('hoje', true);

  estado.permissoes = await carregarPermissoes();
  const deps = departamentosPermitidos();
  if (!deps.length) {
    $('sem-acesso').hidden = false;
    if (window.BX24 && BX24.fitWindow) BX24.fitWindow();
    return;
  }
  $('app').hidden = false;
  estado.departamento = deps[0];
  estado.agente = DEPARTAMENTOS[estado.departamento].agentes[0].id;
  pintarSegDepartamento();
  pintarSegAgente();
  pintarFiltrosDoDepartamento();
  atualizarResumoFiltros();
  atualizarTudo();
}

if (window.BX24) {
  BX24.init(() => { iniciar(); if (BX24.fitWindow) BX24.fitWindow(); });
} else {
  document.addEventListener('DOMContentLoaded', iniciar);
}
