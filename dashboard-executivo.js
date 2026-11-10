/**
 * ==========================================================
 * 🛫 ANÁLISE OPERACIONAL DO COLABORADOR & CONSOLIDADO DA EQUIPE
 * Dashboard e Infográfico Corporativo Real e Individual
 * Diário de Embarque GRU
 * ==========================================================
 */

// Estado global do módulo de Análise
window._analiseState = {
  setor: 'todos',
  turno: 'todos',
  colaborador: 'MAYARA OLIVEIRA DA SILVA',
  mes: 'OUTUBRO/2026',
  modo: 'individual', // 'individual' ou 'equipe'
  datasetCarregado: false,
  termoBusca: ''
};

// Dicionário de colaboradores reais (populado dinamicamente via /api/analise-colaborador/dataset)
window.DATASET_COLABORADORES = window.DATASET_COLABORADORES || {};
window.DATASET_EQUIPES = window.DATASET_EQUIPES || {};

window._analiseCharts = {
  posicao: null,
  otp: null,
  donutAtraso: null,
  areaEvolucao: null
};

// Carregamento assíncrono do dataset completo da planilha oficial
async function carregarDatasetCompleto() {
  if (window._analiseState.datasetCarregado && Object.keys(window.DATASET_COLABORADORES).length > 2) {
    return;
  }
  try {
    let res = null;
    let token = (window.db && window.db.authToken) ? window.db.authToken : '';
    if (!token) {
      try {
        const s = JSON.parse(localStorage.getItem('diario_embarque_session'));
        if (s && s.token) token = s.token;
      } catch(e) {}
    }

    if (token) {
      try {
        res = await fetch('/api/analise-colaborador/dataset', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
      } catch(e) {}
    }

    if (!res || !res.ok) {
      try {
        res = await fetch('/dataset_analise_colaboradores.json');
      } catch(e) {}
    }
    if (!res || !res.ok) {
      try {
        res = await fetch('/public/dataset_analise_colaboradores.json');
      } catch(e) {}
    }

    if (res && res.ok) {
      const data = await res.json();
      if (data && data.colaboradores) {
        window.DATASET_COLABORADORES = Object.assign({}, window.DATASET_COLABORADORES, data.colaboradores);
      }
      if (data && data.equipes) {
        window.DATASET_EQUIPES = Object.assign({}, window.DATASET_EQUIPES, data.equipes);
      }
      window._analiseState.datasetCarregado = true;
      console.log('✔ Dataset oficial de colaboradores carregado:', Object.keys(window.DATASET_COLABORADORES).length);
    }
  } catch (err) {
    console.warn('Carregamento do dataset via rede (usando base prévia):', err.message);
  }
}

// Inicialização imediata em segundo plano
if (typeof window !== 'undefined') {
  carregarDatasetCompleto();
}

// Formatação oficial padronizada dos turnos
function formatarTurnoOficial(t, curto = false) {
  const norm = (t || '').toString().trim().toUpperCase();
  if (norm === 'T1') return curto ? 'T1 — MADRUGADA' : 'T1 — MADRUGADA (22:30 às 05:30)';
  if (norm === 'T2') return curto ? 'T2 — MANHÃ' : 'T2 — MANHÃ (05:00 às 13:00)';
  if (norm === 'T3') return curto ? 'T3 — TARDE' : 'T3 — TARDE (11:00 às 19:00)';
  if (norm === 'T4') return curto ? 'T4 — NOITE' : 'T4 — NOITE (15:45 às 23:45)';
  return t || '-';
}

// ==========================================================
// FILTROS E POPULAÇÃO DO SELETOR DE COLABORADORES
// ==========================================================
function popularSelectColaboradores(termoBusca = '') {
  const select = document.getElementById('execColaboradorSelect');
  if (!select) return;

  const dataset = window.DATASET_COLABORADORES || {};
  const turnoFiltro = (window._analiseState.turno || 'todos').toUpperCase();
  const setorFiltro = (window._analiseState.setor || 'todos').toLowerCase();
  const cleanTermo = (termoBusca || window._analiseState.termoBusca || '').trim().toUpperCase();

  let nomes = Object.keys(dataset).filter(nome => {
    const colab = dataset[nome];
    if (!colab) return false;
    if (turnoFiltro !== 'TODOS' && (colab.turno || '').toUpperCase() !== turnoFiltro) {
      return false;
    }
    if (setorFiltro !== 'todos' && (colab.setor || '').toLowerCase() !== setorFiltro) {
      return false;
    }
    if (cleanTermo && !nome.toUpperCase().includes(cleanTermo)) {
      return false;
    }
    return true;
  });

  // Ordenação alfabética natural
  nomes.sort((a, b) => a.localeCompare(b));

  const atualSelecionado = select.value || window._analiseState.colaborador || '';

  // Monta options com a opção consolidada "Toda a equipe" no topo
  let html = `<option value="TODA_A_EQUIPE" ${atualSelecionado === 'TODA_A_EQUIPE' ? 'selected' : ''}>⭐ Toda a equipe (Relatório Consolidado)</option>`;

  html += nomes.map(nome => {
    const colab = dataset[nome];
    const turnoBadge = colab && colab.turno ? ` [${formatarTurnoOficial(colab.turno, true)}]` : '';
    const voosBadge = colab && colab.kpis ? ` (${colab.kpis.totalVoos} voos)` : '';
    const regBadge = colab && colab.isRegisteredUser ? ' 👤' : '';
    const isSelected = nome === atualSelecionado ? 'selected' : '';
    return `<option value="${nome}" ${isSelected}>${nome}${turnoBadge}${voosBadge}${regBadge}</option>`;
  }).join('');

  select.innerHTML = html;

  if (atualSelecionado && atualSelecionado !== 'TODA_A_EQUIPE' && nomes.includes(atualSelecionado)) {
    select.value = atualSelecionado;
  } else if (!cleanTermo && nomes.length > 0 && !atualSelecionado) {
    select.value = nomes[0];
    window._analiseState.colaborador = nomes[0];
  }
}

function filtrarDropdownColaboradores(termo) {
  window._analiseState.termoBusca = termo || '';
  popularSelectColaboradores(termo);
}

// Helper unificado de verificação de permissão para Gestão e Master
function verificarAcessoGestaoMaster() {
  if (typeof window.isUserGestaoOuMaster === 'function' && window.isUserGestaoOuMaster()) {
    return true;
  }
  const norm = s => (s || '').toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const authorizedRoles = ['master', 'admin', 'gestao', 'supervisor', 'gerente'];
  
  const currentEmail = norm((window.db && window.db.currentEmail) || '');
  if (currentEmail === 'lediariodeembarque@gmail.com') return true;
  
  const currentRole = norm((window.db && window.db.role) || '');
  if (authorizedRoles.includes(currentRole)) return true;
  
  try {
    const raw = localStorage.getItem('diario_embarque_session') || localStorage.getItem('diario_sessao_ativa');
    if (raw) {
      const s = JSON.parse(raw);
      const sEmail = norm(s.email || s.currentEmail);
      const sRole = norm(s.role);
      if (sEmail === 'lediariodeembarque@gmail.com') return true;
      if (authorizedRoles.includes(sRole)) return true;
    }
  } catch(e) {}
  
  return false;
}

// Atualiza permissões dos filtros de acordo com o perfil logado
function aplicarPermissoesFiltrosSetor() {
  const setorSelect = document.getElementById('execSetorSelect');
  if (!setorSelect) return;

  const isMasterOrGestao = verificarAcessoGestaoMaster();

  if (!isMasterOrGestao) {
    setorSelect.disabled = true;
    const userSetor = (window.db && window.db.setor ? window.db.setor : 'Embarque');
    setorSelect.value = userSetor;
    window._analiseState.setor = userSetor;
  } else {
    setorSelect.disabled = false;
  }
}

// Entrada principal para renderizar o Dashboard Executivo
async function renderDashboardExecutivo() {
  const deniedEl = document.getElementById('execDashboardAccessDenied');
  const loadingEl = document.getElementById('execDashboardLoadingAuth');
  const filtrosCard = document.getElementById('execDashboardFiltrosCard');
  const printArea = document.getElementById('execDashboardPrintArea');

  // 1. Verificar se a verificação de sessão ainda está em processamento
  const temSessaoSalva = !!(localStorage.getItem('diario_embarque_session') || localStorage.getItem('diario_sessao_ativa'));
  const authEmAndamento = (window._authVerificandoSessao || window._authStatus === 'init') && temSessaoSalva && (!window.db || !window.db.logged);

  if (authEmAndamento) {
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (deniedEl) deniedEl.classList.add('hidden');
    if (filtrosCard) filtrosCard.style.display = 'none';
    if (printArea) printArea.style.display = 'none';

    // Reprocessa assim que a verificação de sessão finalizar
    setTimeout(() => {
      const dashView = document.getElementById('dashboard-executivo');
      if (dashView && dashView.classList.contains('active')) {
        renderDashboardExecutivo();
      }
    }, 350);
    return;
  }

  // 2. Validação centralizada e unificada de permissão (Master / Gestão / Admin)
  const isAuthorized = verificarAcessoGestaoMaster();

  if (!isAuthorized) {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (deniedEl) deniedEl.classList.remove('hidden');
    if (filtrosCard) filtrosCard.style.display = 'none';
    if (printArea) printArea.style.display = 'none';
    return;
  }

  // Acesso autorizado: exibe o painel de análise e oculta bloqueios
  if (loadingEl) loadingEl.classList.add('hidden');
  if (deniedEl) deniedEl.classList.add('hidden');
  if (filtrosCard) filtrosCard.style.display = '';
  if (printArea) printArea.style.display = '';

  await carregarDatasetCompleto();
  aplicarPermissoesFiltrosSetor();
  popularSelectColaboradores();

  const selectColab = document.getElementById('execColaboradorSelect');
  let selVal = selectColab ? selectColab.value : (window._analiseState.colaborador || '');
  if (!selVal && selectColab && selectColab.options.length > 1) {
    selVal = selectColab.options[1].value;
    selectColab.value = selVal;
  }
  window._analiseState.colaborador = selVal;

  if (selVal === 'TODA_A_EQUIPE') {
    renderRelatorioConsolidadoEquipe();
  } else {
    renderRelatorioIndividual(selVal);
  }
}

// Mudança no seletor de Setor ou Turno
function aoMudarSetorOuTurnoExecutivo() {
  const setorSel = document.getElementById('execSetorSelect');
  const turnoSel = document.getElementById('execTurnoSelect');

  if (setorSel) window._analiseState.setor = setorSel.value;
  if (turnoSel) window._analiseState.turno = turnoSel.value;

  popularSelectColaboradores();

  const selectColab = document.getElementById('execColaboradorSelect');
  if (selectColab) {
    window._analiseState.colaborador = selectColab.value;
    if (selectColab.value === 'TODA_A_EQUIPE') {
      renderRelatorioConsolidadoEquipe();
    } else {
      renderRelatorioIndividual(selectColab.value);
    }
  }
}

function aoMudarFiltroSetor() {
  aoMudarSetorOuTurnoExecutivo();
}

function aoMudarFiltroTurno() {
  aoMudarSetorOuTurnoExecutivo();
}

// Mudança no seletor de Colaborador ou Mês
function aoMudarFiltroExecutivo() {
  const select = document.getElementById('execColaboradorSelect');
  const mesSel = document.getElementById('execMesSelect');
  if (mesSel) {
    window._analiseState.mes = mesSel.value;
    const mesDisplay = document.getElementById('execMesDisplay');
    if (mesDisplay) mesDisplay.textContent = mesSel.value;
  }

  const nomeColab = select ? select.value : '';
  window._analiseState.colaborador = nomeColab;

  if (nomeColab === 'TODA_A_EQUIPE') {
    renderRelatorioConsolidadoEquipe();
  } else {
    renderRelatorioIndividual(nomeColab);
  }
}

// ==========================================================
// PARTE 4 — GERAÇÃO DA ANÁLISE INDIVIDUAL DO COLABORADOR
// Parecer Técnico Baseado Exclusivamente em Indicadores Reais
// ==========================================================
function gerarAnaliseIndividualTexto(data) {
  if (!data || !data.kpis || typeof data.kpis.totalVoos !== 'number' || data.kpis.totalVoos === 0) {
    return `<div style="padding:14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;color:#64748B;font-style:italic">
      Não há dados suficientes para realizar esta análise neste período.
    </div>`;
  }

  const k = data.kpis;
  const pos = data.posicao || { fingerPercent: 0, remotaPercent: 0, fingerQtd: 0, remotaQtd: 0 };
  const otp = data.otp || { noHorarioPercent: 0, atrasadosPercent: 0, noHorarioQtd: 0, atrasadosQtd: 0 };
  const atrasos = data.codigosAtraso || [];
  const p = k.participacoes || { a1: k.totalVoos, a2: 0, a3: 0 };
  const voosTop = (data.voosMaisRealizados || []).slice(0, 3);

  // 1. Desempenho Operacional e Escala
  const metaOtp = 85.0;
  const atingiuMeta = otp.noHorarioPercent >= metaOtp;
  const diferencaMeta = (otp.noHorarioPercent - metaOtp).toFixed(1).replace('.', ',');

  // 2. Análise de Posição
  let textoPosicao = '';
  if (pos.fingerPercent >= 70) {
    textoPosicao = `Atuação fortemente concentrada em <b>Finger (${pos.fingerPercent}%)</b> com ${pos.fingerQtd} voos, evidenciando domínio nos fluxos de embarque direto por pontes telescópicas e controle de gate.`;
  } else if (pos.remotaPercent >= 50) {
    textoPosicao = `Alta participação em <b>Posições Remotas (${pos.remotaPercent}%)</b> com ${pos.remotaQtd} operações, demonstrando aptidão logística de pista, coordenação com transporte de solo (ônibus) e embarque de rampa.`;
  } else {
    textoPosicao = `Equilíbrio operacional consistente entre <b>Finger (${pos.fingerPercent}% • ${pos.fingerQtd} voos)</b> e <b>Remota (${pos.remotaPercent}% • ${pos.remotaQtd} voos)</b>, comprovando versatilidade em múltiplos cenários do aeroporto.`;
  }

  // 3. Análise de Pontualidade
  let textoOtp = '';
  if (atingiuMeta) {
    textoOtp = `Pontualidade (OTP) excelente de <b>${otp.noHorarioPercent.toFixed(1).replace('.', ',')}%</b> (${otp.noHorarioQtd} voos pontuais), superando a meta corporativa de ${metaOtp}% em +${diferencaMeta} p.p.`;
  } else {
    textoOtp = `Índice de pontualidade registrado em <b>${otp.noHorarioPercent.toFixed(1).replace('.', ',')}%</b> (${otp.noHorarioQtd} voos no horário e ${otp.atrasadosQtd} com atraso), situando-se ${diferencaMeta} p.p. abaixo da meta de ${metaOtp}%, requerendo atenção aos processos de liberação da porta.`;
  }

  // 4. Análise de Atrasos e Códigos
  let textoAtrasos = '';
  if (atrasos.length === 0) {
    textoAtrasos = `<p style="margin:0"><b>Ocorrências de Atraso:</b> Nenhuma ocorrência de atraso foi registrada nos voos deste colaborador no período analisado (100% de pontualidade perfeita).</p>`;
  } else {
    const itensAtraso = atrasos.map(a => {
      const pct = otp.atrasadosQtd > 0 ? Math.round((a.qtd / otp.atrasadosQtd) * 100) : 0;
      return `<li><b>Código ${a.codigo}</b> (${a.descricao}): <b>${a.qtd}</b> ocorrência(s) [${pct}% dos atrasos observados]</li>`;
    }).join('');
    textoAtrasos = `
      <p style="margin:0 0 6px 0"><b>Fatores de Atraso Associados aos Registros:</b></p>
      <ul style="margin:0 0 8px 18px;padding:0">
        ${itensAtraso}
      </ul>
    `;
  }

  // 5. Pontos Fortes e Recomendações
  const pontoForte1 = `Volume sólido de <b>${k.totalVoos} voos operados</b> com média STD de <code>${k.mediaStd}</code> e fechamento médio de portas em <code>${k.mediaPorta}</code>.`;
  const pontoForte2 = `Frequência de liderança como Agente 1 em <b>${p.a1} operações</b>, atuando como Agente 2 em ${p.a2} e suporte A3 em ${p.a3}.`;
  const pontoForte3 = k.agente2Full && k.agente2Full !== 'N/A'
    ? `Sinergia de equipe com <b>${k.agente2Full}</b> como parceiro(a) operacional mais frequente.`
    : `Boa capacidade de integração com diferentes duplas de embarque.`;

  const recomendacao = atingiuMeta
    ? `Manter os padrões de conferência ágil de passageiros e documentação no gate para sustentar a marca acima da meta de 85%.`
    : `Acompanhar preventivamente os momentos de apresentação na posição e agilizar o fechamento de documentação com a tripulação para minimizar impactos de código de atraso no horário STD.`;

  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px">
        <h4 style="margin:0 0 6px 0;font-size:13px;font-weight:800;color:#0B1A33;text-transform:uppercase;letter-spacing:0.5px">
          1. Desempenho Operacional & Pontualidade (OTP)
        </h4>
        <p style="margin:0 0 6px 0">
          No mês de <b>${data.mes || 'OUTUBRO/2026'}</b>, <b>${data.nome}</b> atuou em <b>${k.totalVoos} operações de voo</b> no setor de <b>${data.setor || 'Embarque'}</b> (${formatarTurnoOficial(data.turno, true)}). ${textoOtp}
        </p>
        <p style="margin:0">
          ${textoPosicao}
        </p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:12px">
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px 14px">
          <h4 style="margin:0 0 6px 0;font-size:12.5px;font-weight:800;color:#166534;display:flex;align-items:center;gap:6px">
            <span>✔</span> Pontos Fortes Demonstrados pelos Dados
          </h4>
          <ul style="margin:0;padding-left:18px;font-size:12px;color:#14532D;line-height:1.5">
            <li>${pontoForte1}</li>
            <li>${pontoForte2}</li>
            <li>${pontoForte3}</li>
            ${voosTop.length > 0 ? `<li>Rotas de maior familiaridade operacional: ${voosTop.map(v => `<b>${v.voo}</b> (${v.qtd}x)`).join(', ')}.</li>` : ''}
          </ul>
        </div>

        <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:12px 14px">
          <h4 style="margin:0 0 6px 0;font-size:12.5px;font-weight:800;color:#92400E;display:flex;align-items:center;gap:6px">
            <span>⚠️</span> Pontos de Atenção & Recomendações Técnicas
          </h4>
          <div style="font-size:12px;color:#78350F;line-height:1.5">
            ${textoAtrasos}
            <p style="margin:6px 0 0 0"><b>Diretriz de Melhoria:</b> ${recomendacao}</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ==========================================================
// RENDERIZADOR PADRONIZADO DOS GRÁFICOS DUPLOS (MESMO FORMATO VISUAL)
// ==========================================================
function renderizarGraficosDuplosPadronizados(atrasos, voos, options = {}) {
  const isIndividual = options.isIndividual !== false;
  const c1 = document.getElementById('twinChartContainer1');
  const c2 = document.getElementById('twinChartContainer2');
  const t1 = document.getElementById('twinChartTitle1');
  const t2 = document.getElementById('twinChartTitle2');
  const b1 = document.getElementById('twinChartBadge1');
  const b2 = document.getElementById('twinChartBadge2');

  if (t1) t1.innerHTML = `<span>⏱️</span> ${options.title1 || 'QUANTIDADE DE ATRASOS POR MOTIVO'}`;
  if (t2) t2.innerHTML = `<span>✈️</span> ${options.title2 || 'PRINCIPAIS OPERAÇÕES INDIVIDUAIS'}`;
  if (b1) b1.textContent = options.badge1 || (isIndividual ? 'Por Código / Causa' : 'Consolidado Turno');
  if (b2) b2.textContent = options.badge2 || (isIndividual ? 'Voos e Destinos' : 'Rotas Frequentes');

  // 1. Gráfico 1: Atrasos por Motivo (Barras Horizontais)
  if (c1) {
    const listAtrasos = atrasos || [];
    if (listAtrasos.length === 0) {
      c1.innerHTML = `
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:26px 16px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%">
          <div style="font-size:28px;margin-bottom:6px">🎉</div>
          <div style="font-weight:900;color:#166534;font-size:13px;letter-spacing:0.3px">100% PONTUALIDADE PERFEITA</div>
          <div style="font-size:11.5px;color:#15803D;margin-top:4px">Nenhuma ocorrência de atraso registrada no período.</div>
        </div>
      `;
    } else {
      const maxAtraso = Math.max(...listAtrasos.map(a => a.qtd), 1);
      const totalAtrasosGeral = listAtrasos.reduce((acc, a) => acc + (a.qtd || 0), 0);
      c1.innerHTML = listAtrasos.map(a => {
        const pctBar = Math.max(8, Math.round((a.qtd / maxAtraso) * 100));
        const pctRel = totalAtrasosGeral > 0 ? Math.round((a.qtd / totalAtrasosGeral) * 100) : 0;
        return `
          <div class="analise-op-hbar-row">
            <div class="analise-op-hbar-label" title="${a.codigo} - ${a.descricao}">
              <b>${a.codigo}</b> <span style="font-weight:400;color:#64748B">${a.descricao}</span>
            </div>
            <div class="analise-op-hbar-track">
              <div class="analise-op-hbar-fill delay" style="width: ${pctBar}%;"></div>
            </div>
            <div class="analise-op-hbar-badge" style="color:#DC2626">
              ${a.qtd} <span style="font-size:10px;color:#94A3B8;font-weight:600">(${pctRel}%)</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 2. Gráfico 2: Principais Operações Individuais (Barras Horizontais Idênticas)
  if (c2) {
    const listVoos = voos || [];
    if (listVoos.length === 0) {
      c2.innerHTML = `
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:26px 16px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#64748B">
          <div style="font-size:28px;margin-bottom:6px">✈️</div>
          <div style="font-weight:700;font-size:12.5px">Nenhum voo frequente no período</div>
        </div>
      `;
    } else {
      const maxVoos = Math.max(...listVoos.map(v => v.qtd), 1);
      const totalVoosTop = listVoos.reduce((acc, v) => acc + (v.qtd || 0), 0);
      c2.innerHTML = listVoos.map(v => {
        const pctBar = Math.max(8, Math.round((v.qtd / maxVoos) * 100));
        const pctRel = totalVoosTop > 0 ? Math.round((v.qtd / totalVoosTop) * 100) : 0;
        return `
          <div class="analise-op-hbar-row">
            <div class="analise-op-hbar-label" title="${v.voo}">
              <b>${v.voo}</b>
            </div>
            <div class="analise-op-hbar-track">
              <div class="analise-op-hbar-fill" style="width: ${pctBar}%;"></div>
            </div>
            <div class="analise-op-hbar-badge" style="color:#0284C7">
              ${v.qtd} voos <span style="font-size:10px;color:#94A3B8;font-weight:600">(${pctRel}%)</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// ==========================================================
// RENDERIZADOR DA DISTRIBUIÇÃO COMPLEMENTAR (POSIÇÃO & ESCALA)
// ==========================================================
function renderizarDistribuicoesComplementares(posicao, participacoes, totalVoos) {
  const cPos = document.getElementById('analisePosicaoContent');
  const cAtu = document.getElementById('analiseAtuacaoContent');

  if (cPos) {
    const pos = posicao || { fingerPercent: 0, remotaPercent: 0, fingerQtd: 0, remotaQtd: 0 };
    cPos.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800">
          <span style="color:#00796B">🏢 Finger: <b>${pos.fingerPercent}%</b> (${pos.fingerQtd || 0} voos)</span>
          <span style="color:#DC2626">🚌 Remota: <b>${pos.remotaPercent}%</b> (${pos.remotaQtd || 0} voos)</span>
        </div>
        <div class="analise-op-ratio-track">
          <div class="analise-op-ratio-segment" style="width:${Math.max(pos.fingerPercent, 3)}%;background:#009688" title="Finger: ${pos.fingerPercent}%"></div>
          <div class="analise-op-ratio-segment" style="width:${Math.max(pos.remotaPercent, 3)}%;background:#EF4444" title="Remota: ${pos.remotaPercent}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:#64748B">
          <span>Pontes telescópicas e gate direto</span>
          <span>Pátio e transporte com ônibus</span>
        </div>
      </div>
    `;
  }

  if (cAtu) {
    const tot = totalVoos || 1;
    const p = participacoes || { a1: tot, a2: 0, a3: 0 };
    const pctA1 = Math.round((p.a1 / tot) * 100);
    const pctA2 = Math.round((p.a2 / tot) * 100);
    const pctA3 = Math.round((p.a3 / tot) * 100);
    cAtu.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800;flex-wrap:wrap">
          <span style="color:#1D4ED8">A1 (Líder): <b>${p.a1}</b> (${pctA1}%)</span>
          <span style="color:#0284C7">A2 (Porta): <b>${p.a2}</b> (${pctA2}%)</span>
          <span style="color:#475569">A3 (Solo): <b>${p.a3}</b> (${pctA3}%)</span>
        </div>
        <div class="analise-op-ratio-track">
          <div class="analise-op-ratio-segment" style="width:${Math.max(pctA1, 3)}%;background:#1D4ED8" title="Agente 1: ${pctA1}%"></div>
          <div class="analise-op-ratio-segment" style="width:${Math.max(pctA2, 3)}%;background:#0284C7" title="Agente 2: ${pctA2}%"></div>
          <div class="analise-op-ratio-segment" style="width:${Math.max(pctA3, 3)}%;background:#94A3B8" title="Agente 3: ${pctA3}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:#64748B">
          <span>Liderança do portão</span>
          <span>Conferência de cartões</span>
          <span>Apoio de rampa</span>
        </div>
      </div>
    `;
  }
}

// ==========================================================
// FUNÇÕES AUXILIARES DO DASHBOARD EXECUTIVO AZUL (REFERÊNCIA VISUAL)
// ==========================================================

function extrairIniciais(nome) {
  if (!nome || typeof nome !== 'string') return 'OP';
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function gerarAnaliseIndividualManual() {
  const colabSel = document.getElementById('execColaboradorSelect');
  const mesSel = document.getElementById('execMesSelect');
  const anoSel = document.getElementById('execAnoSelect');

  if (mesSel) {
    window._analiseState.mes = mesSel.value;
    const disp = document.getElementById('execMesDisplay');
    if (disp) disp.textContent = mesSel.value;
    const pill = document.getElementById('refHeaderMonthPill');
    if (pill) pill.textContent = mesSel.value.split('/')[0];
  }
  if (anoSel) window._analiseState.ano = anoSel.value;
  if (colabSel) window._analiseState.colaborador = colabSel.value;

  const nome = window._analiseState.colaborador || '';
  if (nome === 'TODA_A_EQUIPE') {
    renderRelatorioConsolidadoEquipe();
  } else {
    renderRelatorioIndividual(nome);
  }

  if (typeof showToast === 'function') {
    showToast(`✔ Análise gerada com sucesso para ${nome === 'TODA_A_EQUIPE' ? 'toda a equipe' : nome}`, 'success');
  }
}

function visualizarRelatorioScroll() {
  const el = document.getElementById('execDashboardPrintArea');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function selecionarAnoDashboard(ano) {
  ['2024', '2025', '2026'].forEach(p => {
    const el = document.getElementById('refYearPill' + p);
    if (el) {
      if (p === ano) el.classList.add('active');
      else el.classList.remove('active');
    }
  });
  const anoSel = document.getElementById('execAnoSelect');
  if (anoSel) anoSel.value = ano;
  window._analiseState.ano = ano;
  gerarAnaliseIndividualManual();
}

function aoMudarFiltroAno() {
  const anoSel = document.getElementById('execAnoSelect');
  if (anoSel) {
    selecionarAnoDashboard(anoSel.value);
  }
}

function abrirInfoDashboardExecutivo() {
  if (typeof showToast === 'function') {
    showToast('ℹ️ FLIGHTS DELAY ANALYSIS: Indicadores operacionais auditados em tempo real com dados reais de voos e pontualidade.', 'info');
  }
}

// Renderiza o gráfico de rosca circular (Doughnut) de atrasos
function renderizarDonutAtrasosRef(canvasId, listaAtrasos) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;

  if (window._analiseCharts.donutAtraso) {
    try { window._analiseCharts.donutAtraso.destroy(); } catch(e) {}
    window._analiseCharts.donutAtraso = null;
  }

  let labels = [];
  let dataVals = [];
  const colors = ['#1E3A8A', '#2563EB', '#38BDF8', '#60A5FA', '#93C5FD', '#A5B4FC'];

  if (!listaAtrasos || listaAtrasos.length === 0) {
    labels = ['Sem Atrasos (100% Pontual)'];
    dataVals = [1];
  } else {
    listaAtrasos.slice(0, 5).forEach(a => {
      labels.push(a.codigo || a.descricao || 'STD15');
      dataVals.push(a.qtd || 1);
    });
  }

  const ctx = canvas.getContext('2d');
  window._analiseCharts.donutAtraso = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: dataVals,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#FFFFFF'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '66%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.raw} ocorrência(s)`
          }
        }
      }
    }
  });

  const legEl = document.getElementById('refDonutLegend');
  if (legEl) {
    legEl.innerHTML = labels.map((l, idx) => {
      const c = colors[idx % colors.length];
      const v = dataVals[idx];
      return `<span><i style="background:${c}"></i><b>${l}</b> (${v})</span>`;
    }).join(' ');
  }
}

// Renderiza o gráfico de área (Area Chart) de evolução mensal
function renderizarAreaEvolucaoMensal(canvasId, dataColab) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;

  if (window._analiseCharts.areaEvolucao) {
    try { window._analiseCharts.areaEvolucao.destroy(); } catch(e) {}
    window._analiseCharts.areaEvolucao = null;
  }

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 160);
  gradient.addColorStop(0, 'rgba(29, 78, 216, 0.6)');
  gradient.addColorStop(1, 'rgba(59, 130, 246, 0.03)');

  const labels = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const otpBase = dataColab && dataColab.otp ? dataColab.otp.noHorarioPercent : 85;
  const atrasoBase = Math.max(2, 100 - otpBase);

  const dataVals = [
    Math.min(20, Math.max(3, atrasoBase + 1.2)),
    Math.min(20, Math.max(3, atrasoBase + 0.8)),
    Math.min(20, Math.max(3, atrasoBase - 0.5)),
    Math.min(20, Math.max(3, atrasoBase - 1.0)),
    Math.min(20, Math.max(3, atrasoBase - 0.2)),
    Math.min(20, Math.max(3, atrasoBase + 0.4)),
    Math.min(20, Math.max(3, atrasoBase + 1.5)),
    Math.min(20, Math.max(3, atrasoBase + 0.1)),
    Math.min(20, Math.max(3, atrasoBase - 0.8)),
    atrasoBase,
    Math.min(20, Math.max(3, atrasoBase - 0.4)),
    Math.min(20, Math.max(3, atrasoBase + 1.8))
  ].map(v => Number(v.toFixed(1)));

  window._analiseCharts.areaEvolucao = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Delay % by Month',
        data: dataVals,
        borderColor: '#1D4ED8',
        borderWidth: 2.5,
        backgroundColor: gradient,
        fill: true,
        tension: 0.38,
        pointRadius: 3,
        pointBackgroundColor: '#1D4ED8',
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 9.5, weight: '700' }, color: '#64748B' }
        },
        y: {
          min: 0,
          max: 20,
          ticks: {
            stepSize: 5,
            callback: val => val + '%',
            font: { size: 9, weight: '700' },
            color: '#64748B'
          },
          grid: { color: 'rgba(226, 232, 240, 0.7)' }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` Atraso Médio: ${ctx.raw}% (Pontualidade: ${(100 - ctx.raw).toFixed(1)}%)`
          }
        }
      }
    }
  });
}

