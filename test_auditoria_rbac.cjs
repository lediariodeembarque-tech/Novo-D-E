const fs = require('fs');
const http = require('http');

async function runAuditSecurityTests() {
  console.log('=== TESTE DE SEGURANÇA E ACESSO EXCLUSIVO — PAINEL DE AUDITORIA INTELIGENTE ===');
  const baseUrl = 'http://127.0.0.1:3000';
  const results = [];

  function assert(title, condition, detail) {
    results.push({ title, condition, detail });
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${title} ${detail ? '-> ' + detail : ''}`);
    if (!condition) {
      console.error('ASSERTION FAILED:', title, detail);
    }
  }

  // 1. CHECAGEM DE ARQUITETURA NO FRONTEND (VIEW_ALLOWED)
  const indexHtml = fs.readFileSync('index.html', 'utf8');
  const embarqueMatch = indexHtml.match(/embarque:\s*\[([^\]]+)\]/);
  const hccMatch = indexHtml.match(/hcc:\s*\[([^\]]+)\]/);
  const adminMatch = indexHtml.match(/admin:\s*\[([^\]]+)\]/);
  const masterMatch = indexHtml.match(/master:\s*\[([^\]]+)\]/);

  assert('VIEW_ALLOWED.embarque não contém auditoria-inteligente', 
    embarqueMatch && !embarqueMatch[1].includes('auditoria-inteligente'), 
    'Acesso excluído da lista de visões permitidas do Embarque');

  assert('VIEW_ALLOWED.hcc não contém auditoria-inteligente', 
    hccMatch && !hccMatch[1].includes('auditoria-inteligente'), 
    'Acesso excluído da lista de visões permitidas do HCC');

  assert('VIEW_ALLOWED.admin contém auditoria-inteligente', 
    adminMatch && adminMatch[1].includes('auditoria-inteligente'), 
    'Acesso concedido ao perfil Gestão/Admin');

  assert('VIEW_ALLOWED.master contém auditoria-inteligente', 
    masterMatch && masterMatch[1].includes('auditoria-inteligente'), 
    'Acesso concedido ao perfil Master');

  // 2. TESTE BACKEND: ACESSO ANÔNIMO DEVE RECEBER 401
  const anonRes = await fetch(baseUrl + '/api/auditoria/dados');
  assert('Acesso anônimo a /api/auditoria/dados retorna 401', 
    anonRes.status === 401, `Status recebido: ${anonRes.status}`);

  // 3. CRIAÇÃO DE USUÁRIOS DE TESTE: EMBARQUE, HCC E MASTER
  // 3.1 Usuário Embarque
  const embarqueEmail = 'operador.embarque.audittest@exemplo.com';
  const embarquePass = 'EmbarquePass123!';
  await fetch(baseUrl + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: embarqueEmail, password: embarquePass, name: 'Operador Embarque', role: 'embarque', turno: 'T1' })
  });
  const loginEmbarqueRes = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: embarqueEmail, password: embarquePass })
  });
  const loginEmbarqueData = await loginEmbarqueRes.json();
  const tokenEmbarque = loginEmbarqueData.token;

  // 3.2 Usuário HCC
  const hccEmail = 'agente.hcc.audittest@exemplo.com';
  const hccPass = 'HccPass123!';
  await fetch(baseUrl + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: hccEmail, password: hccPass, name: 'Agente HCC', role: 'hcc', turno: 'T2' })
  });
  const loginHccRes = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: hccEmail, password: hccPass })
  });
  const loginHccData = await loginHccRes.json();
  const tokenHcc = loginHccData.token;

  // 3.3 Usuário Master Oficial
  const masterEmail = 'lediariodeembarque@gmail.com';
  const masterPass = 'MasterAudit2026!';
  // Atualiza ou registra senha master
  const loginMasterRes = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: masterEmail, password: masterPass, role: 'master' })
  });
  const loginMasterData = await loginMasterRes.json();
  const tokenMaster = loginMasterData.token;

  // 4. TESTE BACKEND: EMBARQUE BLOQUEADO COM 403
  const embarqueAuditRes = await fetch(baseUrl + '/api/auditoria/dados', {
    headers: { 'Authorization': `Bearer ${tokenEmbarque}` }
  });
  assert('Usuário Embarque recebe HTTP 403 Forbidden ao tentar ler /api/auditoria/dados', 
    embarqueAuditRes.status === 403, `Status recebido: ${embarqueAuditRes.status}`);

  const embarqueColabRes = await fetch(baseUrl + '/api/auditoria/colaborador/ANADIA', {
    headers: { 'Authorization': `Bearer ${tokenEmbarque}` }
  });
  assert('Usuário Embarque recebe HTTP 403 Forbidden ao tentar ler dossiê de colaborador', 
    embarqueColabRes.status === 403, `Status recebido: ${embarqueColabRes.status}`);

  const embarqueLogsRes = await fetch(baseUrl + '/api/auditoria/logs', {
    headers: { 'Authorization': `Bearer ${tokenEmbarque}` }
  });
  assert('Usuário Embarque recebe HTTP 403 Forbidden ao tentar consultar logs de auditoria', 
    embarqueLogsRes.status === 403, `Status recebido: ${embarqueLogsRes.status}`);

  // 5. TESTE BACKEND: HCC BLOQUEADO COM 403
  const hccAuditRes = await fetch(baseUrl + '/api/auditoria/dados', {
    headers: { 'Authorization': `Bearer ${tokenHcc}` }
  });
  assert('Usuário HCC recebe HTTP 403 Forbidden ao tentar ler /api/auditoria/dados', 
    hccAuditRes.status === 403, `Status recebido: ${hccAuditRes.status}`);

  // 6. TESTE BACKEND: MASTER POSSUI ACESSO COMPLETO COM HTTP 200
  const masterAuditRes = await fetch(baseUrl + '/api/auditoria/dados', {
    headers: { 'Authorization': `Bearer ${tokenMaster}` }
  });
  assert('Usuário Master recebe HTTP 200 OK ao acessar /api/auditoria/dados', 
    masterAuditRes.status === 200, `Status recebido: ${masterAuditRes.status}`);

  if (masterAuditRes.status === 200) {
    const auditData = await masterAuditRes.json();
    assert('Dados retornam 6 gráficos oficiais da referência visual', 
      auditData.riskRating && 
      auditData.statusPlanned && 
      auditData.resultCompleted && 
      auditData.summaryObservationsVsRemediated && 
      auditData.businessProcesses && 
      auditData.locationObservations && 
      auditData.impactVulnerabilityAnalysis,
      `Planejadas: ${auditData.indicadoresGerais?.totalAuditoriasPlanejadas}, Remediadas: ${auditData.indicadoresGerais?.totalObservacoesRemediadas}`);

    assert('Lista de colaboradores para seleção possui mais de 300 registros reais', 
      (auditData.colaboradoresLista || []).length >= 300, 
      `Total de colaboradores na lista: ${auditData.colaboradoresLista?.length}`);
  }

  // 7. TESTE DOSSIÊ INDIVIDUAL COM DADOS REAIS
  const masterColabRes = await fetch(baseUrl + '/api/auditoria/colaborador/' + encodeURIComponent('ANADIA ROSA GONCALVES GOMES'), {
    headers: { 'Authorization': `Bearer ${tokenMaster}` }
  });
  assert('Consulta de dossiê individual por Gestão/Master retorna HTTP 200', 
    masterColabRes.status === 200, `Status: ${masterColabRes.status}`);

  if (masterColabRes.status === 200) {
    const colabData = await masterColabRes.json();
    assert('Dossiê individual contém métricas, conformidade D0 e recomendações', 
      colabData.colaborador && colabData.metricasAuditoria && colabData.voosAuditados,
      `Colaborador: ${colabData.colaborador?.nome}, Conformidade: ${colabData.metricasAuditoria?.conformidadeOperacionalPercent}%`);
  }

  // 8. TESTE TRILHA DE LOGS DE SEGURANÇA
  const masterLogsRes = await fetch(baseUrl + '/api/auditoria/logs', {
    headers: { 'Authorization': `Bearer ${tokenMaster}` }
  });
  assert('Master consulta trilha de segurança e tentativas bloqueadas com HTTP 200', 
    masterLogsRes.status === 200, `Status: ${masterLogsRes.status}`);

  if (masterLogsRes.status === 200) {
    const logsData = await masterLogsRes.json();
    assert('Tentativas bloqueadas do usuário Embarque foram registradas no log', 
      (logsData.logs || []).some(l => l.email === embarqueEmail || l.role === 'embarque'),
      `Total de tentativas registradas no log de segurança: ${logsData.totalTentativas}`);
  }

  const allPassed = results.every(r => r.condition);
  console.log('====================================================================');
  console.log(allPassed ? '✔ TODOS OS TESTES DE SEGURANÇA E RBAC PASSARAM COM SUCESSO!' : '❌ HOUVE FALHA EM TESTES DE SEGURANÇA.');
  console.log('====================================================================');
  process.exit(allPassed ? 0 : 1);
}

runAuditSecurityTests().catch(err => {
  console.error('Erro na execução da bateria de testes:', err);
  process.exit(1);
});
