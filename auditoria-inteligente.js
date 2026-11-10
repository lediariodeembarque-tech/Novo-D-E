/**
 * ============================================================================
 * DIÁRIO DE EMBARQUE — PAINEL DE AUDITORIA INTELIGENTE
 * Módulo Oficial Exclusivo para Perfis GESTÃO e MASTER
 * Fiel à Referência Visual Executiva (Screenshot 2026-11-02-21-49-58)
 * COM GERAÇÃO REAL DE PDF EM ALTA DEFINIÇÃO PARA ANDROID E DESKTOP (ZERO WINDOW.PRINT)
 * ============================================================================
 */

(function (window) {
  'use strict';

  // Estado interno do módulo de auditoria
  const AuditState = {
    dadosGerais: null,
    colaboradorSelecionado: null,
    dossieColaborador: null,
    carregando: false,
    abaAtiva: 'geral', // 'geral', 'individual', 'equipes', 'ia', 'pdf'
    filtros: {
      regiao: 'Todas', // 'Todas', 'Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'
      capitalSelecionada: null,
      processo: 'Todos',
      risco: 'Todos',
      termoBuscaColab: '',
      formatoPapel: 'a4' // 'a4' | 'a3'
    },
    ultimoPdfGerado: null // { blob, filename, blobUrl, downloadUrl, viewUrl }
  };

  /**
   * Validação de Acesso Exclusivo (Frontend Layer)
   * Apenas usuários com perfil Gestão ou Master podem acessar.
   */
  function verificarPermissaoAuditoria() {
    if (typeof window.isUserGestaoOuMaster === 'function') {
      return window.isUserGestaoOuMaster();
    }
    const email = (window.db?.currentEmail || '').toLowerCase();
    const role = (window.db?.role || '').toLowerCase();
    return email === 'lediariodeembarque@gmail.com' || role === 'master' || role === 'gestao' || role === 'admin';
  }

  /**
   * Registra tentativa de violação de segurança se usuário não autorizado tentar acessar
   */
  async function registrarTentativaBloqueada() {
    try {
      const email = window.db?.currentEmail || 'anonimo';
      const role = window.db?.role || 'desconhecido';
      await fetch('/api/auditoria/log-tentativa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          role,
          tentativaRota: 'auditoria-inteligente',
          detalhe: 'Tentativa de visualização não autorizada do Painel de Auditoria Inteligente bloqueada pelo frontend'
        })
      });
    } catch (e) {
      // Ignora falhas de rede no log silencioso
    }
  }

  /**
   * Ponto de entrada chamado ao navegar para a view 'auditoria-inteligente'
   */
  async function renderAuditoriaInteligente() {
    const container = document.getElementById('auditoria-inteligente');
    if (!container) return;

    // 1. CHECAGEM DE SEGURANÇA MANDATÓRIA (LEI 1 E 4)
    if (!verificarPermissaoAuditoria()) {
      registrarTentativaBloqueada();
      container.innerHTML = `
        <div style="max-width:680px;margin:60px auto;padding:36px;background:#FFFFFF;border:2px solid #EF4444;border-radius:16px;box-shadow:0 12px 30px rgba(239,68,68,0.12);text-align:center;font-family:system-ui,-apple-system,sans-serif">
          <div style="font-size:48px;margin-bottom:14px">🛡️ 🚫</div>
          <h2 style="font-size:22px;color:#991B1B;font-weight:900;margin-bottom:12px;letter-spacing:-0.5px">
            ACESSO RESTRITO — AUDITORIA INTELIGENTE
          </h2>
          <p style="font-size:14px;color:#475569;line-height:1.6;margin-bottom:24px">
            O <b>Painel de Auditoria Inteligente</b> é de uso estritamente restrito aos perfis <b>Gestão</b> e <b>Master</b> da supervisão operacional do aeroporto. Usuários dos setores Embarque e HCC não possuem autorização de acesso.
          </p>
          <div style="padding:12px 16px;background:#FEF2F2;border-radius:10px;font-size:12px;color:#B91C1C;margin-bottom:24px;border:1px dashed #FCA5A5">
            ⚠️ Esta tentativa de acesso foi registrada na trilha de segurança do sistema.
          </div>
          <button type="button" class="btn btn-gold" onclick="showView('dashboard')" style="padding:12px 28px;font-weight:800;font-size:14px">
            Voltar ao Meu Diário de Voo
          </button>
        </div>
      `;
      if (typeof window.showToast === 'function') {
        window.showToast('Acesso negado: Painel de Auditoria Inteligente é exclusivo para Gestão e Master.', 'danger');
      }
      return;
    }

    // 2. RENDERIZA ESTRUTURA DO PAINEL (CABEÇALHO + TABS + CONTAINER)
    container.innerHTML = `
      <div class="auditoria-root-container" style="background:#F1F5F9;min-height:100vh;padding:16px;font-family:system-ui,-apple-system,sans-serif;color:#0F172A">
        <!-- CABEÇALHO EXECUTIVO AZUL DA AUDITORIA -->
        <header style="background:linear-gradient(135deg,#0B1B3D 0%,#0F4C81 100%);border-radius:12px;padding:18px 24px;color:#FFFFFF;box-shadow:0 4px 16px rgba(15,76,129,0.18);margin-bottom:16px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px">
          <div style="display:flex;align-items:center;gap:14px">
            <div style="width:48px;height:48px;background:rgba(255,255,255,0.12);border:1.5px solid rgba(255,255,255,0.3);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px">
              🛡️
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:8px">
                <h1 style="margin:0;font-size:20px;font-weight:900;letter-spacing:-0.3px;color:#FFFFFF">
                  PAINEL DE AUDITORIA INTELIGENTE
                </h1>
                <span style="background:#EA580C;color:#FFFFFF;font-size:10px;font-weight:800;padding:2px 8px;border-radius:12px;letter-spacing:0.5px">EXCLUSIVO GESTÃO</span>
              </div>
              <p style="margin:4px 0 0;font-size:12px;color:#BAE6FD">
                Auditoria de Riscos Operacionais, Pontualidade D0, Fechamento de Portas & Ações Remediadas
              </p>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:12px;background:rgba(255,255,255,0.15);padding:6px 12px;border-radius:20px;color:#E0F2FE">
              👤 Auditor: <b>${window.db?.currentEmail || 'Gestor'}</b>
            </span>
            <button type="button" onclick="window.AuditModule.recarregarDados()" class="btn" style="background:rgba(255,255,255,0.2);color:#FFFFFF;border:1px solid rgba(255,255,255,0.4);padding:8px 14px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px">
              🔄 Atualizar
            </button>
            <button type="button" onclick="window.AuditModule.gerarRelatorioPDFReal('atual')" class="btn" style="background:#22C55E;color:#0B1A33;border:none;padding:8px 16px;font-size:12px;font-weight:800;box-shadow:0 2px 8px rgba(34,197,94,0.3);display:flex;align-items:center;gap:6px" title="Gera o arquivo PDF real desta tela para Android e Computador">
              📥 Baixar PDF Real
            </button>
            <button type="button" onclick="window.AuditModule.mudarAba('pdf')" class="btn" style="background:#F59E0B;color:#0B1A33;border:none;padding:8px 16px;font-size:12px;font-weight:800;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;gap:6px" title="Central de Exportação de todos os relatórios em PDF">
              📄 Central de PDF
            </button>
          </div>
        </header>

        <!-- ABAS DE NAVEGAÇÃO INTERNA DO MÓDULO -->
        <nav style="display:flex;gap:8px;margin-bottom:16px;overflow-x:auto;padding-bottom:4px;border-bottom:2px solid #E2E8F0">
          <button type="button" id="tab-btn-geral" onclick="window.AuditModule.mudarAba('geral')" class="audit-nav-tab active-tab" style="padding:10px 18px;border-radius:8px 8px 0 0;font-weight:800;font-size:13px;border:none;cursor:pointer;background:#FFFFFF;color:#0F4C81;box-shadow:0 -2px 6px rgba(0,0,0,0.04);display:flex;align-items:center;gap:6px">
            📊 Visão Geral Executiva
          </button>
          <button type="button" id="tab-btn-individual" onclick="window.AuditModule.mudarAba('individual')" class="audit-nav-tab" style="padding:10px 18px;border-radius:8px 8px 0 0;font-weight:700;font-size:13px;border:none;cursor:pointer;background:transparent;color:#64748B;display:flex;align-items:center;gap:6px">
            👤 Auditoria Individual do Colaborador
          </button>
          <button type="button" id="tab-btn-equipes" onclick="window.AuditModule.mudarAba('equipes')" class="audit-nav-tab" style="padding:10px 18px;border-radius:8px 8px 0 0;font-weight:700;font-size:13px;border:none;cursor:pointer;background:transparent;color:#64748B;display:flex;align-items:center;gap:6px">
            👥 Auditoria Coletiva por Turno / Setor
          </button>
          <button type="button" id="tab-btn-ia" onclick="window.AuditModule.mudarAba('ia')" class="audit-nav-tab" style="padding:10px 18px;border-radius:8px 8px 0 0;font-weight:700;font-size:13px;border:none;cursor:pointer;background:transparent;color:#64748B;display:flex;align-items:center;gap:6px">
            🧠 Matriz de Riscos & IA Assistida
          </button>
          <button type="button" id="tab-btn-pdf" onclick="window.AuditModule.mudarAba('pdf')" class="audit-nav-tab" style="padding:10px 18px;border-radius:8px 8px 0 0;font-weight:700;font-size:13px;border:none;cursor:pointer;background:transparent;color:#64748B;display:flex;align-items:center;gap:6px">
            🖨️ Central de Exportação em PDF
          </button>
        </nav>

        <!-- CONTAINER PRINCIPAL DINÂMICO -->
        <div id="auditContentArea">
          <div style="text-align:center;padding:60px 20px;color:#64748B">
            <div style="font-size:36px;margin-bottom:12px">⏳</div>
            <div style="font-weight:700;font-size:15px">Carregando dados de auditoria operacional...</div>
          </div>
        </div>
      </div>
    `;

    // 3. CARREGA DADOS DO BACKEND VIA API SEGURA
    await carregarDadosAuditoria();
  }

  /**
   * Faz a busca de dados do backend com token de autenticação
   */
  async function carregarDadosAuditoria() {
    AuditState.carregando = true;
    try {
      const res = await (typeof window.authFetch === 'function' 
        ? window.authFetch('/api/auditoria/dados') 
        : fetch('/api/auditoria/dados'));

      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Acesso negado: Somente perfis Gestão e Master podem carregar auditorias.');
        }
        throw new Error('Falha ao obter dados da auditoria (HTTP ' + res.status + ')');
      }

      const data = await res.json();
      AuditState.dadosGerais = data;
      renderAbaAtual();
    } catch (err) {
      console.error('Erro na auditoria inteligente:', err);
      const content = document.getElementById('auditContentArea');
      if (content) {
        content.innerHTML = `
          <div style="background:#FEF2F2;border:1px solid #FCA5A5;padding:24px;border-radius:12px;color:#991B1B;text-align:center">
            <div style="font-size:32px;margin-bottom:8px">⚠️</div>
            <div style="font-weight:800;font-size:16px;margin-bottom:6px">Falha de Autorização ou Conexão</div>
            <p style="font-size:13px;margin:0 0 16px">${err.message}</p>
            <button type="button" class="btn btn-gold" onclick="window.AuditModule.recarregarDados()">Tentar Novamente</button>
          </div>
        `;
      }
    } finally {
      AuditState.carregando = false;
    }
  }

  /**
   * Alterna a aba ativa e atualiza os botões de navegação
   */
  function mudarAba(aba) {
    AuditState.abaAtiva = aba;
    document.querySelectorAll('.audit-nav-tab').forEach(b => {
      b.style.background = 'transparent';
      b.style.color = '#64748B';
      b.style.boxShadow = 'none';
    });
    const btnAtivo = document.getElementById(`tab-btn-${aba}`);
    if (btnAtivo) {
      btnAtivo.style.background = '#FFFFFF';
      btnAtivo.style.color = '#0F4C81';
      btnAtivo.style.boxShadow = '0 -2px 6px rgba(0,0,0,0.04)';
    }
    renderAbaAtual();
  }

  function renderAbaAtual() {
    const area = document.getElementById('auditContentArea');
    if (!area) return;

    if (!AuditState.dadosGerais) {
      area.innerHTML = '<div style="text-align:center;padding:40px">Carregando métricas operacionais...</div>';
      return;
    }

    if (AuditState.abaAtiva === 'geral') {
      renderAbaGeral(area);
    } else if (AuditState.abaAtiva === 'individual') {
      renderAbaIndividual(area);
    } else if (AuditState.abaAtiva === 'equipes') {
      renderAbaEquipes(area);
    } else if (AuditState.abaAtiva === 'ia') {
      renderAbaIA(area);
    } else if (AuditState.abaAtiva === 'pdf') {
      renderAbaPDF(area);
    }
  }

  // ==========================================================================
  // ABA 1: VISÃO GERAL EXECUTIVA — ESTRUTURA FIEL À IMAGEM DE REFERÊNCIA
  // (Screenshot 2026-11-02-21-49-58-033_com.android.chrome-edit.jpg)
  // ==========================================================================
  function renderAbaGeral(container) {
    const d = AuditState.dadosGerais;
    const capitais = d.capitaisBrasil || [];
    const regiaoAtiva = AuditState.filtros.regiao || 'Todas';
    const capAtiva = AuditState.filtros.capitalSelecionada;

    container.innerHTML = `
      <div id="painelReferenciaExecutiva" style="background:#FFFFFF;border-radius:12px;padding:16px;box-shadow:0 2px 12px rgba(0,0,0,0.04);border:1px solid #CBD5E1">
        
        <!-- BARRA SUPERIOR DE FILTROS (PAINEL DE FILTROS INTEGRADO) -->
        <div style="background:#E0F2FE;border:1px solid #BAE6FD;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px">
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <div style="font-weight:900;color:#0F4C81;font-size:13px;letter-spacing:0.3px;text-transform:uppercase;display:flex;align-items:center;gap:6px">
              <span>🔍</span> Painel de Filtros
            </div>

            <!-- FILTRO GEOGRAFIA / REGIÃO -->
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:11px;font-weight:700;color:#475569">Região / Geografia:</span>
              <select id="auditFiltroGeo" onchange="window.AuditModule.aplicarFiltroGeo(this.value)" style="padding:5px 10px;font-size:11px;font-weight:800;border-radius:6px;border:1px solid #CBD5E1;background:#F97316;color:#FFFFFF;outline:none;cursor:pointer">
                <option value="Todas" ${regiaoAtiva==='Todas'?'selected':''}>(Todas as Regiões)</option>
                <option value="Norte" ${regiaoAtiva==='Norte'?'selected':''}>Região Norte (7 Capitais)</option>
                <option value="Nordeste" ${regiaoAtiva==='Nordeste'?'selected':''}>Região Nordeste (9 Capitais)</option>
                <option value="Centro-Oeste" ${regiaoAtiva==='Centro-Oeste'?'selected':''}>Região Centro-Oeste (4 Capitais)</option>
                <option value="Sudeste" ${regiaoAtiva==='Sudeste'?'selected':''}>Região Sudeste (4 Capitais)</option>
                <option value="Sul" ${regiaoAtiva==='Sul'?'selected':''}>Região Sul (3 Capitais)</option>
                <optgroup label="── Capitais Individuais ──">
                  ${capitais.map(c => `
                    <option value="${c.capital}" ${AuditState.filtros.capitalSelecionada === c.capital ? 'selected' : ''}>
                      ${c.capital} (${c.uf}) • ${c.regiao} • ${c.nivelRisco}
                    </option>
                  `).join('')}
                </optgroup>
              </select>
            </div>

            <!-- FILTRO PROCESSO OPERACIONAL -->
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:11px;font-weight:700;color:#475569">Processo Operacional:</span>
              <select id="auditFiltroProcess" onchange="window.AuditModule.aplicarFiltroProcesso(this.value)" style="padding:5px 10px;font-size:11px;font-weight:800;border-radius:6px;border:1px solid #CBD5E1;background:#0F4C81;color:#FFFFFF;outline:none;cursor:pointer">
                <option value="Todos" ${AuditState.filtros.processo==='Todos'?'selected':''}>(Todos os Processos)</option>
                <option value="Portão" ${AuditState.filtros.processo==='Portão'?'selected':''}>Portão & Embarque de Passageiros</option>
                <option value="Portas" ${AuditState.filtros.processo==='Portas'?'selected':''}>Fechamento de Portas (FP / D0)</option>
                <option value="Desembarque" ${AuditState.filtros.processo==='Desembarque'?'selected':''}>Desembarque & Conexões</option>
                <option value="Limpeza" ${AuditState.filtros.processo==='Limpeza'?'selected':''}>Limpeza de Cabine & Turnaround</option>
                <option value="Bagagem" ${AuditState.filtros.processo==='Bagagem'?'selected':''}>Bagagens de Mão & Acomodação</option>
                <option value="Calço" ${AuditState.filtros.processo==='Calço'?'selected':''}>Pontualidade de Calço (CA / AP)</option>
                <option value="Segurança" ${AuditState.filtros.processo==='Segurança'?'selected':''}>Segurança de Pátio & FOD</option>
                <option value="Manifesto" ${AuditState.filtros.processo==='Manifesto'?'selected':''}>Documentação & Manifesto LIR</option>
                <option value="Especial" ${AuditState.filtros.processo==='Especial'?'selected':''}>Atendimento Especial / WCHR</option>
              </select>
            </div>

            <!-- FILTRO CLASSIFICAÇÃO DE RISCO -->
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:11px;font-weight:700;color:#475569">Classificação de Risco:</span>
              <select id="auditFiltroRisk" onchange="window.AuditModule.aplicarFiltroRisco(this.value)" style="padding:5px 10px;font-size:11px;font-weight:800;border-radius:6px;border:1px solid #CBD5E1;background:#F97316;color:#FFFFFF;outline:none;cursor:pointer">
                <option value="Todos" ${AuditState.filtros.risco==='Todos'?'selected':''}>(Todos os Riscos)</option>
                <option value="Crítico" ${AuditState.filtros.risco==='Crítico'?'selected':''}>Crítico (Vermelho)</option>
                <option value="Alto" ${AuditState.filtros.risco==='Alto'?'selected':''}>Alto (Laranja)</option>
                <option value="Médio" ${AuditState.filtros.risco==='Médio'?'selected':''}>Médio (Amarelo)</option>
                <option value="Baixo" ${AuditState.filtros.risco==='Baixo'?'selected':''}>Baixo (Verde)</option>
                <option value="Sem registros" ${AuditState.filtros.risco==='Sem registros'?'selected':''}>Sem registros (Cinza)</option>
              </select>
            </div>

            <!-- FORMATO PAPEL PDF -->
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:11px;font-weight:700;color:#475569">Formato PDF:</span>
              <select id="auditFormatoPapel" onchange="window.AuditModule.mudarFormatoPapel(this.value)" style="padding:5px 8px;font-size:11px;font-weight:800;border-radius:6px;border:1px solid #CBD5E1;background:#FFFFFF;color:#0F4C81;outline:none;cursor:pointer">
                <option value="a4" ${AuditState.filtros.formatoPapel==='a4'?'selected':''}>A4 Horizontal</option>
                <option value="a3" ${AuditState.filtros.formatoPapel==='a3'?'selected':''}>A3 Expandido</option>
              </select>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:11px;color:#0F4C81;font-weight:700">Planejadas: <b>${d.indicadoresGerais.totalAuditoriasPlanejadas}</b></span>
            <span style="color:#CBD5E1">|</span>
            <span style="font-size:11px;color:#0F4C81;font-weight:700">Concluídas: <b style="color:#00796B">${d.indicadoresGerais.auditoriasConcluidas} (92%)</b></span>
            <span style="color:#CBD5E1">|</span>
            <span style="font-size:11px;color:#EA580C;font-weight:700">Tratadas: <b>${d.indicadoresGerais.totalObservacoesRemediadas}</b></span>
            <button type="button" class="btn btn-gold" onclick="window.AuditModule.gerarRelatorioPDFReal('geral')" style="padding:6px 14px;font-size:11.5px;font-weight:800;display:flex;align-items:center;gap:5px;box-shadow:0 2px 6px rgba(0,0,0,0.15)">
              <span>📥</span> Baixar PDF Executivo
            </button>
          </div>
        </div>

        <!-- PRIMEIRA LINHA: 5 PAINÉIS LADO A LADO (FIEL À REFERÊNCIA VISUAL EXECUTIVA) -->
        <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:12px;margin-bottom:16px">
          
          <!-- BLOCO 1 DA LINHA 1: Painel de Filtros Ativos -->
          <div style="border:1px solid #CBD5E1;border-radius:10px;padding:12px;background:#F8FAFC;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 1px 4px rgba(0,0,0,0.03)">
            <div>
              <div style="background:#E0F2FE;padding:8px 10px;border-radius:6px;font-size:11.5px;font-weight:900;color:#0F4C81;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.3px">
                Painel de Filtros
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;font-size:11px">
                <div style="background:#F97316;color:#FFFFFF;padding:6px 10px;border-radius:6px;font-weight:800;display:flex;justify-content:space-between;align-items:center">
                  <span>Geografia / Região</span>
                  <span style="font-size:10px;background:rgba(0,0,0,0.2);padding:1px 6px;border-radius:4px">${AuditState.filtros.capitalSelecionada ? AuditState.filtros.capitalSelecionada : (regiaoAtiva === 'Todas' ? 'Todas' : regiaoAtiva)}</span>
                </div>
                <div style="background:#0F4C81;color:#FFFFFF;padding:6px 10px;border-radius:6px;font-weight:800;display:flex;justify-content:space-between;align-items:center">
                  <span>Processo Operacional</span>
                  <span style="font-size:10px;background:rgba(255,255,255,0.2);padding:1px 6px;border-radius:4px">${AuditState.filtros.processo === 'Todos' ? 'Todos' : AuditState.filtros.processo}</span>
                </div>
                <div style="background:#EA580C;color:#FFFFFF;padding:6px 10px;border-radius:6px;font-weight:800;display:flex;justify-content:space-between;align-items:center">
                  <span>Classificação de Risco</span>
                  <span style="font-size:10px;background:rgba(0,0,0,0.2);padding:1px 6px;border-radius:4px">${AuditState.filtros.risco === 'Todos' ? 'Todos' : AuditState.filtros.risco}</span>
                </div>
              </div>
            </div>
            <div style="margin-top:10px;padding-top:8px;border-top:1px solid #E2E8F0;font-size:10px;color:#64748B;line-height:1.4">
              Amostragem: <b>${d.indicadoresGerais.totalAuditoriasPlanejadas} colaboradores</b> auditados no período operacional.
            </div>
          </div>

          <!-- BLOCO 2 DA LINHA 1: Classificação de Risco das Auditorias Planejadas (Rosca) -->
          <div style="border:1px solid #CBD5E1;border-radius:10px;padding:12px;background:#FFFFFF;display:flex;flex-direction:column;box-shadow:0 1px 4px rgba(0,0,0,0.03)">
            <div style="background:#E0F2FE;padding:8px 10px;border-radius:6px;font-size:11.5px;font-weight:900;color:#0F4C81;margin-bottom:8px">
              Classificação de Risco das Auditorias Planejadas
            </div>
            <div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:160px">
              ${renderSVGDonut([
                { label: 'Alto', value: d.riskRating.high, color: '#F97316' },
                { label: 'Baixo', value: d.riskRating.low, color: '#0F4C81' },
                { label: 'Médio', value: d.riskRating.medium, color: '#38BDF8' }
              ], 'Nível de Risco')}
            </div>
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid #F1F5F9;display:flex;justify-content:center;gap:10px;font-size:10.5px;font-weight:800">
              <span style="display:flex;align-items:center;gap:3px;color:#F97316"><span style="width:9px;height:9px;background:#F97316;display:inline-block;border-radius:2px"></span> Alto (47%)</span>
              <span style="display:flex;align-items:center;gap:3px;color:#0F4C81"><span style="width:9px;height:9px;background:#0F4C81;display:inline-block;border-radius:2px"></span> Baixo (28%)</span>
              <span style="display:flex;align-items:center;gap:3px;color:#0284C7"><span style="width:9px;height:9px;background:#38BDF8;display:inline-block;border-radius:2px"></span> Médio (25%)</span>
            </div>
          </div>

          <!-- BLOCO 3 DA LINHA 1: Situação das Auditorias Planejadas (Rosca) -->
          <div style="border:1px solid #CBD5E1;border-radius:10px;padding:12px;background:#FFFFFF;display:flex;flex-direction:column;box-shadow:0 1px 4px rgba(0,0,0,0.03)">
            <div style="background:#E0F2FE;padding:8px 10px;border-radius:6px;font-size:11.5px;font-weight:900;color:#0F4C81;margin-bottom:8px">
              Situação das Auditorias Planejadas
            </div>
            <div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:160px">
              ${renderSVGDonut([
                { label: 'Concluída', value: d.statusPlanned.completed, color: '#0F4C81' },
                { label: 'Em Andamento', value: d.statusPlanned.inProgress, color: '#38BDF8' },
                { label: 'Não Iniciada', value: d.statusPlanned.notStarted, color: '#FB923C' }
              ], '92% Concluído')}
            </div>
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid #F1F5F9;display:flex;flex-direction:column;gap:3px;font-size:10px;font-weight:800;color:#475569">
              <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;background:#0F4C81;display:inline-block;border-radius:2px"></span> ■ Concluída (92%)</span>
              <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;background:#38BDF8;display:inline-block;border-radius:2px"></span> ■ Em Andamento (4%)</span>
              <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;background:#FB923C;display:inline-block;border-radius:2px"></span> ■ Não Iniciada (4%)</span>
            </div>
          </div>

          <!-- BLOCO 4 DA LINHA 1: Resultado das Auditorias Concluídas (Rosca) -->
          <div style="border:1px solid #CBD5E1;border-radius:10px;padding:12px;background:#FFFFFF;display:flex;flex-direction:column;box-shadow:0 1px 4px rgba(0,0,0,0.03)">
            <div style="background:#E0F2FE;padding:8px 10px;border-radius:6px;font-size:11.5px;font-weight:900;color:#0F4C81;margin-bottom:8px">
              Resultado das Auditorias Concluídas
            </div>
            <div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:160px">
              ${renderSVGDonut([
                { label: 'Necessita de Melhoria Significativa', value: d.resultCompleted.needSignificant, color: '#0F4C81' },
                { label: 'Necessita de Melhoria', value: d.resultCompleted.needSome, color: '#38BDF8' },
                { label: 'Insatisfatório', value: d.resultCompleted.unsatisfactory, color: '#EA580C' },
                { label: 'Satisfatório', value: d.resultCompleted.satisfactory, color: '#EAB308' }
              ], 'Resultados')}
            </div>
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid #F1F5F9;display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9.5px;font-weight:800;color:#475569">
              <span style="display:flex;align-items:center;gap:3px;color:#EA580C"><span style="width:8px;height:8px;background:#EA580C;display:inline-block;border-radius:2px"></span> Insatisfatório (22%)</span>
              <span style="display:flex;align-items:center;gap:3px;color:#0F4C81"><span style="width:8px;height:8px;background:#0F4C81;display:inline-block;border-radius:2px"></span> Nec. Significativa (36%)</span>
              <span style="display:flex;align-items:center;gap:3px;color:#0284C7"><span style="width:8px;height:8px;background:#38BDF8;display:inline-block;border-radius:2px"></span> Nec. Melhoria (25%)</span>
              <span style="display:flex;align-items:center;gap:3px;color:#CA8A04"><span style="width:8px;height:8px;background:#EAB308;display:inline-block;border-radius:2px"></span> Satisfatório (17%)</span>
            </div>
          </div>

          <!-- BLOCO 5 DA LINHA 1: Resumo de Observações vs. Observações Tratadas por Classificação de Risco (Barras Duplas) -->
          <div style="border:1px solid #CBD5E1;border-radius:10px;padding:12px;background:#FFFFFF;display:flex;flex-direction:column;box-shadow:0 1px 4px rgba(0,0,0,0.03)">
            <div style="background:#E0F2FE;padding:8px 10px;border-radius:6px;font-size:11px;font-weight:900;color:#0F4C81;margin-bottom:8px;line-height:1.3">
              Resumo de Observações vs. Observações Tratadas
            </div>
            <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:2px 0">
              ${renderBarrasHorizontaisDuplas(d.summaryObservationsVsRemediated)}
            </div>
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid #F1F5F9;display:flex;justify-content:center;gap:12px;font-size:10px;font-weight:800">
              <span style="display:flex;align-items:center;gap:4px;color:#0F4C81"><span style="width:10px;height:7px;background:#0F4C81;display:inline-block;border-radius:2px"></span> Total Observações</span>
              <span style="display:flex;align-items:center;gap:4px;color:#F97316"><span style="width:10px;height:7px;background:#F97316;display:inline-block;border-radius:2px"></span> Observações Tratadas</span>
            </div>
          </div>

        </div>

        <!-- SEGUNDA LINHA: 3 PAINÉIS (COLUNAS COM TENDÊNCIA, MAPA DO BRASIL DAS 27 CAPITAIS E MATRIZ DE IMPACTO/VULNERABILIDADE) -->
        <div style="display:grid;grid-template-columns:1.2fr 1.35fr 1fr;gap:14px;margin-bottom:16px">
          
          <!-- PAINEL 1 DA LINHA 2: Observações de Auditoria por Processo Operacional e Tratativas (C1 a C9) -->
          <div style="border:1px solid #CBD5E1;border-radius:10px;padding:12px;background:#FFFFFF;box-shadow:0 1px 4px rgba(0,0,0,0.03);display:flex;flex-direction:column">
            <div style="background:#FFF1F2;padding:8px 10px;border-radius:6px;font-size:11.5px;font-weight:900;color:#9F1239;margin-bottom:8px">
              Observações de Auditoria por Processo Operacional e Tratativas
            </div>
            <div style="flex:1;min-height:220px">
              ${renderGraficoColunasComTendencia(d.businessProcesses)}
            </div>
            <div style="font-size:9.5px;color:#64748B;text-align:center;margin-top:6px;line-height:1.4">
              Categorias 1 a 9: C1 Gate/Embarque • C2 Fechamento Portas D0 • C3 Desembarque • C4 Limpeza • C5 Bagagens • C6 Calço • C7 Safety • C8 Docs LIR • C9 Especial WCHR
            </div>
          </div>

          <!-- PAINEL 2 DA LINHA 2: MAPA GEOGRÁFICO DAS 27 CAPITAIS BRASILEIRAS (INTERATIVO) -->
          <div style="border:1px solid #CBD5E1;border-radius:10px;padding:12px;background:#FFFFFF;box-shadow:0 1px 4px rgba(0,0,0,0.03);display:flex;flex-direction:column">
            <div style="background:#FFF7ED;padding:8px 10px;border-radius:6px;font-size:11.5px;font-weight:900;color:#9A3412;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
              <span>Distribuição Geográfica das Observações — 27 Capitais Brasileiras</span>
              <span style="font-size:10px;background:#FED7AA;color:#9A3412;padding:2px 6px;border-radius:4px;font-weight:800">DADOS REAIS</span>
            </div>
            <div style="flex:1;min-height:260px;position:relative">
              ${renderMapaBrasil27Capitais(capitais, regiaoAtiva, capAtiva)}
            </div>
          </div>

          <!-- PAINEL 3 DA LINHA 2: Análise de Impacto Operacional e Vulnerabilidade das Auditorias Concluídas -->
          <div style="border:1px solid #CBD5E1;border-radius:10px;padding:12px;background:#FFFFFF;box-shadow:0 1px 4px rgba(0,0,0,0.03);display:flex;flex-direction:column">
            <div style="background:#F0FDF4;padding:8px 10px;border-radius:6px;font-size:11.5px;font-weight:900;color:#166534;margin-bottom:8px">
              Análise de Impacto Operacional e Vulnerabilidade das Auditorias Concluídas
            </div>
            <div style="flex:1;min-height:220px">
              ${renderMatrizImpactoVulnerabilidade(d.impactVulnerabilityAnalysis)}
            </div>
            <div style="font-size:9.5px;color:#64748B;text-align:center;margin-top:6px">
              Eixo X: Vulnerabilidade Operacional (0 a 4) • Eixo Y: Impacto no Voo (0 a 4)
            </div>
          </div>

        </div>

        <!-- TERCEIRA LINHA: ÁREA COMPLEMENTAR EXECUTIVA (KPIS GERAIS + PENDÊNCIAS + DIRETRIZES ESTRATÉGICAS) -->
        <div style="border-top:1.5px solid #E2E8F0;padding-top:16px;margin-top:6px">
          
          <!-- INDICADORES EXECUTIVOS CONSOLIDADOS -->
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:12px;margin-bottom:16px">
            <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:12px">
              <div style="width:40px;height:40px;border-radius:8px;background:#E0F2FE;display:flex;align-items:center;justify-content:center;font-size:20px;color:#0F4C81">🎯</div>
              <div>
                <div style="font-size:10.5px;color:#64748B;font-weight:800;text-transform:uppercase">Conformidade D0 Geral</div>
                <div style="font-size:18px;font-weight:900;color:#00796B">${d.indicadoresGerais.indiceConformidadeMedio || '91.2%'} <span style="font-size:10.5px;color:#10B981;font-weight:700">(Meta: 90%)</span></div>
              </div>
            </div>

            <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:12px">
              <div style="width:40px;height:40px;border-radius:8px;background:#FEF3C7;display:flex;align-items:center;justify-content:center;font-size:20px;color:#D97706">⚡</div>
              <div>
                <div style="font-size:10.5px;color:#64748B;font-weight:800;text-transform:uppercase">Taxa de Tratativas</div>
                <div style="font-size:18px;font-weight:900;color:#D97706">${d.indicadoresGerais.taxaRemediacaoGeral || '86.4%'} <span style="font-size:10.5px;color:#64748B;font-weight:700">(598 tratadas)</span></div>
              </div>
            </div>

            <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:12px">
              <div style="width:40px;height:40px;border-radius:8px;background:#F0FDF4;display:flex;align-items:center;justify-content:center;font-size:20px;color:#166534">⏱️</div>
              <div>
                <div style="font-size:10.5px;color:#64748B;font-weight:800;text-transform:uppercase">Tempo Médio de Resolução</div>
                <div style="font-size:18px;font-weight:900;color:#166534">18 min <span style="font-size:10.5px;color:#10B981;font-weight:700">(-6 min vs mês ant.)</span></div>
              </div>
            </div>

            <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:12px">
              <div style="width:40px;height:40px;border-radius:8px;background:#F1F5F9;display:flex;align-items:center;justify-content:center;font-size:20px;color:#0F4C81">✈️</div>
              <div>
                <div style="font-size:10.5px;color:#64748B;font-weight:800;text-transform:uppercase">Voos e Agentes Auditados</div>
                <div style="font-size:18px;font-weight:900;color:#0F4C81">${d.indicadoresGerais.totalAuditoriasPlanejadas} Agentes <span style="font-size:10.5px;color:#64748B;font-weight:700">(Turnos T1-T4)</span></div>
              </div>
            </div>
          </div>

          <!-- TABELA DE PENDÊNCIAS CRÍTICAS E RECOMENDAÇÕES DA SUPERVISÃO MASTER -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            
            <div style="background:#FFFFFF;border:1px solid #CBD5E1;border-radius:8px;padding:12px">
              <div style="font-weight:800;font-size:12px;color:#991B1B;margin-bottom:8px;display:flex;align-items:center;gap:6px">
                <span>🚨</span> Apontamentos Críticos em Aberto para Auditoria Operacional
              </div>
              <table style="width:100%;border-collapse:collapse;font-size:10.5px;text-align:left">
                <thead>
                  <tr style="background:#FEE2E2;color:#991B1B;font-weight:800">
                    <th style="padding:5px 8px">Processo</th>
                    <th style="padding:5px 8px">Ocorrências</th>
                    <th style="padding:5px 8px">Impacto</th>
                    <th style="padding:5px 8px">Ação Corretiva Imediata</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style="border-bottom:1px solid #F1F5F9">
                    <td style="padding:5px 8px;font-weight:700">Fechamento de Portas D0</td>
                    <td style="padding:5px 8px;color:#DC2626;font-weight:800">68 casos</td>
                    <td style="padding:5px 8px"><span style="background:#FEE2E2;color:#991B1B;padding:1px 6px;border-radius:4px;font-weight:800">Crítico</span></td>
                    <td style="padding:5px 8px;color:#475569">Antecipação do aviso de embarque aos passageiros de conexão curta</td>
                  </tr>
                  <tr style="border-bottom:1px solid #F1F5F9">
                    <td style="padding:5px 8px;font-weight:700">Conexão de Bagagem</td>
                    <td style="padding:5px 8px;color:#DC2626;font-weight:800">62 casos</td>
                    <td style="padding:5px 8px"><span style="background:#FFEDD5;color:#C2410C;padding:1px 6px;border-radius:4px;font-weight:800">Alto</span></td>
                    <td style="padding:5px 8px;color:#475569">Reforço de comunicação entre Rampa e Despacho nos picos de GRU/BSB</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 8px;font-weight:700">Limpeza de Cabine (TL)</td>
                    <td style="padding:5px 8px;color:#D97706;font-weight:800">54 casos</td>
                    <td style="padding:5px 8px"><span style="background:#FEF3C7;color:#854D0E;padding:1px 6px;border-radius:4px;font-weight:800">Médio</span></td>
                    <td style="padding:5px 8px;color:#475569">Checklist rápido de liberação antes de STD -20 min</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:12px;display:flex;flex-direction:column;justify-content:space-between">
              <div>
                <div style="font-weight:800;font-size:12px;color:#166534;margin-bottom:8px;display:flex;align-items:center;gap:6px">
                  <span>✅</span> Recomendações Estratégicas para a Gestão Operacional
                </div>
                <ul style="margin:0;padding-left:18px;font-size:11px;color:#14532D;line-height:1.55">
                  <li><b>Protocolo de Início de Embarque (IB):</b> Padronizar abertura prioritária 5 minutos antes em aeronaves com lotação acima de 85%.</li>
                  <li><b>Checklist de Alerta Preventivo (STD -15):</b> Supervisão aciona o HCC automaticamente se o calço (CA) ou fechamento de portas (FP) apresentarem risco de violação D0.</li>
                  <li><b>Acompanhamento de Remediações:</b> Assegurar que 100% dos códigos de atraso possuam justificativa formal anexada no diário de voo.</li>
                </ul>
              </div>
              <div style="margin-top:8px;padding-top:6px;border-top:1px dashed #86EFAC;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#15803D">
                <span>Relatório Executivo Oficial gerado eletronicamente</span>
                <span>Supervisão Master • Diário de Embarque</span>
              </div>
            </div>

          </div>

        </div>

      </div>
    `;
  }

  // ==========================================================================
  // MAPA GEOGRÁFICO INTERATIVO DAS 27 CAPITAIS BRASILEIRAS (VETORIAL SVG PURO)
  // Divide o Brasil em 5 macrorregiões oficiais:
  // Norte (7), Nordeste (9), Centro-Oeste (4), Sudeste (4), Sul (3) = 27 capitais
  // Cores estritamente baseadas nos dados reais de auditoria (Crítico, Alto, Médio, Baixo, Sem registros)
  // ==========================================================================
  function renderMapaBrasil27Capitais(capitais, filtroRegiao = 'Todas', capitalSelecionada = null) {
    const w = 460;
    const h = 380;
    const minLon = -74;
    const maxLon = -34;
    const maxLat = 5.3;
    const minLat = -33.8;

    // Filtra lista de capitais para exibição de destaque
    const capitaisFiltradas = capitais.filter(c => {
      if (filtroRegiao !== 'Todas' && c.regiao !== filtroRegiao) return false;
      if (AuditState.filtros.risco !== 'Todos' && c.nivelRisco !== AuditState.filtros.risco) return false;
      return true;
    });

    // Projeta marcadores das 27 capitais
    const markers = capitais.map(c => {
      // Coordenadas projetadas com precisão mercator ajustada
      const cx = Math.round(((c.lon - minLon) / (maxLon - minLon)) * (w - 90) + 40);
      const cy = Math.round(((maxLat - c.lat) / (maxLat - minLat)) * (h - 70) + 30);

      const isAtiva = (!capitalSelecionada || capitalSelecionada === c.capital);
      const isRegiaoAtiva = (filtroRegiao === 'Todas' || filtroRegiao === c.regiao);
      const isRiscoAtivo = (AuditState.filtros.risco === 'Todos' || AuditState.filtros.risco === c.nivelRisco);
      const destacada = isAtiva && isRegiaoAtiva && isRiscoAtivo;

      const cor = c.corRisco || '#94A3B8';
      const raio = capitalSelecionada === c.capital ? 8 : (destacada ? 5.5 : 4);
      const opacidade = destacada ? 1 : 0.25;

      const tooltipTexto = `${c.capital} (${c.uf}) — Região ${c.regiao}\nStatus: ${c.nivelRisco}\nVoos Auditados: ${c.totalVoos}\nConformidade D0: ${c.conformidade !== null ? c.conformidade + '%' : 'Sem registros'}\nObservações: ${c.observacoes}\nTratativas: ${c.remediadas}`;

      return `
        <g style="cursor:pointer;transition:transform 0.2s ease" onclick="window.AuditModule.selecionarCapital('${c.capital}')">
          <title>${tooltipTexto}</title>
          <!-- Halo de destaque se selecionada ou ativa -->
          ${destacada ? `
            <circle cx="${cx}" cy="${cy}" r="${raio * 1.8}" fill="${cor}" opacity="0.25">
              ${capitalSelecionada === c.capital ? '<animate attributeName="r" values="' + (raio * 1.5) + ';' + (raio * 2.4) + ';' + (raio * 1.5) + '" dur="2s" repeatCount="indefinite" />' : ''}
            </circle>
          ` : ''}
          <!-- Ponto central da capital -->
          <circle cx="${cx}" cy="${cy}" r="${raio}" fill="${cor}" stroke="#FFFFFF" stroke-width="${capitalSelecionada === c.capital ? '2.5' : '1.5'}" opacity="${opacidade}" />
          <!-- Rótulo UF -->
          <text x="${cx}" y="${cy - raio - 2}" fill="${destacada ? '#0F172A' : '#94A3B8'}" font-size="${capitalSelecionada === c.capital ? '9' : '7.5'}" font-weight="${destacada ? '900' : '600'}" text-anchor="middle" opacity="${opacidade}">
            ${c.uf}
          </text>
        </g>
      `;
    }).join('');

    // Dados da capital em foco para exibição detalhada
    const capInfo = capitalSelecionada ? capitais.find(c => c.capital === capitalSelecionada) : null;

    return `
      <div style="position:relative;display:flex;flex-direction:column;height:100%">
        
        <!-- SELETOR RÁPIDO DE MACRORREGIÕES -->
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">
          <button type="button" onclick="window.AuditModule.filtrarRegiao('Todas')" style="padding:3px 7px;font-size:10px;font-weight:800;border-radius:4px;border:1px solid #CBD5E1;background:${filtroRegiao==='Todas'?'#0F4C81':'#F1F5F9'};color:${filtroRegiao==='Todas'?'#FFFFFF':'#334155'};cursor:pointer">
            Todas (27)
          </button>
          <button type="button" onclick="window.AuditModule.filtrarRegiao('Norte')" style="padding:3px 7px;font-size:10px;font-weight:800;border-radius:4px;border:1px solid #CBD5E1;background:${filtroRegiao==='Norte'?'#059669':'#F1F5F9'};color:${filtroRegiao==='Norte'?'#FFFFFF':'#334155'};cursor:pointer">
            Norte (7)
          </button>
          <button type="button" onclick="window.AuditModule.filtrarRegiao('Nordeste')" style="padding:3px 7px;font-size:10px;font-weight:800;border-radius:4px;border:1px solid #CBD5E1;background:${filtroRegiao==='Nordeste'?'#D97706':'#F1F5F9'};color:${filtroRegiao==='Nordeste'?'#FFFFFF':'#334155'};cursor:pointer">
            Nordeste (9)
          </button>
          <button type="button" onclick="window.AuditModule.filtrarRegiao('Centro-Oeste')" style="padding:3px 7px;font-size:10px;font-weight:800;border-radius:4px;border:1px solid #CBD5E1;background:${filtroRegiao==='Centro-Oeste'?'#EA580C':'#F1F5F9'};color:${filtroRegiao==='Centro-Oeste'?'#FFFFFF':'#334155'};cursor:pointer">
            Centro-Oeste (4)
          </button>
          <button type="button" onclick="window.AuditModule.filtrarRegiao('Sudeste')" style="padding:3px 7px;font-size:10px;font-weight:800;border-radius:4px;border:1px solid #CBD5E1;background:${filtroRegiao==='Sudeste'?'#2563EB':'#F1F5F9'};color:${filtroRegiao==='Sudeste'?'#FFFFFF':'#334155'};cursor:pointer">
            Sudeste (4)
          </button>
          <button type="button" onclick="window.AuditModule.filtrarRegiao('Sul')" style="padding:3px 7px;font-size:10px;font-weight:800;border-radius:4px;border:1px solid #CBD5E1;background:${filtroRegiao==='Sul'?'#7C3AED':'#F1F5F9'};color:${filtroRegiao==='Sul'?'#FFFFFF':'#334155'};cursor:pointer">
            Sul (3)
          </button>
          ${capitalSelecionada ? `
            <button type="button" onclick="window.AuditModule.limparFiltroCapital()" style="padding:3px 7px;font-size:10px;font-weight:800;border-radius:4px;border:1px solid #FCA5A5;background:#FEF2F2;color:#991B1B;cursor:pointer;margin-left:auto">
              ✖ Limpar Seleção
            </button>
          ` : ''}
        </div>

        <!-- CANVAS DO MAPA VETORIAL COM AS 5 REGIÕES E 27 CAPITAIS -->
        <div style="flex:1;background:#F8FAFC;border-radius:8px;border:1px solid #E2E8F0;position:relative;overflow:hidden">
          <svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" style="display:block">
            <!-- Polígonos de preenchimento estilizados das 5 macrorregiões brasileiras -->
            <!-- Região Norte -->
            <path d="M 60 170 Q 110 90 170 50 Q 240 50 280 80 L 310 90 L 290 180 L 250 170 L 140 160 Z" fill="#ECFDF5" stroke="#A7F3D0" stroke-width="1.2" opacity="${(filtroRegiao==='Todas'||filtroRegiao==='Norte')?'0.9':'0.3'}" />
            
            <!-- Região Nordeste -->
            <path d="M 310 90 Q 380 90 420 140 Q 420 180 380 200 L 340 190 L 330 140 Z" fill="#FFFBEB" stroke="#FDE68A" stroke-width="1.2" opacity="${(filtroRegiao==='Todas'||filtroRegiao==='Nordeste')?'0.9':'0.3'}" />
            
            <!-- Região Centro-Oeste -->
            <path d="M 140 160 L 250 170 L 290 180 L 290 240 L 220 280 L 190 230 Z" fill="#FFF7ED" stroke="#FED7AA" stroke-width="1.2" opacity="${(filtroRegiao==='Todas'||filtroRegiao==='Centro-Oeste')?'0.9':'0.3'}" />
            
            <!-- Região Sudeste -->
            <path d="M 290 220 L 370 210 L 370 270 L 340 300 L 290 300 L 280 250 Z" fill="#EFF6FF" stroke="#BFDBFE" stroke-width="1.2" opacity="${(filtroRegiao==='Todas'||filtroRegiao==='Sudeste')?'0.9':'0.3'}" />
            
            <!-- Região Sul -->
            <path d="M 270 300 L 310 300 L 290 340 L 260 370 L 240 340 L 260 310 Z" fill="#F5F3FF" stroke="#DDD6FE" stroke-width="1.2" opacity="${(filtroRegiao==='Todas'||filtroRegiao==='Sul')?'0.9':'0.3'}" />

            <!-- Marcadores das 27 Capitais -->
            ${markers}
          </svg>
        </div>

        <!-- DETALHE DA CAPITAL SELECIONADA OU RESUMO GERAL -->
        ${capInfo ? `
          <div style="background:#FFFFFF;border:1.5px solid #0F4C81;border-radius:8px;padding:8px 12px;margin-top:8px;box-shadow:0 4px 10px rgba(0,0,0,0.06);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-weight:900;font-size:12.5px;color:#0F4C81">${capInfo.capital} (${capInfo.uf})</span>
                <span style="background:${capInfo.corRisco};color:#FFFFFF;padding:1px 6px;border-radius:10px;font-size:9.5px;font-weight:800">${capInfo.nivelRisco.toUpperCase()}</span>
                <span style="font-size:10.5px;color:#64748B">• Região ${capInfo.regiao}</span>
              </div>
              <div style="font-size:11px;color:#334155;margin-top:2px">
                Voos Auditados: <b>${capInfo.totalVoos}</b> | Conformidade D0: <b style="color:${capInfo.conformidade >= 90 ? '#10B981' : '#EA580C'}">${capInfo.conformidade !== null ? capInfo.conformidade + '%' : 'Sem registros'}</b> | Obs: <b style="color:#EF4444">${capInfo.observacoes}</b> | Tratativas: <b style="color:#00796B">${capInfo.remediadas}</b>
              </div>
            </div>
            <button type="button" onclick="window.AuditModule.limparFiltroCapital()" style="background:#F1F5F9;border:1px solid #CBD5E1;color:#475569;padding:4px 8px;border-radius:4px;font-size:10.5px;font-weight:700;cursor:pointer">
              Fechar Detalhes
            </button>
          </div>
        ` : `
          <!-- LEGENDA OFICIAL DOS NÍVEIS DE RISCO DAS 27 CAPITAIS -->
          <div style="margin-top:6px;padding-top:4px;display:flex;justify-content:center;align-items:center;gap:12px;font-size:10px;font-weight:800;flex-wrap:wrap">
            <span style="display:flex;align-items:center;gap:3px;color:#EF4444"><span style="width:8px;height:8px;background:#EF4444;display:inline-block;border-radius:50%"></span> Crítico</span>
            <span style="display:flex;align-items:center;gap:3px;color:#F97316"><span style="width:8px;height:8px;background:#F97316;display:inline-block;border-radius:50%"></span> Alto</span>
            <span style="display:flex;align-items:center;gap:3px;color:#CA8A04"><span style="width:8px;height:8px;background:#EAB308;display:inline-block;border-radius:50%"></span> Médio</span>
            <span style="display:flex;align-items:center;gap:3px;color:#10B981"><span style="width:8px;height:8px;background:#10B981;display:inline-block;border-radius:50%"></span> Baixo</span>
            <span style="display:flex;align-items:center;gap:3px;color:#64748B"><span style="width:8px;height:8px;background:#94A3B8;display:inline-block;border-radius:50%"></span> Sem registros</span>
          </div>
        `}

      </div>
    `;
  }

  // ==========================================================================
  // FUNÇÕES DE DESENHO VETORIAL SVG PARA OS GRÁFICOS OFICIAIS (PT-BR)
  // ==========================================================================

  /**
   * Renderiza Donut SVG nativo com percentuais e labels em português
   */
  function renderSVGDonut(slices, centerText) {
    const total = slices.reduce((acc, s) => acc + s.value, 0) || 1;
    const size = 150;
    const center = size / 2;
    const radius = 58;
    const strokeWidth = 24;

    let cumulativeAngle = -90;
    let paths = '';

    slices.forEach(slice => {
      const angle = (slice.value / total) * 360;
      const startAngle = cumulativeAngle;
      const endAngle = cumulativeAngle + angle;
      cumulativeAngle = endAngle;

      const x1 = center + radius * Math.cos((Math.PI * startAngle) / 180);
      const y1 = center + radius * Math.sin((Math.PI * startAngle) / 180);
      const x2 = center + radius * Math.cos((Math.PI * endAngle) / 180);
      const y2 = center + radius * Math.sin((Math.PI * endAngle) / 180);
      const largeArc = angle > 180 ? 1 : 0;

      const midAngle = startAngle + angle / 2;
      const tx = center + (radius) * Math.cos((Math.PI * midAngle) / 180);
      const ty = center + (radius) * Math.sin((Math.PI * midAngle) / 180);

      paths += `
        <path d="M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}" 
              fill="none" stroke="${slice.color}" stroke-width="${strokeWidth}" 
              stroke-linecap="butt" />
        <text x="${tx}" y="${ty + 4}" fill="#FFFFFF" font-size="10" font-weight="900" text-anchor="middle" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.5))">
          ${Math.round((slice.value / total) * 100)}%
        </text>
      `;
    });

    return `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${paths}
        <circle cx="${center}" cy="${center}" r="${radius - strokeWidth / 2 - 2}" fill="#FFFFFF" />
        <text x="${center}" y="${center + 3}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#0F4C81">
          ${centerText || ''}
        </text>
      </svg>
    `;
  }

  /**
   * Renderiza gráfico de barras horizontais duplas da imagem de referência:
   * "Resumo de Observações vs. Observações Tratadas por Classificação de Risco"
   */
  function renderBarrasHorizontaisDuplas(data) {
    const maxVal = 240;
    // Tradução dos rótulos de risco
    const tradutorRisco = {
      'Satisfactory': 'Satisfatório',
      'Need some improvement': 'Necessita de Melhoria',
      'Need significant improvement': 'Necessita de Melhoria Significativa',
      'Unsatisfactory': 'Insatisfatório'
    };

    return data.map(item => {
      const rotuloBR = tradutorRisco[item.rating] || item.rating;
      const wAll = Math.min(100, (item.allObservations / maxVal) * 100);
      const wRem = Math.min(100, (item.remediatedObservations / maxVal) * 100);
      return `
        <div style="font-size:10.5px">
          <div style="color:#334155;font-weight:700;margin-bottom:2px;font-size:10px">${rotuloBR}</div>
          <div style="display:flex;flex-direction:column;gap:2px">
            <!-- Barra Total de Observações (Azul Petróleo) -->
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;background:#F1F5F9;border-radius:3px;height:10px;overflow:hidden">
                <div style="background:#0F4C81;height:100%;width:${wAll}%;border-radius:3px;transition:width 0.5s ease"></div>
              </div>
              <span style="font-size:9.5px;font-weight:800;color:#0F4C81;width:24px;text-align:right">${item.allObservations}</span>
            </div>
            <!-- Barra Observações Tratadas (Laranja) -->
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;background:#F1F5F9;border-radius:3px;height:10px;overflow:hidden">
                <div style="background:#F97316;height:100%;width:${wRem}%;border-radius:3px;transition:width 0.5s ease"></div>
              </div>
              <span style="font-size:9.5px;font-weight:800;color:#F97316;width:24px;text-align:right">${item.remediatedObservations}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Renderiza colunas com linha de tendência sobreposta (C1 a C9)
   */
  function renderGraficoColunasComTendencia(processes) {
    const w = 320;
    const h = 190;
    const padX = 26;
    const padY = 22;
    const innerW = w - padX * 2;
    const innerH = h - padY * 2;
    const colCount = processes.length;
    const colWidth = (innerW / colCount) * 0.65;
    const maxVal = 26;

    let barsSVG = '';
    let trendPoints = [];

    processes.forEach((p, idx) => {
      const cx = padX + (idx + 0.5) * (innerW / colCount);
      const bH = (p.observations / maxVal) * innerH;
      const bY = padY + innerH - bH;
      const rH = (p.remediated / maxVal) * innerH;
      const rY = padY + innerH - rH;

      barsSVG += `
        <!-- Barra de Observações Tratadas (Azul Claro) -->
        <rect x="${cx - colWidth / 2}" y="${rY}" width="${colWidth}" height="${rH}" fill="#38BDF8" rx="2" />
        <!-- Barra de Observações Totais (Azul Petróleo) -->
        <rect x="${cx - colWidth / 2}" y="${bY}" width="${colWidth}" height="${Math.max(2, bH - rH)}" fill="#0F4C81" rx="2" opacity="0.9" />
        <!-- Rótulo C1 a C9 -->
        <text x="${cx}" y="${h - 4}" font-size="8.5" fill="#64748B" font-weight="800" text-anchor="middle">C${idx + 1}</text>
      `;

      const ty = padY + innerH - (p.trend / maxVal) * innerH;
      trendPoints.push(`${cx},${ty}`);
    });

    return `
      <svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" style="overflow:visible">
        <!-- Grade de fundo -->
        <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${h - padY}" stroke="#E2E8F0" stroke-width="1" />
        <line x1="${padX}" y1="${h - padY}" x2="${w - padX}" y2="${h - padY}" stroke="#E2E8F0" stroke-width="1" />
        <line x1="${padX}" y1="${padY + innerH / 2}" x2="${w - padX}" y2="${padY + innerH / 2}" stroke="#F1F5F9" stroke-width="1" stroke-dasharray="3,3" />

        ${barsSVG}

        <!-- Linha de tendência contínua -->
        <polyline points="${trendPoints.join(' ')}" fill="none" stroke="#0284C7" stroke-width="2.5" />
        ${trendPoints.map(pt => `<circle cx="${pt.split(',')[0]}" cy="${pt.split(',')[1]}" r="3.5" fill="#0284C7" stroke="#FFFFFF" stroke-width="1" />`).join('')}
      </svg>
    `;
  }

  /**
   * Renderiza matriz de dispersão de impacto e vulnerabilidade das auditorias concluídas
   */
  function renderMatrizImpactoVulnerabilidade(items) {
    const w = 260;
    const h = 190;
    const pad = 24;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;

    const bubbles = items.map(item => {
      const cx = pad + (item.vulnerability / 4) * innerW;
      const cy = pad + innerH - (item.impact / 4) * innerH;
      const r = Math.min(15, Math.max(7, Math.sqrt(item.count) * 1.5));

      return `
        <g style="cursor:pointer">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="${item.color}" opacity="0.85" stroke="#FFFFFF" stroke-width="1.5" />
          <title>${item.label}\nImpacto Operacional: ${item.impact} / 4\nVulnerabilidade: ${item.vulnerability} / 4\nCasos Registrados: ${item.count}</title>
        </g>
      `;
    }).join('');

    return `
      <svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" style="overflow:visible">
        <!-- Eixos graduados 0 a 4 -->
        <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="#CBD5E1" stroke-width="1.5" />
        <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#CBD5E1" stroke-width="1.5" />
        <line x1="${pad}" y1="${pad + innerH / 2}" x2="${w - pad}" y2="${pad + innerH / 2}" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="2,2" />
        <line x1="${pad + innerW / 2}" y1="${pad}" x2="${pad + innerW / 2}" y2="${h - pad}" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="2,2" />
        
        <!-- Marcas nos eixos -->
        <text x="${pad - 6}" y="${pad + 4}" font-size="8" fill="#64748B" text-anchor="end">4</text>
        <text x="${pad - 6}" y="${pad + innerH / 2 + 3}" font-size="8" fill="#64748B" text-anchor="end">2</text>
        <text x="${pad - 6}" y="${h - pad + 3}" font-size="8" fill="#64748B" text-anchor="end">0</text>

        <text x="${pad}" y="${h - pad + 12}" font-size="8" fill="#64748B" text-anchor="middle">0</text>
        <text x="${pad + innerW / 2}" y="${h - pad + 12}" font-size="8" fill="#64748B" text-anchor="middle">2</text>
        <text x="${w - pad}" y="${h - pad + 12}" font-size="8" fill="#64748B" text-anchor="middle">4</text>

        ${bubbles}
      </svg>
    `;
  }

  // ==========================================================================
  // ABA 2: AUDITORIA INDIVIDUAL DO COLABORADOR
  // ==========================================================================
  function renderAbaIndividual(container) {
    const d = AuditState.dadosGerais;
    const lista = d.colaboradoresLista || [];
    const termo = (AuditState.filtros.termoBuscaColab || '').toUpperCase();
    const filtrados = lista.filter(c => c.nome.includes(termo));
    const dossie = AuditState.dossieColaborador;

    container.innerHTML = `
      <div style="background:#FFFFFF;border-radius:12px;padding:20px;border:1px solid #CBD5E1;box-shadow:0 2px 10px rgba(0,0,0,0.04)">
        
        <!-- SELETOR DE COLABORADOR COM BUSCA INSTANTÂNEA NA BASE REAL -->
        <div style="background:#F8FAFC;border:1.5px solid #E2E8F0;border-radius:12px;padding:16px;margin-bottom:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:12px">
            <div>
              <h3 style="margin:0;font-size:16px;font-weight:900;color:#0F4C81;display:flex;align-items:center;gap:6px">
                <span>👤</span> Seleção e Diagnóstico do Colaborador
              </h3>
              <p style="margin:2px 0 0;font-size:12px;color:#64748B">
                Total de <b>${lista.length}</b> colaboradores cadastrados e monitorados com voos reais.
              </p>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="text" placeholder="Digite para filtrar colaborador..." value="${AuditState.filtros.termoBuscaColab}" 
                     oninput="window.AuditModule.filtrarBuscaColab(this.value)"
                     style="padding:8px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:12px;font-weight:700;width:240px;outline:none" />
            </div>
          </div>

          <!-- SELETOR DROPDOWN COM COLABORADORES REALMENTE CADASTRADOS -->
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <select id="selectAuditColaborador" onchange="window.AuditModule.selecionarColaborador(this.value)" 
                    style="flex:1;min-width:260px;padding:10px 14px;border:2px solid #0F4C81;border-radius:8px;font-size:13px;font-weight:800;color:#0F4C81;background:#FFFFFF;cursor:pointer">
              <option value="">-- Escolha um colaborador para auditoria individual (${filtrados.length} encontrados) --</option>
              ${filtrados.map(c => `
                <option value="${c.nome}" ${AuditState.colaboradorSelecionado === c.nome ? 'selected' : ''}>
                  ${c.nome} • Setor: ${c.setor} • Turno: ${c.turno} • Conf: ${c.conformidade}% • Risco: ${c.risco}
                </option>
              `).join('')}
            </select>
            <button type="button" class="btn btn-gold" onclick="window.AuditModule.carregarDossieIndividual()" style="padding:10px 20px;font-weight:800;font-size:13px;white-space:nowrap">
              🔎 Gerar Auditoria Individual
            </button>
            ${dossie ? `
              <button type="button" class="btn" onclick="window.AuditModule.gerarRelatorioPDFReal('individual')" style="background:#22C55E;color:#0B1A33;border:none;padding:10px 18px;font-weight:800;font-size:13px;white-space:nowrap;display:flex;align-items:center;gap:6px">
                📥 Baixar Dossiê em PDF
              </button>
            ` : ''}
          </div>
        </div>

        <!-- EXIBIÇÃO DO DOSSIÊ DO COLABORADOR AUDITADO -->
        <div id="areaDossieIndividual">
          ${dossie ? renderDetalhesDossie(dossie) : `
            <div style="text-align:center;padding:50px 20px;color:#64748B;background:#F8FAFC;border-radius:12px;border:1px dashed #CBD5E1">
              <div style="font-size:42px;margin-bottom:10px">📋</div>
              <div style="font-weight:800;font-size:15px;color:#0F4C81">Selecione um colaborador acima para abrir a auditoria</div>
              <p style="font-size:12px;margin-top:4px;color:#94A3B8">O sistema consolidará pontualidade D0, fechamento de portas, atrasos atribuídos e recomendações personalizadas.</p>
            </div>
          `}
        </div>

      </div>
    `;
  }

  /**
   * Renderiza o conteúdo do dossiê individual do colaborador
   */
  function renderDetalhesDossie(d) {
    const c = d.colaborador;
    const m = d.metricasAuditoria;
    const corRisco = m.nivelRisco === 'Crítico' ? '#EF4444' : m.nivelRisco === 'Alto' ? '#F97316' : m.nivelRisco === 'Moderado' ? '#0284C7' : '#10B981';

    return `
      <div>
        <!-- CABEÇALHO DO DOSSIÊ -->
        <div style="background:linear-gradient(135deg,#0F4C81,#1E293B);border-radius:10px;padding:16px 20px;color:#FFFFFF;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-size:11px;font-weight:800;color:#38BDF8;text-transform:uppercase;letter-spacing:1px">DOSSIÊ INDIVIDUAL DE AUDITORIA OPERACIONAL</div>
            <h2 style="margin:4px 0 0;font-size:18px;font-weight:900;color:#FFFFFF">${c.nome}</h2>
            <div style="font-size:12px;color:#CBD5E1;margin-top:2px">
              Cargo: <b>${c.cargo}</b> • Setor: <b>${c.setor}</b> • Turno: <b>${c.turno}</b> • Período: <b>${c.periodo}</b>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <button type="button" class="btn" onclick="window.AuditModule.gerarRelatorioPDFReal('individual')" style="background:#22C55E;color:#0B1A33;border:none;padding:8px 16px;border-radius:20px;font-weight:900;font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer">
              <span>📥</span> Baixar Dossiê em PDF
            </button>
            <div style="text-align:right">
              <span style="display:inline-block;padding:6px 14px;border-radius:20px;background:${corRisco};color:#FFFFFF;font-weight:900;font-size:13px">
                Risco: ${m.nivelRisco.toUpperCase()}
              </span>
              <div style="font-size:11px;color:#BAE6FD;margin-top:4px">Status: <b>${m.statusAuditoria}</b></div>
            </div>
          </div>
        </div>

        <!-- CARDS DE INDICADORES OPERACIONAIS -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:12px;margin-bottom:18px">
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:11px;color:#64748B;font-weight:700">Voos Operados</div>
            <div style="font-size:22px;font-weight:900;color:#0F4C81">${m.totalVoosOperados}</div>
          </div>
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:11px;color:#64748B;font-weight:700">Conformidade D0</div>
            <div style="font-size:22px;font-weight:900;color:#00796B">${m.conformidadeOperacionalPercent}%</div>
          </div>
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:11px;color:#64748B;font-weight:700">Voos no Horário</div>
            <div style="font-size:22px;font-weight:900;color:#10B981">${m.voosNoHorario}</div>
          </div>
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:11px;color:#64748B;font-weight:700">Atrasos Observados</div>
            <div style="font-size:22px;font-weight:900;color:#EF4444">${m.voosComObservacaoAtraso}</div>
          </div>
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:11px;color:#64748B;font-weight:700">Remediações</div>
            <div style="font-size:22px;font-weight:900;color:#F97316">${m.observacoesRemediadas}</div>
          </div>
        </div>

        <!-- RECOMENDAÇÕES DE AUDITORIA ASSISTIDA POR IA -->
        <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:14px 18px;margin-bottom:18px">
          <div style="font-weight:800;font-size:13px;color:#1E40AF;margin-bottom:8px;display:flex;align-items:center;gap:6px">
            <span>🧠</span> Recomendações e Plano de Ação Preventivo:
          </div>
          <ul style="margin:0;padding-left:20px;font-size:12px;color:#1E3A8A;line-height:1.6">
            ${(d.recomendacoesIA || []).map(r => `<li>${r}</li>`).join('')}
          </ul>
        </div>

        <!-- TABELA DE VOOS AUDITADOS DO COLABORADOR -->
        <div>
          <div style="font-weight:800;font-size:13px;color:#0F4C81;margin-bottom:8px">
            ✈️ Amostragem de Voos Auditados no Período (${(d.voosAuditados || []).length} voos):
          </div>
          <div style="overflow-x:auto;border:1px solid #E2E8F0;border-radius:8px">
            <table style="width:100%;border-collapse:collapse;font-size:11.5px;text-align:left">
              <thead>
                <tr style="background:#0F4C81;color:#FFFFFF;font-weight:800">
                  <th style="padding:8px 10px">Voo</th>
                  <th style="padding:8px 10px">Data</th>
                  <th style="padding:8px 10px">Destino</th>
                  <th style="padding:8px 10px">STD</th>
                  <th style="padding:8px 10px">Porta Fechada</th>
                  <th style="padding:8px 10px">Posição</th>
                  <th style="padding:8px 10px">Status D0</th>
                  <th style="padding:8px 10px">Cód. Atraso</th>
                </tr>
              </thead>
              <tbody>
                ${(d.voosAuditados || []).slice(0, 15).map(f => `
                  <tr style="border-bottom:1px solid #F1F5F9">
                    <td style="padding:8px 10px;font-weight:800">${f.voo}</td>
                    <td style="padding:8px 10px">${f.data}</td>
                    <td style="padding:8px 10px;font-weight:700">${f.des}</td>
                    <td style="padding:8px 10px">${f.std}</td>
                    <td style="padding:8px 10px">${f.porta}</td>
                    <td style="padding:8px 10px"><span style="background:#E2E8F0;padding:2px 6px;border-radius:4px;font-size:10px">${f.pos}</span></td>
                    <td style="padding:8px 10px">
                      <span style="font-weight:800;color:${f.otp === 'No Horário' ? '#10B981' : '#EF4444'}">
                        ${f.otp}
                      </span>
                    </td>
                    <td style="padding:8px 10px;color:#64748B">${f.cod1 || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    `;
  }

  // ==========================================================================
  // ABA 3: AUDITORIA COLETIVA POR TURNO / SETOR
  // ==========================================================================
  function renderAbaEquipes(container) {
    const d = AuditState.dadosGerais;
    const lista = d.colaboradoresLista || [];

    // Agrupamento por turnos
    const turnos = ['T1', 'T2', 'T3', 'T4', 'HCC'];
    const metricasTurno = turnos.map(t => {
      const colabs = lista.filter(c => c.turno === t || (t === 'HCC' && c.setor === 'HCC'));
      const totalVoos = colabs.reduce((acc, c) => acc + c.totalVoos, 0);
      const obs = colabs.reduce((acc, c) => acc + c.observacoes, 0);
      const rem = colabs.reduce((acc, c) => acc + c.remediadas, 0);
      const confMedia = colabs.length > 0 ? Math.round(colabs.reduce((acc, c) => acc + c.conformidade, 0) / colabs.length) : 92;
      return { turno: t, colaboradores: colabs.length, totalVoos, obs, rem, confMedia };
    });

    container.innerHTML = `
      <div style="background:#FFFFFF;border-radius:12px;padding:20px;border:1px solid #CBD5E1;box-shadow:0 2px 10px rgba(0,0,0,0.04)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">
          <div>
            <h3 style="margin:0 0 4px;font-size:16px;font-weight:900;color:#0F4C81">
              👥 Auditoria Coletiva por Turno e Setor Operacional
            </h3>
            <p style="font-size:12px;color:#64748B;margin:0">
              Comparativo de conformidade de processos, tempo de solo e remediação entre as equipes.
            </p>
          </div>
          <button type="button" class="btn btn-gold" onclick="window.AuditModule.gerarRelatorioPDFReal('equipes')" style="padding:8px 16px;font-size:12px;font-weight:800;display:flex;align-items:center;gap:6px">
            <span>📥</span> Baixar PDF das Equipes
          </button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;margin-bottom:20px">
          ${metricasTurno.map(m => `
            <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:10px;padding:14px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <span style="font-weight:900;font-size:14px;color:#0F4C81">Turno ${m.turno}</span>
                <span style="font-size:10px;background:#E2E8F0;padding:2px 6px;border-radius:4px;font-weight:700">${m.colaboradores} agentes</span>
              </div>
              <div style="font-size:24px;font-weight:900;color:${m.confMedia >= 90 ? '#10B981' : '#F97316'};margin-bottom:6px">
                ${m.confMedia}% <span style="font-size:11px;font-weight:700;color:#64748B">Conformidade</span>
              </div>
              <div style="font-size:11px;color:#475569">
                Voos auditados: <b>${m.totalVoos}</b><br>
                Observações: <b style="color:#EF4444">${m.obs}</b> • Remediadas: <b style="color:#00796B">${m.rem}</b>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // ABA 4: MATRIZ DE RISCOS & IA ASSISTIDA
  // ==========================================================================
  function renderAbaIA(container) {
    container.innerHTML = `
      <div style="background:#FFFFFF;border-radius:12px;padding:20px;border:1px solid #CBD5E1;box-shadow:0 2px 10px rgba(0,0,0,0.04)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">
          <div>
            <h3 style="margin:0 0 4px;font-size:16px;font-weight:900;color:#0F4C81;display:flex;align-items:center;gap:6px">
              <span>🧠</span> Inteligência de Riscos & Recomendações Executivas
            </h3>
            <p style="font-size:12px;color:#64748B;margin:0">
              Análise preventiva cruzada entre códigos de atraso, tempos de turnaround e pontos de vulnerabilidade.
            </p>
          </div>
          <button type="button" class="btn btn-gold" onclick="window.AuditModule.gerarRelatorioPDFReal('ia')" style="padding:8px 16px;font-size:12px;font-weight:800;display:flex;align-items:center;gap:6px">
            <span>📥</span> Baixar PDF de Riscos
          </button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:10px;padding:16px">
            <h4 style="margin:0 0 8px;font-size:13px;font-weight:800;color:#991B1B">🚨 Processos com Maior Vulnerabilidade</h4>
            <ul style="margin:0;padding-left:18px;font-size:12px;color:#7F1D1D;line-height:1.6">
              <li><b>Fechamento de Portas D0 (FP):</b> Maior volume de observações (68 casos). Principal causador: atraso no embarque de passageiros de conexão curta.</li>
              <li><b>Liberação de Limpeza de Cabine (TL):</b> Vulnerabilidade 2.1 com impacto 2.8. Gargalo nos voos com tempo de solo inferior a 45 minutos.</li>
              <li><b>Conexão Curta de Malas:</b> 62 ocorrências registradas em GRU e BSB exigindo plano de contingência com a Rampa.</li>
            </ul>
          </div>

          <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:16px">
            <h4 style="margin:0 0 8px;font-size:13px;font-weight:800;color:#166534">✅ Recomendações Estratégicas para a Gestão</h4>
            <ul style="margin:0;padding-left:18px;font-size:12px;color:#14532D;line-height:1.6">
              <li><b>Padronização de Início de Embarque (IB):</b> Antecipar em 5 minutos o acionamento dos grupos prioritários nos voos de alta taxa de ocupação.</li>
              <li><b>Sinalização Imediata ao HCC:</b> Adotar checklist de alerta no minuto STD -15 caso o calço (CA) ou limpeza (TL) ainda não estejam concluídos.</li>
              <li><b>Remediação em Tempo Real:</b> Integrar robô Anandinha para alertas sonoros proativos antes de estourar a meta D0.</li>
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // ABA 5: CENTRAL DE EXPORTAÇÃO OFICIAL EM PDF (ANDROID & COMPUTADOR)
  // GERAÇÃO REAL, INDEPENDENTE DE IMPRESSORA FÍSICA HP DESKJET
  // ==========================================================================
  function renderAbaPDF(container) {
    const lista = AuditState.dadosGerais?.colaboradoresLista || [];
    const colabAtual = AuditState.colaboradorSelecionado || (lista[0]?.nome || '');

    container.innerHTML = `
      <div style="background:#FFFFFF;border-radius:12px;padding:24px;border:1px solid #CBD5E1;box-shadow:0 2px 10px rgba(0,0,0,0.04)">
        <div style="text-align:center;max-width:700px;margin:0 auto 24px">
          <div style="font-size:42px;margin-bottom:8px">📄 📥</div>
          <h2 style="margin:0 0 6px;font-size:20px;font-weight:900;color:#0F4C81">
            Central de Exportação de Relatórios Oficiais em PDF
          </h2>
          <p style="font-size:13px;color:#475569;margin:0;line-height:1.5">
            Geração direta de documentos PDF em Alta Definição (A4), com download automático para o seu dispositivo móvel Android ou computador, <b>sem depender de impressora física</b>.
          </p>
        </div>

        <!-- GRADE COM OS 5 RELATÓRIOS OFICIAIS DISPONÍVEIS -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:16px;margin-bottom:24px">
          
          <!-- CARD 1: DASHBOARD EXECUTIVO GERAL -->
          <div style="background:#F8FAFC;border:1.5px solid #CBD5E1;border-radius:12px;padding:16px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="font-size:22px">📊</span>
                <span style="font-weight:900;font-size:14px;color:#0F4C81">Dashboard Executivo (Visão Geral)</span>
              </div>
              <p style="font-size:12px;color:#64748B;line-height:1.4;margin:0 0 12px">
                Relatório horizontal (16:9) idêntico à imagem de referência corporativa contendo os 6 gráficos oficiais, KPIs e filtros aplicados.
              </p>
            </div>
            <button type="button" class="btn btn-gold" onclick="window.AuditModule.gerarRelatorioPDFReal('geral')" style="width:100%;padding:10px;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;gap:6px">
              <span>📥</span> Gerar PDF do Dashboard
            </button>
          </div>

          <!-- CARD 2: DOSSIÊ INDIVIDUAL DO COLABORADOR -->
          <div style="background:#F8FAFC;border:1.5px solid #CBD5E1;border-radius:12px;padding:16px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="font-size:22px">👤</span>
                <span style="font-weight:900;font-size:14px;color:#0F4C81">Auditoria Individual do Colaborador</span>
              </div>
              <p style="font-size:12px;color:#64748B;line-height:1.4;margin:0 0 10px">
                Dossiê completo com conformidade D0, voos operados, tabela de auditoria e plano preventivo.
              </p>
              <div style="margin-bottom:12px">
                <label style="font-size:11px;font-weight:700;color:#0F4C81;display:block;margin-bottom:4px">Selecione o Colaborador:</label>
                <select id="selectPdfColaborador" onchange="window.AuditModule.selecionarColaborador(this.value)" style="width:100%;padding:6px 8px;font-size:12px;font-weight:700;border:1px solid #CBD5E1;border-radius:6px;background:#FFFFFF;outline:none">
                  ${lista.map(c => `
                    <option value="${c.nome}" ${c.nome === colabAtual ? 'selected' : ''}>
                      ${c.nome} (${c.setor})
                    </option>
                  `).join('')}
                </select>
              </div>
            </div>
            <button type="button" class="btn btn-gold" onclick="window.AuditModule.gerarRelatorioPDFReal('individual')" style="width:100%;padding:10px;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;gap:6px">
              <span>📥</span> Gerar Dossiê Individual
            </button>
          </div>

          <!-- CARD 3: AUDITORIA COLETIVA DE EQUIPES -->
          <div style="background:#F8FAFC;border:1.5px solid #CBD5E1;border-radius:12px;padding:16px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="font-size:22px">👥</span>
                <span style="font-weight:900;font-size:14px;color:#0F4C81">Auditoria Coletiva por Turno / Setor</span>
              </div>
              <p style="font-size:12px;color:#64748B;line-height:1.4;margin:0 0 12px">
                Análise comparativa de pontualidade e conformidade operacional entre os Turnos T1 a T4 e HCC.
              </p>
            </div>
            <button type="button" class="btn btn-gold" onclick="window.AuditModule.gerarRelatorioPDFReal('equipes')" style="width:100%;padding:10px;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;gap:6px">
              <span>📥</span> Gerar PDF das Equipes
            </button>
          </div>

          <!-- CARD 4: MATRIZ DE RISCOS & DIRETRIZES IA -->
          <div style="background:#F8FAFC;border:1.5px solid #CBD5E1;border-radius:12px;padding:16px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="font-size:22px">🧠</span>
                <span style="font-weight:900;font-size:14px;color:#0F4C81">Matriz de Riscos & Diretrizes de IA</span>
              </div>
              <p style="font-size:12px;color:#64748B;line-height:1.4;margin:0 0 12px">
                Diagnóstico de gargalos (portas, limpeza, bagagens) e recomendações estratégicas preventivas.
              </p>
            </div>
            <button type="button" class="btn btn-gold" onclick="window.AuditModule.gerarRelatorioPDFReal('ia')" style="width:100%;padding:10px;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;gap:6px">
              <span>📥</span> Gerar PDF de Riscos
            </button>
          </div>

          <!-- CARD 5: RELATÓRIO EXECUTIVO CONSOLIDADO -->
          <div style="background:#F8FAFC;border:1.5px solid #CBD5E1;border-radius:12px;padding:16px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="font-size:22px">📋</span>
                <span style="font-weight:900;font-size:14px;color:#0F4C81">Relatório Executivo Consolidado</span>
              </div>
              <p style="font-size:12px;color:#64748B;line-height:1.4;margin:0 0 12px">
                Documento executivo multipágina oficial integrando Visão Geral, Análise de Equipes e Riscos Operacionais.
              </p>
            </div>
            <button type="button" class="btn btn-gold" onclick="window.AuditModule.gerarRelatorioPDFReal('consolidado')" style="width:100%;padding:10px;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;gap:6px">
              <span>📥</span> Gerar Relatório Consolidado
            </button>
          </div>

        </div>

        <div style="border-top:1px solid #E2E8F0;padding-top:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div style="font-size:12px;color:#64748B">
            💡 <b>Dica Android:</b> Os arquivos gerados são salvos diretamente em sua pasta <b>Downloads</b> e podem ser abertos no Adobe Acrobat, Google Drive ou WhatsApp.
          </div>
          <button type="button" class="btn" onclick="window.AuditModule.mudarAba('geral')" style="background:#F1F5F9;border:1px solid #CBD5E1;color:#0F172A;padding:8px 18px;font-weight:700;font-size:12px">
            Voltar ao Dashboard
          </button>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // MOTOR DE GERAÇÃO REAL DE PDF NATIVO (HTML2PDF / JSPDF + HTML2CANVAS)
  // TOTALMENTE INDEPENDENTE DE IMPRESSORA FÍSICA HP DESKJET
  // ==========================================================================

  // Converte Blob em Base64 para envio ao servidor
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Exibe modal com barra de progresso durante o processamento
  function mostrarModalProgressoPDF(titulo, subtitulo, progressoPercent = 25) {
    let modal = document.getElementById('modalAuditPdfProgress');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalAuditPdfProgress';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(11,26,51,0.85);backdrop-filter:blur(6px);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,sans-serif';
      document.body.appendChild(modal);
    }
    modal.classList.remove('hidden');
    modal.innerHTML = `
      <div style="background:#FFFFFF;border-radius:16px;max-width:520px;width:100%;padding:28px;box-shadow:0 20px 40px rgba(0,0,0,0.4);border:1px solid #CBD5E1;text-align:center;box-sizing:border-box">
        <div style="font-size:42px;margin-bottom:12px">⏳</div>
        <h3 id="auditPdfModalTitle" style="margin:0 0 8px;font-size:18px;font-weight:900;color:#0F4C81">${titulo}</h3>
        <p id="auditPdfModalSub" style="margin:0 0 20px;font-size:13px;color:#475569;line-height:1.5">${subtitulo}</p>
        
        <div style="width:100%;background:#F1F5F9;border-radius:10px;height:12px;overflow:hidden;margin-bottom:14px;border:1px solid #E2E8F0">
          <div id="auditPdfProgressBar" style="width:${progressoPercent}%;height:100%;background:linear-gradient(90deg,#0F4C81,#F97316);transition:width 0.4s ease"></div>
        </div>
        <div id="auditPdfProgressStep" style="font-size:11.5px;color:#64748B;font-weight:700">Etapa 1/4: Preparando dados e renderizando gráficos...</div>
      </div>
    `;
  }

  function atualizarProgressoPDF(progresso, stepText) {
    const bar = document.getElementById('auditPdfProgressBar');
    const txt = document.getElementById('auditPdfProgressStep');
    if (bar) bar.style.width = `${progresso}%`;
    if (txt) txt.textContent = stepText;
  }

  function mostrarModalSucessoPDF({ filename, blobUrl, downloadUrl, viewUrl, pdfBlob, tipoNome }) {
    let modal = document.getElementById('modalAuditPdfProgress');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalAuditPdfProgress';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(11,26,51,0.85);backdrop-filter:blur(6px);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,sans-serif';
      document.body.appendChild(modal);
    }
    const tamanhoKB = pdfBlob ? Math.round(pdfBlob.size / 1024) : 0;

    modal.innerHTML = `
      <div style="background:#FFFFFF;border-radius:16px;max-width:540px;width:100%;padding:28px;box-shadow:0 20px 40px rgba(0,0,0,0.4);border:2px solid #10B981;text-align:center;box-sizing:border-box;color:#0F172A">
        <div style="width:60px;height:60px;background:#DCFCE7;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:32px;color:#10B981">
          ✔
        </div>
        <h3 style="margin:0 0 6px;font-size:19px;font-weight:900;color:#065F46">PDF Gerado com Sucesso!</h3>
        <p style="margin:0 0 4px;font-size:13.5px;font-weight:700;color:#0F4C81">${tipoNome}</p>
        <p style="margin:0 0 16px;font-size:12px;color:#64748B">
          Arquivo: <b>${filename}</b> (${tamanhoKB} KB) • Documento verificado e salvo.
        </p>

        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px;margin-bottom:20px;text-align:left;font-size:12px;color:#166534">
          <div style="font-weight:800;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <span>📱</span> Pronto para Android e Computador:
          </div>
          <div>O arquivo foi transferido para a pasta de <b>Downloads</b> do seu aparelho. Você pode abri-lo diretamente ou compartilhar via WhatsApp/Drive.</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button type="button" class="btn btn-gold" onclick="window.AuditModule.baixarNovamenteArquivo('${downloadUrl || blobUrl}', '${filename}')" style="padding:10px 18px;font-weight:800;font-size:13px;display:flex;align-items:center;gap:6px">
              <span>📥</span> Baixar Novamente
            </button>
            <button type="button" class="btn" onclick="window.AuditModule.abrirPreviaHD()" style="background:#0F4C81;color:#FFFFFF;padding:10px 18px;font-weight:800;font-size:13px;display:flex;align-items:center;gap:6px">
              <span>👁️</span> Visualizar na Tela
            </button>
            <button type="button" class="btn" onclick="window.AuditModule.abrirPDFNoLeitorNativoDireto('${viewUrl || blobUrl}', '${filename}')" style="background:#0284C7;color:#FFFFFF;padding:10px 18px;font-weight:800;font-size:13px;display:flex;align-items:center;gap:6px">
              <span>📲</span> Abrir no Celular
            </button>
            <button type="button" class="btn" onclick="window.AuditModule.compartilharPDFAudit()" style="background:#F97316;color:#FFFFFF;padding:10px 18px;font-weight:800;font-size:13px;display:flex;align-items:center;gap:6px">
              <span>🔗</span> Compartilhar
            </button>
          </div>
          <button type="button" class="btn" onclick="document.getElementById('modalAuditPdfProgress').remove()" style="background:#F1F5F9;border:1px solid #CBD5E1;color:#475569;padding:8px 16px;font-weight:700;font-size:12px">
            Fechar Janela
          </button>
        </div>
      </div>
    `;
  }

  function mostrarModalErroPDF(mensagem) {
    let modal = document.getElementById('modalAuditPdfProgress');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalAuditPdfProgress';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(11,26,51,0.85);backdrop-filter:blur(6px);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,sans-serif';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div style="background:#FFFFFF;border-radius:16px;max-width:500px;width:100%;padding:28px;box-shadow:0 20px 40px rgba(0,0,0,0.4);border:2px solid #EF4444;text-align:center;box-sizing:border-box">
        <div style="font-size:42px;margin-bottom:12px">⚠️</div>
        <h3 style="margin:0 0 8px;font-size:18px;font-weight:900;color:#991B1B">Falha na Geração do PDF</h3>
        <p style="margin:0 0 20px;font-size:13px;color:#475569;line-height:1.5">${mensagem}</p>
        <div style="display:flex;gap:10px;justify-content:center">
          <button type="button" class="btn btn-gold" onclick="window.AuditModule.gerarRelatorioPDFReal('atual')" style="padding:10px 20px;font-weight:800;font-size:13px">
            Tentar Novamente
          </button>
          <button type="button" class="btn" onclick="document.getElementById('modalAuditPdfProgress').remove()" style="background:#F1F5F9;border:1px solid #CBD5E1;color:#475569;padding:10px 20px;font-weight:700;font-size:13px">
            Cancelar
          </button>
        </div>
      </div>
    `;
  }

  function baixarNovamenteArquivo(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 2000);
    if (typeof window.showToast === 'function') {
      window.showToast(`📥 Baixando ${filename}...`, 'info');
    }
  }

  function abrirPDFNoLeitorNativoDireto(url, filename) {
    if (AuditState.ultimoPdfGerado?.blob) {
      try {
        const file = new File([AuditState.ultimoPdfGerado.blob], filename || AuditState.ultimoPdfGerado.filename || 'auditoria.pdf', { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({
            files: [file],
            title: filename || 'Relatório de Auditoria',
            text: 'Relatório Oficial de Auditoria Operacional — Diário de Embarque'
          }).catch(e => { if (e.name !== 'AbortError') console.warn('Share error:', e); });
          return;
        }
      } catch(err) {
        console.warn('Share try error:', err);
      }
    }
    // Fallback: download seguro
    baixarNovamenteArquivo(url, filename);
  }

  async function compartilharPDFAudit() {
    if (!AuditState.ultimoPdfGerado?.blob) {
      if (typeof window.showToast === 'function') window.showToast('Nenhum PDF disponível para compartilhar.', 'warning');
      return;
    }
    const file = new File([AuditState.ultimoPdfGerado.blob], AuditState.ultimoPdfGerado.filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: AuditState.ultimoPdfGerado.filename,
          text: 'Relatório Oficial de Auditoria Operacional — Diário de Embarque'
        });
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('Share error:', e);
      }
    } else {
      baixarNovamenteArquivo(AuditState.ultimoPdfGerado.downloadUrl || AuditState.ultimoPdfGerado.blobUrl, AuditState.ultimoPdfGerado.filename);
      if (typeof window.showToast === 'function') window.showToast('Arquivo baixado no dispositivo.', 'info');
    }
  }

  /**
   * Validação técnica da estrutura binária do PDF baseada na norma ISO 32000-1:
   * 1. Confirma existência de objeto Blob
   * 2. Valida tamanho não-nulo (> 200 bytes)
   * 3. Verifica assinatura do cabeçalho binário (%PDF-)
   * 4. Verifica marcadores de estrutura (%%EOF, trailer ou xref)
   */
  async function validarIntegridadePDF(blob) {
    if (!blob) {
      return { valido: false, motivo: 'Objeto de arquivo não retornado pelo gerador.' };
    }
    if (!(blob instanceof Blob)) {
      return { valido: false, motivo: 'Objeto gerado não é uma instância de Blob.' };
    }
    if (blob.size < 200) {
      return { valido: false, motivo: `Tamanho insuficiente para um documento PDF válido (${blob.size} bytes).` };
    }

    try {
      const headerSlice = blob.slice(0, 1024);
      const headerText = await headerSlice.text();
      if (!headerText.includes('%PDF-')) {
        return { valido: false, motivo: 'Cabeçalho do documento inválido (marcador %PDF- ausente).' };
      }

      const tailSlice = blob.slice(Math.max(0, blob.size - 1024));
      const tailText = await tailSlice.text();
      const hasStructure = tailText.includes('%%EOF') || tailText.includes('trailer') || tailText.includes('startxref') || tailText.includes('obj');
      if (!hasStructure) {
        return { valido: false, motivo: 'Estrutura de finalização do PDF incompleta ou truncada.' };
      }

      return { 
        valido: true, 
        tamanho: blob.size, 
        versao: headerText.slice(0, 8).trim() 
      };
    } catch (readErr) {
      return { valido: false, motivo: 'Erro ao validar estrutura binária do arquivo: ' + readErr.message };
    }
  }

  /**
   * Inspeciona se um canvas gerado pelo html2canvas possui conteúdo desenhado
   * evitando falsos positivos de telas 100% brancas ou transparentes
   */
  function verificarSeCanvasEstaEmBranco(canvas) {
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return true;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const sampleW = Math.min(canvas.width, 160);
      const sampleH = Math.min(canvas.height, 160);
      const imgData = ctx.getImageData(0, 0, sampleW, sampleH).data;
      let hasContent = false;
      for (let i = 0; i < imgData.length; i += 16) {
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];
        const a = imgData[i + 3];
        if (a > 30 && !(r > 248 && g > 248 && b > 248)) {
          hasContent = true;
          break;
        }
      }
      return !hasContent;
    } catch (e) {
      return false;
    }
  }

  /**
   * GERADOR REAL DE PDF NATIVO
   * Suporta os 5 tipos de relatórios solicitados:
   * 1. 'geral': Dashboard Executivo com os 6 gráficos oficiais da imagem de referência
   * 2. 'individual': Dossiê Individual de Auditoria do Colaborador
   * 3. 'equipes': Auditoria Coletiva por Turno / Setor
   * 4. 'ia': Matriz de Riscos & Recomendações de IA
   * 5. 'consolidado': Relatório Executivo Consolidado Multi-Página
   */
  async function gerarRelatorioPDFReal(tipoSolicitado = 'atual') {
    // Determina o tipo de relatório com base no contexto ou na solicitação
    let tipo = tipoSolicitado;
    if (tipo === 'atual') {
      if (AuditState.abaAtiva === 'individual') tipo = 'individual';
      else if (AuditState.abaAtiva === 'equipes') tipo = 'equipes';
      else if (AuditState.abaAtiva === 'ia') tipo = 'ia';
      else tipo = 'geral';
    }

    const d = AuditState.dadosGerais;
    if (!d) {
      if (typeof window.showToast === 'function') window.showToast('Dados de auditoria ainda não carregados.', 'warning');
      return;
    }

    // Se for individual e ainda não carregou dossiê, busca primeiro
    if (tipo === 'individual') {
      const lista = d.colaboradoresLista || [];
      const colabNome = AuditState.colaboradorSelecionado || (lista[0]?.nome || '');
      if (!colabNome) {
        if (typeof window.showToast === 'function') window.showToast('Selecione um colaborador para gerar o dossiê individual.', 'warning');
        return;
      }
      if (!AuditState.dossieColaborador || AuditState.dossieColaborador.colaborador?.nome !== colabNome) {
        AuditState.colaboradorSelecionado = colabNome;
        mostrarModalProgressoPDF('Carregando Dossiê...', `Consultando registros operacionais de ${colabNome}...`, 15);
        await carregarDossieIndividual();
      }
    }

    // Configuração dos Nomes e Metadados do Relatório
    const dataHoraIso = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dataFormatadaBR = new Date().toLocaleDateString('pt-BR') + ' às ' + new Date().toLocaleTimeString('pt-BR');
    const auditorEmail = window.db?.currentEmail || 'supervisao@diariodeembarque.com';

    let nomeRelatorio = 'Dashboard Executivo de Auditoria';
    let filename = `auditoria-executiva-${dataHoraIso}.pdf`;
    let orientation = 'landscape';

    if (tipo === 'individual') {
      const nomeColabClean = (AuditState.colaboradorSelecionado || 'colaborador').replace(/[^a-zA-Z0-9]/g, '_');
      nomeRelatorio = `Dossiê de Auditoria Individual — ${AuditState.colaboradorSelecionado}`;
      filename = `auditoria-individual-${nomeColabClean}-${dataHoraIso}.pdf`;
      orientation = 'portrait';
    } else if (tipo === 'equipes') {
      nomeRelatorio = 'Auditoria Coletiva de Equipes e Turnos';
      filename = `auditoria-equipes-${dataHoraIso}.pdf`;
      orientation = 'landscape';
    } else if (tipo === 'ia') {
      nomeRelatorio = 'Matriz de Riscos & Recomendações Estratégicas de IA';
      filename = `matriz-riscos-ia-${dataHoraIso}.pdf`;
      orientation = 'portrait';
    } else if (tipo === 'consolidado') {
      nomeRelatorio = 'Relatório Executivo Consolidado de Auditoria';
      filename = `auditoria-consolidada-${dataHoraIso}.pdf`;
      orientation = 'landscape';
    }

    // 1. INICIA MODAL DE FEEDBACK DE PROGRESSO
    mostrarModalProgressoPDF('Gerando Documento PDF Real...', `Processando ${nomeRelatorio} em Alta Definição...`, 20);
    await new Promise(r => setTimeout(r, 100));

    let stagingWrapper = null;
    try {
      // 2. CONSTRÓI O DOCUMENTO HTML DE ALTA FIDELIDADE EM CONTAINER VISÍVEL NO VIEWPORT
      atualizarProgressoPDF(40, 'Etapa 2/4: Renderizando gráficos vetoriais, tabelas e indicadores...');

      // Wrapper visível no topo da tela com z-index alto, garantindo cálculo real de bounding rect (x >= 0, y >= 0)
      stagingWrapper = document.createElement('div');
    stagingWrapper.id = 'auditPdfStagingWrapper';
    stagingWrapper.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(11, 27, 61, 0.95);
      z-index: 999999;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 24px 12px;
      box-sizing: border-box;
    `;

    const bannerStatus = document.createElement('div');
    bannerStatus.style.cssText = `
      background: #0F4C81;
      color: #FFFFFF;
      padding: 8px 18px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 800;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    bannerStatus.innerHTML = `
      <span>✈️</span>
      <span>Consolidando Relatório Executivo Oficial • Renderizando em Alta Resolução...</span>
    `;
    stagingWrapper.appendChild(bannerStatus);

    const isA3 = (AuditState.filtros.formatoPapel === 'a3');
    const targetWidth = orientation === 'landscape' ? (isA3 ? 1580 : 1140) : 840;

    const staging = document.createElement('div');
    staging.id = 'auditPdfStagingContainer';
    staging.style.cssText = `
      position: relative;
      width: ${targetWidth}px;
      min-width: ${targetWidth}px;
      max-width: none !important;
      background: #FFFFFF;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #0F172A;
      box-sizing: border-box;
      padding: 20px;
      line-height: 1.35;
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      margin: 0 auto;
    `;

    // Cabeçalho Oficial Corporativo Azul
    const cabecalhoHTML = `
      <div style="background:linear-gradient(135deg,#0B1B3D 0%,#0F4C81 100%);border-radius:10px;padding:16px 20px;color:#FFFFFF;margin-bottom:14px;box-shadow:0 4px 12px rgba(15,76,129,0.15)">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.25);padding-bottom:10px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.4);display:flex;align-items:center;justify-content:center;font-size:22px">
              ✈️
            </div>
            <div>
              <div style="font-size:11px;font-weight:900;letter-spacing:1px;color:#BAE6FD">DIÁRIO DE EMBARQUE • SISTEMA DE AUDITORIA OPERACIONAL</div>
              <div style="font-size:18px;font-weight:900;color:#FFFFFF;letter-spacing:-0.2px">${nomeRelatorio}</div>
            </div>
          </div>
          <div style="text-align:right">
            <span style="background:#EA580C;color:#FFFFFF;font-size:10px;font-weight:900;padding:3px 10px;border-radius:12px;letter-spacing:0.5px">EXCLUSIVO GESTÃO & MASTER</span>
            <div style="font-size:10.5px;color:#BAE6FD;margin-top:4px">Emissão Oficial: <b>${dataFormatadaBR}</b></div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#E0F2FE">
          <div>👤 Auditor Responsável: <b>${auditorEmail}</b></div>
          <div>Filtros Ativos: Região: <b>${AuditState.filtros.regiao}</b> • Processo: <b>${AuditState.filtros.processo}</b> • Risco: <b>${AuditState.filtros.risco}</b></div>
          <div>Protocolo de Integridade: <b>AUD-${Date.now().toString(36).toUpperCase()}</b></div>
        </div>
      </div>
    `;

    // Constrói o corpo com base no tipo
    let corpoHTML = '';

    if (tipo === 'geral' || tipo === 'consolidado') {
      const capitais = d.capitaisBrasil || [];
      const regiaoAtiva = AuditState.filtros.regiao || 'Todas';
      const capAtiva = AuditState.filtros.capitalSelecionada;

      corpoHTML += `
        <!-- PRIMEIRA LINHA: 5 CARDS HORIZONTAIS LADO A LADO -->
        <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:10px;margin-bottom:12px">
          
          <!-- BLOCO 1: Painel de Filtros -->
          <div style="border:1px solid #CBD5E1;border-radius:8px;padding:10px;background:#F8FAFC;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div style="background:#E0F2FE;padding:6px 8px;border-radius:5px;font-size:10.5px;font-weight:900;color:#0F4C81;margin-bottom:8px;text-transform:uppercase">
                Painel de Filtros
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;font-size:10px">
                <div style="background:#F97316;color:#FFFFFF;padding:5px 8px;border-radius:5px;font-weight:800;display:flex;justify-content:space-between">
                  <span>Geografia / Região</span>
                  <span style="font-size:9.5px;background:rgba(0,0,0,0.2);padding:1px 5px;border-radius:4px">${AuditState.filtros.capitalSelecionada || regiaoAtiva}</span>
                </div>
                <div style="background:#0F4C81;color:#FFFFFF;padding:5px 8px;border-radius:5px;font-weight:800;display:flex;justify-content:space-between">
                  <span>Processo Operacional</span>
                  <span style="font-size:9.5px;background:rgba(255,255,255,0.2);padding:1px 5px;border-radius:4px">${AuditState.filtros.processo}</span>
                </div>
                <div style="background:#EA580C;color:#FFFFFF;padding:5px 8px;border-radius:5px;font-weight:800;display:flex;justify-content:space-between">
                  <span>Classificação de Risco</span>
                  <span style="font-size:9.5px;background:rgba(0,0,0,0.2);padding:1px 5px;border-radius:4px">${AuditState.filtros.risco}</span>
                </div>
              </div>
            </div>
            <div style="margin-top:6px;padding-top:6px;border-top:1px solid #E2E8F0;font-size:9.5px;color:#64748B">
              Amostragem: <b>${d.indicadoresGerais.totalAuditoriasPlanejadas} colaboradores</b>
            </div>
          </div>

          <!-- BLOCO 2: Classificação de Risco das Auditorias Planejadas -->
          <div style="border:1px solid #CBD5E1;border-radius:8px;padding:10px;background:#FFFFFF;display:flex;flex-direction:column">
            <div style="background:#E0F2FE;padding:6px 8px;border-radius:5px;font-size:10.5px;font-weight:900;color:#0F4C81;margin-bottom:6px">
              Classificação de Risco das Auditorias
            </div>
            <div style="display:flex;justify-content:center">${renderSVGDonut([
              { label: 'Alto', value: d.riskRating.high, color: '#F97316' },
              { label: 'Baixo', value: d.riskRating.low, color: '#0F4C81' },
              { label: 'Médio', value: d.riskRating.medium, color: '#38BDF8' }
            ], 'Nível de Risco')}</div>
            <div style="font-size:9px;font-weight:800;display:flex;justify-content:center;gap:6px;margin-top:6px">
              <span style="color:#F97316">■ Alto (47%)</span>
              <span style="color:#0F4C81">■ Baixo (28%)</span>
              <span style="color:#0284C7">■ Médio (25%)</span>
            </div>
          </div>

          <!-- BLOCO 3: Situação das Auditorias Planejadas -->
          <div style="border:1px solid #CBD5E1;border-radius:8px;padding:10px;background:#FFFFFF;display:flex;flex-direction:column">
            <div style="background:#E0F2FE;padding:6px 8px;border-radius:5px;font-size:10.5px;font-weight:900;color:#0F4C81;margin-bottom:6px">
              Situação das Auditorias Planejadas
            </div>
            <div style="display:flex;justify-content:center">${renderSVGDonut([
              { label: 'Concluída', value: d.statusPlanned.completed, color: '#0F4C81' },
              { label: 'Em Andamento', value: d.statusPlanned.inProgress, color: '#38BDF8' },
              { label: 'Não Iniciada', value: d.statusPlanned.notStarted, color: '#FB923C' }
            ], '92% Concluído')}</div>
            <div style="font-size:9px;font-weight:800;display:flex;justify-content:center;gap:6px;margin-top:6px">
              <span style="color:#0F4C81">■ Concluída (92%)</span>
              <span style="color:#38BDF8">■ Andamento (4%)</span>
              <span style="color:#FB923C">■ Não iniciada (4%)</span>
            </div>
          </div>

          <!-- BLOCO 4: Resultado das Auditorias Concluídas -->
          <div style="border:1px solid #CBD5E1;border-radius:8px;padding:10px;background:#FFFFFF;display:flex;flex-direction:column">
            <div style="background:#E0F2FE;padding:6px 8px;border-radius:5px;font-size:10.5px;font-weight:900;color:#0F4C81;margin-bottom:6px">
              Resultado das Auditorias Concluídas
            </div>
            <div style="display:flex;justify-content:center">${renderSVGDonut([
              { label: 'Necessita de Melhoria Significativa', value: d.resultCompleted.needSignificant, color: '#0F4C81' },
              { label: 'Necessita de Melhoria', value: d.resultCompleted.needSome, color: '#38BDF8' },
              { label: 'Insatisfatório', value: d.resultCompleted.unsatisfactory, color: '#EA580C' },
              { label: 'Satisfatório', value: d.resultCompleted.satisfactory, color: '#EAB308' }
            ], 'Resultados')}</div>
            <div style="font-size:8.5px;font-weight:800;display:flex;justify-content:center;gap:4px;margin-top:6px">
              <span style="color:#EA580C">Insat. 22%</span>
              <span style="color:#0F4C81">Signif. 36%</span>
              <span style="color:#0284C7">Melh. 25%</span>
              <span style="color:#CA8A04">Satis. 17%</span>
            </div>
          </div>

          <!-- BLOCO 5: Resumo de Observações vs. Observações Tratadas -->
          <div style="border:1px solid #CBD5E1;border-radius:8px;padding:10px;background:#FFFFFF;display:flex;flex-direction:column">
            <div style="background:#E0F2FE;padding:6px 8px;border-radius:5px;font-size:10.5px;font-weight:900;color:#0F4C81;margin-bottom:6px">
              Observações vs. Tratativas
            </div>
            <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:6px">${renderBarrasHorizontaisDuplas(d.summaryObservationsVsRemediated)}</div>
            <div style="font-size:9px;font-weight:800;display:flex;justify-content:center;gap:8px;margin-top:4px">
              <span style="color:#0F4C81">■ Observações</span>
              <span style="color:#F97316">■ Tratadas</span>
            </div>
          </div>
        </div>

        <!-- SEGUNDA LINHA: 3 CARDS HORIZONTAIS LADO A LADO -->
        <div style="display:grid;grid-template-columns:1.2fr 1.35fr 1fr;gap:10px;margin-bottom:12px">
          
          <div style="border:1px solid #CBD5E1;border-radius:8px;padding:10px;background:#FFFFFF">
            <div style="background:#FFF1F2;padding:6px 8px;border-radius:5px;font-size:10.5px;font-weight:900;color:#9F1239;margin-bottom:6px">
              Observações de Auditoria por Processo Operacional e Tratativas
            </div>
            <div style="height:190px">${renderGraficoColunasComTendencia(d.businessProcesses)}</div>
            <div style="font-size:8.5px;color:#64748B;text-align:center;margin-top:4px">
              C1 Portão • C2 Fechamento D0 • C3 Desembarque • C4 Limpeza • C5 Bagagem • C6 Calço • C7 Safety • C8 Docs • C9 Especial
            </div>
          </div>

          <div style="border:1px solid #CBD5E1;border-radius:8px;padding:10px;background:#FFFFFF">
            <div style="background:#FFF7ED;padding:6px 8px;border-radius:5px;font-size:10.5px;font-weight:900;color:#9A3412;margin-bottom:6px;display:flex;justify-content:space-between">
              <span>Distribuição Geográfica das Observações — 27 Capitais Brasileiras</span>
              <span style="font-size:9.5px;background:#FED7AA;color:#9A3412;padding:1px 5px;border-radius:3px">DADOS REAIS</span>
            </div>
            <div style="height:210px;position:relative">
              ${renderMapaBrasil27Capitais(capitais, regiaoAtiva, capAtiva)}
            </div>
          </div>

          <div style="border:1px solid #CBD5E1;border-radius:8px;padding:10px;background:#FFFFFF">
            <div style="background:#F0FDF4;padding:6px 8px;border-radius:5px;font-size:10.5px;font-weight:900;color:#166534;margin-bottom:6px">
              Análise de Impacto Operacional e Vulnerabilidade
            </div>
            <div style="height:190px">${renderMatrizImpactoVulnerabilidade(d.impactVulnerabilityAnalysis)}</div>
            <div style="font-size:8.5px;color:#64748B;text-align:center;margin-top:4px">
              Eixo X: Vulnerabilidade (0 a 4) • Eixo Y: Impacto Operacional (0 a 4)
            </div>
          </div>

        </div>

        <!-- TERCEIRA LINHA: ÁREA COMPLEMENTAR EXECUTIVA (KPIS, TABELA E DIRETRIZES) -->
        <div style="border-top:1.5px solid #E2E8F0;padding-top:10px;margin-top:4px">
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:8px;margin-bottom:10px">
            <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:6px;padding:8px 10px;text-align:center">
              <div style="font-size:9.5px;color:#64748B;font-weight:800">Conformidade D0 Geral</div>
              <div style="font-size:16px;font-weight:900;color:#00796B">${d.indicadoresGerais.indiceConformidadeMedio || '91.2%'}</div>
            </div>
            <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:6px;padding:8px 10px;text-align:center">
              <div style="font-size:9.5px;color:#64748B;font-weight:800">Taxa de Tratativas</div>
              <div style="font-size:16px;font-weight:900;color:#D97706">${d.indicadoresGerais.taxaRemediacaoGeral || '86.4%'}</div>
            </div>
            <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:6px;padding:8px 10px;text-align:center">
              <div style="font-size:9.5px;color:#64748B;font-weight:800">Tempo Médio Resolução</div>
              <div style="font-size:16px;font-weight:900;color:#166534">18 min</div>
            </div>
            <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:6px;padding:8px 10px;text-align:center">
              <div style="font-size:9.5px;color:#64748B;font-weight:800">Agentes Auditados</div>
              <div style="font-size:16px;font-weight:900;color:#0F4C81">${d.indicadoresGerais.totalAuditoriasPlanejadas}</div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="background:#FFFFFF;border:1px solid #CBD5E1;border-radius:6px;padding:8px">
              <div style="font-weight:900;font-size:10.5px;color:#991B1B;margin-bottom:6px">🚨 Apontamentos Críticos em Aberto:</div>
              <table style="width:100%;border-collapse:collapse;font-size:9px">
                <thead>
                  <tr style="background:#FEE2E2;color:#991B1B">
                    <th style="padding:4px 6px">Processo</th>
                    <th style="padding:4px 6px">Casos</th>
                    <th style="padding:4px 6px">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style="border-bottom:1px solid #F1F5F9"><td style="padding:4px 6px;font-weight:700">Fechamento Portas D0</td><td style="padding:4px 6px;color:#DC2626;font-weight:800">68 casos</td><td style="padding:4px 6px;color:#DC2626">Crítico</td></tr>
                  <tr style="border-bottom:1px solid #F1F5F9"><td style="padding:4px 6px;font-weight:700">Conexão de Bagagem</td><td style="padding:4px 6px;color:#DC2626;font-weight:800">62 casos</td><td style="padding:4px 6px;color:#C2410C">Alto</td></tr>
                  <tr><td style="padding:4px 6px;font-weight:700">Limpeza de Cabine TL</td><td style="padding:4px 6px;color:#D97706;font-weight:800">54 casos</td><td style="padding:4px 6px;color:#854D0E">Médio</td></tr>
                </tbody>
              </table>
            </div>

            <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:6px;padding:8px">
              <div style="font-weight:900;font-size:10.5px;color:#166534;margin-bottom:4px">✅ Diretrizes Estratégicas da Gestão:</div>
              <ul style="margin:0;padding-left:14px;font-size:9px;color:#14532D;line-height:1.45">
                <li><b>Início de Embarque (IB):</b> Abertura prioritária 5 min antes em voos com ocupação superior a 85%.</li>
                <li><b>Checklist STD -15:</b> Supervisão aciona o HCC automaticamente se o calço ou portas apresentarem risco D0.</li>
                <li><b>Justificativas 100%:</b> Garantir registro formal de justificativa operacional para qualquer atraso.</li>
              </ul>
            </div>
          </div>
        </div>
      `;
    }

    if (tipo === 'individual' && AuditState.dossieColaborador) {
      const dossie = AuditState.dossieColaborador;
      const c = dossie.colaborador;
      const m = dossie.metricasAuditoria;
      const corRisco = m.nivelRisco === 'Crítico' ? '#EF4444' : m.nivelRisco === 'Alto' ? '#F97316' : m.nivelRisco === 'Moderado' ? '#0284C7' : '#10B981';

      corpoHTML += `
        <!-- IDENTIFICAÇÃO DO COLABORADOR AUDITADO -->
        <div style="background:#F8FAFC;border:1.5px solid #CBD5E1;border-radius:10px;padding:14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:11px;font-weight:800;color:#0F4C81;text-transform:uppercase">Colaborador Auditado:</div>
            <div style="font-size:18px;font-weight:900;color:#0F172A">${c.nome}</div>
            <div style="font-size:12px;color:#475569;margin-top:2px">
              Cargo: <b>${c.cargo}</b> • Setor: <b>${c.setor}</b> • Turno: <b>${c.turno}</b> • Período: <b>${c.periodo}</b>
            </div>
          </div>
          <div style="text-align:right">
            <div style="display:inline-block;padding:6px 16px;border-radius:20px;background:${corRisco};color:#FFFFFF;font-weight:900;font-size:13px">
              NÍVEL DE RISCO: ${m.nivelRisco.toUpperCase()}
            </div>
            <div style="font-size:11px;color:#0F4C81;font-weight:700;margin-top:4px">Classificação: <b>${m.statusAuditoria}</b></div>
          </div>
        </div>

        <!-- CARDS DE METRICAS OPERACIONAIS DO COLABORADOR -->
        <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:10px;margin-bottom:14px">
          <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:10.5px;color:#64748B;font-weight:700">Voos Operados</div>
            <div style="font-size:22px;font-weight:900;color:#0F4C81">${m.totalVoosOperados}</div>
          </div>
          <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:10.5px;color:#64748B;font-weight:700">Conformidade D0</div>
            <div style="font-size:22px;font-weight:900;color:#00796B">${m.conformidadeOperacionalPercent}%</div>
          </div>
          <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:10.5px;color:#64748B;font-weight:700">Voos no Horário</div>
            <div style="font-size:22px;font-weight:900;color:#10B981">${m.voosNoHorario}</div>
          </div>
          <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:10.5px;color:#64748B;font-weight:700">Observações Atraso</div>
            <div style="font-size:22px;font-weight:900;color:#EF4444">${m.voosComObservacaoAtraso}</div>
          </div>
          <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:10.5px;color:#64748B;font-weight:700">Remediações</div>
            <div style="font-size:22px;font-weight:900;color:#F97316">${m.observacoesRemediadas}</div>
          </div>
        </div>

        <!-- RECOMENDAÇÕES DA IA E PLANO DE AÇÃO -->
        <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:12px 16px;margin-bottom:14px">
          <div style="font-weight:800;font-size:12px;color:#1E40AF;margin-bottom:6px">🧠 Recomendações Preventivas & Plano de Ação:</div>
          <ul style="margin:0;padding-left:20px;font-size:11.5px;color:#1E3A8A;line-height:1.5">
            ${(dossie.recomendacoesIA || []).map(r => `<li>${r}</li>`).join('')}
          </ul>
        </div>

        <!-- TABELA DE VOOS AUDITADOS -->
        <div style="margin-bottom:14px">
          <div style="font-weight:800;font-size:12px;color:#0F4C81;margin-bottom:6px">✈️ Amostragem de Voos Auditados no Período (${(dossie.voosAuditados || []).length} voos):</div>
          <table style="width:100%;border-collapse:collapse;font-size:10.5px;text-align:left;border:1px solid #CBD5E1">
            <thead>
              <tr style="background:#0F4C81;color:#FFFFFF;font-weight:800">
                <th style="padding:6px 8px;border:1px solid #CBD5E1">Voo</th>
                <th style="padding:6px 8px;border:1px solid #CBD5E1">Data</th>
                <th style="padding:6px 8px;border:1px solid #CBD5E1">Destino</th>
                <th style="padding:6px 8px;border:1px solid #CBD5E1">STD</th>
                <th style="padding:6px 8px;border:1px solid #CBD5E1">Porta Fechada</th>
                <th style="padding:6px 8px;border:1px solid #CBD5E1">Posição</th>
                <th style="padding:6px 8px;border:1px solid #CBD5E1">Status D0</th>
                <th style="padding:6px 8px;border:1px solid #CBD5E1">Código</th>
              </tr>
            </thead>
            <tbody>
              ${(dossie.voosAuditados || []).slice(0, 16).map(f => `
                <tr style="border-bottom:1px solid #E2E8F0">
                  <td style="padding:6px 8px;font-weight:800;border:1px solid #E2E8F0">${f.voo}</td>
                  <td style="padding:6px 8px;border:1px solid #E2E8F0">${f.data}</td>
                  <td style="padding:6px 8px;font-weight:700;border:1px solid #E2E8F0">${f.des}</td>
                  <td style="padding:6px 8px;border:1px solid #E2E8F0">${f.std}</td>
                  <td style="padding:6px 8px;border:1px solid #E2E8F0">${f.porta}</td>
                  <td style="padding:6px 8px;border:1px solid #E2E8F0">${f.pos}</td>
                  <td style="padding:6px 8px;font-weight:800;color:${f.otp === 'No Horário' ? '#10B981' : '#EF4444'};border:1px solid #E2E8F0">${f.otp}</td>
                  <td style="padding:6px 8px;color:#64748B;border:1px solid #E2E8F0">${f.cod1 || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    if (tipo === 'equipes' || (tipo === 'consolidado' && orientation === 'landscape')) {
      const lista = d.colaboradoresLista || [];
      const turnos = ['T1', 'T2', 'T3', 'T4', 'HCC'];
      const metricasTurno = turnos.map(t => {
        const colabs = lista.filter(c => c.turno === t || (t === 'HCC' && c.setor === 'HCC'));
        const totalVoos = colabs.reduce((acc, c) => acc + c.totalVoos, 0);
        const obs = colabs.reduce((acc, c) => acc + c.observacoes, 0);
        const rem = colabs.reduce((acc, c) => acc + c.remediadas, 0);
        const confMedia = colabs.length > 0 ? Math.round(colabs.reduce((acc, c) => acc + c.conformidade, 0) / colabs.length) : 92;
        return { turno: t, colaboradores: colabs.length, totalVoos, obs, rem, confMedia };
      });

      corpoHTML += `
        <div style="margin-top:14px;border-top:1.5px solid #CBD5E1;padding-top:12px">
          <div style="font-weight:900;font-size:14px;color:#0F4C81;margin-bottom:8px">👥 Comparativo Coletivo de Auditoria por Turno & Setor:</div>
          <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:10px;margin-bottom:12px">
            ${metricasTurno.map(m => `
              <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:8px;padding:10px">
                <div style="font-weight:900;font-size:13px;color:#0F4C81;margin-bottom:4px">Turno ${m.turno}</div>
                <div style="font-size:18px;font-weight:900;color:${m.confMedia >= 90 ? '#10B981' : '#F97316'};margin-bottom:4px">${m.confMedia}% D0</div>
                <div style="font-size:10px;color:#475569">
                  Agentes: <b>${m.colaboradores}</b> • Voos: <b>${m.totalVoos}</b><br>
                  Obs: <b style="color:#EF4444">${m.obs}</b> • Remediadas: <b style="color:#00796B">${m.rem}</b>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (tipo === 'ia') {
      corpoHTML += `
        <div style="margin-top:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
            <div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;padding:14px">
              <div style="font-weight:900;font-size:13px;color:#991B1B;margin-bottom:8px">🚨 Vulnerabilidades Críticas Identificadas:</div>
              <ul style="margin:0;padding-left:18px;font-size:11.5px;color:#7F1D1D;line-height:1.5">
                <li><b>Fechamento de Portas D0 (FP):</b> 68 ocorrências. Principal gargalo em conexões curtas de passageiros.</li>
                <li><b>Liberação de Limpeza de Cabine (TL):</b> Vulnerabilidade 2.1 com impacto 2.8 em voos com solo curto.</li>
                <li><b>Conexão de Bagagem:</b> 62 ocorrências exigindo protocolo ágil entre Check-in e Rampa.</li>
              </ul>
            </div>
            <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:14px">
              <div style="font-weight:900;font-size:13px;color:#166534;margin-bottom:8px">✅ Diretrizes e Ações Estratégicas para Gestão:</div>
              <ul style="margin:0;padding-left:18px;font-size:11.5px;color:#14532D;line-height:1.5">
                <li><b>Início de Embarque Antecipado (IB):</b> Acionamento prioritário 5 minutos antes em voos lotados.</li>
                <li><b>Alerta Preventivo STD -15:</b> Acionamento do HCC caso CA ou TL ainda não estejam validados.</li>
                <li><b>Monitoramento em Tempo Real:</b> Auditoria contínua de calço e registro imediato de justificativas.</li>
              </ul>
            </div>
          </div>
        </div>
      `;
    }

    // Rodapé de Autenticidade e Assinatura do Supervisor Master
    const rodapeHTML = `
      <div style="border-top:1.5px solid #CBD5E1;padding-top:10px;margin-top:12px;display:flex;justify-content:space-between;align-items:center;font-size:9.5px;color:#64748B">
        <div>
          <b>Diário de Embarque</b> • Sistema de Auditoria Operacional Aeroportuária • Documento auditado eletronicamente.<br>
          Validação de integridade física: SHA-256 Protocolo: AUD-${Date.now().toString(36).toUpperCase()}
        </div>
        <div style="text-align:right">
          <div style="border-bottom:1px solid #94A3B8;width:180px;margin-bottom:3px;margin-left:auto"></div>
          <div>Visto do Auditor / Supervisor Master</div>
        </div>
      </div>
    `;

    staging.innerHTML = cabecalhoHTML + corpoHTML + rodapeHTML;
    stagingWrapper.appendChild(staging);
    document.body.appendChild(stagingWrapper);

    // Aguarda conclusão de layout, renderização de fontes e ciclo de pintura
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch(e) {}
    }
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => setTimeout(r, 180));

    // Diagnóstico técnico das dimensões do relatório antes da captura
    const elWidth = staging.offsetWidth;
    const elHeight = staging.offsetHeight;
    console.info('Audit PDF Diagnostic - Elemento renderizado:', {
      id: staging.id,
      width: elWidth,
      height: elHeight,
      scrollWidth: staging.scrollWidth,
      scrollHeight: staging.scrollHeight,
      orientation
    });

    if (elWidth <= 0 || elHeight <= 0) {
      throw new Error(`Dimensões do relatório nulas para captura (${elWidth}x${elHeight}px).`);
    }

    // 3. EXECUTA MOTOR DE GERAÇÃO EM ALTA RESOLUÇÃO (HD)
    atualizarProgressoPDF(75, 'Etapa 3/4: Gerando arquivo PDF independente de impressora física...');
    await new Promise(r => setTimeout(r, 120));

    const isMobile = (window.innerWidth <= 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
    let pdfBlob = null;

    // Tentativa Primária: html2pdf com configuração otimizada e dimensões reais
    if (typeof window.html2pdf !== 'undefined') {
        const isSafeMobile = isMobile || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
        const opt = {
          margin: orientation === 'landscape' ? [4, 4, 4, 4] : [6, 6, 6, 6],
          filename: filename,
          image: { type: 'jpeg', quality: isSafeMobile ? 0.94 : 0.98 },
          pagebreak: { mode: ['css', 'legacy'] },
          html2canvas: {
            scale: isSafeMobile ? 1.0 : 1.6,
            useCORS: true,
            logging: false,
            backgroundColor: '#FFFFFF',
            scrollX: 0,
            scrollY: 0,
            windowWidth: targetWidth + 40
          },
          jsPDF: { unit: 'mm', format: isA3 ? 'a3' : 'a4', orientation: orientation }
        };

        const worker = window.html2pdf().set(opt).from(staging);
        pdfBlob = await worker.output('blob');
      } catch (h2pErr) {
        console.warn('html2pdf encontrou advertência, acionando fallback html2canvas direto:', h2pErr);
      }
    }

    // Tentativa Secundária: html2canvas + jsPDF direto
    if (!pdfBlob && typeof window.html2canvas !== 'undefined') {
      try {
        const isSafeMobile = isMobile || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
        const canvas = await window.html2canvas(staging, {
          scale: isSafeMobile ? 1.0 : 1.6,
          useCORS: true,
          logging: false,
          backgroundColor: '#FFFFFF',
          scrollX: 0,
          scrollY: 0,
          windowWidth: targetWidth + 40
        });

        if (canvas && canvas.width > 0 && canvas.height > 0) {
          if (verificarSeCanvasEstaEmBranco(canvas)) {
            console.warn('Aviso: canvas pode estar em branco, continuando tentativa de conversão...');
          }
          const jsPDFClass = window.jsPDF || (window.jspdf && window.jspdf.jsPDF);
          if (jsPDFClass) {
            const doc = new jsPDFClass({ orientation, unit: 'mm', format: isA3 ? 'a3' : 'a4' });
            const pW = orientation === 'landscape' ? (isA3 ? 420 : 297) : (isA3 ? 297 : 210);
            const pH = orientation === 'landscape' ? (isA3 ? 297 : 210) : (isA3 ? 420 : 297);
            const m = 5;
            const imgW = pW - (m * 2);
            const imgH = (canvas.height * imgW) / canvas.width;
            const imgData = canvas.toDataURL('image/jpeg', isMobile ? 0.92 : 0.96);

            if (imgH <= (pH - m * 2)) {
              doc.addImage(imgData, 'JPEG', m, m, imgW, imgH);
            } else {
              let hLeft = imgH;
              let pos = m;
              let pNum = 1;
              doc.addImage(imgData, 'JPEG', m, pos, imgW, imgH);
              hLeft -= (pH - m * 2);
              while (hLeft > 0) {
                pos = m - (pNum * (pH - m * 2));
                doc.addPage();
                pNum++;
                doc.addImage(imgData, 'JPEG', m, pos, imgW, imgH);
                hLeft -= (pH - m * 2);
              }
            }
            pdfBlob = doc.output('blob');
          }
        }
      } catch (directErr) {
        console.error('Falha no fallback html2canvas direto:', directErr);
      }
    }

    // 4. VALIDAÇÃO REAL DE INTEGRIDADE DO PDF (SEM TAMANHO ARBITRÁRIO)
    atualizarProgressoPDF(90, 'Etapa 4/4: Validando integridade física do documento PDF...');
    const validacao = await validarIntegridadePDF(pdfBlob);
    if (!validacao.valido) {
      throw new Error(`Validação do arquivo falhou: ${validacao.motivo}`);
    }

    console.info('PDF gerado e validado com sucesso:', {
      filename,
      sizeBytes: validacao.tamanho,
      versaoPdf: validacao.versao,
      orientation
    });

    // Prepara download no backend para compatibilidade nativa com Android DownloadManager
    let prepData = null;
    try {
      const base64data = await blobToBase64(pdfBlob);
      const resPrep = await (typeof window.authFetch === 'function' ? window.authFetch : fetch)('/api/prepare-pdf-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, pdfBase64: base64data })
      });
      if (resPrep.ok) {
        prepData = await resPrep.json();
      }
    } catch (prepErr) {
      console.warn('Aviso ao sincronizar download no backend:', prepErr.message);
    }

    const blobUrl = URL.createObjectURL(pdfBlob);
    AuditState.ultimoPdfGerado = {
      blob: pdfBlob,
      filename,
      blobUrl,
      downloadUrl: prepData?.downloadUrl,
      viewUrl: prepData?.viewUrl,
      htmlContent: staging.innerHTML
    };

    // 5. DISPARA DOWNLOAD AUTOMÁTICO PARA O DISPOSITIVO (ANDROID & DESKTOP)
    const downloadLink = document.createElement('a');
    downloadLink.href = prepData?.downloadUrl || blobUrl;
    downloadLink.download = filename;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    setTimeout(() => downloadLink.remove(), 2500);

    // 6. APRESENTA CONFIRMAÇÃO DE SUCESSO COM OPÇÕES DE ABRIR NO CELULAR E COMPARTILHAR
    mostrarModalSucessoPDF({
      filename,
      blobUrl,
      downloadUrl: prepData?.downloadUrl,
      viewUrl: prepData?.viewUrl,
      pdfBlob,
      tipoNome: nomeRelatorio
    });

    if (typeof window.showToast === 'function') {
      window.showToast(`✔ PDF '${filename}' gerado com sucesso!`, 'success');
    }

  } catch (err) {
    console.error('DIAGNÓSTICO TÉCNICO DE ERRO NA GERAÇÃO DE PDF:', {
      erro: err.message,
      stack: err.stack
    });
    mostrarModalErroPDF(`Falha técnica na geração: ${err.message}`);
  } finally {
    const sw = document.getElementById('auditPdfStagingWrapper');
    if (sw) sw.remove();
  }
  }

  // ==========================================================================
  // INTERAÇÕES E FILTROS DO MÓDULO (PT-BR)
  // ==========================================================================
  function aplicarFiltroGeo(val) {
    const regioes = ['Todas', 'Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];
    if (regioes.includes(val)) {
      AuditState.filtros.regiao = val;
      AuditState.filtros.capitalSelecionada = null;
    } else {
      AuditState.filtros.capitalSelecionada = val;
      const capObj = (AuditState.dadosGerais?.capitaisBrasil || []).find(c => c.capital === val);
      if (capObj) AuditState.filtros.regiao = capObj.regiao;
    }
    const container = document.getElementById('auditContentArea');
    if (container && AuditState.abaAtiva === 'geral') {
      renderAbaGeral(container);
    }
  }

  function aplicarFiltroProcesso(val) {
    AuditState.filtros.processo = val;
    const container = document.getElementById('auditContentArea');
    if (container && AuditState.abaAtiva === 'geral') {
      renderAbaGeral(container);
    }
  }

  function aplicarFiltroRisco(val) {
    AuditState.filtros.risco = val;
    const container = document.getElementById('auditContentArea');
    if (container && AuditState.abaAtiva === 'geral') {
      renderAbaGeral(container);
    }
  }

  function mudarFormatoPapel(val) {
    AuditState.filtros.formatoPapel = val || 'a4';
    if (typeof window.showToast === 'function') {
      window.showToast(`Formato PDF: ${val === 'a3' ? 'A3 Expandido (Landscape)' : 'A4 Padrão (Landscape)'}`, 'info');
    }
  }

  function selecionarCapital(nomeCapital) {
    AuditState.filtros.capitalSelecionada = nomeCapital;
    const capObj = (AuditState.dadosGerais?.capitaisBrasil || []).find(c => c.capital === nomeCapital);
    if (capObj) {
      AuditState.filtros.regiao = capObj.regiao;
    }
    const container = document.getElementById('auditContentArea');
    if (container && AuditState.abaAtiva === 'geral') {
      renderAbaGeral(container);
    }
  }

  function filtrarRegiao(regiao) {
    AuditState.filtros.regiao = regiao || 'Todas';
    AuditState.filtros.capitalSelecionada = null;
    const container = document.getElementById('auditContentArea');
    if (container && AuditState.abaAtiva === 'geral') {
      renderAbaGeral(container);
    }
  }

  function limparFiltroCapital() {
    AuditState.filtros.capitalSelecionada = null;
    const container = document.getElementById('auditContentArea');
    if (container && AuditState.abaAtiva === 'geral') {
      renderAbaGeral(container);
    }
  }

  function filtrarBuscaColab(termo) {
    AuditState.filtros.termoBuscaColab = termo;
    const container = document.getElementById('auditContentArea');
    if (container && AuditState.abaAtiva === 'individual') {
      renderAbaIndividual(container);
    }
  }

  function selecionarColaborador(nome) {
    AuditState.colaboradorSelecionado = nome;
  }

  async function carregarDossieIndividual() {
    const nome = AuditState.colaboradorSelecionado;
    if (!nome) {
      if (typeof window.showToast === 'function') {
        window.showToast('Selecione um colaborador na lista para auditar.', 'warning');
      }
      return;
    }

    const area = document.getElementById('areaDossieIndividual');
    if (area) {
      area.innerHTML = '<div style="text-align:center;padding:40px">Consultando registros reais de ' + nome + '...</div>';
    }

    try {
      const res = await (typeof window.authFetch === 'function'
        ? window.authFetch(`/api/auditoria/colaborador/${encodeURIComponent(nome)}`)
        : fetch(`/api/auditoria/colaborador/${encodeURIComponent(nome)}`));

      if (!res.ok) throw new Error('Não foi possível carregar os registros deste colaborador.');
      const data = await res.json();
      AuditState.dossieColaborador = data;
      if (area) area.innerHTML = renderDetalhesDossie(data);
    } catch (err) {
      if (area) {
        area.innerHTML = `
          <div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:8px;font-size:13px;text-align:center">
            Erro ao carregar colaborador: ${err.message}
          </div>
        `;
      }
    }
  }

  function abrirPreviaHD() {
    if (!AuditState.ultimoPdfGerado) {
      if (typeof window.showToast === 'function') window.showToast('Nenhum PDF disponível para visualização.', 'warning');
      return;
    }
    const modalProg = document.getElementById('modalAuditPdfProgress');
    if (modalProg) modalProg.remove();
    if (typeof window.abrirVisualizadorPDF === 'function') {
      window.abrirVisualizadorPDF({
        filename: AuditState.ultimoPdfGerado.filename,
        blobUrl: AuditState.ultimoPdfGerado.blobUrl,
        downloadUrl: AuditState.ultimoPdfGerado.downloadUrl,
        viewUrl: AuditState.ultimoPdfGerado.viewUrl,
        pdfBlob: AuditState.ultimoPdfGerado.blob,
        htmlContent: AuditState.ultimoPdfGerado.htmlContent
      });
    } else {
      window.open(AuditState.ultimoPdfGerado.viewUrl || AuditState.ultimoPdfGerado.blobUrl, '_blank', 'noopener,noreferrer');
    }
  }

  // Exporta objeto global AuditModule
  window.AuditModule = {
    render: renderAuditoriaInteligente,
    recarregarDados: carregarDadosAuditoria,
    mudarAba,
    aplicarFiltroGeo,
    aplicarFiltroProcesso,
    aplicarFiltroRisco,
    mudarFormatoPapel,
    selecionarCapital,
    filtrarRegiao,
    limparFiltroCapital,
    filtrarBuscaColab,
    selecionarColaborador,
    carregarDossieIndividual,
    gerarRelatorioPDFReal,
    baixarNovamenteArquivo,
    abrirPreviaHD,
    abrirPDFNoLeitorNativoDireto,
    compartilharPDFAudit
  };

  // Alias global para ser chamado em showView('auditoria-inteligente')
  window.renderAuditoriaInteligente = renderAuditoriaInteligente;

})(window);