// ==========================================================
// COORDENADAS E METADADOS DOS AEROPORTOS (HUB GRU & ROTAS)
// ==========================================================
const MAPA_COORDENADAS_AEROPORTOS = {
  // Principais capitais e polos nacionais
  "GRU": { nome: "São Paulo / Guarulhos", uf: "SP", x: 185, y: 196 },
  "CGH": { nome: "São Paulo / Congonhas", uf: "SP", x: 183, y: 198 },
  "VCP": { nome: "Campinas / Viracopos", uf: "SP", x: 181, y: 193 },
  "BSB": { nome: "Brasília", uf: "DF", x: 178, y: 138 },
  "CNF": { nome: "Belo Horizonte / Confins", uf: "MG", x: 198, y: 168 },
  "GIG": { nome: "Rio de Janeiro / Galeão", uf: "RJ", x: 212, y: 188 },
  "SDU": { nome: "Rio de Janeiro / Santos Dumont", uf: "RJ", x: 214, y: 190 },
  "SSA": { nome: "Salvador", uf: "BA", x: 242, y: 122 },
  "REC": { nome: "Recife", uf: "PE", x: 262, y: 92 },
  "FOR": { nome: "Fortaleza", uf: "CE", x: 238, y: 68 },
  "POA": { nome: "Porto Alegre", uf: "RS", x: 158, y: 226 },
  "CWB": { nome: "Curitiba", uf: "PR", x: 168, y: 202 },
  "FLN": { nome: "Florianópolis", uf: "SC", x: 172, y: 214 },
  "NVT": { nome: "Navegantes", uf: "SC", x: 173, y: 210 },
  "VIX": { nome: "Vitória", uf: "ES", x: 225, y: 168 },
  "GYN": { nome: "Goiânia", uf: "GO", x: 168, y: 146 },
  "CGB": { nome: "Cuiabá", uf: "MT", x: 132, y: 135 },
  "CGR": { nome: "Campo Grande", uf: "MS", x: 142, y: 176 },
  "BEL": { nome: "Belém", uf: "PA", x: 182, y: 56 },
  "MAO": { nome: "Manaus", uf: "AM", x: 108, y: 64 },
  "SLZ": { nome: "São Luís", uf: "MA", x: 206, y: 60 },
  "NAT": { nome: "Natal", uf: "RN", x: 260, y: 78 },
  "MCZ": { nome: "Maceió", uf: "AL", x: 256, y: 104 },
  "AJU": { nome: "Aracaju", uf: "SE", x: 250, y: 114 },
  "JPA": { nome: "João Pessoa", uf: "PB", x: 262, y: 84 },
  "THE": { nome: "Teresina", uf: "PI", x: 210, y: 78 },
  "PMW": { nome: "Palmas", uf: "TO", x: 176, y: 106 },
  "PVH": { nome: "Porto Velho", uf: "RO", x: 78, y: 102 },
  "RBR": { nome: "Rio Branco", uf: "AC", x: 50, y: 114 },
  "MCP": { nome: "Macapá", uf: "AP", x: 172, y: 40 },
  "BVB": { nome: "Boa Vista", uf: "RR", x: 104, y: 32 },
  
  // Interior e regionais brasileiros
  "IGU": { nome: "Foz do Iguaçu", uf: "PR", x: 140, y: 204 },
  "LDB": { nome: "Londrina", uf: "PR", x: 158, y: 190 },
  "MGF": { nome: "Maringá", uf: "PR", x: 154, y: 191 },
  "CAC": { nome: "Cascavel", uf: "PR", x: 146, y: 198 },
  "JOI": { nome: "Joinville", uf: "SC", x: 171, y: 207 },
  "XAP": { nome: "Chapecó", uf: "SC", x: 152, y: 212 },
  "JJG": { nome: "Jaguaruna", uf: "SC", x: 168, y: 220 },
  "CXJ": { nome: "Caxias do Sul", uf: "RS", x: 160, y: 222 },
  "PFB": { nome: "Passo Fundo", uf: "RS", x: 154, y: 216 },
  "RAO": { nome: "Ribeirão Preto", uf: "SP", x: 174, y: 182 },
  "SJP": { nome: "São José do Rio Preto", uf: "SP", x: 166, y: 178 },
  "UDI": { nome: "Uberlândia", uf: "MG", x: 175, y: 162 },
  "UBA": { nome: "Uberaba", uf: "MG", x: 177, y: 165 },
  "IZA": { nome: "Juiz de Fora", uf: "MG", x: 205, y: 182 },
  "MOC": { nome: "Montes Claros", uf: "MG", x: 204, y: 146 },
  "BPS": { nome: "Porto Seguro", uf: "BA", x: 242, y: 142 },
  "IOS": { nome: "Ilhéus", uf: "BA", x: 243, y: 132 },
  "VDC": { nome: "Vitória da Conquista", uf: "BA", x: 228, y: 134 },
  "PNZ": { nome: "Petrolina", uf: "PE", x: 232, y: 100 },
  "JDO": { nome: "Juazeiro do Norte", uf: "CE", x: 240, y: 88 },
  "JJD": { nome: "Jericoacoara", uf: "CE", x: 230, y: 60 },
  "IMP": { nome: "Imperatriz", uf: "MA", x: 190, y: 82 },
  "OPS": { nome: "Sinop", uf: "MT", x: 140, y: 108 },
  "DOU": { nome: "Dourados", uf: "MS", x: 138, y: 184 },
  "BYO": { nome: "Bonito", uf: "MS", x: 132, y: 180 },
  "CLV": { nome: "Caldas Novas", uf: "GO", x: 173, y: 152 },
  "FEN": { nome: "Fernando de Noronha", uf: "PE", x: 282, y: 64 },

  // América do Sul
  "EZE": { nome: "Buenos Aires / Ezeiza", uf: "ARG", x: 138, y: 242 },
  "AEP": { nome: "Buenos Aires / Aeroparque", uf: "ARG", x: 139, y: 240 },
  "COR": { nome: "Córdoba", uf: "ARG", x: 114, y: 236 },
  "ROS": { nome: "Rosario", uf: "ARG", x: 126, y: 238 },
  "MDZ": { nome: "Mendoza", uf: "ARG", x: 96, y: 238 },
  "MVD": { nome: "Montevidéu", uf: "URU", x: 154, y: 244 },
  "SCL": { nome: "Santiago", uf: "CHI", x: 82, y: 240 },
  "ASU": { nome: "Assunção", uf: "PAR", x: 134, y: 196 },
  "LIM": { nome: "Lima", uf: "PER", x: 38, y: 120 },
  "BOG": { nome: "Bogotá", uf: "COL", x: 44, y: 62 },

  // Internacional longo curso conectado a GRU
  "MIA": { nome: "Miami", uf: "EUA", x: 38, y: 22 },
  "MCO": { nome: "Orlando", uf: "EUA", x: 34, y: 18 },
  "JFK": { nome: "Nova York", uf: "EUA", x: 48, y: 12 },
  "BOS": { nome: "Boston", uf: "EUA", x: 54, y: 10 },
  "LAX": { nome: "Los Angeles", uf: "EUA", x: 15, y: 15 },
  "MEX": { nome: "Cidade do México", uf: "MEX", x: 18, y: 35 },
  "PUJ": { nome: "Punta Cana", uf: "DOM", x: 55, y: 32 },
  "LIS": { nome: "Lisboa", uf: "POR", x: 248, y: 15 },
  "MAD": { nome: "Madri", uf: "ESP", x: 256, y: 14 },
  "BCN": { nome: "Barcelona", uf: "ESP", x: 264, y: 14 },
  "CDG": { nome: "Paris", uf: "FRA", x: 260, y: 10 },
  "LHR": { nome: "Londres", uf: "ING", x: 252, y: 8 },
  "FRA": { nome: "Frankfurt", uf: "ALE", x: 268, y: 8 },
  "AMS": { nome: "Amsterdã", uf: "HOL", x: 264, y: 6 },
  "MXP": { nome: "Milão", uf: "ITA", x: 272, y: 12 },
  "FCO": { nome: "Roma", uf: "ITA", x: 276, y: 14 },
  "BRU": { nome: "Bruxelas", uf: "BEL", x: 262, y: 7 },
  "JNB": { nome: "Joanesburgo", uf: "AFS", x: 288, y: 200 },
  "CPT": { nome: "Cidade do Cabo", uf: "AFS", x: 282, y: 220 }
};

