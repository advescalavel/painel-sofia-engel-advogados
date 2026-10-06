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
  { chave: 'insatisfacao', rotulo: 'Cliente insatisfeito', soDepartamento: 'sucesso_cliente' },
  { chave: 'com_feedback', rotulo: 'Com feedback da Laila', soDepartamento: 'sucesso_cliente', precisaPermissao: true }
];

// Nome de exibição da IA supervisionada, usado no rótulo "Score de …" da aba
// Qualidade da IA — o Vigia (agora "Supervisora") é quem avalia, não quem é
// avaliado, então o rótulo precisa nomear a IA sob avaliação, não o auditor.
const NOME_IA_AVALIADA = {
  sdr: 'IA Supervisora SDR',
  fechamento: 'IA Supervisora de Fechamento',
  sucesso: 'Sofia'
};

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
  // Componente avaliado (só Sucesso do Cliente): 'ambos' | 'ia' | 'humano'.
  // Define quais notas e critérios a Supervisora devolve nas métricas.
  componente: 'ambos',
  periodos: [],
  periodoRotulo: 'Hoje',
  periodoPreset: 'hoje',
  sinais: { sem_resposta_60min: false, falha_ia: false, janela_2h: false, insatisfacao: false, com_feedback: false },
  // Filtros categóricos adicionais da aba Atendimentos — ver README, seção
  // "Pendências de backend" para o que ainda precisa existir na API.
  filtroMotivoFalha: null,
  filtroCriterio: null,
  filtroTipoAtendimento: null,
  filtroMotivoTransferencia: null,
  // Faixa de nota vinda do drill-down da Visão geral: { rotulo, min, max }.
  filtroFaixa: null,
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

// camposMedia (opcional): campos que são médias (ex.: nota média) e por isso
// não podem ser somados quando dois buckets caem no mesmo dia — viram a média
// simples dos valores não nulos. Sem o parâmetro o comportamento é o de antes.
function agruparSeriePorDia(dados, camposMedia) {
  const mapa = new Map();
  const ordem = [];
  const medias = camposMedia || [];
  const contagem = new Map();
  dados.forEach(d => {
    const data = new Date(d.bucket);
    const chave = isNaN(data)
      ? String(d.bucket)
      : data.getFullYear() + '-' + String(data.getMonth() + 1).padStart(2, '0') + '-' + String(data.getDate()).padStart(2, '0');
    if (!mapa.has(chave)) {
      const copia = Object.assign({}, d, { bucket: chave });
      mapa.set(chave, copia);
      ordem.push(chave);
      const cont = {};
      medias.forEach(k => { cont[k] = typeof d[k] === 'number' ? 1 : 0; });
      contagem.set(chave, cont);
    } else {
      const alvo = mapa.get(chave);
      const cont = contagem.get(chave);
      Object.keys(d).forEach(k => {
        if (k === 'bucket') return;
        if (typeof d[k] !== 'number') return;
        if (medias.indexOf(k) !== -1) {
          alvo[k] = (num(alvo[k]) * cont[k] + d[k]) / (cont[k] + 1);
          cont[k] += 1;
        } else {
          alvo[k] = num(alvo[k]) + d[k];
        }
      });
    }
  });
  return ordem.sort().map(c => mapa.get(c));
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
  if (secao === 'visao') { $('kpis-visao').className = 'vg-kpis'; $('graficos-visao').className = 'vg-graficos'; }
  $('kpis-' + secao).innerHTML = skeletonKpis(secao === 'visao' ? (estado.agente === 'sucesso' ? 7 : 5) : 3);
  $('graficos-' + secao).innerHTML = skeletonGraficos(3);
}

// =============================================================================
// KPI
// =============================================================================
// drill (opcional): objeto de filtros aplicado ao abrir a aba Atendimentos —
// mesmo formato aceito por irParaAtendimentos.
function drillAttr(patch) { return `data-drill="${escapeHtml(JSON.stringify(patch || {}))}"`; }

function cardKpi({ rotulo, valor, apoio, tag, alerta, medidorPct, sinal, status, drill }) {
  const tagEl = tag ? `<span class="vg-kpi__tag">${escapeHtml(tag)}</span>` : '';
  const medidor = medidorPct != null ? `<span class="vg-kpi__medidor"><i style="width:${Math.max(0, Math.min(100, medidorPct))}%"></i></span>` : '';
  const apoioEl = apoio ? `<span class="vg-kpi__apoio">${escapeHtml(apoio)}</span>` : '';
  const miolo = `<div class="vg-kpi__topo">
      <span class="vg-kpi__rotulo" title="${escapeHtml(rotulo)}">${escapeHtml(rotulo)}</span>${tagEl}
    </div>
    <span class="vg-kpi__valor">${valor}</span>${medidor}${apoioEl}`;

  if (sinal || status || drill) {
    const atributo = sinal ? `data-sinal="${sinal}"` : (status ? `data-status="${status}"` : drillAttr(drill));
    return `<button class="vg-kpi${alerta ? ' vg-kpi--alerta' : ''}" type="button" ${atributo}>
      ${miolo}<span class="vg-kpi__ir">ver atendimentos →</span></button>`;
  }
  return `<div class="vg-kpi${alerta ? ' vg-kpi--alerta' : ''}">${miolo}</div>`;
}

// =============================================================================
// Gráficos (Ajustados para ocultar o card se não houver dados)
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
  const card = el.closest('.vg-card');
  const cfg = opcoes || {};

  if (granularidade !== 'mes' && dados && dados.length) dados = agruparSeriePorDia(dados);
  const totais = dados ? dados.map(d => series.reduce((acc, s) => acc + num(d[s.chave]), 0)) : [];
  // legendaPct / aoClicarSerie: opcionais, usados na distribuição por faixa.
  const somaTotal = totais.reduce((a, b) => a + b, 0);

  if (!dados || !dados.length || somaTotal === 0) {
    if (card) card.hidden = true;
    el.innerHTML = '';
    return;
  }
  if (card) card.hidden = false;

  const { ticks, topo } = ticksEixo(Math.max(...totais, 1));

  const legenda = series.map((s, i) => {
    const soma = dados.reduce((acc, d) => acc + num(d[s.chave]), 0);
    const part = cfg.legendaPct ? ` <span class="vg-legenda__pct">${nf1.format(pct(soma, somaTotal))}%</span>` : '';
    const miolo = `<span class="vg-legenda__cor" style="background:${s.cor}"></span>${escapeHtml(s.rotulo)} <b>${nf.format(soma)}</b>${part}`;
    return cfg.aoClicarSerie
      ? `<button class="vg-legenda__item vg-legenda__item--clicavel" type="button" data-s="${i}" title="Ver atendimentos de ${escapeHtml(s.rotulo)}">${miolo}</button>`
      : `<span class="vg-legenda__item">${miolo}</span>`;
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

  if (cfg.aoClicarSerie) {
    el.querySelectorAll('.vg-legenda__item--clicavel').forEach(botao => {
      botao.addEventListener('click', () => cfg.aoClicarSerie(series[Number(botao.dataset.s)]));
    });
  }
}

function graficoComposicao(container, partes, opcoes) {
  const el = typeof container === 'string' ? $(container) : container;
  if (!el) return;
  const card = el.closest('.vg-card');
  const total = partes ? partes.reduce((acc, p) => acc + num(p.valor), 0) : 0;
  if (!total) {
    if (card) card.hidden = true;
    el.innerHTML = '';
    return;
  }
  if (card) card.hidden = false;

  const segs = partes.filter(p => num(p.valor) > 0).map(p =>
    `<span class="vg-comp__seg" style="width:${pct(num(p.valor), total)}%;background:${p.cor}" title="${escapeHtml(p.rotulo)}: ${nf.format(num(p.valor))}"></span>`
  ).join('');
  const cfg = opcoes || {};
  const linhas = partes.map((p, i) =>
    `<span class="vg-comp__linha${cfg.aoClicarParte ? ' vg-comp__linha--clicavel' : ''}"${cfg.aoClicarParte ? ` data-i="${i}" role="button" tabindex="0"` : ''}>
      <span class="vg-comp__ponto" style="background:${p.cor}"></span>
      <span class="vg-comp__nome">${escapeHtml(p.rotulo)}</span>
      <span class="vg-comp__valor">${nf.format(num(p.valor))}</span>
      <span class="vg-comp__pct">${nf1.format(pct(num(p.valor), total))}%</span>
    </span>`).join('');
  el.innerHTML = `<div class="vg-comp">${segs}</div><div class="vg-comp__legenda">${linhas}</div>
    ${(cfg.rodape) ? `<p class="vg-card__apoio" style="margin-top:12px">${escapeHtml(cfg.rodape)}</p>` : ''}`;

  if (cfg.aoClicarParte) {
    el.querySelectorAll('.vg-comp__linha--clicavel').forEach(linha => {
      linha.addEventListener('click', () => cfg.aoClicarParte(partes[Number(linha.dataset.i)]));
      linha.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cfg.aoClicarParte(partes[Number(linha.dataset.i)]); } });
    });
  }
}

