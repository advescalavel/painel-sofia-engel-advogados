(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // Configuração
  // -----------------------------------------------------------------------
  var API_BASE = 'https://webhook.prod.advocaciaescalaveldev.shop/webhook';
  var METRICS_URL = API_BASE + '/painel-sucesso-cliente-metricas';
  var AUDITORIA_URL = API_BASE + '/painel-sucesso-cliente-auditoria';
  var AUTO_REFRESH_MS = 3600000; // 1h — intencionalmente lento, para não mudar números durante reuniões/apresentações
  var STALE_AFTER_MS = 75 * 60 * 1000;
  var PAGE_SIZE = 20;

  // Link do chat de suporte
  var SUPPORT_CHAT_URL = 'https://www.bitrix24.net/oauth/select/?preset=im&IM_DIALOG=networkLines2c241bdd31ccc82c8bb67b64d6de9d1f';

  var MESES_NOMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  var PERIODO_LABELS = {
    hoje: 'hoje',
    semana_atual: 'nesta semana',
    semanas_especificas: 'nas semanas selecionadas',
    mes_atual: 'neste mês',
    meses_especificos: 'nos meses selecionados',
    trimestre: 'no trimestre atual',
    semestre: 'no semestre atual',
    personalizado: 'no período selecionado'
  };

  // -----------------------------------------------------------------------
  // Estado
  // -----------------------------------------------------------------------
  var state = {
    tab: 'visao',
    page: 1,
    periodo: 'hoje',
    semanasSelecionadas: [],
    mesesSelecionados: [],
    dataInicio: null,
    dataFim: null,
    lastFetchAt: null,
    refreshTimer: null,
    theme: 'dark'
  };

  function $(id) { return document.getElementById(id); }

  function fmtNumber(n) {
    if (n === null || n === undefined) return '—';
    return String(n);
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function badge(value) {
    if (value === true) return '<span class="badge badge--true">Sim</span>';
    if (value === false) return '<span class="badge badge--false">Não</span>';
    return '<span class="badge badge--null">N/A</span>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // -----------------------------------------------------------------------
  // Período selecionado
  // -----------------------------------------------------------------------
  function currentPeriodParams() {
    var params = { tipo_periodo: state.periodo };
    if (state.periodo === 'personalizado') {
      params.data_inicio = state.dataInicio;
      params.data_fim = state.dataFim;
    } else if (state.periodo === 'meses_especificos') {
      params.meses = state.mesesSelecionados.join(',');
    } else if (state.periodo === 'semanas_especificas') {
      params.semanas = state.semanasSelecionadas.join(',');
    }
    return params;
  }

  function toQueryString(params) {
    return Object.keys(params)
      .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
  }

  function renderPeriodSelection() {
    document.querySelectorAll('.segmented__opt').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.periodo === state.periodo);
    });
    document.querySelectorAll('.chip').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.periodo === state.periodo);
    });
    var texto = 'Dados ' + (PERIODO_LABELS[state.periodo] || 'do período');
    $('periodo-label').textContent = texto;
    $('periodo-label-auditoria').textContent = texto;
  }

  function selectPeriod(tipo) {
    state.periodo = tipo;
    state.page = 1;
    renderPeriodSelection();
    closeAllPopovers();
    loadActiveTab();
  }

  function closeAllPopovers() {
    $('pop-mes').hidden = true;
    $('pop-custom').hidden = true;
    $('pop-semanas').hidden = true;
  }

  function popularListaMeses() {
    var now = new Date();
    var ano = now.getFullYear();
    var mesAtual = now.getMonth() + 1;
    var container = $('lista-meses');
    container.innerHTML = '';
    for (var m = mesAtual; m >= 1; m--) {
      var chave = ano + '-' + String(m).padStart(2, '0');
      var checked = state.mesesSelecionados.indexOf(chave) !== -1;
      var label = document.createElement('label');
      label.className = 'lista-checkbox__item';
      label.innerHTML = '<input type="checkbox" value="' + chave + '"' + (checked ? ' checked' : '') + '> ' + MESES_NOMES[m - 1] + ' / ' + ano;
      container.appendChild(label);
    }
  }

  function segundaFeiraDe(data) {
    var d = new Date(data);
    var diaSemana = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diaSemana);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function fmtDataCurta(d) {
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function popularListaSemanas() {
    var container = $('lista-semanas');
    container.innerHTML = '';
    var hoje = new Date();
    var segundaAtual = segundaFeiraDe(hoje);
    for (var i = 0; i < 12; i++) {
      var segunda = new Date(segundaAtual);
      segunda.setDate(segunda.getDate() - i * 7);
      var domingo = new Date(segunda);
      domingo.setDate(domingo.getDate() + 6);
      var chave = segunda.getFullYear() + '-' + String(segunda.getMonth() + 1).padStart(2, '0') + '-' + String(segunda.getDate()).padStart(2, '0');
      var texto = (i === 0 ? 'Esta semana · ' : i === 1 ? 'Semana passada · ' : '') + fmtDataCurta(segunda) + ' a ' + fmtDataCurta(domingo) + ' / ' + domingo.getFullYear();
      var checked = state.semanasSelecionadas.indexOf(chave) !== -1;
      var label = document.createElement('label');
      label.className = 'lista-checkbox__item';
      label.innerHTML = '<input type="checkbox" value="' + chave + '"' + (checked ? ' checked' : '') + '> ' + texto;
      container.appendChild(label);
    }
  }

  // -----------------------------------------------------------------------
  // Rede
  // -----------------------------------------------------------------------
  function fetchJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function setConnection(ok) {
    var dot = $('conn-dot');
    var label = $('conn-label');
    dot.classList.remove('is-ok', 'is-error');
    dot.classList.add(ok ? 'is-ok' : 'is-error');
    label.textContent = ok ? 'Conectado' : 'Erro de conexão';
  }

  // -----------------------------------------------------------------------
  // Frescor dos dados
  // -----------------------------------------------------------------------
  function markFetched() {
    state.lastFetchAt = Date.now();
    renderFreshness();
  }

  function renderFreshness() {
    var el = $('freshness-left');
    if (!state.lastFetchAt) { el.textContent = 'carregando dados…'; return; }
    var secs = Math.round((Date.now() - state.lastFetchAt) / 1000);
    var label;
    if (secs < 5) label = 'dados de agora mesmo';
    else if (secs < 60) label = 'dados de ' + secs + 's atrás';
    else label = 'dados de ' + Math.round(secs / 60) + ' min atrás';
    el.textContent = label;
    el.classList.toggle('is-stale', (Date.now() - state.lastFetchAt) > STALE_AFTER_MS);
  }

  setInterval(renderFreshness, 5000);

  // -----------------------------------------------------------------------
  // Visão geral
  // -----------------------------------------------------------------------
  function renderBar(elId, value, max) {
    var el = $(elId);
    if (!max || max <= 0) { el.style.width = '0%'; return; }
    var pct = Math.max(0, Math.min(100, (value / max) * 100));
    el.style.width = pct + '%';
  }

  function loadMetrics() {
    $('visao-error').hidden = true;
    $('visao-empty').hidden = true;

    var url = METRICS_URL + '?' + toQueryString(currentPeriodParams());

    return fetchJson(url)
      .then(function (data) {
        setConnection(true);

        var efetividade = data.efetividade_sofia_pct;
        $('m-efetividade').textContent = (efetividade === null || efetividade === undefined) ? '—' : efetividade + '%';
        renderBar('bar-efetividade', efetividade || 0, 100);

        $('m-em-aberto').textContent = fmtNumber(data.atendimentos_em_aberto);
        $('m-criados').textContent = fmtNumber(data.atendimentos_criados);
        $('m-concluidos').textContent = fmtNumber(data.atendimentos_concluidos);
        $('m-sem-resposta').textContent = fmtNumber(data.sem_resposta_24h);
        $('m-transferido-sem-resposta').textContent = fmtNumber(data.transferidos_sem_resposta);
        $('m-sem-aceite').textContent = fmtNumber(data.colaborador_nao_aceitou);

        var totalPeriodo = (data.atendimentos_concluidos || 0) + (data.atendimentos_criados || 0);
        renderBar('bar-concluidos', data.atendimentos_concluidos || 0, totalPeriodo);
        $('hint-concluidos').textContent = fmtNumber(data.atendimentos_concluidos) + ' de ' + fmtNumber(totalPeriodo) + ' atendimentos';

        var semDados = !data.atendimentos_em_aberto && !data.atendimentos_concluidos && !data.atendimentos_criados;
        $('visao-empty').hidden = !semDados;
        markFetched();
      })
      .catch(function (err) {
        setConnection(false);
        var el = $('visao-error');
        el.hidden = false;
        el.textContent = 'Não foi possível carregar as métricas agora (' + err.message + '). Tente novamente em instantes.';
      });
  }

  // -----------------------------------------------------------------------
  // Auditoria
  // -----------------------------------------------------------------------
  var FALHA_LABELS = {
    nenhuma: 'Sem falha',
    informacao_inventada: 'Informação inventada',
    ignorou_pedido_humano: 'Ignorou pedido humano',
    informacao_incorreta: 'Informação incorreta',
    cliente_corrigiu_sofia: 'Cliente corrigiu a Sofia',
    persistiu_apos_erro: 'Persistiu após erro',
    expectativa_incorreta: 'Expectativa incorreta',
    repeticao_sem_evolucao: 'Repetição sem evolução'
  };

  function falhaBadge(falha) {
    if (!falha) return '<span class="badge badge--null">N/A</span>';
    if (falha === 'nenhuma') return '<span class="badge badge--true">Sem falha</span>';
    return '<span class="badge badge--false">' + escapeHtml(FALHA_LABELS[falha] || falha) + '</span>';
  }

  function renderAuditRow(a) {
    var detalheErro = a.categoria_erro
      ? '<strong>' + escapeHtml(a.categoria_erro) + '</strong>' +
        (a.evidencia_erro ? '<em>Evidência:</em> ' + escapeHtml(a.evidencia_erro) + ' ' : '') +
        (a.impacto_erro ? '<em>Impacto:</em> ' + escapeHtml(a.impacto_erro) + ' ' : '') +
        (a.sugestao_melhoria ? '<em>Sugestão:</em> ' + escapeHtml(a.sugestao_melhoria) : '')
      : (a.justificativa_avaliacao
          ? '<strong>' + escapeHtml(a.acao_recomendada || 'Sem ação recomendada') + '</strong>' + escapeHtml(a.justificativa_avaliacao)
          : '<span>Ainda não avaliado.</span>');

    var nomeCliente = escapeHtml(a.cliente || 'Não informado');
    var clienteHtml = a.chat_id
      ? '<a class="cell-session__name cell-session__link" href="https://engeladvogados.bitrix24.com.br/online/?IM_DIALOG=chat' + encodeURIComponent(a.chat_id) + '" target="_blank" rel="noopener">' + nomeCliente + '</a>'
      : '<span class="cell-session__name cell-session__name--plain">' + nomeCliente + '</span>';

    var scoreHtml = (a.score_efetividade === null || a.score_efetividade === undefined) ? '—' : a.score_efetividade;
    var subScores = (a.compreensao_demanda_score !== null && a.compreensao_demanda_score !== undefined)
      ? '<br><span class="sub-score">C ' + a.compreensao_demanda_score + ' · P ' + a.precisao_resposta_score + ' · E ' + a.esforco_cliente_score + ' · Enc ' + a.encaminhamento_score + '</span>'
      : '';

    return '' +
      '<tr>' +
        '<td class="cell-session">' +
          clienteHtml +
          escapeHtml(a.session_id || '') +
        '</td>' +
        '<td>' + fmtDateTime(a.avaliado_em) + '</td>' +
        '<td class="score-cell">' + scoreHtml + subScores + '</td>' +
        '<td>' + falhaBadge(a.falha_critica) + '</td>' +
        '<td>' + badge(a.informacao_processual_correta) + '</td>' +
        '<td>' + badge(a.alucinacao_detectada) + '</td>' +
        '<td>' + badge(a.insatisfacao_com_escritorio) + '</td>' +
        '<td>' + badge(a.alerta_golpe_repassado) + '</td>' +
        '<td>' + badge(a.transferencia_confirmada) + '</td>' +
        '<td class="justificativa">' + detalheErro + '</td>' +
      '</tr>';
  }

  function classificationFilterParams() {
    return {
      filtro_canal: $('filtro-canal').value,
      filtro_info_processual: $('filtro-info').value,
      filtro_alucinacao: $('filtro-alucinacao').value,
      filtro_insatisfacao: $('filtro-insatisfacao').value,
      filtro_golpe: $('filtro-golpe').value,
      filtro_transferencia: $('filtro-transferencia').value,
      filtro_sem_resposta: $('filtro-sem-resposta').value,
      filtro_transferido_sem_resposta: $('filtro-transferido-sem-resposta').value,
      filtro_sem_aceite: $('filtro-sem-aceite').value,
      filtro_falha_critica: $('filtro-falha-critica').value
    };
  }

  function loadAuditoria() {
    $('auditoria-error').hidden = true;
    $('auditoria-empty').hidden = true;
    $('pagination').hidden = true;

    var params = currentPeriodParams();
    params.page = state.page;
    params.pageSize = PAGE_SIZE;
    Object.assign(params, classificationFilterParams());

    var url = AUDITORIA_URL + '?' + toQueryString(params);

    return fetchJson(url)
      .then(function (data) {
        setConnection(true);
        var rows = data.atendimentos || [];
        var tbody = $('audit-tbody');

        if (rows.length === 0) {
          tbody.innerHTML = '';
          $('auditoria-empty').hidden = false;
        } else {
          tbody.innerHTML = rows.map(renderAuditRow).join('');
        }

        var totalPages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || PAGE_SIZE)));
        $('pag-info').textContent = 'Página ' + data.page + ' de ' + totalPages + ' · ' + data.total + ' atendimentos';
        $('pag-anterior').disabled = data.page <= 1;
        $('pag-proxima').disabled = data.page >= totalPages;
        $('pagination').hidden = rows.length === 0 && data.page === 1;

        markFetched();
      })
      .catch(function (err) {
        setConnection(false);
        var el = $('auditoria-error');
        el.hidden = false;
        el.textContent = 'Não foi possível carregar a auditoria agora (' + err.message + '). Tente novamente em instantes.';
        $('audit-tbody').innerHTML = '';
      });
  }

  // -----------------------------------------------------------------------
  // Orquestração de abas
  // -----------------------------------------------------------------------
  function loadActiveTab() {
    if (state.tab === 'visao') return loadMetrics();
    return loadAuditoria();
  }

  function switchTab(tab) {
    state.tab = tab;
    state.page = 1;

    var isVisao = tab === 'visao';
    $('painel-visao').hidden = !isVisao;
    $('painel-auditoria').hidden = isVisao;
    $('tab-visao').classList.toggle('is-active', isVisao);
    $('tab-auditoria').classList.toggle('is-active', !isVisao);
    $('tab-visao').setAttribute('aria-selected', String(isVisao));
    $('tab-auditoria').setAttribute('aria-selected', String(!isVisao));

    loadActiveTab();
  }

  function restartAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(loadActiveTab, AUTO_REFRESH_MS);
  }

  // -----------------------------------------------------------------------
  // Eventos — período
  // -----------------------------------------------------------------------
  document.querySelectorAll('.segmented__opt').forEach(function (el) {
    el.addEventListener('click', function (evt) {
      var tipo = el.dataset.periodo;
      if (tipo === 'personalizado') {
        evt.stopPropagation();
        $('pop-mes').hidden = true;
        $('pop-semanas').hidden = true;
        $('pop-custom').hidden = !$('pop-custom').hidden;
        return;
      }
      selectPeriod(tipo);
    });
  });

  document.querySelectorAll('.chip').forEach(function (el) {
    el.addEventListener('click', function (evt) {
      var tipo = el.dataset.periodo;
      if (tipo === 'meses_especificos') {
        evt.stopPropagation();
        $('pop-custom').hidden = true;
        $('pop-semanas').hidden = true;
        var abrirMes = $('pop-mes').hidden;
        if (abrirMes) popularListaMeses();
        $('pop-mes').hidden = !abrirMes;
        return;
      }
      if (tipo === 'semanas_especificas') {
        evt.stopPropagation();
        $('pop-custom').hidden = true;
        $('pop-mes').hidden = true;
        var abrirSemana = $('pop-semanas').hidden;
        if (abrirSemana) popularListaSemanas();
        $('pop-semanas').hidden = !abrirSemana;
        return;
      }
      selectPeriod(tipo);
    });
  });

  document.addEventListener('click', function (evt) {
    if (!evt.target.closest('.chip-pop-wrap')) closeAllPopovers();
  });

  $('aplicar-mes').addEventListener('click', function (evt) {
    evt.stopPropagation();
    var marcados = Array.prototype.slice.call($('lista-meses').querySelectorAll('input:checked')).map(function (i) { return i.value; });
    if (!marcados.length) return;
    state.mesesSelecionados = marcados;
    selectPeriod('meses_especificos');
  });

  $('aplicar-semanas').addEventListener('click', function (evt) {
    evt.stopPropagation();
    var marcados = Array.prototype.slice.call($('lista-semanas').querySelectorAll('input:checked')).map(function (i) { return i.value; });
    if (!marcados.length) return;
    state.semanasSelecionadas = marcados;
    selectPeriod('semanas_especificas');
  });

  $('aplicar-custom').addEventListener('click', function (evt) {
    evt.stopPropagation();
    var inicio = $('input-inicio').value;
    var fim = $('input-fim').value;
    if (!inicio || !fim) return;
    state.dataInicio = inicio;
    state.dataFim = fim;
    selectPeriod('personalizado');
  });

  // -----------------------------------------------------------------------
  // Eventos — abas e paginação
  // -----------------------------------------------------------------------
  $('tab-visao').addEventListener('click', function () { switchTab('visao'); });
  $('tab-auditoria').addEventListener('click', function () { switchTab('auditoria'); });

  $('pag-anterior').addEventListener('click', function () {
    if (state.page > 1) { state.page -= 1; loadAuditoria(); }
  });
  $('pag-proxima').addEventListener('click', function () {
    state.page += 1; loadAuditoria();
  });

  var FILTROS_AUDITORIA_IDS = ['filtro-canal', 'filtro-info', 'filtro-alucinacao', 'filtro-insatisfacao', 'filtro-golpe', 'filtro-transferencia', 'filtro-sem-resposta', 'filtro-transferido-sem-resposta', 'filtro-sem-aceite', 'filtro-falha-critica'];

  FILTROS_AUDITORIA_IDS.forEach(function (id) {
    $(id).addEventListener('change', function () {
      state.page = 1;
      loadAuditoria();
    });
  });

  $('limpar-filtros-auditoria').addEventListener('click', function () {
    FILTROS_AUDITORIA_IDS.forEach(function (id) { $(id).value = ''; });
    state.page = 1;
    loadAuditoria();
  });

  // -----------------------------------------------------------------------
  // Atualização manual
  // -----------------------------------------------------------------------
  $('btn-atualizar').addEventListener('click', function () {
    var btn = $('btn-atualizar');
    btn.classList.add('is-spinning');
    Promise.resolve(loadActiveTab()).finally(function () {
      setTimeout(function () { btn.classList.remove('is-spinning'); }, 400);
    });
  });

  // -----------------------------------------------------------------------
  // Tema claro/escuro
  // -----------------------------------------------------------------------
  var ICON_SUN = '<path d="M10 2.5v2M10 15.5v2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M2.5 10h2M15.5 10h2M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="10" r="3.6" stroke="currentColor" stroke-width="1.5"/>';
  var ICON_MOON = '<path d="M15.5 11.8A6 6 0 0 1 8.2 4.5a6.3 6.3 0 1 0 7.3 7.3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>';

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    $('icone-tema').innerHTML = theme === 'dark' ? ICON_SUN : ICON_MOON;
    try { localStorage.setItem('vigia-theme', theme); } catch (e) { /* localStorage indisponível — segue só na sessão atual */ }
  }

  $('btn-tema').addEventListener('click', function () {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  });

  function loadInitialTheme() {
    var saved = null;
    try { saved = localStorage.getItem('vigia-theme'); } catch (e) { /* ignora */ }
    if (saved === 'light' || saved === 'dark') return saved;
    var prefereClaro = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    return prefereClaro ? 'light' : 'dark';
  }

  // -----------------------------------------------------------------------
  // Suporte
  // -----------------------------------------------------------------------
  function setupSupportButton() {
    var btn = $('btn-suporte');
    if (!SUPPORT_CHAT_URL) {
      btn.classList.add('is-disabled');
      btn.removeAttribute('href');
      btn.title = 'Link de suporte ainda não configurado';
    } else {
      btn.href = SUPPORT_CHAT_URL;
      btn.title = 'Falar com o suporte';
    }
  }

  // -----------------------------------------------------------------------
  // Inicialização
  // -----------------------------------------------------------------------
  function init() {
    applyTheme(loadInitialTheme());
    setupSupportButton();
    renderPeriodSelection();
    loadActiveTab();
    restartAutoRefresh();

    if (window.BX24 && typeof window.BX24.init === 'function') {
      window.BX24.init(function () {
        if (typeof window.BX24.fitWindow === 'function') window.BX24.fitWindow();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