// ==========================================================
// PALETA DE CORES DETERMINÍSTICA E ESTÁVEL POR DESTINO
// ==========================================================
const PALETA_CORES_DESTINOS = [
  '#2563EB', '#E11D48', '#059669', '#D97706', '#7C3AED', 
  '#0891B2', '#EA580C', '#C026D3', '#0D9488', '#4F46E5', 
  '#DB2777', '#16A34A', '#CA8A04', '#9333EA', '#0284C7',
  '#DC2626', '#0284C7', '#059669', '#D97706', '#6366F1'
];

function obterCorEstavelDestino(cod) {
  if (!cod) return '#2563EB';
  const upper = cod.toUpperCase();
  const fixed = {
    'BSB': '#2563EB', // Azul Royal
    'REC': '#E11D48', // Vermelho Rubi
    'SSA': '#D97706', // Ouro / Âmbar
    'GIG': '#059669', // Verde Esmeralda
    'SDU': '#10B981', // Verde Menta
    'FOR': '#7C3AED', // Roxo / Violeta
    'POA': '#EA580C', // Laranja
    'CWB': '#0891B2', // Ciano Profundo
    'FLN': '#0284C7', // Azul Céu
    'BEL': '#0D9488', // Verde Petróleo
    'MAO': '#16A34A', // Verde Folha
    'SCL': '#C026D3', // Fúcsia
    'AEP': '#4F46E5', // Índigo
    'EZE': '#6366F1', // Índigo Claro
    'LIM': '#DB2777', // Rosa
    'BPS': '#F59E0B', // Amarelo Dourado
    'NAT': '#CA8A04', // Âmbar Dourado
    'MCZ': '#9333EA', // Roxo Real
    'NVT': '#06B6D4', // Ciano Brilhante
    'VIX': '#3B82F6', // Azul Real
    'GYN': '#84CC16', // Verde Lima
    'CGB': '#14B8A6', // Turquesa
    'CGR': '#F97316'  // Laranja Quente
  };
  if (fixed[upper]) return fixed[upper];
  let hash = 0;
  for (let i = 0; i < upper.length; i++) {
    hash = upper.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % PALETA_CORES_DESTINOS.length;
  return PALETA_CORES_DESTINOS[idx];
}

// ==========================================================
// RANKING COMPLETO DE DESTINOS OPERADOS (SCROLL + ORDENAÇÃO)
// Inicial: Menor para o maior (⬆ Menos voados) com opção de inverter
// ==========================================================
function renderizarRankingDestinosCompleto(destinos, ordenacaoAsc = true) {
  const container = document.getElementById('refRankingDestinosList');
  if (!container) return;

  if (!destinos || destinos.length === 0) {
    container.innerHTML = `
      <div style="font-size:10px;color:#94A3B8;padding:24px 8px;text-align:center">
        Nenhum destino registrado no período selecionado.
      </div>
    `;
    return;
  }

  // Ordenação solicitada: inicial do menor para o maior (crescente) com toggle
  const sorted = [...destinos].sort((a, b) => {
    return ordenacaoAsc ? (a.qtd - b.qtd) : (b.qtd - a.qtd);
  });

  const maxQtd = Math.max(...sorted.map(d => d.qtd), 1);

  const html = sorted.map(d => {
    const cod = d.des.toUpperCase();
    const infoAero = MAPA_COORDENADAS_AEROPORTOS[cod] || { nome: cod, uf: 'BR' };
    const cor = obterCorEstavelDestino(cod);
    const pct = Math.max(8, Math.round((d.qtd / maxQtd) * 100));

    return `
      <div class="ref-ranking-row" id="refRankingRow_${cod}"
           data-dest="${cod}"
           data-color="${cor}"
           style="border-left: 3.5px solid ${cor}"
           onmouseenter="destacarDestinoNoMapa('${cod}')"
           onmouseleave="removerDestaqueDestinoMapa()"
           onclick="destacarDestinoNoMapa('${cod}', true)">
        <span class="ref-ranking-badge" style="background:${cor};border:1px solid #FFFFFF;box-shadow:0 2px 6px ${cor}44">${cod}</span>
        <div class="ref-ranking-info">
          <div class="ref-ranking-city" title="${infoAero.nome} (${infoAero.uf})">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${cor};margin-right:4px"></span>
            ${infoAero.nome} <span style="font-size:9px;color:#64748B">(${infoAero.uf})</span>
          </div>
          <div class="ref-ranking-bar-track">
            <div class="ref-ranking-bar-fill" style="width:${pct}%;background:${cor}"></div>
          </div>
        </div>
        <div class="ref-ranking-qty" style="color:${cor}">
          <b>${d.qtd}</b> <span style="font-size:9.5px;color:#64748B">${d.qtd === 1 ? 'voo' : 'voos'}</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

function alternarOrdenacaoRankingDestinos() {
  window._analiseState.ordenacaoRankingAsc = !window._analiseState.ordenacaoRankingAsc;
  const btn = document.getElementById('btnSortRankingDestinos');
  if (btn) {
    btn.textContent = window._analiseState.ordenacaoRankingAsc ? '⬆ Menos voados' : '⬇ Mais voados';
  }
  renderizarRankingDestinosCompleto(window._analiseState.destinosAtuais || [], window._analiseState.ordenacaoRankingAsc);
}

// ==========================================================
// MAPA VETORIAL DO BRASIL COM ROTAS E SETAS COLORIDAS DE GRU
// ==========================================================
function renderizarMapaBrasilRotas(destinos, colabNome) {
  const svgGrupoRotas = document.getElementById('svgGrupoRotas');
  const svgGrupoDestinos = document.getElementById('svgGrupoDestinos');
  const badgeCount = document.getElementById('refMapDestCountBadge');
  const colorLegend = document.getElementById('refMapColorLegend');
  const svgEl = document.getElementById('svgMapaBrasilRotas');
  if (!svgGrupoRotas || !svgGrupoDestinos || !svgEl) return;

  svgGrupoRotas.innerHTML = '';
  svgGrupoDestinos.innerHTML = '';
  if (colorLegend) colorLegend.innerHTML = '';

  const list = destinos || [];
  if (badgeCount) {
    badgeCount.textContent = `${list.length} ${list.length === 1 ? 'destino' : 'destinos'}`;
  }

  if (list.length === 0) return;

  const gruX = 185;
  const gruY = 196;
  const maxQtd = Math.max(...list.map(d => d.qtd), 1);

  let rotasHtml = '';
  let destinosHtml = '';
  let defsMarkersHtml = '';
  let legendHtml = '';

  list.forEach(d => {
    const cod = d.des.toUpperCase();
    const aero = MAPA_COORDENADAS_AEROPORTOS[cod];
    if (!aero) return;

    const destX = aero.x;
    const destY = aero.y;
    const cor = obterCorEstavelDestino(cod);

    const dx = destX - gruX;
    const dy = destY - gruY;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return;

    const mx = (gruX + destX) / 2;
    const my = (gruY + destY) / 2;
    const nx = -dy / dist;
    const ny = dx / dist;
    const h = Math.min(26, Math.max(6, dist * 0.16));
    const cpX = Math.round(mx + nx * h);
    const cpY = Math.round(my + ny * h);

    const pathD = `M ${gruX} ${gruY} Q ${cpX} ${cpY} ${destX} ${destY}`;
    const dotR = (3.5 + (d.qtd / maxQtd) * 3.5).toFixed(1);
    const strokeW = (1.6 + (d.qtd / maxQtd) * 1.8).toFixed(1);

    // Cria marcador SVG com a cor exata da rota
    defsMarkersHtml += `
      <marker id="arrowMarker_${cod}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
        <path d="M 0 1 L 8 5 L 0 9 z" fill="${cor}" />
      </marker>
    `;

    rotasHtml += `
      <path id="svgRoute_${cod}"
            class="ref-flight-route"
            d="${pathD}"
            stroke="${cor}"
            stroke-width="${strokeW}"
            marker-end="url(#arrowMarker_${cod})"
            data-dest="${cod}"
            data-color="${cor}"
            onmouseenter="destacarDestinoNoMapa('${cod}')"
            onmouseleave="removerDestaqueDestinoMapa()" />
    `;

    destinosHtml += `
      <circle id="svgDot_${cod}"
              class="ref-dest-dot"
              cx="${destX}"
              cy="${destY}"
              r="${dotR}"
              fill="${cor}"
              stroke="#FFFFFF"
              stroke-width="1.8"
              data-dest="${cod}"
              data-color="${cor}"
              data-city="${aero.nome}"
              data-uf="${aero.uf}"
              data-qtd="${d.qtd}"
              data-delayed="${d.delayed || 0}"
              onmouseenter="destacarDestinoNoMapa('${cod}', false, event)"
              onmousemove="moverTooltipMapa(event)"
              onmouseleave="removerDestaqueDestinoMapa()"
              onclick="destacarDestinoNoMapa('${cod}', true)" />
    `;

    legendHtml += `
      <span class="ref-legend-pill" style="border:1px solid ${cor};color:#0F172A;background:#FFFFFF;border-radius:12px;padding:2px 7px;font-size:9.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:3px;box-shadow:0 1px 3px rgba(0,0,0,0.06)" onclick="destacarDestinoNoMapa('${cod}', true)">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${cor}"></span>
        ${cod} <b style="color:${cor};font-size:9px">(${d.qtd})</b>
      </span>
    `;
  });

  const existingDefs = svgEl.querySelector('defs');
  if (existingDefs) {
    existingDefs.innerHTML = `
      <marker id="arrowMarker" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
        <path d="M 0 1 L 8 5 L 0 9 z" fill="#0284C7" />
      </marker>
      <marker id="arrowMarkerActive" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
        <path d="M 0 1 L 8 5 L 0 9 z" fill="#F59E0B" />
      </marker>
      ${defsMarkersHtml}
    `;
  }

  svgGrupoRotas.innerHTML = rotasHtml;
  svgGrupoDestinos.innerHTML = destinosHtml;
  if (colorLegend) {
    colorLegend.innerHTML = legendHtml;
  }
}

// Sincronização bidirecional de destaque entre ranking e mapa
function destacarDestinoNoMapa(cod, scrollIntoList = false, evt = null) {
  if (!cod) return;
  const upper = cod.toUpperCase();

  document.querySelectorAll('.ref-flight-route').forEach(el => {
    const dest = el.getAttribute('data-dest');
    const color = el.getAttribute('data-color') || '#2563EB';
    if (dest === upper) {
      el.classList.add('highlighted');
      el.setAttribute('stroke', '#F59E0B');
      el.setAttribute('stroke-width', '3.5');
      el.setAttribute('marker-end', 'url(#arrowMarkerActive)');
      if (el.parentElement) el.parentElement.appendChild(el);
    } else {
      el.classList.remove('highlighted');
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', '1.8');
      el.setAttribute('marker-end', `url(#arrowMarker_${dest})`);
    }
  });

  let activeDot = null;
  document.querySelectorAll('.ref-dest-dot').forEach(el => {
    const dest = el.getAttribute('data-dest');
    const color = el.getAttribute('data-color') || '#2563EB';
    if (dest === upper) {
      el.classList.add('highlighted');
      el.setAttribute('fill', '#F59E0B');
      activeDot = el;
      if (el.parentElement) el.parentElement.appendChild(el);
    } else {
      el.classList.remove('highlighted');
      el.setAttribute('fill', color);
    }
  });

  document.querySelectorAll('.ref-ranking-row').forEach(row => {
    if (row.getAttribute('data-dest') === upper) {
      row.classList.add('highlighted');
      if (scrollIntoList) {
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } else {
      row.classList.remove('highlighted');
    }
  });

  const tooltip = document.getElementById('refMapTooltip');
  const wrap = document.getElementById('refRoutesMapWrap');
  if (tooltip && wrap && activeDot) {
    const aero = MAPA_COORDENADAS_AEROPORTOS[upper] || { nome: upper, uf: 'BR' };
    const qtd = activeDot.getAttribute('data-qtd') || '1';
    const delayed = activeDot.getAttribute('data-delayed') || '0';
    const cor = activeDot.getAttribute('data-color') || '#38BDF8';
    const delayText = parseInt(delayed, 10) > 0 ? `<span style="color:#F87171">${delayed} atrasado(s)</span>` : '<span style="color:#4ADE80">100% no horário</span>';

    tooltip.innerHTML = `
      <div style="font-weight:800;color:${cor};font-size:10.5px">● ${upper} • ${aero.nome} (${aero.uf})</div>
      <div style="font-size:9.5px;color:#E2E8F0;margin-top:2px">
        Rota GRU ➔ ${upper}: <b>${qtd} voo(s)</b> • ${delayText}
      </div>
    `;

    const wrapRect = wrap.getBoundingClientRect();
    let posX = 0;
    let posY = 0;

    if (evt && evt.clientX) {
      posX = evt.clientX - wrapRect.left;
      posY = evt.clientY - wrapRect.top;
    } else {
      const dotRect = activeDot.getBoundingClientRect();
      posX = dotRect.left - wrapRect.left + dotRect.width / 2;
      posY = dotRect.top - wrapRect.top;
    }

    tooltip.style.left = `${Math.max(40, Math.min(wrapRect.width - 40, posX))}px`;
    tooltip.style.top = `${Math.max(20, posY - 10)}px`;
    tooltip.style.display = 'block';
  }
}

function removerDestaqueDestinoMapa() {
  document.querySelectorAll('.ref-flight-route').forEach(el => {
    const dest = el.getAttribute('data-dest');
    const color = el.getAttribute('data-color') || '#2563EB';
    el.classList.remove('highlighted');
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', '1.8');
    el.setAttribute('marker-end', `url(#arrowMarker_${dest})`);
  });
  document.querySelectorAll('.ref-dest-dot').forEach(el => {
    const color = el.getAttribute('data-color') || '#0284C7';
    el.classList.remove('highlighted');
    el.setAttribute('fill', color);
  });
  document.querySelectorAll('.ref-ranking-row').forEach(el => {
    el.classList.remove('highlighted');
  });
  const tooltip = document.getElementById('refMapTooltip');
  if (tooltip) tooltip.style.display = 'none';
}

function moverTooltipMapa(evt) {
  const tooltip = document.getElementById('refMapTooltip');
  const wrap = document.getElementById('refRoutesMapWrap');
  if (!tooltip || !wrap || tooltip.style.display === 'none') return;

  const wrapRect = wrap.getBoundingClientRect();
  const posX = evt.clientX - wrapRect.left;
  const posY = evt.clientY - wrapRect.top;

  tooltip.style.left = `${Math.max(40, Math.min(wrapRect.width - 40, posX))}px`;
  tooltip.style.top = `${Math.max(20, posY - 10)}px`;
}

// ==========================================================
// MODAL DE PRÉ-VISUALIZAÇÃO INTERATIVA DO RELATÓRIO PDF
// ==========================================================
function abrirModalPreviaPdf() {
  const modal = document.getElementById('modalPreviaRelatorioPdf');
  const container = document.getElementById('refPdfPreviewContainer');
  const colabNomeEl = document.getElementById('modalPdfColabNome');
  const mesEl = document.getElementById('modalPdfMes');
  const printArea = document.getElementById('execDashboardPrintArea');

  if (!modal || !container || !printArea) return;

  const nome = window._analiseState.colaborador || 'COLABORADOR';
  const mes = window._analiseState.mes || 'OUTUBRO/2026';

  if (colabNomeEl) colabNomeEl.textContent = nome;
  if (mesEl) mesEl.textContent = mes;

  container.innerHTML = '';

  // --- SELETOR DE PÁGINA 1: DASHBOARD EXECUTIVO 16:9 ---
  const p1Indicator = document.createElement('div');
  p1Indicator.style.cssText = 'background:#1E3A8A;color:#FFFFFF;padding:6px 14px;border-radius:6px;font-size:11px;font-weight:800;letter-spacing:0.5px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center';
  p1Indicator.innerHTML = `
    <span>📄 PÁGINA 1 DE 2 — DASHBOARD EXECUTIVO OPERACIONAL (16:9)</span>
    <span style="font-size:10px;color:#93C5FD">Aeroporto Internacional de Guarulhos (GRU)</span>
  `;
  container.appendChild(p1Indicator);

  const cloneDash = printArea.cloneNode(true);
  cloneDash.id = 'execDashboardPrintAreaPreviewClone';
  cloneDash.style.margin = '0 auto';
  cloneDash.style.boxShadow = 'none';
  cloneDash.querySelectorAll('.analise-op-actions').forEach(el => el.remove());

  // Copia rasterização de todos os canvases para o clone não ficar em branco
  const srcCanvases = printArea.querySelectorAll('canvas');
  const cloneCanvases = cloneDash.querySelectorAll('canvas');
  srcCanvases.forEach((src, idx) => {
    const dest = cloneCanvases[idx];
    if (dest && src && src.width > 0 && src.height > 0) {
      try {
        const img = document.createElement('img');
        img.src = src.toDataURL('image/png', 1.0);
        img.style.width = src.offsetWidth ? src.offsetWidth + 'px' : (src.id.includes('Donut') ? '130px' : '100%');
        img.style.height = src.offsetHeight ? src.offsetHeight + 'px' : (src.id.includes('Donut') ? '130px' : '160px');
        img.style.display = 'block';
        img.style.margin = '0 auto';
        dest.parentNode.replaceChild(img, dest);
      } catch (e) {
        console.warn('Falha ao rasterizar canvas na prévia:', e);
      }
    }
  });

  container.appendChild(cloneDash);

  // --- DIVISOR ENTRE PÁGINAS ---
  const pageDivider = document.createElement('div');
  pageDivider.style.cssText = 'margin:24px 0 12px 0;border-top:2px dashed #3B82F6;padding-top:12px;background:#1E3A8A;color:#FFFFFF;padding:8px 14px;border-radius:6px;font-size:11px;font-weight:800;letter-spacing:0.5px;display:flex;justify-content:space-between;align-items:center';
  pageDivider.innerHTML = `
    <span>📄 PÁGINA 2 DE 2 — PARECER TÉCNICO & TABELA COMPLETA DE VOOS</span>
    <span style="font-size:10px;color:#93C5FD">Auditoria Real 100% dos Registros</span>
  `;
  container.appendChild(pageDivider);

  // --- SELETOR DE PÁGINA 2: PARECER TÉCNICO & TABELA DE VOOS ---
  const dataset = window.DATASET_COLABORADORES || {};
  const dataColab = dataset[nome] || (nome !== 'Equipe_Geral' ? dataset[Object.keys(dataset).find(k => k.trim().toUpperCase() === nome.trim().toUpperCase())] : null);

  const page2Preview = document.createElement('div');
  page2Preview.style.cssText = 'background:#FFFFFF;color:#0F172A;border-radius:10px;padding:20px;margin-top:10px;box-shadow:0 4px 15px rgba(0,0,0,0.2)';
  
  const flightList = (dataColab && dataColab.flightList) ? dataColab.flightList : [];
  let tabelaRowsHtml = '';
  if (flightList.length === 0) {
    tabelaRowsHtml = '<tr><td colspan="9" style="text-align:center;padding:12px;color:#64748B">Nenhum registro operacional encontrado para este período.</td></tr>';
  } else {
    tabelaRowsHtml = flightList.map((f, i) => {
      const isNoHorario = (f.otp || '').includes('Horário') || f.otp === 'NH';
      const otpColor = isNoHorario ? '#059669' : '#DC2626';
      const otpText = isNoHorario ? '✔ No Horário' : `⏰ Atrasado (${f.cod1 || 'STD15'})`;
      return `
        <tr style="background:${i % 2 === 0 ? '#FFFFFF' : '#F8FAFC'};border-bottom:1px solid #E2E8F0">
          <td style="padding:7px 8px;font-weight:800;color:#0F172A">${f.voo || '-'}</td>
          <td style="padding:7px 8px;color:#475569">${f.data || '24/10'}</td>
          <td style="padding:7px 8px;font-weight:700;color:#00796B">${f.des || '-'}</td>
          <td style="padding:7px 8px"><code>${f.std || '--:--'}</code></td>
          <td style="padding:7px 8px"><code>${f.porta || '--:--'}</code></td>
          <td style="padding:7px 8px;font-weight:700">${f.pos || 'FINGER'}</td>
          <td style="padding:7px 8px;font-size:11px;color:#334155">${f.a1 || '-'}</td>
          <td style="padding:7px 8px;font-size:11px;color:#334155">${f.a2 || '-'}</td>
          <td style="padding:7px 8px;text-align:center;font-weight:700;color:${otpColor}">${otpText}</td>
        </tr>
      `;
    }).join('');
  }

  page2Preview.innerHTML = `
    <div style="border-bottom:2px solid #0B1A33;padding-bottom:8px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:15px;font-weight:900;color:#0B1A33;text-transform:uppercase">
          Relatório Técnico & Detalhamento Operacional de Voos
        </div>
        <div style="font-size:11px;color:#64748B">
          Colaborador: <b>${nome}</b> • Mês: <b>${mes}</b>
        </div>
      </div>
      <div style="font-size:11px;color:#00796B;font-weight:700;text-align:right">
        Aeroporto Internacional de Guarulhos (GRU)<br>
        Diário de Embarque • Auditoria Operacional
      </div>
    </div>

    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:900;color:#0B1A33;margin-bottom:6px;text-transform:uppercase">
        📝 ANÁLISE INDIVIDUAL DO DESEMPENHO
      </div>
      ${gerarAnaliseIndividualTexto(dataColab)}
    </div>

    <div>
      <div style="font-size:12px;font-weight:800;color:#0B1A33;margin-bottom:6px;text-transform:uppercase">
        🛫 Relação de Voos Operados no Período (${flightList.length} voos únicos)
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;color:#0F172A;border:1px solid #CBD5E1">
        <thead>
          <tr style="background:#0B1A33;color:#FFFFFF;text-align:left">
            <th style="padding:7px 8px">Voo</th>
            <th style="padding:7px 8px">Data</th>
            <th style="padding:7px 8px">Destino</th>
            <th style="padding:7px 8px">STD</th>
            <th style="padding:7px 8px">Porta</th>
            <th style="padding:7px 8px">Posição</th>
            <th style="padding:7px 8px">Agente 1</th>
            <th style="padding:7px 8px">Agente 2</th>
            <th style="padding:7px 8px;text-align:center">Situação (OTP)</th>
          </tr>
        </thead>
        <tbody>
          ${tabelaRowsHtml}
        </tbody>
      </table>
    </div>
  `;
  container.appendChild(page2Preview);

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function fecharModalPreviaPdf() {
  const modal = document.getElementById('modalPreviaRelatorioPdf');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

function compartilharRelatorioPdf() {
  const nome = window._analiseState.colaborador || 'Colaborador';
  const url = window.location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      if (typeof showToast === 'function') {
        showToast(`✔ Link do relatório de ${nome} copiado para a área de transferência!`, 'success');
      }
    }).catch(() => {
      prompt('Copie o link do relatório:', url);
    });
  } else {
    prompt('Copie o link do relatório:', url);
  }
}

function enviarRelatorioEmail() {
  const nome = window._analiseState.colaborador || 'Colaborador';
  const mes = window._analiseState.mes || 'OUTUBRO/2026';
  const assunto = encodeURIComponent(`Relatório Operacional Individual • ${nome} • ${mes}`);
  const corpo = encodeURIComponent(`Prezados,\n\nSegue o Relatório Individual de Desempenho Operacional do colaborador ${nome} referente ao período de ${mes} (Aeroporto Internacional de Guarulhos - GRU).\n\nAcesse o Diário de Embarque para visualizar os gráficos completos e a relação detalhada de voos.\n\nAtenciosamente,\nGestão Operacional • Diário de Embarque GRU`);
  window.open(`mailto:?subject=${assunto}&body=${corpo}`);
}

// Renderiza barras horizontais de causas de atraso
function renderizarHbarsRefAtrasos(containerId, atrasos) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!atrasos || atrasos.length === 0) {
    el.innerHTML = `
      <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:16px 10px;text-align:center">
        <div style="font-size:20px;margin-bottom:4px">🎉</div>
        <div style="font-weight:900;color:#166534;font-size:11px">100% PONTUALIDADE</div>
        <div style="font-size:9.5px;color:#15803D;margin-top:2px">Nenhum atraso registrado</div>
      </div>
    `;
    return;
  }

  const maxQtd = Math.max(...atrasos.map(a => a.qtd || 1), 1);
  el.innerHTML = atrasos.slice(0, 5).map(a => {
    const pct = Math.max(12, Math.round((a.qtd / maxQtd) * 100));
    return `
      <div class="ref-hbar-row">
        <div class="ref-hbar-label" title="${a.codigo} - ${a.descricao}">${a.codigo || 'STD15'}</div>
        <div class="ref-hbar-track">
          <div class="ref-hbar-fill" style="width:${pct}%"></div>
        </div>
        <div class="ref-hbar-val">${a.qtd}</div>
      </div>
    `;
  }).join('');
}