function graficoBarrasH(container, dados, campoRotulo, campoValor, opcoes) {
  const el = typeof container === 'string' ? $(container) : container;
  if (!el) return;
  const card = el.closest('.vg-card');
  const cfg = opcoes || {};
  // Opcionais: ignorarNulos (descarta itens sem valor), ordemCrescente (pior
  // primeiro, para diagnóstico), max (escala fixa, ex.: 100 para notas),
  // corPorValor (cor por item) e mensagemVazio ([título, texto] em vez de
  // ocultar o card quando não há dado).
  if (cfg.ignorarNulos && dados) dados = dados.filter(d => d[campoValor] != null && d[campoValor] !== '');
  const soma = dados ? dados.reduce((acc, d) => acc + num(d[campoValor]), 0) : 0;
  if (!dados || !dados.length || soma === 0) {
    if (cfg.mensagemVazio) {
      if (card) card.hidden = false;
      el.innerHTML = blocoVazio(cfg.mensagemVazio[0], cfg.mensagemVazio[1]);
      return;
    }
    if (card) card.hidden = true;
    el.innerHTML = '';
    return;
  }
  if (card) card.hidden = false;

  const itens = dados.slice().sort((a, b) => cfg.ordemCrescente
    ? num(a[campoValor]) - num(b[campoValor])
    : num(b[campoValor]) - num(a[campoValor]));
  const max = cfg.max || Math.max(...itens.map(d => num(d[campoValor])), 1);
  el.innerHTML = '<div class="vg-barras">' + itens.map(d => {
    const valor = num(d[campoValor]);
    const rotulo = String(d[campoRotulo] == null ? '—' : d[campoRotulo]);
    const parte = cfg.semParticipacao ? '' : cfg.campoSecundario
      ? ` <span class="vg-comp__pct">${escapeHtml(cfg.formatadorSecundario ? cfg.formatadorSecundario(d[cfg.campoSecundario]) : nf.format(num(d[cfg.campoSecundario])))}</span>`
      : ` <span class="vg-comp__pct">${nf1.format(pct(valor, soma))}%</span>`;
    return `<div class="vg-barras__linha${cfg.aoClicarItem ? ' vg-barras__linha--clicavel' : ''}"${cfg.aoClicarItem ? ' role="button" tabindex="0"' : ''}>
      <span class="vg-barras__rotulo" title="${escapeHtml(rotulo)}">${escapeHtml(rotulo)}</span>
      <span class="vg-barras__trilha"><i class="vg-barras__preenchido" style="width:${Math.min(100, pct(valor, max))}%;${(cfg.corPorValor ? cfg.corPorValor(valor, d) : cfg.cor) ? 'background:' + (cfg.corPorValor ? cfg.corPorValor(valor, d) : cfg.cor) : ''}"></i></span>
      <span class="vg-barras__valor">${cfg.formatador ? cfg.formatador(valor) : nf.format(valor)}${parte}</span>
    </div>`;
  }).join('') + '</div>';

  if (cfg.aoClicarItem) {
    el.querySelectorAll('.vg-barras__linha--clicavel').forEach((linha, i) => {
      linha.addEventListener('click', () => cfg.aoClicarItem(itens[i]));
      linha.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cfg.aoClicarItem(itens[i]); } });
    });
  }
}

