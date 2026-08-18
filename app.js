(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // Configuração
  // -----------------------------------------------------------------------
  var API_BASE = 'https://webhook.prod.advocaciaescalaveldev.shop/webhook';
  var METRICS_URL = API_BASE + '/painel-sucesso-cliente-metricas';
  var AUDITORIA_URL = API_BASE + '/painel-sucesso-cliente-auditoria';
  var OBSERVACAO_URL = API_BASE + '/painel-sucesso-cliente-observacao';
  var QH_URL = API_BASE + '/painel-sucesso-cliente-auditoria-humana';
  var AUTO_REFRESH_MS = 3600000; // 1h — intencionalmente lento, para não mudar números durante reuniões/apresentações
  var STALE_AFTER_MS = 75 * 60 * 1000;
  var PAGE_SIZE = 20;

  // Link do chat de suporte
  var SUPPORT_CHAT_URL = 'https://engeladvogados.bitrix24.com.br/online/?IM_DIALOG=67807';

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
    qhPage: 1,
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
    $('periodo-label-qh').textContent = texto;
  }

  function selectPeriod(tipo) {
    state.periodo = tipo;
    state.page = 1;
    state.qhPage = 1;
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

  var DIAS_SEMANA_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  function renderBarChart(elId, valores, labels) {
    var container = $(elId);
    var max = Math.max.apply(null, valores.concat([1]));
    container.innerHTML = valores.map(function (v, i) {
      var alturaPct = Math.max(2, Math.round((v / max) * 100));
      return '' +
        '<div class="bar-chart__col">' +
          '<span class="bar-chart__value">' + fmtNumber(v) + '</span>' +
          '<div class="bar-chart__bar" style="height:' + alturaPct + '%"></div>' +
          '<span class="bar-chart__label">' + labels[i] + '</span>' +
        '</div>';
    }).join('');
  }

  function fmtDuracao(segundos) {
    if (segundos === null || segundos === undefined) return '—';
    if (segundos < 60) return segundos + 's';
    var min = Math.round(segundos / 60);
    if (min < 60) return min + ' min';
    var horas = Math.floor(min / 60);
    var minRestantes = min % 60;
    return horas + 'h' + (minRestantes ? ' ' + minRestantes + 'min' : '');
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
        $('m-sem-resposta-cliente').textContent = fmtNumber(data.sem_resposta_cliente_24h);

        var totalPeriodo = (data.atendimentos_concluidos || 0) + (data.atendimentos_criados || 0);
        renderBar('bar-concluidos', data.atendimentos_concluidos || 0, totalPeriodo);
        $('hint-concluidos').textContent = fmtNumber(data.atendimentos_concluidos) + ' de ' + fmtNumber(totalPeriodo) + ' atendimentos';

        var iaPuraPct = data.atendimentos_ia_pura_pct;
        $('m-ia-pura').textContent = (iaPuraPct === null || iaPuraPct === undefined) ? '—' : iaPuraPct + '%';
        renderBar('bar-ia-pura', iaPuraPct || 0, 100);
        $('hint-ia-pura').textContent = fmtNumber(data.atendimentos_concluidos_ia_pura) + ' de ' + fmtNumber(data.atendimentos_concluidos_base_ia_pura) + ' atendimentos concluídos, sem interação humana';

        renderBarChart('chart-dia-semana', data.distribuicao_dia_semana || [0, 0, 0, 0, 0, 0, 0], DIAS_SEMANA_LABELS);
        $('m-tempo-resposta').textContent = fmtDuracao(data.tempo_resposta_medio_seg);

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
    var scoreInlineHtml = (a.score_efetividade === null || a.score_efetividade === undefined)
      ? ''
      : '<span class="cell-session__score' + (a.score_efetividade < 60 ? ' cell-session__score--baixo' : '') + '">' + a.score_efetividade + '</span>';
    var subScores = (a.compreensao_demanda_score !== null && a.compreensao_demanda_score !== undefined)
      ? '<br><span class="sub-score">C ' + a.compreensao_demanda_score + ' · P ' + a.precisao_resposta_score + ' · E ' + a.esforco_cliente_score + ' · Enc ' + a.encaminhamento_score + '</span>'
      : '';

    return '' +
      '<tr>' +
        '<td class="cell-session">' +
          clienteHtml + scoreInlineHtml + '<br>' +
          escapeHtml(a.session_id || '') +
        '</td>' +
        '<td class="justificativa">' + detalheErro + '</td>' +
        '<td>' + fmtDateTime(a.avaliado_em) + '</td>' +
        '<td class="score-cell">' + scoreHtml + subScores + '</td>' +
        '<td>' + falhaBadge(a.falha_critica) + '</td>' +
        '<td>' + badge(a.informacao_processual_correta) + '</td>' +
        '<td>' + badge(a.alucinacao_detectada) + '</td>' +
        '<td>' + badge(a.insatisfacao_com_escritorio) + '</td>' +
        '<td>' + badge(a.alerta_golpe_repassado) + '</td>' +
        '<td>' + badge(a.transferencia_confirmada) + '</td>' +
        '<td class="observacao-cell">' +
          '<textarea class="observacao-texto" data-session-id="' + escapeHtml(a.session_id || '') + '" placeholder="Ponderação, observação ou feedback sobre este atendimento..." rows="2"></textarea>' +
          '<button type="button" class="btn btn--ghost btn--small observacao-enviar" data-session-id="' + escapeHtml(a.session_id || '') + '">Enviar para Mell</button>' +
          '<span class="observacao-status" data-session-id="' + escapeHtml(a.session_id || '') + '"></span>' +
        '</td>' +
      '</tr>';
  }

  function enviarObservacao(sessionId, textarea, statusEl, botao) {
    var texto = (textarea.value || '').trim();
    if (!texto) {
      statusEl.textContent = 'Escreva algo antes de enviar.';
      statusEl.className = 'observacao-status observacao-status--erro';
      return;
    }
    botao.disabled = true;
    statusEl.textContent = 'Enviando...';
    statusEl.className = 'observacao-status';

    fetch(OBSERVACAO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, texto: texto, autor: 'Laila' })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Falha ao enviar (' + res.status + ')');
        return res.json();
      })
      .then(function () {
        statusEl.textContent = 'Enviado para a Mell.';
        statusEl.className = 'observacao-status observacao-status--ok';
        textarea.value = '';
      })
      .catch(function (err) {
        statusEl.textContent = 'Não foi possível enviar (' + err.message + ').';
        statusEl.className = 'observacao-status observacao-status--erro';
      })
      .finally(function () {
        botao.disabled = false;
      });
  }

  function selectedValues(id) {
    return Array.prototype.slice.call($(id).selectedOptions).map(function (o) { return o.value; });
  }

  function classificationFilterParams() {
    return {
      filtro_canal: selectedValues('filtro-canal').join(','),
      filtro_info_processual: selectedValues('filtro-info').join(','),
      filtro_alucinacao: selectedValues('filtro-alucinacao').join(','),
      filtro_insatisfacao: selectedValues('filtro-insatisfacao').join(','),
      filtro_golpe: selectedValues('filtro-golpe').join(','),
      filtro_transferencia: selectedValues('filtro-transferencia').join(','),
      filtro_sem_resposta: selectedValues('filtro-sem-resposta').join(','),
      filtro_transferido_sem_resposta: selectedValues('filtro-transferido-sem-resposta').join(','),
      filtro_sem_aceite: selectedValues('filtro-sem-aceite').join(','),
      filtro_sem_resposta_cliente: selectedValues('filtro-sem-resposta-cliente').join(','),
      filtro_falha_critica: selectedValues('filtro-falha-critica').join(',')
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
  // Qualidade Humana (análise automática do Vigia + observação da gestão)
  // -----------------------------------------------------------------------
  function statusBadgeQH(auditado) {
    return auditado
      ? '<span class="badge badge--true">Analisado pelo Vigia</span>'
      : '<span class="badge badge--null">Ainda não analisado</span>';
  }

  function analiseQHHtml(a) {
    if (!a.auditado) return '<span>Ainda não analisado pelo Vigia.</span>';
    var subScores = '<span class="sub-score">Obj ' + fmtNumber(a.objetividade_score) +
      ' · Simp ' + fmtNumber(a.simplicidade_score) +
      ' · Vel ' + fmtNumber(a.velocidade_score) +
      ' · Prev ' + fmtNumber(a.previsibilidade_score) + '</span>';
    var detalhe = a.categoria_erro_humano
      ? '<strong>' + escapeHtml(a.categoria_erro_humano) + '</strong>' +
        (a.evidencia_erro_humano ? '<em>Evidência:</em> ' + escapeHtml(a.evidencia_erro_humano) + ' ' : '') +
        (a.impacto_erro_humano ? '<em>Impacto:</em> ' + escapeHtml(a.impacto_erro_humano) + ' ' : '') +
        (a.sugestao_melhoria_humano ? '<em>Sugestão:</em> ' + escapeHtml(a.sugestao_melhoria_humano) : '')
      : (a.justificativa_humano
          ? '<strong>' + escapeHtml(a.acao_recomendada_humano || 'Sem ação recomendada') + '</strong>' + escapeHtml(a.justificativa_humano)
          : '<span>Sem observações do Vigia.</span>');
    return subScores + '<br>' + detalhe;
  }

  function renderQHRow(a) {
    var sid = escapeHtml(a.session_id || '');
    var nomeCliente = escapeHtml(a.cliente || 'Não informado');
    var clienteHtml = a.chat_id
      ? '<a class="cell-session__name cell-session__link" href="https://engeladvogados.bitrix24.com.br/online/?IM_DIALOG=chat' + encodeURIComponent(a.chat_id) + '" target="_blank" rel="noopener">' + nomeCliente + '</a>'
      : '<span class="cell-session__name cell-session__name--plain">' + nomeCliente + '</span>';
    var score = (a.score_efetividade_humano === null || a.score_efetividade_humano === undefined) ? '—' : a.score_efetividade_humano;

    return '' +
      '<tr>' +
        '<td class="cell-session">' + clienteHtml + '<br>' + sid + '</td>' +
        '<td>' + escapeHtml(a.colaborador_responsavel || 'Não informado') + '</td>' +
        '<td>' + fmtDateTime(a.iniciado_em) + '</td>' +
        '<td>' + statusBadgeQH(a.auditado) + '</td>' +
        '<td class="score-cell">' + score + '</td>' +
        '<td class="justificativa">' + analiseQHHtml(a) + '</td>' +
        '<td class="observacao-cell">' +
          '<textarea class="observacao-texto" data-session-id="' + sid + '" placeholder="Ponderação, observação ou feedback sobre este atendimento..." rows="2"></textarea>' +
          '<button type="button" class="btn btn--ghost btn--small observacao-enviar" data-session-id="' + sid + '">Enviar para Mell</button>' +
          '<span class="observacao-status" data-session-id="' + sid + '"></span>' +
        '</td>' +
      '</tr>';
  }

  function classificationFilterParamsQH() {
    return {
      filtro_status: $('filtro-qh-status').value || '',
      filtro_colaborador: ($('filtro-qh-colaborador').value || '').trim()
    };
  }

  function loadQualidadeHumana() {
    $('qh-error').hidden = true;
    $('qh-empty').hidden = true;
    $('qh-pagination').hidden = true;

    var params = currentPeriodParams();
    params.page = state.qhPage;
    params.pageSize = PAGE_SIZE;
    Object.assign(params, classificationFilterParamsQH());

    var url = QH_URL + '?' + toQueryString(params);

    return fetchJson(url)
      .then(function (data) {
        setConnection(true);
        var rows = data.atendimentos || [];
        var tbody = $('qh-tbody');

        if (rows.length === 0) {
          tbody.innerHTML = '';
          $('qh-empty').hidden = false;
        } else {
          tbody.innerHTML = rows.map(renderQHRow).join('');
        }

        var totalPages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || PAGE_SIZE)));
        $('qh-pag-info').textContent = 'Página ' + data.page + ' de ' + totalPages + ' · ' + data.total + ' atendimentos';
        $('qh-pag-anterior').disabled = data.page <= 1;
        $('qh-pag-proxima').disabled = data.page >= totalPages;
        $('qh-pagination').hidden = rows.length === 0 && data.page === 1;

        markFetched();
      })
      .catch(function (err) {
        setConnection(false);
        var el = $('qh-error');
        el.hidden = false;
        el.textContent = 'Não foi possível carregar a auditoria humana agora (' + err.message + '). Tente novamente em instantes.';
        $('qh-tbody').innerHTML = '';
      });
  }

  // -----------------------------------------------------------------------
  // Orquestração de abas
  // -----------------------------------------------------------------------
  function loadActiveTab() {
    if (state.tab === 'visao') return loadMetrics();
    if (state.tab === 'qualidade_humana') return loadQualidadeHumana();
    return loadAuditoria();
  }

  function switchTab(tab) {
    state.tab = tab;
    state.page = 1;
    state.qhPage = 1;

    $('painel-visao').hidden = tab !== 'visao';
    $('painel-auditoria').hidden = tab !== 'auditoria';
    $('painel-qualidade-humana').hidden = tab !== 'qualidade_humana';

    $('tab-visao').classList.toggle('is-active', tab === 'visao');
    $('tab-auditoria').classList.toggle('is-active', tab === 'auditoria');
    $('tab-qualidade-humana').classList.toggle('is-active', tab === 'qualidade_humana');

    $('tab-visao').setAttribute('aria-selected', String(tab === 'visao'));
    $('tab-auditoria').setAttribute('aria-selected', String(tab === 'auditoria'));
    $('tab-qualidade-humana').setAttribute('aria-selected', String(tab === 'qualidade_humana'));

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
  $('tab-qualidade-humana').addEventListener('click', function () { switchTab('qualidade_humana'); });

  $('audit-tbody').addEventListener('click', function (ev) {
    var botao = ev.target.closest('.observacao-enviar');
    if (!botao) return;
    var sessionId = botao.getAttribute('data-session-id');
    var td = botao.closest('.observacao-cell');
    var textarea = td.querySelector('.observacao-texto');
    var statusEl = td.querySelector('.observacao-status');
    enviarObservacao(sessionId, textarea, statusEl, botao);
  });

  $('pag-anterior').addEventListener('click', function () {
    if (state.page > 1) { state.page -= 1; loadAuditoria(); }
  });
  $('pag-proxima').addEventListener('click', function () {
    state.page += 1; loadAuditoria();
  });

  var FILTROS_AUDITORIA_IDS = ['filtro-canal', 'filtro-info', 'filtro-alucinacao', 'filtro-insatisfacao', 'filtro-golpe', 'filtro-transferencia', 'filtro-sem-resposta', 'filtro-transferido-sem-resposta', 'filtro-sem-aceite', 'filtro-sem-resposta-cliente', 'filtro-falha-critica'];

  FILTROS_AUDITORIA_IDS.forEach(function (id) {
    $(id).addEventListener('change', function () {
      state.page = 1;
      loadAuditoria();
    });
  });

  $('limpar-filtros-auditoria').addEventListener('click', function () {
    FILTROS_AUDITORIA_IDS.forEach(function (id) {
      Array.prototype.slice.call($(id).options).forEach(function (opt) { opt.selected = false; });
    });
    state.page = 1;
    loadAuditoria();
  });

  // -----------------------------------------------------------------------
  // Eventos — aba Qualidade Humana
  // -----------------------------------------------------------------------
  $('qh-tbody').addEventListener('click', function (ev) {
    var botao = ev.target.closest('.observacao-enviar');
    if (!botao) return;
    var sessionId = botao.getAttribute('data-session-id');
    var td = botao.closest('.observacao-cell');
    var textarea = td.querySelector('.observacao-texto');
    var statusEl = td.querySelector('.observacao-status');
    enviarObservacao(sessionId, textarea, statusEl, botao);
  });

  $('filtro-qh-status').addEventListener('change', function () {
    state.qhPage = 1;
    loadQualidadeHumana();
  });

  var qhColaboradorTimer = null;
  $('filtro-qh-colaborador').addEventListener('input', function () {
    clearTimeout(qhColaboradorTimer);
    qhColaboradorTimer = setTimeout(function () {
      state.qhPage = 1;
      loadQualidadeHumana();
    }, 400);
  });

  $('limpar-filtros-qh').addEventListener('click', function () {
    $('filtro-qh-status').value = '';
    $('filtro-qh-colaborador').value = '';
    state.qhPage = 1;
    loadQualidadeHumana();
  });

  $('qh-pag-anterior').addEventListener('click', function () {
    if (state.qhPage > 1) { state.qhPage -= 1; loadQualidadeHumana(); }
  });
  $('qh-pag-proxima').addEventListener('click', function () {
    state.qhPage += 1; loadQualidadeHumana();
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
      btn.title = 'Contatar o suporte';
    }
  }

  // -----------------------------------------------------------------------
  // Sessão Bitrix24 (tokens + identificação de acesso)
  // -----------------------------------------------------------------------
  // Chamado uma vez a cada abertura do painel, logo após BX24.init().
  // Não bloqueia nem restringe nada no painel: apenas repassa ao back-end
  // os tokens já fornecidos pela sessão do próprio usuário (via
  // BX24.getAuth()) para eles ficarem frescos no Supabase, e permite que o
  // back-end registre quem acessou.
  function registrarSessao() {
    try {
      if (!window.BX24 || typeof window.BX24.getAuth !== 'function') return;
      var auth = window.BX24.getAuth();
      if (!auth || !auth.member_id) return;

      fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: auth.member_id,
          domain: auth.domain,
          accessToken: auth.access_token,
          refreshToken: auth.refresh_token,
          expiresIn: auth.expires_in
        })
      }).catch(function (err) {
        console.warn('Não foi possível registrar a sessão:', err);
      });
    } catch (e) {
      console.warn('Falha ao capturar contexto de autenticação Bitrix24:', e);
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
        registrarSessao();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