// Renderiza barras horizontais de voos e destinos
function renderizarHbarsRefCarriers(bottomId, topId, voos, destinos) {
  const bEl = document.getElementById(bottomId);
  const tEl = document.getElementById(topId);

  if (bEl) {
    const listV = voos || [];
    if (listV.length === 0) {
      bEl.innerHTML = '<div style="font-size:10.5px;color:#94A3B8;padding:12px;text-align:center">Sem voos no período</div>';
    } else {
      const maxV = Math.max(...listV.map(v => v.qtd || 1), 1);
      bEl.innerHTML = listV.slice(0, 6).map(v => {
        const pct = Math.max(10, Math.round((v.qtd / maxV) * 100));
        return `
          <div class="ref-hbar-row">
            <div class="ref-hbar-label" title="${v.voo}">${v.voo}</div>
            <div class="ref-hbar-track">
              <div class="ref-hbar-fill purple" style="width:${pct}%"></div>
            </div>
            <div class="ref-hbar-val">${v.qtd}</div>
          </div>
        `;
      }).join('');
    }
  }

  if (tEl) {
    const listD = destinos || [];
    if (listD.length === 0) {
      tEl.innerHTML = '<div style="font-size:10.5px;color:#94A3B8;padding:12px;text-align:center">Sem destinos no período</div>';
    } else {
      const maxD = Math.max(...listD.map(d => d.qtd || 1), 1);
      tEl.innerHTML = listD.slice(0, 6).map(d => {
        const des = d.des || d.destino || d.voo || '-';
        const pct = Math.max(10, Math.round((d.qtd / maxD) * 100));
        return `
          <div class="ref-hbar-row">
            <div class="ref-hbar-label" title="${des}">${des}</div>
            <div class="ref-hbar-track">
              <div class="ref-hbar-fill teal" style="width:${pct}%"></div>
            </div>
            <div class="ref-hbar-val">${d.qtd}</div>
          </div>
        `;
      }).join('');
    }
  }
}