// Linha multissérie — mesmo vocabulário visual de vg-plot (eixo, grade,
// tooltip). Valores nulos quebram a linha em vez de cair para zero, para não
// inventar queda onde só falta dado. Opções: max (100 = escala fixa de nota ou
// percentual), altura, camposMedia (ver agruparSeriePorDia), extrasTip(d) →
// [[rótulo, valor]] e mensagemVazio ([título, texto]) quando nenhuma série tem
// valor. Por série: chave ou valor(d), rotulo, cor, tracejada, formato
// ('nota' | 'pct' | 'int'), agregado (número para a legenda) ou peso (campo
// usado como peso da média da legenda) ou somar (legenda com a soma).
function graficoLinha(container, dados, series, granularidade, opcoes) {
  const el = typeof container === 'string' ? $(container) : container;
  if (!el) return;
  const card = el.closest('.vg-card');
  const cfg = opcoes || {};

  if (granularidade !== 'mes' && dados && dados.length) dados = agruparSeriePorDia(dados, cfg.camposMedia);
  dados = dados || [];
  const valorDe = (s, d) => {
    const v = s.valor ? s.valor(d) : d[s.chave];
    return (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  };
  const matriz = series.map(s => dados.map(d => valorDe(s, d)));
  const temValor = matriz.some(l => l.some(v => v !== null));

  if (!dados.length || !temValor) {
    if (cfg.mensagemVazio) {
      if (card) card.hidden = false;
      el.innerHTML = blocoVazio(cfg.mensagemVazio[0], cfg.mensagemVazio[1]);
    } else {
      if (card) card.hidden = true;
      el.innerHTML = '';
    }
    return;
  }
  if (card) card.hidden = false;

  const valores = [].concat(...matriz).filter(v => v !== null);
  const { ticks, topo } = cfg.max ? { ticks: [0, 25, 50, 75, 100], topo: 100 } : ticksEixo(Math.max(1, ...valores));
  const n = dados.length;
  const xPct = (i) => ((i + 0.5) / n) * 100;
  const yPct = (v) => Math.max(0, Math.min(100, pct(v, topo)));
  const formatar = (s, v) => {
    if (v === null) return '—';
    if (s.formato === 'pct') return nf1.format(v) + '%';
    return nf.format(Math.round(v));
  };
  const agregado = (s, i) => {
    if (s.agregado != null) return s.agregado;
    const lista = matriz[i];
    if (s.somar) return lista.reduce((a, v) => a + (v || 0), 0);
    let somaP = 0, somaV = 0;
    lista.forEach((v, j) => {
      if (v === null) return;
      const w = s.peso ? num(dados[j][s.peso]) : 1;
      somaP += w; somaV += v * w;
    });
    return somaP ? somaV / somaP : null;
  };

  const legenda = series.map((s, i) => {
    const ag = agregado(s, i);
    return `<span class="vg-legenda__item"><span class="vg-legenda__cor${s.tracejada ? ' vg-legenda__cor--tracejada' : ''}" style="background:${s.cor};color:${s.cor}"></span>${escapeHtml(s.rotulo)}${ag !== null ? ` <b>${formatar(s, ag)}</b>` : ''}</span>`;
  }).join('');

  const linhasGrade = ticks.map(v => `<div class="vg-plot__linha${v === 0 ? ' vg-plot__linha--base' : ''}" style="bottom:${pct(v, topo)}%">
      <span class="vg-plot__tick">${nf.format(v)}</span></div>`).join('');

  const caminhos = series.map((s, i) => {
    let d = '';
    let aberto = false;
    matriz[i].forEach((v, j) => {
      if (v === null) { aberto = false; return; }
      const x = (xPct(j) * 10).toFixed(2);
      const y = (1000 - yPct(v) * 10).toFixed(2);
      d += (aberto ? ' L' : ' M') + x + ' ' + y;
      aberto = true;
    });
    return d ? `<path d="${d.trim()}" fill="none" stroke="${s.cor}" stroke-width="${s.tracejada ? 1.75 : 2.25}" stroke-linejoin="round" stroke-linecap="round"${s.tracejada ? ' stroke-dasharray="5 4"' : ''} vector-effect="non-scaling-stroke"></path>` : '';
  }).join('');

  const pontos = series.map((s, i) => matriz[i].map((v, j) => v === null ? '' :
    `<span class="vg-linha__ponto${s.tracejada ? ' vg-linha__ponto--leve' : ''}" style="left:${xPct(j)}%;bottom:${yPct(v)}%;--cor:${s.cor}"></span>`
  ).join('')).join('');

  const passoRotulo = Math.max(1, Math.ceil(n / 12));
  const rotulosX = dados.map((d, j) => (j % passoRotulo === 0 || j === n - 1)
    ? `<span class="vg-linha__xlab" style="left:${xPct(j)}%">${escapeHtml(formatarBucket(d.bucket, granularidade))}</span>` : '').join('');

  el.innerHTML = `<div class="vg-legenda">${legenda}</div>
    <div class="vg-plot"><div class="vg-plot__area vg-linha__area${n <= 3 ? ' vg-linha__area--poucos' : ''}" style="height:${cfg.altura || 186}px">${linhasGrade}
      <svg class="vg-linha__svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">${caminhos}</svg>
      <div class="vg-linha__pontos">${pontos}</div>
      <div class="vg-linha__alvos">${dados.map((d, j) => `<div class="vg-linha__alvo" data-i="${j}"></div>`).join('')}</div>
    </div></div>
    <div class="vg-linha__x">${rotulosX}</div>`;

  el.querySelectorAll('.vg-linha__alvo').forEach(alvo => {
    const j = Number(alvo.dataset.i);
    const d = dados[j];
    const conteudo = () => {
      const linhasTip = series.map((s, i) => `<span class="vg-tip__linha"><span class="vg-tip__ponto" style="background:${s.cor}"></span><span>${escapeHtml(s.rotulo)}</span><b>${formatar(s, matriz[i][j])}</b></span>`).join('');
      const extras = cfg.extrasTip ? cfg.extrasTip(d) : [];
      const extrasHtml = extras.length
        ? '<div class="vg-tip__total vg-tip__total--lista">' + extras.map(e => `<span>${escapeHtml(e[0])}</span><b>${escapeHtml(e[1])}</b>`).join('') + '</div>'
        : '';
      return `<div class="vg-tip__titulo">${escapeHtml(formatarBucket(d.bucket, granularidade))}</div>${linhasTip}${extrasHtml}`;
    };
    alvo.addEventListener('mouseenter', (e) => mostrarTip(conteudo(), e));
    alvo.addEventListener('mousemove', posicionarTip);
    alvo.addEventListener('mouseleave', esconderTip);
  });
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

// -----------------------------------------------------------------------------
// Sucesso do Cliente — Visão geral como resumo executivo, na sequência
// Resultado → Qualidade → Diagnóstico → Risco → Ação. Todo indicador abre a
// aba Atendimentos já filtrada (drill-down), e o que é estado do momento
// ("agora") fica separado do que é histórico do período.
// -----------------------------------------------------------------------------

// Faixas gerenciais da nota de efetividade (classificação final do Vigia).
const FAIXAS_CLASSIFICACAO = [
  { chave: 'critico', rotulo: 'Crítico', min: 0, max: 49, cor: 'var(--vg-faixa-critico)' },
  { chave: 'regular', rotulo: 'Regular', min: 50, max: 69, cor: 'var(--vg-faixa-regular)' },
  { chave: 'bom', rotulo: 'Bom', min: 70, max: 84, cor: 'var(--vg-faixa-bom)' },
  { chave: 'excelente', rotulo: 'Excelente', min: 85, max: 100, cor: 'var(--vg-faixa-excelente)' }
];
const ROTULOS_COMPONENTE = { ambos: 'IA e humano', ia: 'Somente IA', humano: 'Somente humano' };
const LIMITE_CRITERIO_OK = 70; // abaixo disso o critério aparece em destaque

function classificacaoDaNota(v) {
  const f = FAIXAS_CLASSIFICACAO.find(x => v >= x.min && v < x.max + 1);
  return f ? f.rotulo : '';
}
function faixaDeRotulo(rotulo) {
  const m = String(rotulo || '').match(/(\d+)\D+(\d+)/);
  return m ? { rotulo: String(rotulo), min: Number(m[1]), max: Number(m[2]) } : null;
}
function somaCampo(lista, campo) { return (lista || []).reduce((acc, d) => acc + num(d[campo]), 0); }
function temAlgumCampo(lista, campos) { return (lista || []).some(d => campos.some(c => d[c] != null)); }
function maiorPor(lista, campo) { return (lista || []).slice().sort((a, b) => num(b[campo]) - num(a[campo]))[0]; }

function blocoVisao(id, titulo, apoio, conteudo, classeExtra, tag) {
  return `<section class="vg-bloco${classeExtra ? ' ' + classeExtra : ''}" id="bloco-${id}" aria-label="${escapeHtml(titulo)}">
    <header class="vg-bloco__cabecalho">
      <h2 class="vg-bloco__titulo">${escapeHtml(titulo)}</h2>${tag ? `<span class="vg-kpi__tag">${escapeHtml(tag)}</span>` : ''}
      ${apoio ? `<p class="vg-bloco__apoio">${escapeHtml(apoio)}</p>` : ''}
    </header>
    <div class="vg-graficos">${conteudo}</div>
  </section>`;
}

// Um bloco sem nenhum card visível (todos sem dado) some inteiro, para não
// deixar título de seção solto.
function ocultarBlocosVazios(container) {
  container.querySelectorAll('.vg-bloco').forEach(bloco => {
    const cards = bloco.querySelectorAll('.vg-card');
    bloco.hidden = cards.length > 0 && Array.from(cards).every(c => c.hidden);
  });
}

function pintarVisaoSucesso(dados) {
  const k = dados.kpis || {};
  const serie = dados.serie || [];
  const gran = dados.granularidade;

  const falhaLista = (dados.falha_critica || []).filter(f => !semFalhaCritica(f.motivo));
  let totalFalhasIa = num(k.falhas_ia);
  if (Array.isArray(dados.falha_critica)) totalFalhasIa = falhaLista.reduce((acc, f) => acc + num(f.quantidade), 0);

  const classif = Array.isArray(dados.distribuicao_classificacao_serie) && dados.distribuicao_classificacao_serie.length
    ? dados.distribuicao_classificacao_serie : null;
  const criticos = k.atendimentos_criticos != null ? num(k.atendimentos_criticos) : (classif ? somaCampo(classif, 'critico') : null);
  const totalClassificados = classif ? FAIXAS_CLASSIFICACAO.reduce((acc, f) => acc + somaCampo(classif, f.chave), 0) : num(k.avaliados);
  const faixaCritica = FAIXAS_CLASSIFICACAO[0];
  const drillCritico = { faixa: { rotulo: faixaCritica.rotulo + ' (' + faixaCritica.min + '–' + faixaCritica.max + ')', min: faixaCritica.min, max: faixaCritica.max } };
  const nota = k.efetividade_media_pct != null ? num(k.efetividade_media_pct) : null;
  const riscosAgora = num(k.janela_2h_agora) + num(k.sem_resposta_60min_agora);

  // ---------------------------------------------------------------- KPIs
  const refPeriodo = estado.periodoRotulo + (estado.baseData === 'conclusao' ? ' · por data de conclusão' : ' · por data de criação');
  const cardsPeriodo = [
    cardKpi({
      rotulo: 'Atendimentos',
      valor: nf.format(num(k.total_atendimentos)),
      apoio: nf.format(num(k.resolvidos)) + ' resolvidos · ' + nf.format(num(k.transferidos)) + ' transferidos',
      drill: {}
    }),
    cardKpi({
      rotulo: 'Taxa de resolução',
      valor: nf1.format(num(k.taxa_resolucao_pct)) + '%',
      medidorPct: num(k.taxa_resolucao_pct),
      apoio: nf.format(num(k.resolvidos)) + ' resolvidos sem humano',
      drill: { status: 'resolvido' }
    }),
    cardKpi({
      rotulo: 'Nota média',
      valor: nota !== null ? nf.format(Math.round(nota)) + '<small class="vg-kpi__unidade">/100</small>' : '—',
      medidorPct: nota,
      apoio: nota !== null ? classificacaoDaNota(nota) + ' · ' + nf.format(num(k.avaliados)) + ' avaliados' : 'sem atendimentos avaliados',
      drill: {}
    }),
    cardKpi({
      rotulo: 'Atendimentos críticos',
      valor: criticos !== null ? nf.format(criticos) : '—',
      alerta: num(criticos) > 0,
      apoio: criticos !== null
        ? 'nota 0–49' + (totalClassificados ? ' · ' + nf1.format(pct(criticos, totalClassificados)) + '% dos avaliados' : '')
        : 'nota 0–49 — sem dado no período',
      drill: drillCritico
    }),
    cardKpi({
      rotulo: 'Falhas críticas da IA',
      valor: nf.format(totalFalhasIa),
      alerta: totalFalhasIa > 0,
      apoio: num(k.avaliados) ? nf1.format(pct(totalFalhasIa, num(k.avaliados))) + '% dos avaliados' : 'atendimentos com falha crítica',
      sinal: 'falha_ia'
    }),
    cardKpi({
      rotulo: 'Clientes insatisfeitos',
      valor: nf.format(num(k.clientes_insatisfeitos)),
      alerta: num(k.clientes_insatisfeitos) > 0,
      apoio: 'insatisfação detectada pela Supervisora',
      sinal: 'insatisfacao'
    })
  ].join('');

  const cardAgora = `<div class="vg-kpi vg-kpi--agora${riscosAgora > 0 ? ' vg-kpi--alerta' : ''}">
      <div class="vg-kpi__topo"><span class="vg-kpi__rotulo">Riscos operacionais ativos</span></div>
      <span class="vg-kpi__valor">${nf.format(riscosAgora)}</span>
      <div class="vg-agora__linhas">
        <button class="vg-agora__linha" type="button" ${drillAttr({ sinal: 'janela_2h' })}>
          <span>Janela de 24h encerrando</span><b>${nf.format(num(k.janela_2h_agora))}</b>
        </button>
        <button class="vg-agora__linha" type="button" ${drillAttr({ sinal: 'sem_resposta_60min' })}>
          <span>Sem resposta há +1h</span><b>${nf.format(num(k.sem_resposta_60min_agora))}</b>
        </button>
      </div>
      <button class="vg-link" type="button" data-rolar="riscos">ver riscos operacionais ↓</button>
    </div>`;

  const kpis = $('kpis-visao');
  kpis.className = 'vg-kpis vg-kpis--agrupado';
  kpis.innerHTML = `<div class="vg-kpi-grupo">
      <div class="vg-kpi-grupo__topo"><span class="vg-kpi-grupo__rotulo">No período</span><span class="vg-kpi-grupo__ref">${escapeHtml(refPeriodo)}</span></div>
      <div class="vg-kpi-grupo__cards">${cardsPeriodo}</div>
    </div>
    <div class="vg-kpi-grupo vg-kpi-grupo--agora">
      <div class="vg-kpi-grupo__topo"><span class="vg-kpi-grupo__rotulo"><i class="vg-pulso" aria-hidden="true"></i>Agora</span><span class="vg-kpi-grupo__ref">independe do período</span></div>
      ${cardAgora}
    </div>`;

  // ------------------------------------------------------------- Gráficos
  const camposNota = ['nota_media_resolvidos', 'nota_media_transferidos', 'nota_media_humano'];
  const temNotas = temAlgumCampo(serie, camposNota);
  const tipos = dados.tipos_atendimento || [];
  const temNotaTipo = tipos.some(t => t.nota_media != null);
  const camposAlerta = ['alertas_janela_24h', 'alertas_sem_resposta', 'alertas_insatisfacao'];
  const temHistAlertas = temAlgumCampo(serie, camposAlerta);

  const apoioEvolucao = temNotas
    ? 'nota média da Supervisora por desfecho; a linha tracejada é a taxa de resolução (%)'
    : 'taxa de resolução (%) ao longo do período — a nota por desfecho aparece assim que a Supervisora enviar';
  const apoioFaixas = classif
    ? 'Excelente 85–100 · Bom 70–84 · Regular 50–69 · Crítico 0–49 — clique em uma faixa para ver os atendimentos'
    : 'atendimentos por faixa de nota da Supervisora — clique em uma faixa para ver os atendimentos';

  $('graficos-visao').className = 'vg-graficos vg-graficos--blocos';
  $('graficos-visao').innerHTML =
    blocoVisao('evolucao', 'Evolução', 'estamos melhorando ou piorando?',
      cardGrafico('g-evolucao', 'Evolução da taxa de resolução', apoioEvolucao, true, notaGranularidade(dados))) +
    blocoVisao('qualidade', 'Qualidade', 'como as notas se distribuem e onde os critérios falham',
      cardGrafico('g-faixas', 'Distribuição dos atendimentos por faixa', apoioFaixas, true, notaGranularidade(dados)) +
      cardGrafico('g-criterios', 'Desempenho por critério', 'taxa de aprovação, do pior para o melhor — abaixo de ' + LIMITE_CRITERIO_OK + '% em destaque') +
      cardGrafico('g-falhas', 'Motivos de falha crítica', 'quantidade por motivo')) +
    blocoVisao('diagnostico', 'Diagnóstico', 'onde estão os problemas',
      cardGrafico('g-tipos', temNotaTipo ? 'Efetividade por tipo de atendimento' : 'Tipos de atendimento',
        temNotaTipo ? 'nota média por tipo, do pior para o melhor, com o volume ao lado' : 'andamento processual, dúvidas gerais e golpe do falso advogado') +
      cardGrafico('g-transferencia', 'Motivos de transferência', 'quantidade por motivo')) +
    blocoVisao('riscos', 'Riscos operacionais', 'situações que pedem atenção da equipe — separadas do histórico de qualidade',
      cardGrafico('g-alertas', 'Alertas operacionais por tipo',
        temHistAlertas ? 'ocorrências no período — clique para ver os atendimentos' : 'janela e sem resposta refletem o momento atual; os demais, o período') +
      cardGrafico('g-alertas-evolucao', 'Evolução dos alertas', 'alertas disparados ao longo do período', false, notaGranularidade(dados)),
      'vg-bloco--risco', 'agora + período') +
    blocoVisao('acao', 'Onde agir', 'pontos de atenção derivados dos filtros atuais — cada um abre a evidência',
      '<div class="vg-card vg-card--largo"><div id="g-acoes"></div></div>');

  // Evolução da taxa de resolução (linha)
  const seriesEvolucao = [];
  if (temNotas) {
    seriesEvolucao.push(
      { chave: 'nota_media_resolvidos', rotulo: 'Resolvidos pela IA', cor: 'var(--ae-serie-2)', peso: 'resolvidos' },
      { chave: 'nota_media_transferidos', rotulo: 'Transferidos', cor: 'var(--ae-serie-1)', peso: 'transferidos' },
      { chave: 'nota_media_humano', rotulo: 'Iniciados e atendidos por humano', cor: 'var(--vg-faixa-bom)', peso: 'atendidos_humano' }
    );
  }
  seriesEvolucao.push({
    rotulo: 'Taxa de resolução',
    valor: (d) => num(d.atendimentos) ? pct(num(d.resolvidos), num(d.atendimentos)) : null,
    cor: 'var(--ae-text-soft)',
    tracejada: true,
    formato: 'pct',
    agregado: num(k.taxa_resolucao_pct)
  });
  graficoLinha('g-evolucao', serie, seriesEvolucao, gran, {
    max: 100,
    altura: 220,
    camposMedia: camposNota,
    extrasTip: (d) => {
      const out = [['Atendimentos', nf.format(num(d.atendimentos))], ['Resolvidos pela IA', nf.format(num(d.resolvidos))], ['Transferidos', nf.format(num(d.transferidos))]];
      if (d.atendidos_humano != null) out.push(['Atendidos por humano', nf.format(num(d.atendidos_humano))]);
      return out;
    }
  });

  // Distribuição por faixa (barras empilhadas)
  const irFaixa = (s) => { if (s.faixa) irParaAtendimentos({ faixa: s.faixa }); };
  if (classif) {
    graficoBarras('g-faixas', classif, FAIXAS_CLASSIFICACAO.map(f => ({
      chave: f.chave, rotulo: f.rotulo + ' · ' + f.min + '–' + f.max, cor: f.cor,
      faixa: { rotulo: f.rotulo + ' (' + f.min + '–' + f.max + ')', min: f.min, max: f.max }
    })), gran, { legendaPct: true, aoClicarSerie: irFaixa });
  } else {
    graficoBarras('g-faixas', dados.distribuicao_score_serie, (dados.distribuicao_score_faixas || []).map((f, i) => ({
      chave: f.chave, rotulo: f.rotulo, cor: CORES_FAIXA[i % CORES_FAIXA.length], faixa: faixaDeRotulo(f.rotulo)
    })), gran, { legendaPct: true, aoClicarSerie: irFaixa });
  }

  // Desempenho por critério (barras horizontais, pior primeiro)
  const criterios = (dados.criterios || []).map(c => Object.assign({}, c, {
    rotulo: (estado.componente === 'ambos' && c.componente) ? (c.componente === 'humano' ? 'Humano · ' : 'IA · ') + c.criterio : c.criterio
  }));
  graficoBarrasH('g-criterios', criterios, 'rotulo', 'taxa_aprovacao_pct', {
    formatador: v => nf1.format(v) + '%',
    campoSecundario: 'quantidade_avaliada',
    formatadorSecundario: v => nf.format(num(v)) + ' aval.',
    ordemCrescente: true,
    max: 100,
    corPorValor: v => v < LIMITE_CRITERIO_OK ? 'var(--vg-faixa-critico)' : 'var(--ae-serie-2)',
    aoClicarItem: (d) => irParaAtendimentos({ criterio: d.criterio })
  });

  graficoBarrasH('g-falhas', falhaLista, 'motivo', 'quantidade', {
    cor: 'var(--ae-serie-7)',
    aoClicarItem: (d) => irParaAtendimentos({ motivoFalha: d.motivo })
  });

  // Diagnóstico
  if (temNotaTipo) {
    graficoBarrasH('g-tipos', tipos, 'tipo', 'nota_media', {
      ignorarNulos: true,
      ordemCrescente: true,
      max: 100,
      formatador: v => nf.format(Math.round(v)),
      campoSecundario: 'quantidade',
      formatadorSecundario: v => nf.format(num(v)) + ' atend.',
      corPorValor: v => v < LIMITE_CRITERIO_OK ? 'var(--vg-faixa-critico)' : 'var(--ae-serie-4)',
      aoClicarItem: (d) => irParaAtendimentos({ tipoAtendimento: d.tipo })
    });
  } else {
    graficoBarrasH('g-tipos', tipos, 'tipo', 'quantidade', {
      cor: 'var(--ae-serie-4)',
      aoClicarItem: (d) => irParaAtendimentos({ tipoAtendimento: d.tipo })
    });
  }
  graficoBarrasH('g-transferencia', dados.motivos_transferencia, 'motivo', 'quantidade', {
    cor: 'var(--ae-serie-3)',
    aoClicarItem: (d) => irParaAtendimentos({ motivoTransferencia: d.motivo })
  });

  // Riscos operacionais
  const somaSerie = (campo) => somaCampo(serie, campo);
  const alertas = [
    {
      tipo: 'Janela de 24h encerrando' + (temHistAlertas ? '' : ' (agora)'),
      quantidade: temHistAlertas ? somaSerie('alertas_janela_24h') : num(k.janela_2h_agora),
      patch: { sinal: 'janela_2h' }
    },
    {
      tipo: 'Sem resposta há +1h' + (temHistAlertas ? '' : ' (agora)'),
      quantidade: temHistAlertas ? somaSerie('alertas_sem_resposta') : num(k.sem_resposta_60min_agora),
      patch: { sinal: 'sem_resposta_60min' }
    },
    {
      tipo: 'Cliente insatisfeito',
      quantidade: temHistAlertas ? somaSerie('alertas_insatisfacao') : num(k.clientes_insatisfeitos),
      patch: { sinal: 'insatisfacao' }
    },
    {
      tipo: 'Transferido e não atendido',
      quantidade: num(k.transferidos_sem_atendimento),
      patch: { status: 'transferido_sem_atendimento' }
    }
  ];
  graficoBarrasH('g-alertas', alertas, 'tipo', 'quantidade', {
    cor: 'var(--ae-serie-1)',
    semParticipacao: true,
    mensagemVazio: ['Nenhum alerta operacional', 'Sem janela encerrando, cliente sem resposta, insatisfação ou transferência sem atendimento nos filtros atuais.'],
    aoClicarItem: (d) => irParaAtendimentos(d.patch)
  });

  graficoLinha('g-alertas-evolucao', serie, [
    { chave: 'alertas_janela_24h', rotulo: 'Janela de 24h', cor: 'var(--ae-serie-3)', somar: true, formato: 'int' },
    { chave: 'alertas_sem_resposta', rotulo: 'Sem resposta', cor: 'var(--ae-serie-1)', somar: true, formato: 'int' },
    { chave: 'alertas_insatisfacao', rotulo: 'Cliente insatisfeito', cor: 'var(--ae-serie-7)', somar: true, formato: 'int' }
  ], gran, {
    mensagemVazio: ['Histórico de alertas indisponível', 'A evolução aparece assim que a Supervisora enviar os alertas disparados por dia.']
  });

  // Onde agir
  pintarAcoesSucesso({ k, criterios, falhaLista, tipos, temNotaTipo, criticos, drillCritico });

  ocultarBlocosVazios($('graficos-visao'));
}

function pintarAcoesSucesso({ k, criterios, falhaLista, tipos, temNotaTipo, criticos, drillCritico }) {
  const acoes = [];
  const plural = (n, um, varios) => nf.format(n) + ' ' + (n === 1 ? um : varios);

  if (num(k.sem_resposta_60min_agora) > 0) {
    acoes.push({ alto: true, texto: plural(num(k.sem_resposta_60min_agora), 'cliente aguardando resposta há mais de 1h', 'clientes aguardando resposta há mais de 1h'), apoio: 'agora', patch: { sinal: 'sem_resposta_60min' } });
  }
  if (num(k.janela_2h_agora) > 0) {
    acoes.push({ alto: true, texto: plural(num(k.janela_2h_agora), 'conversa com a janela de 24h encerrando', 'conversas com a janela de 24h encerrando'), apoio: 'agora · 2h ou menos', patch: { sinal: 'janela_2h' } });
  }
  if (num(criticos) > 0) {
    acoes.push({ alto: true, texto: plural(num(criticos), 'atendimento na faixa crítica', 'atendimentos na faixa crítica'), apoio: 'nota 0–49 no período', patch: drillCritico });
  }
  if (num(k.transferidos_sem_atendimento) > 0) {
    acoes.push({ texto: plural(num(k.transferidos_sem_atendimento), 'transferência sem atendimento humano', 'transferências sem atendimento humano'), apoio: 'no período', patch: { status: 'transferido_sem_atendimento' } });
  }
  const piorCriterio = (criterios || []).filter(c => c.taxa_aprovacao_pct != null).sort((a, b) => num(a.taxa_aprovacao_pct) - num(b.taxa_aprovacao_pct))[0];
  if (piorCriterio && num(piorCriterio.taxa_aprovacao_pct) < 100) {
    acoes.push({ alto: num(piorCriterio.taxa_aprovacao_pct) < LIMITE_CRITERIO_OK, texto: 'Critério com pior desempenho: ' + piorCriterio.rotulo, apoio: nf1.format(num(piorCriterio.taxa_aprovacao_pct)) + '% de aprovação', patch: { criterio: piorCriterio.criterio } });
  }
  const topFalha = maiorPor(falhaLista, 'quantidade');
  if (topFalha && num(topFalha.quantidade) > 0) {
    acoes.push({ texto: 'Falha crítica mais frequente: ' + topFalha.motivo, apoio: plural(num(topFalha.quantidade), 'ocorrência', 'ocorrências'), patch: { motivoFalha: topFalha.motivo } });
  }
  if (temNotaTipo) {
    const piorTipo = (tipos || []).filter(t => t.nota_media != null).sort((a, b) => num(a.nota_media) - num(b.nota_media))[0];
    if (piorTipo) acoes.push({ texto: 'Tipo de atendimento com menor nota: ' + piorTipo.tipo, apoio: 'nota média ' + nf.format(Math.round(num(piorTipo.nota_media))), patch: { tipoAtendimento: piorTipo.tipo } });
  }

  const el = $('g-acoes');
  if (!acoes.length) {
    el.innerHTML = blocoVazio('Nenhum ponto de atenção', 'Sem riscos ativos, atendimentos críticos ou falhas nos filtros atuais.');
    return;
  }
  acoes.sort((a, b) => (b.alto ? 1 : 0) - (a.alto ? 1 : 0));
  el.innerHTML = '<div class="vg-acoes-lista">' + acoes.slice(0, 6).map(a => `<button class="vg-acao${a.alto ? ' vg-acao--alto' : ''}" type="button" ${drillAttr(a.patch)}>
      <span class="vg-acao__marca" aria-hidden="true"></span>
      <span class="vg-acao__texto"><b>${escapeHtml(a.texto)}</b><span>${escapeHtml(a.apoio || '')}</span></span>
      <span class="vg-acao__ir">ver atendimentos →</span>
    </button>`).join('') + '</div>';
}

// =============================================================================
// Qualidade da IA
// =============================================================================
const CORES_FAIXA = ['var(--ae-serie-7)', 'var(--ae-serie-1)', 'var(--ae-serie-3)', 'var(--ae-serie-2)', 'var(--ae-serie-5)'];

function semFalhaCritica(motivo) {
  const m = String(motivo || '').trim().toLowerCase();
  return m === 'nenhuma' || m === 'nenhum' || m === '';
}

function pintarQualidade(dados) {
  const k = dados.kpis || {};
  const faixas = (dados.distribuicao_score_faixas || []).map((f, i) => ({ chave: f.chave, rotulo: f.rotulo, cor: CORES_FAIXA[i % CORES_FAIXA.length] }));

  const falhaCriticaLista = (dados.falha_critica || []).filter(f => !semFalhaCritica(f.motivo));
  const comFalhaCritica = Array.isArray(dados.falha_critica)
    ? falhaCriticaLista.reduce((acc, f) => acc + num(f.quantidade), 0)
    : num(k.com_falha_critica);

  $('kpis-qualidade').innerHTML = [
    cardKpi({
      rotulo: 'Efetividade média da IA',
      valor: k.efetividade_media_pct != null ? nf.format(num(k.efetividade_media_pct)) + '%' : '—',
      apoio: 'score da ' + (NOME_IA_AVALIADA[estado.agente] || 'IA') + ' no período',
      medidorPct: num(k.efetividade_media_pct)
    }),
    cardKpi({ rotulo: 'Atendimentos avaliados', valor: nf.format(num(k.avaliados)), apoio: 'com score da ' + (NOME_IA_AVALIADA[estado.agente] || 'IA') + ' no período' }),
    cardKpi({
      rotulo: 'Com falha crítica',
      valor: nf.format(comFalhaCritica),
      alerta: comFalhaCritica > 0,
      apoio: num(k.avaliados) ? nf1.format(pct(comFalhaCritica, num(k.avaliados))) + '% dos avaliados' : '—',
      sinal: 'falha_ia'
    })
  ].join('');

  $('graficos-qualidade').innerHTML =
    cardGrafico('q-distribuicao', 'Distribuição do score de efetividade', 'atendimentos por faixa de nota, ao longo do tempo', true, notaGranularidade(dados)) +
    cardGrafico('q-criterios', 'Critérios avaliados', 'taxa de aprovação por critério, com a quantidade avaliada ao lado') +
    cardGrafico('q-falha', 'Motivo de falha crítica', 'quantidade por motivo');

  graficoBarras('q-distribuicao', dados.distribuicao_score_serie, faixas, dados.granularidade);
  graficoBarrasH('q-criterios', dados.criterios, 'criterio', 'taxa_aprovacao_pct', {
    formatador: v => nf1.format(v) + '%',
    campoSecundario: 'quantidade_avaliada',
    formatadorSecundario: v => nf.format(num(v)) + ' aval.',
    cor: 'var(--ae-serie-2)',
    aoClicarItem: (d) => irParaAtendimentos({ criterio: d.criterio })
  });
  graficoBarrasH('q-falha', falhaCriticaLista, 'motivo', 'quantidade', {
    cor: 'var(--ae-serie-7)',
    aoClicarItem: (d) => irParaAtendimentos({ motivoFalha: d.motivo })
  });
}

// =============================================================================
// Atendimentos (auditoria)
// =============================================================================
const LARGURAS_COLUNA = {
  'Cliente': 16, 'Responsável': 10, 'Tipo': 8, 'Criado em': 9, 'Concluído em': 9,
  'Status': 8, 'Score': 6, 'Avaliação da Supervisora': 28, 'Sinais': 6, 'Feedbacks (Laila)': 10
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
  base.push('Status', 'Score', 'Avaliação da Supervisora', 'Sinais');
  if (podeDarFeedback()) base.push('Feedbacks (Laila)');
  return base;
}

function pintarChipsAuditoria(contadores) {
  const chips = CHIPS_AUDITORIA.filter(c =>
    (!c.soDepartamento || c.soDepartamento === estado.departamento) && (!c.precisaPermissao || podeDarFeedback())
  );
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
  if (item.sem_avaliacao_humana) return '<span class="vg-vazio-celula">Sem avaliação humana disponível</span>';
  if (item.score_efetividade == null) {
    return item.auditado === false
      ? '<span class="vg-vazio-celula">Aguardando auditoria</span>'
      : '<span class="vg-vazio-celula">—</span>';
  }
  const v = num(item.score_efetividade);
  return `<span class="vg-score"><span class="vg-score__valor">${nf.format(v)}</span>
    <span class="vg-score__medidor"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span></span>`;
}

// Bloco secundário exibido em "Colaboradores e IA" e "Somente IA": quando a
// sessão também tem uma avaliação real de colaborador (Sucesso do Cliente,
// via vw_qualidade_humana_sucesso_cliente), mostra as duas notas lado a lado
// em vez de só a nota da Sofia. Nunca substitui a avaliação da Sofia.
function celulaAvaliacaoColaborador(av) {
  if (!av) return '';
  const nome = escapeHtml(av.responsavel || 'Colaborador');
  let corpo;
  if (av.score_efetividade != null) {
    corpo = `<b>${nf.format(num(av.score_efetividade))}</b> — ${av.justificativa_avaliacao ? escapeHtml(av.justificativa_avaliacao) : '<span class="vg-vazio-celula">sem justificativa</span>'}`;
  } else {
    corpo = av.auditado === false ? 'Aguardando auditoria' : '<span class="vg-vazio-celula">—</span>';
  }
  return `<div class="vg-avaliacao-colaborador"><span class="vg-avaliacao-colaborador__rotulo">Colaborador — ${nome}</span>${corpo}</div>`;
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
      <td>${item.justificativa_avaliacao ? `<span class="vg-avaliacao" title="Clique para expandir">${escapeHtml(item.justificativa_avaliacao)}</span>` : (item.sem_avaliacao_humana ? '' : '<span class="vg-vazio-celula">—</span>')}${celulaAvaliacaoColaborador(item.avaliacao_colaborador)}</td>
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
    ...(estado.colaborador ? { colaborador: estado.colaborador } : {}),
    ...(estado.departamento === 'sucesso_cliente' ? { componente: estado.componente } : {}),
    ...(estado.filtroFaixa ? { score_min: estado.filtroFaixa.min, score_max: estado.filtroFaixa.max } : {}),
    ...(estado.filtroMotivoFalha ? { motivo_falha: estado.filtroMotivoFalha } : {}),
    ...(estado.filtroCriterio ? { criterio: estado.filtroCriterio } : {}),
    ...(estado.filtroTipoAtendimento ? { tipo_atendimento: estado.filtroTipoAtendimento } : {}),
    ...(estado.filtroMotivoTransferencia ? { motivo_transferencia: estado.filtroMotivoTransferencia } : {})
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
      ? window.VigiaDemo.metricas(estado.agente, estado.periodos, { componente: estado.componente })
      : await chamarApi('painel-vigia-engel-metricas', parametrosFiltro());
    pintarMetricas();
    marcarAtualizado();
  } catch (e) {
    ativarDemo('A API da Supervisora não respondeu (' + e.message + '), então o painel exibe um conjunto de exemplo. Nenhum número aqui é dado real da operação.');
    try {
      estado.dados = window.VigiaDemo.metricas(estado.agente, estado.periodos, { componente: estado.componente });
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
  popularFiltrosDinamicos(dados);
  $('kpis-visao').className = 'vg-kpis';
  $('graficos-visao').className = 'vg-graficos';
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

    if (estado.filtroMotivoFalha && estado.lista && estado.lista.itens) {
      estado.lista.itens = estado.lista.itens.filter(item => {
        const motivoFiltro = String(estado.filtroMotivoFalha).trim().toLowerCase();
        const motivoAtendimento = String(item.falha_critica || '').trim().toLowerCase();
        
        const isNenhumaFiltro = motivoFiltro === 'nenhuma' || motivoFiltro === 'nenhum' || motivoFiltro === '';
        const isNenhumaAtendimento = motivoAtendimento === 'nenhuma' || motivoAtendimento === 'nenhum' || motivoAtendimento === '';
        
        if (isNenhumaFiltro) {
          return isNenhumaAtendimento;
        }
        return item.falha_critica === estado.filtroMotivoFalha;
      });
      if (estado.pagina === 1 && estado.lista.itens.length < estado.limite) {
        estado.lista.total = estado.lista.itens.length;
      }
    }

    // Mesmo padrão do motivo de falha: garante a faixa de nota na página
    // atual enquanto o endpoint não aplica score_min/score_max.
    if (estado.filtroFaixa && estado.lista && estado.lista.itens) {
      const { min, max } = estado.filtroFaixa;
      const antes = estado.lista.itens.length;
      estado.lista.itens = estado.lista.itens.filter(item => {
        if (item.score_efetividade == null) return false;
        const v = Math.round(num(item.score_efetividade));
        return v >= min && v <= max;
      });
      if (estado.lista.itens.length !== antes && estado.pagina === 1 && estado.lista.itens.length < estado.limite) {
        estado.lista.total = estado.lista.itens.length;
      }
    }

    renderizarTabela(estado.lista);
    marcarAtualizado();
  } catch (e) {
    ativarDemo('A API da Supervisora não respondeu (' + e.message + '), então o painel exibe um conjunto de exemplo. Nenhum número aqui é dado real da operação.');
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
  if (estado.filtroCriterio) {
    pilulas.push(`<span class="vg-pilula">Critério: <b>${escapeHtml(estado.filtroCriterio)}</b>
      <button class="vg-pilula__x" type="button" data-limpar="criterio" aria-label="Remover filtro de critério">×</button></span>`);
  }
  if (estado.filtroMotivoFalha) {
    pilulas.push(`<span class="vg-pilula">Falha: <b>${escapeHtml(estado.filtroMotivoFalha)}</b>
      <button class="vg-pilula__x" type="button" data-limpar="motivo-falha" aria-label="Remover filtro de falha">×</button></span>`);
  }
  if (estado.filtroTipoAtendimento) {
    pilulas.push(`<span class="vg-pilula">Tipo: <b>${escapeHtml(estado.filtroTipoAtendimento)}</b>
      <button class="vg-pilula__x" type="button" data-limpar="tipo-atendimento" aria-label="Remover filtro de tipo">×</button></span>`);
  }
  if (estado.filtroMotivoTransferencia) {
    pilulas.push(`<span class="vg-pilula">Transferência: <b>${escapeHtml(estado.filtroMotivoTransferencia)}</b>
      <button class="vg-pilula__x" type="button" data-limpar="motivo-transferencia" aria-label="Remover filtro de transferência">×</button></span>`);
  }
  if (estado.filtroFaixa) {
    pilulas.push(`<span class="vg-pilula">Faixa: <b>${escapeHtml(estado.filtroFaixa.rotulo)}</b>
      <button class="vg-pilula__x" type="button" data-limpar="faixa" aria-label="Remover filtro de faixa">×</button></span>`);
  }
  if (estado.departamento === 'sucesso_cliente' && estado.componente !== 'ambos') {
    pilulas.push(`<span class="vg-pilula">Componente: <b>${escapeHtml(ROTULOS_COMPONENTE[estado.componente] || estado.componente)}</b>
      <button class="vg-pilula__x" type="button" data-limpar="componente" aria-label="Remover filtro de componente">×</button></span>`);
  }

  $('filtros-resumo').innerHTML = pilulas.join('') + (pilulas.length ? '<button class="vg-limpar" type="button" data-limpar="tudo">Limpar filtros</button>' : '');
  $('filtro-colaborador').classList.toggle('is-alterado', !!estado.colaborador);
  $('filtro-status').classList.toggle('is-alterado', estado.status !== 'todos');
  $('filtro-base-data').classList.toggle('is-alterado', estado.baseData !== 'criacao');
  $('filtro-criterio').classList.toggle('is-alterado', !!estado.filtroCriterio);
  $('filtro-motivo-falha').classList.toggle('is-alterado', !!estado.filtroMotivoFalha);
  $('btn-periodo').classList.toggle('is-alterado', !estado.periodoPreset);
  $('filtro-componente').classList.toggle('is-alterado', estado.componente !== 'ambos');
  $('filtro-avaliado').classList.toggle('is-alterado', estado.avaliado !== 'sim');

  // Contador do botão "Mais filtros": quantos filtros secundários estão ativos.
  const secundarios = [
    estado.status !== 'todos',
    !!estado.filtroCriterio,
    !!estado.filtroMotivoFalha,
    estado.avaliado !== 'sim',
    estado.departamento === 'sucesso_cliente' && estado.componente !== 'ambos'
  ].filter(Boolean).length;
  $('mais-filtros-contador').hidden = !secundarios;
  $('mais-filtros-contador').textContent = secundarios;
  $('btn-mais-filtros').classList.toggle('is-alterado', secundarios > 0);
}

function sincronizarSelectsFiltro() {
  $('filtro-status').value = estado.status;
  $('filtro-criterio').value = estado.filtroCriterio || '';
  $('filtro-motivo-falha').value = estado.filtroMotivoFalha || '';
  $('filtro-componente').value = estado.componente;
}

function irParaAtendimentos(patch) {
  Object.keys(estado.sinais).forEach(k => { estado.sinais[k] = false; });
  estado.filtroMotivoFalha = null;
  estado.filtroCriterio = null;
  estado.filtroTipoAtendimento = null;
  estado.filtroMotivoTransferencia = null;
  estado.filtroFaixa = null;
  if (patch.faixa) estado.filtroFaixa = patch.faixa;
  if (patch.status !== undefined) estado.status = patch.status;
  if (patch.sinal) estado.sinais[patch.sinal] = true;
  if (patch.motivoFalha) estado.filtroMotivoFalha = patch.motivoFalha;
  if (patch.criterio) estado.filtroCriterio = patch.criterio;
  if (patch.tipoAtendimento) estado.filtroTipoAtendimento = patch.tipoAtendimento;
  if (patch.motivoTransferencia) estado.filtroMotivoTransferencia = patch.motivoTransferencia;
  estado.pagina = 1;
  sincronizarSelectsFiltro();
  atualizarResumoFiltros();
  selecionarSecao('auditoria');
}

function popularFiltrosDinamicos(dados) {
  const criterios = Array.from(new Set((dados.criterios || []).map(c => c.criterio).filter(Boolean)));
  const motivos = Array.from(new Set((dados.falha_critica || []).map(f => f.motivo).filter(m => m && !semFalhaCritica(m))));
  const selCriterio = $('filtro-criterio');
  const selMotivo = $('filtro-motivo-falha');
  const atualCriterio = estado.filtroCriterio;
  const atualMotivo = estado.filtroMotivoFalha;
  selCriterio.innerHTML = '<option value="">Todos os critérios</option>' +
    criterios.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  selMotivo.innerHTML = '<option value="">Todos os motivos de falha</option>' +
    motivos.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  selCriterio.value = atualCriterio || '';
  selMotivo.value = atualMotivo || '';
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
// Popover "Mais filtros" (filtros secundários)
// =============================================================================
function abrirPopupMais() { $('mais-filtros-popup').hidden = false; $('btn-mais-filtros').setAttribute('aria-expanded', 'true'); }
function fecharPopupMais() { $('mais-filtros-popup').hidden = true; $('btn-mais-filtros').setAttribute('aria-expanded', 'false'); }

function ligarPopupMais() {
  $('btn-mais-filtros').addEventListener('click', (e) => {
    e.stopPropagation();
    fecharPopupPeriodo();
    if ($('mais-filtros-popup').hidden) abrirPopupMais(); else fecharPopupMais();
  });
  $('mais-filtros-popup').addEventListener('click', (e) => e.stopPropagation());
  $('btn-mais-filtros-fechar').addEventListener('click', fecharPopupMais);
  $('btn-periodo').addEventListener('click', fecharPopupMais);
  document.addEventListener('click', fecharPopupMais);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharPopupMais(); });
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
    ativarDemo('Não foi possível confirmar suas permissões na API da Supervisora, então o painel exibe um conjunto de exemplo. Nenhum número aqui é dado real da operação.');
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
  $('filtro-componente-wrap').hidden = estado.departamento !== 'sucesso_cliente';
  $('filtro-componente').value = estado.componente;
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
  estado.filtroMotivoFalha = null;
  estado.filtroCriterio = null;
  estado.filtroTipoAtendimento = null;
  estado.filtroMotivoTransferencia = null;
  estado.filtroFaixa = null;
  estado.componente = 'ambos';
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
  $('filtro-criterio').addEventListener('change', (e) => {
    estado.filtroCriterio = e.target.value || null;
    recarregarPorFiltro();
  });
  $('filtro-motivo-falha').addEventListener('change', (e) => {
    estado.filtroMotivoFalha = e.target.value || null;
    recarregarPorFiltro();
  });
  $('filtro-componente').addEventListener('change', (e) => {
    estado.componente = e.target.value || 'ambos';
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
    if (qual === 'criterio' || qual === 'tudo') { estado.filtroCriterio = null; $('filtro-criterio').value = ''; }
    if (qual === 'motivo-falha' || qual === 'tudo') { estado.filtroMotivoFalha = null; $('filtro-motivo-falha').value = ''; }
    if (qual === 'tipo-atendimento' || qual === 'tudo') estado.filtroTipoAtendimento = null;
    if (qual === 'motivo-transferencia' || qual === 'tudo') estado.filtroMotivoTransferencia = null;
    if (qual === 'faixa' || qual === 'tudo') estado.filtroFaixa = null;
    if (qual === 'componente' || qual === 'tudo') { estado.componente = 'ambos'; $('filtro-componente').value = 'ambos'; }
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
      const b = e.target.closest('[data-sinal], [data-status]');
      if (!b) return;
      if (b.dataset.sinal) irParaAtendimentos({ sinal: b.dataset.sinal });
      else irParaAtendimentos({ status: b.dataset.status });
    });
  });

  // Drill-down genérico da Visão geral: KPIs, faixas, alertas e "Onde agir"
  // carregam o filtro em data-drill; data-rolar leva a um bloco da própria aba.
  $('secao-visao').addEventListener('click', (e) => {
    const rolar = e.target.closest('[data-rolar]');
    if (rolar) {
      const alvo = $('bloco-' + rolar.dataset.rolar);
      if (!alvo) return;
      if (window.BX24 && typeof BX24.scrollParentWindow === 'function') BX24.scrollParentWindow(alvo.getBoundingClientRect().top + window.scrollY - 20);
      else alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const b = e.target.closest('[data-drill]');
    if (!b) return;
    try { irParaAtendimentos(JSON.parse(b.dataset.drill || '{}')); } catch (err) { irParaAtendimentos({}); }
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
  ligarPopupMais();
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
