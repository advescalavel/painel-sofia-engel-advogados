(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // Configuração
  // -----------------------------------------------------------------------
  var API_BASE = 'https://webhook.prod.advocaciaescalaveldev.shop/webhook';
  var METRICS_URL = API_BASE + '/painel-sucesso-cliente-metricas';
  var AUDITORIA_URL = API_BASE + '/painel-sucesso-cliente-auditoria';
  var AUTO_REFRESH_MS = 3600000; // 1h — intencionalmente lento, para não mudar números durante reuniões/apresentações
  var STALE_AFTER_MS = 75 * 60 * 1000; // só avisa "desatualizado" se passar bem do ciclo normal de 1h (ex.: timer travou)

  var PAGE_SIZE = 20;

  // -----------------------------------------------------------------------
  // Estado
  // -----------------------------------------------------------------------
  var state = {
    tab: 'visao',
    page: 1,
    lastFetchAt: null,
    refreshTimer: null
  };

  // -----------------------------------------------------------------------
  // Utilidades de DOM
  // -----------------------------------------------------------------------
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
    var tipo = $('periodo-tipo').value;
    var params = { tipo_periodo: tipo };
    if (tipo === 'personalizado') {
      params.data_inicio = $('periodo-inicio').value;
      params.data_fim = $('periodo-fim').value;
    } else if (tipo === 'meses_retroativos') {
      params.meses = $('periodo-meses').value || '2';
    }
    return params;
  }

  function toQueryString(params) {
    return Object.keys(params)
      .filter(function (k) { return params[k] !== undefined && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
  }

  function updatePeriodFieldsVisibility() {
    var tipo = $('periodo-tipo').value;
    $('campo-meses').hidden = tipo !== 'meses_retroativos';
    $('campo-custom').hidden = tipo !== 'personalizado';
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

  // -----------------------------------------------------------------------
  // Frescor dos dados
  // -----------------------------------------------------------------------
  function markFetched() {
    state.lastFetchAt = Date.now();
    renderFreshness();
  }

  function renderFreshness() {
    var el = $('freshness-indicator');
    if (!state.lastFetchAt) { el.textContent = 'Carregando dados…'; return; }
    var secs = Math.round((Date.now() - state.lastFetchAt) / 1000);
    var label;
    if (secs < 5) label = 'agora mesmo';
    else if (secs < 60) label = 'há ' + secs + 's';
    else label = 'há ' + Math.round(secs / 60) + ' min';
    el.textContent = 'Painel atualizado ' + label + ' (atualiza a cada hora). Os dados no banco seguem o ciclo de coleta (~1 min) e de avaliação da Sofia (~5 min).';
    el.classList.toggle('is-stale', (Date.now() - state.lastFetchAt) > STALE_AFTER_MS);
  }

  setInterval(renderFreshness, 5000);

  // -----------------------------------------------------------------------
  // Gauge (efetividade da Sofia)
  // -----------------------------------------------------------------------
  var GAUGE_CIRCUMFERENCE = 282.7;

  function renderGauge(pct) {
    var fill = $('gauge-fill');
    var number = $('gauge-number');
    if (pct === null || pct === undefined) {
      fill.style.strokeDashoffset = String(GAUGE_CIRCUMFERENCE);
      number.textContent = '—';
      return;
    }
    var clamped = Math.max(0, Math.min(100, pct));
    var offset = GAUGE_CIRCUMFERENCE * (1 - clamped / 100);
    fill.style.strokeDashoffset = String(offset);
    number.textContent = String(Math.round(clamped));

    var color = 'var(--accent)';
    if (clamped >= 70) color = 'var(--success)';
    else if (clamped < 40) color = 'var(--warning)';
    fill.style.stroke = color;
  }

  // -----------------------------------------------------------------------
  // Visão geral
  // -----------------------------------------------------------------------
  function loadMetrics() {
    $('visao-error').hidden = true;
    $('visao-empty').hidden = true;

    var url = METRICS_URL + '?' + toQueryString(currentPeriodParams());

    return fetchJson(url)
      .then(function (data) {
        renderGauge(data.efetividade_sofia_pct);
        $('m-em-aberto').textContent = fmtNumber(data.atendimentos_em_aberto);
        $('m-concluidos').textContent = fmtNumber(data.atendimentos_concluidos);
        $('m-criados').textContent = fmtNumber(data.atendimentos_criados);
        $('m-transferido-sem-resposta').textContent = fmtNumber(data.transferidos_sem_resposta);
        $('m-sem-aceite').textContent = fmtNumber(data.colaborador_nao_aceitou);

        var semDados = !data.atendimentos_em_aberto && !data.atendimentos_concluidos && !data.atendimentos_criados;
        $('visao-empty').hidden = !semDados;
        markFetched();
      })
      .catch(function (err) {
        var el = $('visao-error');
        el.hidden = false;
        el.textContent = 'Não foi possível carregar as métricas agora (' + err.message + '). Tente atualizar em instantes.';
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
        var el = $('auditoria-error');
        el.hidden = false;
        el.textContent = 'Não foi possível carregar a auditoria agora (' + err.message + '). Tente atualizar em instantes.';
        $('audit-tbody').innerHTML = '';
      });
  }

  // -----------------------------------------------------------------------
  // Orquestração de carregamento / abas
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

  function manualRefresh() {
    var btn = $('atualizar-agora');
    btn.classList.add('is-spinning');
    loadActiveTab().finally(function () {
      setTimeout(function () { btn.classList.remove('is-spinning'); }, 300);
    });
  }

  // -----------------------------------------------------------------------
  // Eventos
  // -----------------------------------------------------------------------
  $('tab-visao').addEventListener('click', function () { switchTab('visao'); });
  $('tab-auditoria').addEventListener('click', function () { switchTab('auditoria'); });

  $('periodo-tipo').addEventListener('change', function () {
    updatePeriodFieldsVisibility();
    if ($('periodo-tipo').value !== 'personalizado') {
      state.page = 1;
      loadActiveTab();
    }
  });

  $('periodo-meses').addEventListener('change', function () {
    state.page = 1;
    loadActiveTab();
  });

  $('aplicar-periodo').addEventListener('click', function () {
    state.page = 1;
    loadActiveTab();
  });

  $('atualizar-agora').addEventListener('click', manualRefresh);

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
    updatePeriodFieldsVisibility();
    renderGauge(null);
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