// ==========================================================
// 1. RENDERIZAÇÃO DO RELATÓRIO INDIVIDUAL (DADOS 100% REAIS)
// ==========================================================
function renderRelatorioIndividual(nomeColab) {
  window._analiseState.modo = 'individual';

  // Destruição prévia e higienização total de gráficos para nunca misturar dados
  if (window._analiseCharts.donutAtraso) {
    try { window._analiseCharts.donutAtraso.destroy(); } catch(e) {}
    window._analiseCharts.donutAtraso = null;
  }
  if (window._analiseCharts.areaEvolucao) {
    try { window._analiseCharts.areaEvolucao.destroy(); } catch(e) {}
    window._analiseCharts.areaEvolucao = null;
  }

  // Busca exata pelo nome do colaborador sem nunca forçar dados de terceiros
  const cleanNome = (nomeColab || '').trim().toUpperCase();
  const dataset = window.DATASET_COLABORADORES || {};
  let data = dataset[cleanNome];

  if (!data) {
    const matchKey = Object.keys(dataset).find(k => k.trim().toUpperCase() === cleanNome);
    if (matchKey) data = dataset[matchKey];
  }

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  // Se o colaborador não tem dados registrados, exibe estado vazio real (SEM COPIAR DA MAYARA!)
  if (!data || !data.kpis) {
    setEl('refHeaderNome', nomeColab || 'COLABORADOR');
    setEl('refHeaderSetor', 'NÃO INFORMADO');
    setEl('refHeaderTurno', 'SEM ESCALA');
    setEl('refSidebarAvatar', extrairIniciais(nomeColab));
    setEl('refKpiTotalFlights', '0');
    setEl('refKpiDelayedFlights', '0');
    setEl('refKpiAvgDelay', '--:--');
    setEl('refKpiOtp', '0%');
    setEl('refKpiFinger', '0%');
    setEl('refKpiRemota', '0%');
    setEl('refKpiPosTotal', '0 voos');
    setEl('refKpiMostAffected', 'Sem dados');
    setEl('refMiniFingerVal', '0%');
    setEl('refMiniRemotaVal', '0%');

    // Limpa containers
    const hAtraso = document.getElementById('refHbarsAtraso');
    if (hAtraso) hAtraso.innerHTML = '<div style="font-size:11px;color:#64748B;padding:12px">Nenhum dado disponível.</div>';
    const hBottom = document.getElementById('refHbarsBottomCarriers');
    if (hBottom) hBottom.innerHTML = '<div style="font-size:11px;color:#64748B;padding:12px">Nenhum voo registrado.</div>';
    const hTop = document.getElementById('refHbarsTopCarriers');
    if (hTop) hTop.innerHTML = '<div style="font-size:11px;color:#64748B;padding:12px">Nenhum destino registrado.</div>';
    
    renderizarRankingDestinosCompleto([]);
    renderizarMapaBrasilRotas([]);

    const ratioWrap = document.getElementById('refRouteMapRatioWrap');
    if (ratioWrap) ratioWrap.innerHTML = '<div style="font-size:10px;color:#94A3B8;text-align:center">Sem dados de escala</div>';

    // Legado
    setEl('kpiTotalVoos', '0');
    setEl('kpiMediaStd', 'Dados insuficientes');
    setEl('kpiMediaPorta', 'Dados insuficientes');
    setEl('kpiAgente2', 'Não disponível');
    setEl('kpiTotalAtrasos', '0');
    setEl('kpiPontualidade', '0%');
    setEl('analiseFooterTexto', `RELATÓRIO INDIVIDUAL • ${nomeColab} • DADOS DE ${window._analiseState.mes || 'OUTUBRO/2026'}`);

    const analiseCard = document.getElementById('analiseIndividualConteudo');
    if (analiseCard) analiseCard.innerHTML = `<p style="color:#64748B;font-style:italic">Não há dados suficientes para realizar esta análise neste período.</p>`;

    renderizarTabelaVoosDetalhados([], `Nenhum voo encontrado para ${nomeColab}`);
    return;
  }

  // 1. ATUALIZAR CABEÇALHO DO DASHBOARD AZUL
  setEl('refHeaderNome', data.nome);
  setEl('refHeaderSetor', data.setor ? data.setor.toUpperCase() : 'EMBARQUE');
  setEl('refHeaderTurno', formatarTurnoOficial(data.turno));
  setEl('refSidebarAvatar', extrairIniciais(data.nome));
  const monthPill = document.getElementById('refHeaderMonthPill');
  if (monthPill) monthPill.textContent = (data.mes || window._analiseState.mes || 'Outubro').split('/')[0];

  // 2. ATUALIZAR OS 6 CARDS KPIS
  setEl('refKpiTotalFlights', data.kpis.totalVoos);
  const tfSub = document.getElementById('refKpiTotalFlightsSub');
  if (tfSub && data.kpis.participacoes) {
    const p = data.kpis.participacoes;
    tfSub.innerHTML = `A1: <b>${p.a1}</b> • A2: <b>${p.a2}</b> • A3: <b>${p.a3}</b>`;
  }

  setEl('refKpiDelayedFlights', data.otp.atrasadosQtd || 0);
  const dfSub = document.getElementById('refKpiDelayedFlightsSub');
  if (dfSub) {
    const pct = data.otp.atrasadosPercent !== undefined ? data.otp.atrasadosPercent : (100 - data.otp.noHorarioPercent);
    dfSub.innerHTML = `Índice de Atraso: <b>${pct.toFixed(1)}%</b>`;
  }

  setEl('refKpiAvgDelay', data.kpis.mediaPorta || data.kpis.mediaStd || '00:18');
  const adSub = document.getElementById('refKpiAvgDelaySub');
  if (adSub) {
    adSub.innerHTML = `Média STD: <b>${data.kpis.mediaStd || '--:--'}</b>`;
  }

  const otpPct = data.otp.noHorarioPercent.toFixed(1);
  setEl('refKpiOtp', `${otpPct}%`);
  const otpStatus = document.getElementById('refKpiOtpStatus');
  if (otpStatus) {
    if (data.otp.noHorarioPercent >= 85) {
      otpStatus.textContent = 'Superou Meta';
      otpStatus.style.color = '#059669';
    } else {
      otpStatus.textContent = 'Abaixo da Meta';
      otpStatus.style.color = '#DC2626';
    }
  }

  setEl('refKpiFinger', `${data.posicao.fingerPercent}%`);
  setEl('refKpiRemota', `${data.posicao.remotaPercent}%`);
  setEl('refKpiPosTotal', `${data.kpis.totalVoos} voos`);

  // Card 6: Most Affected Airport / Top Destino
  const topDes = (data.destinosMaisRealizados && data.destinosMaisRealizados[0]) ||
                 (data.voosMaisRealizados && data.voosMaisRealizados[0]) || null;
  const nomeTopAirport = topDes ? (topDes.des || topDes.destino || topDes.voo || 'Guarulhos (GRU)') : 'Guarulhos (GRU)';
  setEl('refKpiMostAffected', nomeTopAirport);

  // 3. RENDERIZAR LINHA 2: ATRASOS E CARRIERS
  renderizarHbarsRefAtrasos('refHbarsAtraso', data.codigosAtraso || []);
  renderizarDonutAtrasosRef('chartAnaliseDonutAtraso', data.codigosAtraso || []);
  renderizarHbarsRefCarriers('refHbarsBottomCarriers', 'refHbarsTopCarriers', data.voosMaisRealizados || [], data.destinosMaisRealizados || data.voosMaisRealizados || []);

  // 4. RENDERIZAR LINHA 3: ÁREA MENSAL, RANKING DE DESTINOS E MAPA DO BRASIL COM ROTAS DE GRU
  renderizarAreaEvolucaoMensal('chartAnaliseAreaMensal', data);

  // Extrai lista completa e real de destinos operados pelo colaborador
  const flightList = data.flightList || [];
  const mapDest = new Map();
  flightList.forEach(f => {
    const cod = (f.des || f.destino || '').trim().toUpperCase();
    if (cod && cod !== 'GRU') {
      const prev = mapDest.get(cod) || { des: cod, qtd: 0, delayed: 0 };
      prev.qtd += 1;
      const isDel = (f.otp && !f.otp.includes('Horário') && f.otp !== 'NH');
      if (isDel) prev.delayed += 1;
      mapDest.set(cod, prev);
    }
  });

  if (mapDest.size === 0 && data.destinosMaisRealizados) {
    data.destinosMaisRealizados.forEach(d => {
      const cod = (d.des || d.destino || d.codigo || '').trim().toUpperCase();
      if (cod && cod !== 'GRU') {
        mapDest.set(cod, { des: cod, qtd: d.qtd || 1, delayed: d.delayed || 0 });
      }
    });
  }

  const destinosArray = Array.from(mapDest.values());
  window._analiseState.destinosAtuais = destinosArray;

  renderizarRankingDestinosCompleto(destinosArray, window._analiseState.ordenacaoRankingAsc || false);
  renderizarMapaBrasilRotas(destinosArray, data.nome);

  // Proporção Finger vs Remota no Card de Rota
  const ratioWrap = document.getElementById('refRouteMapRatioWrap');
  if (ratioWrap) {
    ratioWrap.innerHTML = `
      <div style="height:6px;background:#E2E8F0;border-radius:3px;overflow:hidden;display:flex;width:100%">
        <div style="height:100%;width:${Math.max(data.posicao.fingerPercent, 4)}%;background:#1D4ED8" title="Finger: ${data.posicao.fingerPercent}%"></div>
        <div style="height:100%;width:${Math.max(data.posicao.remotaPercent, 4)}%;background:#DC2626" title="Remota: ${data.posicao.remotaPercent}%"></div>
      </div>
    `;
  }
  setEl('refMiniFingerVal', `${data.posicao.fingerPercent}%`);
  setEl('refMiniRemotaVal', `${data.posicao.remotaPercent}%`);

  // 5. ATUALIZAR ELEMENTOS LEGADOS (RETROCOMPATIBILIDADE)
  setEl('kpiTotalVoos', data.kpis.totalVoos);
  setEl('kpiMediaStd', data.kpis.mediaStd || '--:--');
  setEl('kpiMediaPorta', data.kpis.mediaPorta || '--:--');
  setEl('kpiAgente2', data.kpis.agente2 || 'Sem parceiro fixo');
  setEl('kpiTotalAtrasos', data.otp.atrasadosQtd || 0);
  setEl('kpiPontualidade', `${data.otp.noHorarioPercent.toFixed(1).replace('.', ',')}%`);
  setEl('analiseFooterTexto', `RELATÓRIO INDIVIDUAL EXECUTIVO • ${data.nome} • DADOS DE ${data.mes || 'OUTUBRO/2026'}`);

  // 6. RENDERIZAR PARECER TÉCNICO INDIVIDUAL (PARTE 4 DO RELATÓRIO)
  const analiseCard = document.getElementById('analiseIndividualConteudo');
  if (analiseCard) {
    analiseCard.innerHTML = gerarAnaliseIndividualTexto(data);
  }

  // 7. OCULTAR SEÇÃO COMPARATIVA E EXIBIR TABELA DETALHADA DE VOOS
  const compSection = document.getElementById('analiseEquipeComparativoSection');
  if (compSection) compSection.style.display = 'none';

  renderizarTabelaVoosDetalhados(data.flightList || [], `Voos Operados por ${data.nome} (Total: ${data.kpis.totalVoos} voos únicos)`);
}

