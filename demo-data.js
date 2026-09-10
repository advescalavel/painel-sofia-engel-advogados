// =============================================================================
// demo-data.js — conjunto de DEMONSTRAÇÃO do Painel Vigia · Engel Advogados
//
// Usado só quando não há sessão Bitrix24, com ?demo=1, ou quando a API não
// responde. O formato é exatamente o contrato dos endpoints (ver README.md),
// então trocar por dados reais não muda uma linha do app.js.
// Nenhum número aqui é dado real da operação.
// =============================================================================

window.VigiaDemo = (function () {
  'use strict';

  function rng(semente) {
    var s = 0;
    for (var i = 0; i < semente.length; i++) s = (s * 31 + semente.charCodeAt(i)) % 2147483647;
    return function (min, max) {
      s = (s * 1103515245 + 12345) % 2147483647;
      return min + Math.floor((s / 2147483647) * (max - min + 1));
    };
  }

  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function buckets(periodos) {
    var desde = new Date(Math.min.apply(null, periodos.map(function (p) { return +new Date(p.desde); })));
    var ate = new Date(Math.min(Date.now(), Math.max.apply(null, periodos.map(function (p) { return +new Date(p.ate); }))));
    var dias = Math.max(1, Math.round((ate - desde) / 86400000) + 1);

    if (dias > 70) {
      var lista = [];
      var cursor = new Date(desde.getFullYear(), desde.getMonth(), 1);
      while (cursor <= ate && lista.length < 24) {
        lista.push(cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-01');
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }
      return { granularidade: 'mes', chaves: lista, escala: 22 };
    }

    var out = [];
    for (var i = 0; i < Math.min(dias, 31); i++) {
      var d = new Date(desde);
      d.setDate(desde.getDate() + i);
      if (d > ate) break;
      out.push(iso(d));
    }
    if (!out.length) out.push(iso(ate));
    return { granularidade: 'dia', chaves: out, escala: dias <= 1 ? 1 : 2 };
  }

  var MOTIVOS_DESQ = ['Fora da área de atuação', 'Sem documentação mínima', 'Valor da causa inviável', 'Prazo prescrito', 'Já possui advogado', 'Lead duplicado'];
  var OBJECOES = ['Preço / honorários', 'Prazo do processo', 'Vai pensar / falar com a família', 'Desconfiança da IA', 'Já procurou outro escritório', 'Quer garantia de ganho'];
  var MOTIVOS_TRANSF = ['Andamento processual específico', 'Pedido expresso de humano', 'Reclamação sobre o escritório', 'Dúvida financeira / boleto', 'Documento a enviar', 'Falha da IA'];
  var TIPOS_ATEND = ['Andamento processual', 'Dúvidas gerais', 'Golpe do falso advogado'];
  var FALHAS_COM = ['Desqualificação indevida', 'Não transferiu quando deveria', 'Transferência prematura', 'Pulou pergunta obrigatória', 'Promessa indevida', 'Informação inventada'];
  var FALHAS_SC = ['Informação inventada', 'Informação incorreta', 'Ignorou pedido humano', 'Cliente corrigiu a IA', 'Expectativa incorreta', 'Repetição sem evolução'];
  var CRITERIOS_COM = ['Coleta de requisitos', 'Aderência ao roteiro', 'Tratamento de objeção', 'Encaminhamento'];
  var CRITERIOS_SC = ['Compreensão da demanda', 'Precisão da resposta', 'Esforço do cliente', 'Encaminhamento'];
  var NOMES = ['Ana Beatriz Moraes', 'Carlos Eduardo Lima', 'Fernanda Ribeiro', 'Marcos Vinícius Alves', 'Juliana Prado', 'Rafael Antunes', 'Patrícia Nogueira', 'Diego Camargo', 'Larissa Bittencourt', 'Otávio Menezes', 'Simone Vasconcelos', 'Thiago Barreto', 'Camila Deodoro', 'Henrique Salles', 'Vanessa Kuhn', 'Rodrigo Peixoto', 'Bianca Almeida', 'Leandro Furtado', 'Mariana Bastos', 'Gustavo Pinheiro', 'Renata Sampaio', 'Felipe Andrade'];
  var COLABS_COM = ['Bruno Tavares', 'Cíntia Rocha', 'Eduardo Prado'];
  var COLABS_SC = ['Laila Oliveira', 'Mell Ferreira', 'Paula Ventura'];

  var NOME_IA = {
    sdr: 'IA Supervisora SDR',
    fechamento: 'IA Supervisora de Fechamento',
    sucesso: 'IA Supervisora de Sucesso do Cliente'
  };

  function distribuir(rotulos, total, r, campoRotulo, campoValor) {
    var pesos = rotulos.map(function () { return r(4, 20); });
    var soma = pesos.reduce(function (a, b) { return a + b; }, 0);
    return rotulos.map(function (l, i) {
      var o = {};
      o[campoRotulo] = l;
      o[campoValor] = Math.max(1, Math.round((pesos[i] / soma) * total));
      return o;
    }).sort(function (a, b) { return b[campoValor] - a[campoValor]; });
  }

  function metricas(agente, periodos) {
    var b = buckets(periodos);
    var r = rng(agente + '|' + b.chaves.join(''));

    var serie = b.chaves.map(function (chave) {
      var atend = r(5, 14) * b.escala;
      var qual = Math.round(atend * (r(38, 62) / 100));
      var desq = Math.max(0, atend - qual - r(0, 2));
      var fech = Math.round(qual * (r(22, 46) / 100));
      var resolvidos = Math.round(atend * (r(62, 88) / 100));
      return {
        bucket: chave,
        atendimentos: atend,
        qualificados: qual,
        desqualificados: desq,
        fechados: fech,
        nao_fechados: Math.max(0, qual - fech),
        resolvidos: resolvidos,
        transferidos: Math.max(0, atend - resolvidos)
      };
    });

    function soma(k) { return serie.reduce(function (a, d) { return a + d[k]; }, 0); }
    function pct(p, t) { return t ? Math.round((p / t) * 1000) / 10 : 0; }

    var atendimentos = soma('atendimentos');
    var qualificados = soma('qualificados');
    var desqualificados = soma('desqualificados');
    var fechados = soma('fechados');
    var resolvidos = soma('resolvidos');
    var transferidos = soma('transferidos');

    var faixas = [
      { chave: 'f0_59', rotulo: '0–59' },
      { chave: 'f60_74', rotulo: '60–74' },
      { chave: 'f75_89', rotulo: '75–89' },
      { chave: 'f90_100', rotulo: '90–100' }
    ];
    var serieScore = serie.map(function (d) {
      var base = Math.max(1, Math.round(d.atendimentos * 0.8));
      var f0 = Math.round(base * (r(4, 14) / 100));
      var f60 = Math.round(base * (r(12, 24) / 100));
      var f75 = Math.round(base * (r(28, 40) / 100));
      return { bucket: d.bucket, f0_59: f0, f60_74: f60, f75_89: f75, f90_100: Math.max(0, base - f0 - f60 - f75) };
    });
    var avaliados = serieScore.reduce(function (a, d) { return a + d.f0_59 + d.f60_74 + d.f75_89 + d.f90_100; }, 0);
    var falhasLista = agente === 'sucesso' ? FALHAS_SC : FALHAS_COM;
    var comFalha = Math.round(avaliados * (r(9, 18) / 100));
    // O back-end real inclui uma linha "Nenhuma" para os atendimentos sem
    // falha crítica; reproduzimos isso aqui para exercitar o filtro no painel.
    var semFalha = Math.max(0, avaliados - comFalha);

    var base = {
      demo: true,
      agente: agente,
      granularidade: b.granularidade,
      serie: serie,
      // taxa_aprovacao_pct = % dos atendimentos avaliados em que o critério foi
      // cumprido; quantidade_avaliada = em quantos atendimentos esse critério
      // pôde ser avaliado (alguns não se aplicam a todo atendimento).
      criterios: (agente === 'sucesso' ? CRITERIOS_SC : CRITERIOS_COM).map(function (c) {
        return { criterio: c, taxa_aprovacao_pct: r(62, 94), quantidade_avaliada: Math.round(avaliados * (r(70, 100) / 100)) };
      }),
      falha_critica: distribuir(falhasLista, comFalha, r, 'motivo', 'quantidade').concat(
        semFalha ? [{ motivo: 'Nenhuma', quantidade: semFalha }] : []
      ),
      distribuicao_score_faixas: faixas,
      distribuicao_score_serie: serieScore,
      kpis: {
        total_atendimentos: atendimentos,
        avaliados: avaliados,
        com_falha_critica: comFalha,
        janela_2h_agora: r(2, 9),
        sem_resposta_60min_agora: r(3, 14),
        efetividade_media_pct: r(72, 93)
      }
    };

    if (agente === 'sdr' || agente === 'fechamento') {
      base.kpis.qualificacoes = qualificados;
      base.kpis.taxa_qualificacao_pct = pct(qualificados, atendimentos);
      base.kpis.desqualificados = desqualificados;
      base.motivos_desqualificacao = distribuir(MOTIVOS_DESQ, desqualificados, r, 'motivo', 'quantidade');
      base.objecoes = distribuir(OBJECOES, Math.round(atendimentos * 0.55), r, 'objecao', 'quantidade');
    }
    if (agente === 'fechamento') {
      base.kpis.fechamentos = fechados;
      base.kpis.taxa_fechamento_pct = pct(fechados, qualificados);
    }
    if (agente === 'sucesso') {
      base.kpis.resolvidos = resolvidos;
      base.kpis.taxa_resolucao_pct = pct(resolvidos, atendimentos);
      base.kpis.transferidos = transferidos;
      base.kpis.transferidos_sem_atendimento = r(2, 11);
      base.kpis.clientes_insatisfeitos = r(1, 8);
      base.kpis.falhas_ia = comFalha;
      base.motivos_transferencia = distribuir(MOTIVOS_TRANSF, transferidos, r, 'motivo', 'quantidade');
      base.tipos_atendimento = distribuir(TIPOS_ATEND, atendimentos, r, 'tipo', 'quantidade');
    }
    return base;
  }

  function atendimentos(agente, params) {
    var r = rng(agente + '|lista');
    var isSC = agente === 'sucesso';
    var itens = [];
    var total = isSC ? 96 : 72;

    for (var i = 0; i < total; i++) {
      var d = new Date();
      d.setDate(d.getDate() - r(0, 24));
      d.setHours(r(8, 19), r(0, 59), 0, 0);
      var qualificado = r(0, 100) < 55;
      var resolvido = r(0, 100) < 74;
      var temFalha = r(0, 100) < 22;
      var falha = temFalha ? (isSC ? FALHAS_SC : FALHAS_COM)[r(0, 5)] : null;
      var nFb = isSC && r(0, 100) < 34 ? r(1, 4) : 0;
      var ehIa = r(0, 100) < 62;

      var item = {
        session_id: 'engel-' + agente + '-' + (1200 + i),
        chat_id: String(41000 + i),
        contact_name: NOMES[i % NOMES.length],
        responsavel: ehIa ? NOME_IA[agente] : (isSC ? COLABS_SC[i % 3] : COLABS_COM[i % 3]),
        origem: ehIa ? 'ia' : 'colaboradores',
        started_at: d.toISOString(),
        score_efetividade: r(0, 100) < 18 ? r(28, 59) : r(62, 98),
        falha_critica: falha,
        janela_2h: r(0, 100) < 9,
        sem_resposta_60min: r(0, 100) < 17,
        justificativa_avaliacao: falha
          ? 'A IA afirmou andamento sem confirmar na base do processo e seguiu a conversa sem corrigir. Ação recomendada: reforçar a checagem antes de afirmar andamento.'
          : 'Atendimento dentro do padrão: coleta completa, tom adequado e encaminhamento correto.'
      };

      if (isSC) {
        var concluido = r(0, 100) < 82;
        if (concluido) {
          var fim = new Date(d.getTime() + r(6, 260) * 60000);
          item.finished_at = fim.toISOString();
        } else {
          item.finished_at = null;
        }
        item.tipo_atendimento = TIPOS_ATEND[r(0, 100) < 52 ? 0 : (r(0, 100) < 70 ? 1 : 2)];
        item.status = !concluido ? 'em_andamento'
          : (resolvido ? 'resolvido' : (r(0, 100) < 40 ? 'transferido_sem_atendimento' : 'transferido'));
        item.motivo_transferencia = resolvido ? null : MOTIVOS_TRANSF[r(0, 5)];
        item.insatisfacao = r(0, 100) < 11;
        item.feedbacks = {
          total: nFb,
          ultimo: nFb ? { autor: 'Laila Oliveira', criado_em: d.toISOString(), texto: 'Confirmar com a Mell se o cliente recebeu retorno depois da transferência.' } : null
        };
      } else {
        item.status = qualificado ? (agente === 'fechamento' && r(0, 100) < 42 ? 'fechado' : 'qualificado') : 'desqualificado';
        item.motivo_desqualificacao = qualificado ? null : MOTIVOS_DESQ[r(0, 5)];
        item.objecao = r(0, 100) < 58 ? OBJECOES[r(0, 5)] : null;
        item.feedbacks = { total: 0, ultimo: null };
      }
      itens.push(item);
    }

    var filtrados = itens.filter(function (a) {
      if (params.sem_resposta_60min && !a.sem_resposta_60min) return false;
      if (params.falha_ia && !a.falha_critica) return false;
      if (params.janela_2h && !a.janela_2h) return false;
      if (params.com_feedback && !(a.feedbacks && a.feedbacks.total)) return false;
      if (params.insatisfacao && !a.insatisfacao) return false;
      if (params.motivo_falha && a.falha_critica !== params.motivo_falha) return false;
      if (params.tipo_atendimento && a.tipo_atendimento !== params.tipo_atendimento) return false;
      if (params.motivo_transferencia && a.motivo_transferencia !== params.motivo_transferencia) return false;
      if (params.status && params.status !== 'todos') {
        if (params.status === 'concluido') {
          if (a.status === 'em_andamento') return false;
        } else if (a.status !== params.status) return false;
      }
      if (params.base_data === 'conclusao' && !a.finished_at) return false;
      if (params.colaborador && params.colaborador !== 'todos' && a.origem !== params.colaborador) return false;
      return true;
    }).sort(function (a, b) {
      var campo = params.base_data === 'conclusao' ? 'finished_at' : 'started_at';
      return new Date(b[campo] || b.started_at) - new Date(a[campo] || a.started_at);
    });

    var limite = Number(params.limite) || 25;
    var pagina = Number(params.pagina) || 1;

    return {
      demo: true,
      total: filtrados.length,
      contadores: {
        sem_resposta_60min: itens.filter(function (a) { return a.sem_resposta_60min; }).length,
        falha_ia: itens.filter(function (a) { return !!a.falha_critica; }).length,
        janela_2h: itens.filter(function (a) { return a.janela_2h; }).length,
        com_feedback: itens.filter(function (a) { return a.feedbacks && a.feedbacks.total; }).length,
        insatisfacao: itens.filter(function (a) { return a.insatisfacao; }).length
      },
      itens: filtrados.slice((pagina - 1) * limite, pagina * limite)
    };
  }

  var threads = {};

  function feedbacks(sessionId, totalConhecido) {
    if (!threads[sessionId]) {
      var r = rng(sessionId + '|fb');
      var textos = [
        'A IA respondeu andamento sem checar a última movimentação. Pedi para a Mell revisar o prompt.',
        'Cliente ficou satisfeito no fim, mas a resposta demorou. Vale olhar o tempo de primeira resposta.',
        'Transferência correta, porém o colaborador só respondeu no dia seguinte.',
        'Reforcei com a equipe o roteiro de golpe do falso advogado neste caso.'
      ];
      var itens = [];
      for (var i = 0; i < (totalConhecido || 0); i++) {
        var d = new Date();
        d.setDate(d.getDate() - (totalConhecido - i) * r(1, 3));
        itens.push({ id: sessionId + '-fb-' + (i + 1), autor: 'Laila Oliveira', criado_em: d.toISOString(), texto: textos[i % textos.length] });
      }
      threads[sessionId] = itens;
    }
    return { session_id: sessionId, itens: threads[sessionId].slice() };
  }

  function novoFeedback(sessionId, texto, autor) {
    if (!threads[sessionId]) threads[sessionId] = [];
    var item = { id: sessionId + '-fb-' + (threads[sessionId].length + 1), autor: autor || 'Laila Oliveira', criado_em: new Date().toISOString(), texto: texto };
    threads[sessionId].push(item);
    return item;
  }

  // Perfil de demonstração: gestão com os dois departamentos.
  var permissoes = {
    demo: true,
    usuario: { id: 'demo', nome: 'Usuário de demonstração' },
    departamentos: ['comercial', 'sucesso_cliente'],
    pode_dar_feedback: true
  };

  return {
    permissoes: permissoes,
    metricas: metricas,
    atendimentos: atendimentos,
    feedbacks: feedbacks,
    novoFeedback: novoFeedback
  };
})();
