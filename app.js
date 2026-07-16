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

  var PERIODO_LABELS = {
    hoje: 'hoje',
    semana_atual: 'nesta semana',
    semana_anterior: 'na semana anterior',
    mes_atual: 'neste mês',
    meses_retroativos: 'no período selecionado',
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
    meses: 2,
    dataInicio: null,
    dataFim: null,
    lastFetchAt: null,
    refreshTimer: null
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
    } else if (state.periodo === 'meses_retroativos') {
      params.meses = state.meses;
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
    $('periodo-label').textContent = 'Dados ' + (PERIODO_LABELS[state.periodo] || 'do período');
  }

  function selectPeriod(tipo) {
    state.periodo = tipo;
    state.page = 1;
    renderPeriodSelection();
    closeAllPopovers();
    loadActiveTab();
  }

  function closeAllPopovers() {
    $('pop-meses').hidden = true;
    $('pop-custom').hidden = true;
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
  function renderAuditRow(a) {
    var justificativa = a.justificativa_avaliacao
      ? '<strong>' + escapeHtml(a.acao_recomendada || 'Sem ação recomendada') + '</strong>' + escapeHtml(a.justificativa_avaliacao)
      : '<span>Ainda não avaliado.</span>';

    return '' +
      '<tr>' +
        '<td class="cell-session">' +
          '<span class="cell-session__name">' + escapeHtml(a.cliente || 'Não informado') + '</span>' +
          escapeHtml(a.session_id || '') +
        '</td>' +
        '<td>' + fmtDateTime(a.avaliado_em) + '</td>' +
        '<td class="score-cell">' + (a.score_efetividade === null || a.score_efetividade === undefined ? '—' : a.score_efetividade) + '</td>' +
        '<td>' + badge(a.informacao_processual_correta) + '</td>' +
        '<td>' + badge(a.alucinacao_detectada) + '</td>' +
        '<td>' + badge(a.insatisfacao_com_escritorio) + '</td>' +
        '<td>' + badge(a.alerta_golpe_repassado) + '</td>' +
        '<td>' + badge(a.transferencia_confirmada) + '</td>' +
        '<td class="justificativa">' + justificativa + '</td>' +
      '</tr>';
  }

  function loadAuditoria() {
    $('auditoria-error').hidden = true;
    $('auditoria-empty').hidden = true;
    $('pagination').hidden = true;

    var params = currentPeriodParams();
    params.page = state.page;
    params.pageSize = PAGE_SIZE;

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
    el.addEventListener('click', function () { selectPeriod(el.dataset.periodo); });
  });

  document.querySelectorAll('.chip').forEach(function (el) {
    el.addEventListener('click', function (evt) {
      var tipo = el.dataset.periodo;
      if (tipo === 'meses_retroativos') {
        evt.stopPropagation();
        $('pop-custom').hidden = true;
        $('pop-meses').hidden = !$('pop-meses').hidden;
        return;
      }
      if (tipo === 'personalizado') {
        evt.stopPropagation();
        $('pop-meses').hidden = true;
        $('pop-custom').hidden = !$('pop-custom').hidden;
        return;
      }
      selectPeriod(tipo);
    });
  });

  document.addEventListener('click', function (evt) {
    if (!evt.target.closest('.chip-pop-wrap')) closeAllPopovers();
  });

  $('aplicar-meses').addEventListener('click', function (evt) {
    evt.stopPropagation();
    state.meses = Number($('input-meses').value) || 1;
    selectPeriod('meses_retroativos');
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

  // -----------------------------------------------------------------------
  // Inicialização
  // -----------------------------------------------------------------------
  function init() {
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