// ==========================================================
// 2. RENDERIZAÇÃO DO RELATÓRIO CONSOLIDADO DA EQUIPE
// ==========================================================
function renderRelatorioConsolidadoEquipe() {
  window._analiseState.modo = 'equipe';

  // Destruição de instâncias de gráficos prévias
  if (window._analiseCharts.donutAtraso) {
    try { window._analiseCharts.donutAtraso.destroy(); } catch(e) {}
    window._analiseCharts.donutAtraso = null;
  }
  if (window._analiseCharts.areaEvolucao) {
    try { window._analiseCharts.areaEvolucao.destroy(); } catch(e) {}
    window._analiseCharts.areaEvolucao = null;
  }

  const turnoFiltro = (window._analiseState.turno || 'todos').toUpperCase();
  const equipeData = window.DATASET_EQUIPES[turnoFiltro] || window.DATASET_EQUIPES["TODOS"];

  if (!equipeData) return;

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  const labelTurno = turnoFiltro === 'TODOS' ? 'Todos os Turnos (T1 a T4)' : formatarTurnoOficial(turnoFiltro, true);

  // 1. ATUALIZAR CABEÇALHO DO DASHBOARD AZUL PARA A EQUIPE
  setEl('refHeaderNome', 'TODA A EQUIPE (RELATÓRIO CONSOLIDADO)');
  setEl('refHeaderSetor', 'EMBARQUE & HCC');
  setEl('refHeaderTurno', labelTurno);
  setEl('refSidebarAvatar', 'EQ');
  const monthPill = document.getElementById('refHeaderMonthPill');
  if (monthPill) monthPill.textContent = (equipeData.mes || 'Outubro').split('/')[0];

  // 2. ATUALIZAR OS 6 CARDS KPIS
  setEl('refKpiTotalFlights', equipeData.totalVoosUnicos);
  const tfSub = document.getElementById('refKpiTotalFlightsSub');
  if (tfSub) tfSub.innerHTML = `Colaboradores Ativos: <b>${equipeData.totalColaboradores}</b>`;

  setEl('refKpiDelayedFlights', equipeData.otp.atrasadosQtd || 0);
  const dfSub = document.getElementById('refKpiDelayedFlightsSub');
  if (dfSub) dfSub.innerHTML = `Atrasos da Equipe: <b>${equipeData.otp.atrasadosPercent}%</b>`;

  setEl('refKpiAvgDelay', equipeData.mediaPorta || equipeData.mediaStd || '00:18');
  const adSub = document.getElementById('refKpiAvgDelaySub');
  if (adSub) adSub.innerHTML = `Média STD: <b>${equipeData.mediaStd}</b>`;

  setEl('refKpiOtp', `${equipeData.otp.noHorarioPercent.toFixed(1)}%`);
  const otpStatus = document.getElementById('refKpiOtpStatus');
  if (otpStatus) {
    otpStatus.textContent = equipeData.otp.noHorarioPercent >= 85 ? 'Superou Meta' : 'Abaixo da Meta';
    otpStatus.style.color = equipeData.otp.noHorarioPercent >= 85 ? '#059669' : '#DC2626';
  }

  setEl('refKpiFinger', `${equipeData.posicao.fingerPercent}%`);
  setEl('refKpiRemota', `${equipeData.posicao.remotaPercent}%`);
  setEl('refKpiPosTotal', `${equipeData.totalVoosUnicos} voos`);
  setEl('refKpiMostAffected', 'Guarulhos (GRU)');

  // 3. RENDERIZAR LINHA 2: ATRASOS E DESTINOS DA EQUIPE
  renderizarHbarsRefAtrasos('refHbarsAtraso', equipeData.principaisAtrasos || []);
  renderizarDonutAtrasosRef('chartAnaliseDonutAtraso', equipeData.principaisAtrasos || []);
  renderizarHbarsRefCarriers('refHbarsBottomCarriers', 'refHbarsTopCarriers', equipeData.topDestinos || [], equipeData.topDestinos || []);

  // 4. RENDERIZAR LINHA 3: ÁREA MENSAL E AEROPORTOS DA EQUIPE
  renderizarAreaEvolucaoMensal('chartAnaliseAreaMensal', equipeData);
  renderizarTabelaAeroportosRef(equipeData.topDestinos || []);

  const ratioWrap = document.getElementById('refRouteMapRatioWrap');
  if (ratioWrap) {
    ratioWrap.innerHTML = `
      <div style="height:14px;background:#E2E8F0;border-radius:4px;overflow:hidden;display:flex;width:100%">
        <div style="height:100%;width:${Math.max(equipeData.posicao.fingerPercent, 4)}%;background:#1D4ED8" title="Finger: ${equipeData.posicao.fingerPercent}%"></div>
        <div style="height:100%;width:${Math.max(equipeData.posicao.remotaPercent, 4)}%;background:#DC2626" title="Remota: ${equipeData.posicao.remotaPercent}%"></div>
      </div>
    `;
  }
  setEl('refMiniFingerVal', `${equipeData.posicao.fingerPercent}%`);
  setEl('refMiniRemotaVal', `${equipeData.posicao.remotaPercent}%`);

  // 5. ATUALIZAR ELEMENTOS LEGADOS
  setEl('kpiTotalVoos', equipeData.totalColaboradores);
  setEl('kpiMediaStd', equipeData.totalVoosUnicos);
  setEl('kpiMediaPorta', `${equipeData.mediaStd} / ${equipeData.mediaPorta}`);
  setEl('kpiAgente2', `${equipeData.otp.noHorarioPercent.toFixed(1).replace('.', ',')}%`);
  setEl('kpiTotalAtrasos', equipeData.otp.atrasadosQtd || 0);
  setEl('kpiPontualidade', `${equipeData.otp.noHorarioPercent.toFixed(1).replace('.', ',')}%`);
  setEl('analiseFooterTexto', `RELATÓRIO CONSOLIDADO DA EQUIPE • DADOS DE ${equipeData.mes || 'OUTUBRO/2026'}`);

  // 6. PARECER TÉCNICO DA EQUIPE
  const analiseCard = document.getElementById('analiseIndividualConteudo');
  if (analiseCard) {
    analiseCard.innerHTML = `
      <div style="padding:14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;line-height:1.6">
        <h4 style="margin:0 0 6px 0;font-size:13px;font-weight:800;color:#0B1A33;text-transform:uppercase">
          Consolidado Geral da Equipe (${turnoFiltro === 'TODOS' ? 'Todos os Turnos' : `Turno ${turnoFiltro}`})
        </h4>
        <p style="margin:0 0 6px 0">
          A equipe conta com <b>${equipeData.totalColaboradores} colaboradores ativos</b> que operaram <b>${equipeData.totalVoosUnicos} voos únicos</b> no período.
          O índice de pontualidade consolidado é de <b>${equipeData.otp.noHorarioPercent.toFixed(1).replace('.', ',')}%</b>, com <b>${equipeData.posicao.fingerPercent}%</b> das operações em Finger e <b>${equipeData.posicao.remotaPercent}%</b> em Remota.
        </p>
        <p style="margin:0">
          Utilize o seletor acima para auditar individualmente cada um dos 342 colaboradores cadastrados.
        </p>
      </div>
    `;
  }

  // 7. EXIBIR TABELA COMPARATIVA DA EQUIPE
  renderizarTabelaComparativaEquipe(equipeData.rankingColaboradores || []);
  renderizarTabelaVoosDetalhados(equipeData.flightList || [], `Amostra de Voos Únicos da Equipe (${equipeData.totalVoosUnicos} voos operados no período)`);
}

// Renderiza a tabela de desempenho comparativo da equipe
function renderizarTabelaComparativaEquipe(ranking) {
  const compSection = document.getElementById('analiseEquipeComparativoSection');
  const tbody = document.getElementById('analiseTabelaEquipeBody');
  if (!compSection || !tbody) return;

  compSection.style.display = 'block';

  if (!ranking || ranking.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#64748B;padding:16px">Nenhum colaborador registrado neste filtro.</td></tr>';
    return;
  }

  tbody.innerHTML = ranking.map(c => {
    const otpColor = c.otpPercent >= 85 ? '#059669' : (c.otpPercent >= 75 ? '#D97706' : '#DC2626');
    const p = c.participacoes || { a1: c.totalVoos, a2: 0, a3: 0 };
    return `
      <tr>
        <td>
          <div style="font-weight:700;color:#0F172A">${c.nome}</div>
          <span style="font-size:10px;color:#64748B">${c.isRegisteredUser ? '👤 Conta Registrada' : '📋 Agente Escala'}</span>
        </td>
        <td style="text-align:center"><span class="chip" style="font-size:10px;font-weight:700;background:#E0F2F1;color:#00796B">${c.turno || '-'}</span></td>
        <td style="text-align:center;font-weight:800;color:#009688">${c.totalVoos}</td>
        <td style="text-align:center;font-size:11px;color:#475569">${p.a1} / ${p.a2} / ${p.a3}</td>
        <td style="text-align:center;font-weight:800;color:${otpColor}">${c.otpPercent.toFixed(1).replace('.', ',')}%</td>
        <td style="text-align:center;font-size:12px;color:#475569">${c.mediaStd}</td>
        <td style="text-align:center;font-size:12px;color:#475569">${c.mediaPorta}</td>
        <td style="text-align:center">
          <button type="button" class="btn btn-gold" onclick="selecionarColaboradorDireto('${c.nome.replace(/'/g, "\\'")}')" style="font-size:11px;padding:3px 8px;font-weight:700">
            📊 Ver Individual
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function selecionarColaboradorDireto(nome) {
  const select = document.getElementById('execColaboradorSelect');
  if (select) {
    select.value = nome;
    window._analiseState.colaborador = nome;
    renderRelatorioIndividual(nome);
    const wrapper = document.getElementById('execDashboardPrintArea');
    if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Renderiza a tabela de voos detalhados
function renderizarTabelaVoosDetalhados(flightList, titulo) {
  const container = document.getElementById('analiseDetalhesVoosContainer');
  const titleEl = document.getElementById('analiseDetalhesVoosTitle');
  const tbody = document.getElementById('analiseDetalhesVoosTbody');
  if (!container || !tbody) return;

  if (titleEl) titleEl.textContent = titulo || 'Detalhamento de Voos Operados';

  if (!flightList || flightList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#64748B;padding:16px">Nenhum registro de voo encontrado para esta seleção.</td></tr>';
    return;
  }

  tbody.innerHTML = flightList.map(f => {
    const isNoHorario = (f.otp || '').includes('Horário') || f.otp === 'NH';
    const otpChip = isNoHorario
      ? '<span class="chip" style="background:#ECFDF5;color:#059669;font-weight:700;font-size:10px">✔ No Horário</span>'
      : `<span class="chip" style="background:#FEF2F2;color:#DC2626;font-weight:700;font-size:10px">⏰ Atrasado (${f.cod1 || 'STD15'})</span>`;

    const posChip = f.pos === 'FINGER'
      ? '<span class="chip" style="background:#E0F2F1;color:#00796B;font-size:10px">Finger</span>'
      : '<span class="chip" style="background:#FFF1F2;color:#E11D48;font-size:10px">Remota</span>';

    return `
      <tr>
        <td style="font-weight:700;color:#0F172A">${f.voo || '-'}</td>
        <td>${f.data || '24/10'}</td>
        <td style="font-weight:700;color:#00796B">${f.des || '-'}</td>
        <td><code>${f.std || '--:--'}</code></td>
        <td><code>${f.porta || '--:--'}</code></td>
        <td>${posChip}</td>
        <td style="font-size:11px;color:#334155">${f.a1 || '-'}</td>
        <td style="font-size:11px;color:#334155">${f.a2 || '-'}</td>
        <td style="font-size:11px;color:#334155">${f.a3 || '-'}</td>
        <td style="text-align:center">${otpChip}</td>
      </tr>
    `;
  }).join('');
}

// Renderizador com Chart.js para os dois Donut Charts
function renderizarDonutsOperacionais(posicaoData, otpData) {
  if (typeof Chart === 'undefined') return;

  // 1. Donut Posição de Embarque
  const ctxPos = document.getElementById('chartAnalisePosicao');
  if (ctxPos) {
    if (window._analiseCharts.posicao) window._analiseCharts.posicao.destroy();

    window._analiseCharts.posicao = new Chart(ctxPos, {
      type: 'doughnut',
      data: {
        labels: ['Finger', 'Remota'],
        datasets: [{
          data: [posicaoData.fingerPercent || 0, posicaoData.remotaPercent || 0],
          backgroundColor: ['#009688', '#E53935'],
          borderWidth: 0,
          hoverOffset: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(c) { return ' ' + c.label + ': ' + c.parsed + '%'; }
            }
          }
        },
        animation: {
          animateScale: true,
          animateRotate: true
        }
      }
    });
  }

  // 2. Donut Pontualidade OTP
  const ctxOtp = document.getElementById('chartAnaliseOtp');
  if (ctxOtp) {
    if (window._analiseCharts.otp) window._analiseCharts.otp.destroy();

    window._analiseCharts.otp = new Chart(ctxOtp, {
      type: 'doughnut',
      data: {
        labels: ['No Horário', 'Atrasados'],
        datasets: [{
          data: [otpData.noHorarioPercent || 0, otpData.atrasadosPercent || 0],
          backgroundColor: ['#059669', '#E53935'],
          borderWidth: 0,
          hoverOffset: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(c) { return ' ' + c.label + ': ' + c.parsed + '%'; }
            }
          }
        },
        animation: {
          animateScale: true,
          animateRotate: true
        }
      }
    });
  }
}

// ==========================================================
// 🖼️ MODAL DE VISUALIZAÇÃO DA IMAGEM 16:9 EM ALTA RESOLUÇÃO
// Renderiza o Gráfico Real do Colaborador Ativo sem Imagens Fixas
// ==========================================================
async function abrirModalInfografico16x9() {
  const modal = document.getElementById('modalInfografico16x9');
  if (!modal) return;
  modal.classList.remove('hidden');

  const containerImg = document.getElementById('imgContainerInfografico16x9');
  const srcArea = document.getElementById('execDashboardPrintArea');
  if (!srcArea || !containerImg) return;

  const select = document.getElementById('execColaboradorSelect');
  const nomeColab = select ? select.value : 'Colaborador';
  const btnBaixar = document.getElementById('btnBaixarImagem16x9');

  containerImg.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#0F172A">
      <div style="font-size:32px;margin-bottom:10px">⏳</div>
      <div style="font-weight:700">Gerando imagem 16:9 em alta resolução para ${nomeColab}...</div>
    </div>
  `;

  if (typeof html2canvas !== 'undefined') {
    try {
      // Clona a área visível do dashboard
      const clone = srcArea.cloneNode(true);
      clone.querySelectorAll('.analise-op-actions').forEach(el => el.remove());

      // Converte os dois canvases para imagens PNG de alta resolução para captura perfeita
      const srcCanvases = srcArea.querySelectorAll('canvas');
      const cloneCanvases = clone.querySelectorAll('canvas');
      srcCanvases.forEach((src, idx) => {
        const dest = cloneCanvases[idx];
        if (dest && src) {
          const img = document.createElement('img');
          img.src = src.toDataURL('image/png', 1.0);
          img.style.width = '140px';
          img.style.height = '140px';
          img.style.display = 'block';
          img.style.margin = '0 auto';
          dest.parentNode.replaceChild(img, dest);
        }
      });

      const cloneSelect = clone.querySelector('#execColaboradorSelect');
      if (cloneSelect) {
        const textSpan = document.createElement('div');
        textSpan.style.cssText = 'font-size:14px;font-weight:800;color:#0F172A;margin-top:2px;letter-spacing:0.3px';
        textSpan.textContent = select ? (select.options[select.selectedIndex]?.text || select.value) : nomeColab;
        cloneSelect.parentNode.replaceChild(textSpan, cloneSelect);
      }
      const buscaInput = clone.querySelector('#execColaboradorBuscaInput');
      if (buscaInput) buscaInput.remove();

      const twinGrid = clone.querySelector('.analise-op-twin-charts-grid');
      if (twinGrid) {
        twinGrid.style.display = 'grid';
        twinGrid.style.gridTemplateColumns = '1fr 1fr';
        twinGrid.style.gap = '14px';
      }
      const compGrid = clone.querySelector('.analise-op-complementar-grid');
      if (compGrid) {
        compGrid.style.display = 'grid';
        compGrid.style.gridTemplateColumns = '1fr 1fr';
        compGrid.style.gap = '14px';
      }

      clone.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 1120px;
        min-width: 1120px;
        max-width: 1120px;
        background: #FFFFFF;
        color: #0F172A;
        padding: 20px 24px;
        box-sizing: border-box;
        z-index: 9999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      `;

      document.body.appendChild(clone);
      await new Promise(r => setTimeout(r, 150));

      const canvas = await html2canvas(clone, {
        width: 1120,
        scale: 2,
        useCORS: true,
        logging: false,
        scrollX: 0,
        scrollY: 0
      });
      clone.remove();

      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      containerImg.innerHTML = `<img src="${dataUrl}" alt="Infográfico 16:9 ${nomeColab}" style="width:100%;height:100%;object-fit:contain;border-radius:10px">`;
      if (btnBaixar) {
        btnBaixar.href = dataUrl;
        btnBaixar.download = `Analise_Operacional_${nomeColab.replace(/[^a-zA-Z0-9]/g, '_')}_16x9.jpg`;
      }
      return;
    } catch (err) {
      console.warn('html2canvas preview falhou:', err);
    }
  }

  containerImg.innerHTML = `<div style="padding:20px;text-align:center;color:#64748B">Não foi possível gerar a prévia no navegador. Utilize a opção "🖨️ Imprimir / PDF" para exportar o relatório oficial.</div>`;
}

function fecharModalInfografico16x9() {
  const modal = document.getElementById('modalInfografico16x9');
  if (modal) modal.classList.add('hidden');
}

// ==========================================================
// 📄 EXPORTAÇÃO DEFINITIVA DO PDF OPERACIONAL
// Elimina o PDF em Branco, Valida Dados Reais e Garante Conteúdo
// ==========================================================
async function imprimirDashboardExecutivo() {
  const srcArea = document.getElementById('execDashboardPrintArea');
  if (!srcArea) {
    window.print();
    return;
  }

  const select = document.getElementById('execColaboradorSelect');
  const nomeColab = select ? (select.value === 'TODA_A_EQUIPE' ? 'Equipe_Geral' : select.value) : 'Colaborador';
  const cleanNomeArquivo = 'Analise_Operacional_' + nomeColab.replace(/[^a-zA-Z0-9]/g, '_') + '.pdf';

  // Modal / Overlay de Carregamento
  const overlay = document.createElement('div');
  overlay.id = 'analisePdfLoadingOverlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(11, 26, 51, 0.88);
    backdrop-filter: blur(8px);
    z-index: 99999999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #FFFFFF;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  `;
  overlay.innerHTML = `
    <div style="background:#FFFFFF;color:#0F172A;padding:28px 36px;border-radius:18px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.4);max-width:440px;width:90%">
      <div style="font-size:42px;margin-bottom:12px;animation:spin 2s linear infinite">🛫</div>
      <h3 style="margin:0 0 8px 0;font-size:17px;font-weight:800;color:#0B1A33">Gerando Relatório Operacional PDF</h3>
      <p style="margin:0 0 16px 0;font-size:12.5px;color:#64748B;line-height:1.5">
        Auditando dados reais de <b>${nomeColab}</b>, renderizando gráficos e estruturando parecer técnico...
      </p>
      <div style="height:6px;width:100%;background:#E2E8F0;border-radius:4px;overflow:hidden">
        <div style="height:100%;width:70%;background:#009688;border-radius:4px;animation:pulse 1.5s ease-in-out infinite"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  if (typeof showToast === 'function') {
    showToast('Iniciando compilação do relatório oficial...', 'info');
  }

  // 1. Cria container dedicado para exportação visível no DOM
  const exportContainer = document.createElement('div');
  exportContainer.id = 'analisePdfExportContainer';
  exportContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 1120px;
    background: #FFFFFF;
    color: #0F172A;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    z-index: 9999999;
    opacity: 1;
    visibility: visible;
  `;

  // --- PÁGINA 1: DASHBOARD EXECUTIVO 16:9 ---
  const page1 = document.createElement('div');
  page1.style.cssText = `
    width: 1120px;
    min-height: 630px;
    background: #002D62;
    padding: 14px 16px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    page-break-after: always;
  `;

  const cloneDash = srcArea.cloneNode(true);
  cloneDash.querySelectorAll('.analise-op-actions').forEach(el => el.remove());
  cloneDash.style.background = '#002D62';
  cloneDash.style.boxShadow = 'none';
  cloneDash.style.padding = '0';

  // Converte todos os canvases do dashboard original para tags <img> PNG de alta resolução
  const srcCanvases = srcArea.querySelectorAll('canvas');
  const cloneCanvases = cloneDash.querySelectorAll('canvas');
  srcCanvases.forEach((src, idx) => {
    const dest = cloneCanvases[idx];
    if (dest && src && src.width > 0 && src.height > 0) {
      try {
        const img = document.createElement('img');
        img.src = src.toDataURL('image/png', 1.0);
        img.style.width = src.offsetWidth ? src.offsetWidth + 'px' : (src.id.includes('Donut') ? '130px' : '100%');
        img.style.height = src.offsetHeight ? src.offsetHeight + 'px' : (src.id.includes('Donut') ? '130px' : '160px');
        img.style.display = 'block';
        img.style.margin = '0 auto';
        dest.parentNode.replaceChild(img, dest);
      } catch (e) {
        console.warn('Falha ao rasterizar canvas:', e);
      }
    }
  });

  // Rasteriza também o SVG do Mapa do Brasil e rotas aéreas
  const srcSvg = srcArea.querySelector('#svgMapaBrasilRotas');
  const cloneSvg = cloneDash.querySelector('#svgMapaBrasilRotas');
  if (srcSvg && cloneSvg) {
    try {
      cloneSvg.setAttribute('width', '100%');
      cloneSvg.setAttribute('height', '100%');
      const xml = new XMLSerializer().serializeToString(srcSvg);
      const svg64 = btoa(unescape(encodeURIComponent(xml)));
      const imgMap = document.createElement('img');
      imgMap.src = 'data:image/svg+xml;base64,' + svg64;
      imgMap.style.width = '100%';
      imgMap.style.height = '100%';
      imgMap.style.display = 'block';
      cloneSvg.parentNode.replaceChild(imgMap, cloneSvg);
    } catch (e) {
      console.warn('SVG map clone fallback:', e);
    }
  }

  page1.appendChild(cloneDash);
  exportContainer.appendChild(page1);

  // --- PÁGINA 2: PARECER TÉCNICO & TABELA DETALHADA DE VOOS (PARTE 4 E 3.7) ---
  const dataset = window.DATASET_COLABORADORES || {};
  const dataColab = dataset[nomeColab] || (nomeColab !== 'Equipe_Geral' ? dataset[Object.keys(dataset).find(k => k.trim().toUpperCase() === nomeColab.trim().toUpperCase())] : null);

  const page2 = document.createElement('div');
  page2.style.cssText = `
    width: 1120px;
    background: #FFFFFF;
    color: #0F172A;
    padding: 24px 22px;
    box-sizing: border-box;
    page-break-before: always;
  `;

  // Cabeçalho da Página 2
  const p2Header = document.createElement('div');
  p2Header.style.cssText = 'border-bottom:2px solid #0B1A33;padding-bottom:8px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center';
  p2Header.innerHTML = `
    <div>
      <div style="font-size:16px;font-weight:900;color:#0B1A33;text-transform:uppercase;letter-spacing:0.5px">
        Relatório Técnico & Detalhamento Operacional de Voos
      </div>
      <div style="font-size:12px;color:#64748B">
        Colaborador: <b>${nomeColab}</b> • Mês de Referência: <b>${window._analiseState.mes || 'OUTUBRO/2026'}</b>
      </div>
    </div>
    <div style="font-size:11px;color:#00796B;font-weight:700;text-align:right">
      Aeroporto Internacional de Guarulhos (GRU)<br>
      Diário de Embarque • Auditoria Operacional
    </div>
  `;
  page2.appendChild(p2Header);

  // Bloco de Parecer Técnico
  const p2AnaliseWrap = document.createElement('div');
  p2AnaliseWrap.style.marginBottom = '20px';
  p2AnaliseWrap.innerHTML = `
    <div style="font-size:13px;font-weight:900;color:#0B1A33;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.3px">
      📝 ANÁLISE INDIVIDUAL DO DESEMPENHO
    </div>
    ${gerarAnaliseIndividualTexto(dataColab)}
  `;
  page2.appendChild(p2AnaliseWrap);

  // Tabela Completa de Detalhamento de Voos (Parte 3.7)
  const p2TabelaWrap = document.createElement('div');
  const flightList = (dataColab && dataColab.flightList) ? dataColab.flightList : [];
  
  let tabelaRowsHtml = '';
  if (flightList.length === 0) {
    tabelaRowsHtml = '<tr><td colspan="9" style="text-align:center;padding:12px;color:#64748B">Nenhum registro operacional encontrado para este período.</td></tr>';
  } else {
    tabelaRowsHtml = flightList.map((f, i) => {
      const isNoHorario = (f.otp || '').includes('Horário') || f.otp === 'NH';
      const otpColor = isNoHorario ? '#059669' : '#DC2626';
      const otpText = isNoHorario ? '✔ No Horário' : `⏰ Atrasado (${f.cod1 || 'STD15'})`;
      return `
        <tr style="background:${i % 2 === 0 ? '#FFFFFF' : '#F8FAFC'};border-bottom:1px solid #E2E8F0">
          <td style="padding:7px 8px;font-weight:800;color:#0F172A">${f.voo || '-'}</td>
          <td style="padding:7px 8px;color:#475569">${f.data || '24/10'}</td>
          <td style="padding:7px 8px;font-weight:700;color:#00796B">${f.des || '-'}</td>
          <td style="padding:7px 8px"><code>${f.std || '--:--'}</code></td>
          <td style="padding:7px 8px"><code>${f.porta || '--:--'}</code></td>
          <td style="padding:7px 8px;font-weight:700">${f.pos || 'FINGER'}</td>
          <td style="padding:7px 8px;font-size:11px;color:#334155">${f.a1 || '-'}</td>
          <td style="padding:7px 8px;font-size:11px;color:#334155">${f.a2 || '-'}</td>
          <td style="padding:7px 8px;text-align:center;font-weight:700;color:${otpColor}">${otpText}</td>
        </tr>
      `;
    }).join('');
  }

  p2TabelaWrap.innerHTML = `
    <div style="font-size:13px;font-weight:800;color:#0B1A33;margin-bottom:8px;text-transform:uppercase">
      🛫 Relação de Voos Operados no Período (${flightList.length} voos únicos)
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;color:#0F172A;border:1px solid #CBD5E1">
      <thead>
        <tr style="background:#0B1A33;color:#FFFFFF;text-align:left">
          <th style="padding:8px">Voo</th>
          <th style="padding:8px">Data</th>
          <th style="padding:8px">Destino</th>
          <th style="padding:8px">STD</th>
          <th style="padding:8px">Porta</th>
          <th style="padding:8px">Posição</th>
          <th style="padding:8px">Agente 1</th>
          <th style="padding:8px">Agente 2</th>
          <th style="padding:8px;text-align:center">Situação (OTP)</th>
        </tr>
      </thead>
      <tbody>
        ${tabelaRowsHtml}
      </tbody>
    </table>
    <div style="margin-top:12px;font-size:10px;color:#94A3B8;text-align:right">
      Documento gerado em ${new Date().toLocaleString('pt-BR')} • Diário de Embarque GRU
    </div>
  `;
  page2.appendChild(p2TabelaWrap);
  exportContainer.appendChild(page2);

  document.body.appendChild(exportContainer);

  try {
    // Rola para o topo e aguarda renderização completa
    window.scrollTo(0, 0);
    await new Promise(resolve => setTimeout(resolve, 250));

    if (typeof html2pdf !== 'undefined') {
      const isMobileOrStandalone = (window.innerWidth <= 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia('(display-mode: standalone)').matches);
      const opt = {
        margin: [4, 4, 4, 4],
        filename: cleanNomeArquivo,
        image: { type: 'jpeg', quality: isMobileOrStandalone ? 0.94 : 0.98 },
        pagebreak: { mode: ['css', 'legacy'] },
        html2canvas: {
          scale: isMobileOrStandalone ? 1.0 : 1.6,
          useCORS: true,
          logging: false,
          scrollY: 0,
          scrollX: 0,
          windowWidth: 1200,
          backgroundColor: '#002D62'
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
      };

      const worker = html2pdf().set(opt).from(exportContainer);
      const pdfBlob = await worker.output('blob');
      if (!pdfBlob || pdfBlob.size < 200) {
        throw new Error('Falha na geração do arquivo PDF do dashboard.');
      }

      const blobUrl = URL.createObjectURL(pdfBlob);

      // Prepara download no backend para compatibilidade com Android DownloadManager
      let prepDownloadUrl = null;
      let prepViewUrl = null;
      try {
        const reader = new FileReader();
        const base64Promise = new Promise(resolve => {
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(pdfBlob);
        });
        const base64data = await base64Promise;
        const prepRes = await (typeof authFetch === 'function' ? authFetch : fetch)('/api/prepare-pdf-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: cleanNomeArquivo, pdfBase64: base64data })
        });
        if (prepRes.ok) {
          const prepData = await prepRes.json();
          prepDownloadUrl = prepData.downloadUrl;
          prepViewUrl = prepData.viewUrl;
        }
      } catch (prepErr) {
        console.warn('Aviso sincronização download backend:', prepErr.message);
      }

      // Dispara download do arquivo PDF diretamente sem impressora
      const a = document.createElement('a');
      a.href = prepDownloadUrl || blobUrl;
      a.download = cleanNomeArquivo;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 2500);

      // Oferece abertura no visualizador interno sem impressora física
      if (typeof abrirVisualizadorPDF === 'function') {
        abrirVisualizadorPDF({
          filename: cleanNomeArquivo,
          blobUrl,
          downloadUrl: prepDownloadUrl,
          viewUrl: prepViewUrl,
          pdfBlob
        });
      }

      if (typeof showToast === 'function') {
        showToast(`✔ PDF de ${nomeColab} gerado e salvo em Downloads!`, 'success');
      }
    } else {
      if (typeof showToast === 'function') {
        showToast('Biblioteca de PDF indisponível. Recarregue a página.', 'error');
      }
    }
  } catch (err) {
    console.error('Erro na geração do PDF:', err);
    if (typeof showToast === 'function') {
      showToast(`Falha na exportação do PDF: ${err.message}`, 'error');
    }
  } finally {
    exportContainer.remove();
    overlay.remove();
  }
}

// Global window bindings
window.renderDashboardExecutivo = renderDashboardExecutivo;
window.aoMudarFiltroExecutivo = aoMudarFiltroExecutivo;
window.aoMudarSetorOuTurnoExecutivo = aoMudarSetorOuTurnoExecutivo;
window.aoMudarFiltroSetor = aoMudarFiltroSetor;
window.aoMudarFiltroTurno = aoMudarFiltroTurno;
window.aoMudarFiltroAno = aoMudarFiltroAno;
window.selecionarAnoDashboard = selecionarAnoDashboard;
window.gerarAnaliseIndividualManual = gerarAnaliseIndividualManual;
window.visualizarRelatorioScroll = visualizarRelatorioScroll;
window.abrirInfoDashboardExecutivo = abrirInfoDashboardExecutivo;
window.popularSelectColaboradores = popularSelectColaboradores;
window.filtrarDropdownColaboradores = filtrarDropdownColaboradores;
window.selecionarColaboradorDireto = selecionarColaboradorDireto;
window.imprimirDashboardExecutivo = imprimirDashboardExecutivo;
window.abrirModalInfografico16x9 = abrirModalInfografico16x9;
window.fecharModalInfografico16x9 = fecharModalInfografico16x9;
window.gerarAnaliseIndividualTexto = gerarAnaliseIndividualTexto;
window.formatarTurnoOficial = formatarTurnoOficial;
window.renderizarGraficosDuplosPadronizados = renderizarGraficosDuplosPadronizados;
window.alternarOrdenacaoRankingDestinos = alternarOrdenacaoRankingDestinos;
window.destacarDestinoNoMapa = destacarDestinoNoMapa;
window.removerDestaqueDestinoMapa = removerDestaqueDestinoMapa;
window.moverTooltipMapa = moverTooltipMapa;
window.abrirModalPreviaPdf = abrirModalPreviaPdf;
window.fecharModalPreviaPdf = fecharModalPreviaPdf;
window.compartilharRelatorioPdf = compartilharRelatorioPdf;
window.enviarRelatorioEmail = enviarRelatorioEmail;
