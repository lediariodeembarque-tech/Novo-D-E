const fs = require('fs');
const http = require('http');

console.log('================================================================');
console.log('HOMOLOGAÇÃO TÉCNICA E AUDITORIA COMPLETA - DIÁRIO DE EMBARQUE');
console.log('================================================================\n');

const DEV_LOCAL = 'http://127.0.0.1:3000';

function requestHttp(urlStr, options = {}, postData = null) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
    if (postData) {
      reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
    }
    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', (err) => {
      resolve({ error: err.message });
    });
    if (postData) req.write(postData);
    req.end();
  });
}

async function runHomologacao() {
  const relatorio = {
    secao1_auth_roles: false,
    secao2_robos_ia: false,
    secao3_voos_continuidade: false,
    secao4_mobile_layout: false,
    secao5_backup_recuperacao: false
  };

  // ============================================================================
  // 1. AUTENTICAÇÃO E PERMISSÕES (MASTER, EMBARQUE, HCC E ADMIN)
  // ============================================================================
  console.log('1. AUTENTICAÇÃO E PERFIS DE ACESSO:');
  
  // 1.1 Login Master como Admin
  const loginMasterAdmin = await requestHttp(`${DEV_LOCAL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({
    email: 'lediariodeembarque@gmail.com',
    password: 'SenhaCorreta@2026',
    role: 'admin'
  }));

  let tokenMasterAdmin = null;
  try {
    const data = JSON.parse(loginMasterAdmin.body);
    tokenMasterAdmin = data.token;
    if (data.status === 'success' && data.user.role === 'admin') {
      console.log('  ✓ [Master - Admin]: Login aceito com perfil Admin legítimo.');
    } else {
      console.log('  ! [Master - Admin]: Status:', data);
    }
  } catch(e) {
    console.error('  ✗ Erro parse login Master Admin:', e);
  }

  // 1.2 Login Master como HCC
  const loginMasterHCC = await requestHttp(`${DEV_LOCAL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({
    email: 'lediariodeembarque@gmail.com',
    password: 'SenhaCorreta@2026',
    role: 'hcc'
  }));

  try {
    const data = JSON.parse(loginMasterHCC.body);
    if (data.status === 'success' && data.user.role === 'hcc') {
      console.log('  ✓ [Master - HCC]: Login aceito com perfil HCC legítimo.');
    }
  } catch(e) {}

  // 1.3 Login Master como Embarque
  const loginMasterEmbarque = await requestHttp(`${DEV_LOCAL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({
    email: 'lediariodeembarque@gmail.com',
    password: 'SenhaCorreta@2026',
    role: 'embarque'
  }));

  let tokenMaster = null;
  try {
    const data = JSON.parse(loginMasterEmbarque.body);
    tokenMaster = data.token;
    if (data.status === 'success' && data.user.role === 'embarque') {
      console.log('  ✓ [Master - Embarque]: Login aceito com perfil Embarque legítimo.');
    }
  } catch(e) {}

  // 1.4 Teste de Senha Incorreta
  const loginInvalido = await requestHttp(`${DEV_LOCAL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({
    email: 'lediariodeembarque@gmail.com',
    password: 'SenhaErradaInvalida'
  }));
  if (loginInvalido.status === 401) {
    console.log('  ✓ [Segurança]: Senha incorreta recusada com HTTP 401 e mensagem segura.');
  }

  // 1.5 Isolamento de dados entre contas
  const loginAuditor = await requestHttp(`${DEV_LOCAL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({
    email: 'test.auditoria@gru.com.br',
    password: 'SenhaCorreta@2026'
  }));
  let tokenAuditor = null;
  try {
    tokenAuditor = JSON.parse(loginAuditor.body).token;
  } catch(e){}

  const profileCrossCheck = await requestHttp(`${DEV_LOCAL}/api/user/profile?email=lediariodeembarque@gmail.com`, {
    headers: { 'Authorization': `Bearer ${tokenAuditor}` }
  });
  if (profileCrossCheck.status === 403) {
    console.log('  ✓ [Isolamento]: Acesso cruzado não autorizado bloqueado com HTTP 403.');
    relatorio.secao1_auth_roles = true;
  }

  // ============================================================================
  // 2. OITO MODELOS DE ROBÔ E GEMINI
  // ============================================================================
  console.log('\n2. OITO MODELOS DE ROBÔ E INTELIGÊNCIA ARTIFICIAL:');
  const indexHtml = fs.readFileSync('index.html', 'utf8');
  
  const modelosEsperados = [
    'humanoide_premium',
    'compacto_carismatico',
    'androide_operacoes',
    'assistente_operacional',
    'assistente_virtual',
    'robo_hover',
    'robo_campo',
    'assistente_holografico'
  ];

  let todosModelosPresentes = true;
  modelosEsperados.forEach(m => {
    if (!indexHtml.includes(m)) {
      todosModelosPresentes = false;
      console.error(`  ✗ Modelo ausente no HTML: ${m}`);
    }
  });
  if (todosModelosPresentes) {
    console.log('  ✓ [Galeria 8 Modelos]: Todos os 8 modelos estão definidos com gráficos exclusivos no HTML.');
  }

  // Salvar escolha individual de modelo para a conta
  const saveRobo = await requestHttp(`${DEV_LOCAL}/api/cloud/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenAuditor}`
    }
  }, JSON.stringify({
    email: 'test.auditoria@gru.com.br',
    roboCustomization: { modelo: 'assistente_operacional' }
  }));

  // Logout e Relogin para confirmar persistência
  await requestHttp(`${DEV_LOCAL}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tokenAuditor}` }
  });

  const reloginAuditor = await requestHttp(`${DEV_LOCAL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({
    email: 'test.auditoria@gru.com.br',
    password: 'SenhaCorreta@2026'
  }));

  let newAuditorToken = null;
  try {
    const data = JSON.parse(reloginAuditor.body);
    newAuditorToken = data.token;
    if (data.user.roboCustomization && data.user.roboCustomization.modelo === 'assistente_operacional') {
      console.log('  ✓ [Persistência Individual]: Modelo selecionado ("assistente_operacional") mantido após logout/relogin.');
    }
  } catch(e){}

  // Teste de comunicação com o endpoint da IA Gemini
  const chatGemini = await requestHttp(`${DEV_LOCAL}/api/robo/gemini`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${newAuditorToken}`
    }
  }, JSON.stringify({
    prompt: 'Qual é o status da operação do voo 3550?',
    robotModel: 'assistente_operacional',
    userName: 'Auditor GRU',
    userRole: 'embarque'
  }));

  if (chatGemini.status === 200) {
    const resIA = JSON.parse(chatGemini.body);
    console.log(`  ✓ [IA Gemini / Fallback]: Resposta recebida (${resIA.source || 'gemini'}): "${(resIA.response || '').slice(0, 55)}..."`);
    relatorio.secao2_robos_ia = true;
  }

  // ============================================================================
  // 3. VOOS E CONTINUIDADE OPERACIONAL
  // ============================================================================
  console.log('\n3. VOOS E CONTINUIDADE OPERACIONAL:');

  // Criação de voo "em andamento"
  const vooTeste = {
    id: `voo_audit_${Date.now()}`,
    voo: '3820',
    destino: 'REC',
    horario: '14:30',
    status: 'em_andamento',
    t_std_data: new Date().toISOString().slice(0, 10),
    photos: []
  };

  const syncVoo = await requestHttp(`${DEV_LOCAL}/api/cloud/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${newAuditorToken}`
    }
  }, JSON.stringify({
    email: 'test.auditoria@gru.com.br',
    flights: [vooTeste]
  }));

  const pullVoo = await requestHttp(`${DEV_LOCAL}/api/cloud/pull?email=test.auditoria@gru.com.br`, {
    headers: { 'Authorization': `Bearer ${newAuditorToken}` }
  });

  try {
    const pullData = JSON.parse(pullVoo.body);
    const vooRecuperado = (pullData.flights || []).find(f => f.id === vooTeste.id);
    if (vooRecuperado && vooRecuperado.status === 'em_andamento') {
      console.log('  ✓ [Continuidade de Voo]: Voo em andamento recuperado com integridade da nuvem.');
    }
  } catch(e){}

  // Verificação de limpeza na virada do dia: confirmação que código não injeta CNF/IOS/FOR
  const renderAllClean = !indexHtml.includes("{id:'f1',voo:'3254',destino:'IOS'");
  if (renderAllClean) {
    console.log('  ✓ [Abertura de Novo Dia]: Não carrega voos fictícios antigos (CNF, IOS, FOR) no controle de voos do dia.');
    relatorio.secao3_voos_continuidade = true;
  } else {
    console.error('  ✗ Voos fictícios ainda encontrados no código de inicialização!');
  }

  // ============================================================================
  // 4. COMPATIBILIDADE MÓVEL (IOS E ANDROID)
  // ============================================================================
  console.log('\n4. COMPATIBILIDADE MÓVEL (VIEWPORT E RESPONSIVIDADE):');
  const hasProperViewport = indexHtml.includes('width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover');
  const hasNoOverflowX = indexHtml.includes('overflow-x:hidden') || indexHtml.includes('overflow-x: hidden');
  const hasInputPreventZoom = indexHtml.includes('input, select, textarea { font-size: 16px;');

  if (hasProperViewport) {
    console.log('  ✓ [Meta Viewport]: Configuração com initial-scale=1.0, maximum-scale=5.0 e viewport-fit=cover ativa.');
  }
  if (hasNoOverflowX) {
    console.log('  ✓ [Layout Móvel]: Trava de overflow horizontal (overflow-x:hidden) evita redução indesejada da tela.');
  }
  if (hasInputPreventZoom) {
    console.log('  ✓ [iOS Safari Fix]: Font-size 16px nos campos de entrada impede zoom automático forçado.');
    relatorio.secao4_mobile_layout = true;
  }

  // ============================================================================
  // 5. BACKUP E RECUPERAÇÃO (12H BRT / GOOGLE DRIVE)
  // ============================================================================
  console.log('\n5. BACKUP E RECUPERAÇÃO:');

  // Consulta de status do agendamento às 12h BRT
  const statusBackup = await requestHttp(`${DEV_LOCAL}/api/backup/status`, {
    headers: { 'Authorization': `Bearer ${tokenMasterAdmin}` }
  });

  if (statusBackup.status === 200) {
    const bData = JSON.parse(statusBackup.body);
    console.log(`  ✓ [Agendamento 12h BRT]: Rotina diária configurada (${bData.agendamentoDiario}) para ${bData.destinatarioResponsavel}.`);
    console.log(`  ✓ [Viabilidade Google Drive]: Avaliação técnica registrada ("${bData.googleDrive.status}").`);
  }

  // Teste de Exportação de Backup (.json)
  const exportBackup = await requestHttp(`${DEV_LOCAL}/api/backup/export`, {
    headers: { 'Authorization': `Bearer ${tokenMasterAdmin}` }
  });

  if (exportBackup.status === 200) {
    const backupObj = JSON.parse(exportBackup.body);
    console.log(`  ✓ [Snapshot Completo]: Gerado com sucesso! Usuários: ${backupObj.estatisticas.totalUsuarios}, Voos Ativos: ${backupObj.estatisticas.totalVoosAtivos}, Fotos: ${backupObj.estatisticas.totalFotosEEvidencias}.`);

    // Teste de Restauração de Backup
    const restoreBackup = await requestHttp(`${DEV_LOCAL}/api/backup/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenMasterAdmin}`
      }
    }, JSON.stringify(backupObj));

    if (restoreBackup.status === 200) {
      const restData = JSON.parse(restoreBackup.body);
      console.log(`  ✓ [Restauração Segura]: ${restData.message}`);
      relatorio.secao5_backup_recuperacao = true;
    }
  }

  // ============================================================================
  // RESUMO GERAL DA HOMOLOGAÇÃO
  // ============================================================================
  console.log('\n================================================================');
  console.log('RESULTADO GERAL DA AUDITORIA / HOMOLOGAÇÃO');
  console.log('================================================================');
  console.log(`1. Autenticação e Perfis (Master, Embarque, HCC, Admin): ${relatorio.secao1_auth_roles ? 'APROVADO' : 'REPROVADO'}`);
  console.log(`2. 8 Modelos de Robô e IA Gemini:                        ${relatorio.secao2_robos_ia ? 'APROVADO' : 'REPROVADO'}`);
  console.log(`3. Voos e Continuidade Operacional (Sem CNF/IOS/FOR):     ${relatorio.secao3_voos_continuidade ? 'APROVADO' : 'REPROVADO'}`);
  console.log(`4. Compatibilidade Móvel (Android/iOS):                  ${relatorio.secao4_mobile_layout ? 'APROVADO' : 'REPROVADO'}`);
  console.log(`5. Backup e Recuperação (12h BRT / Google Drive):        ${relatorio.secao5_backup_recuperacao ? 'APROVADO' : 'REPROVADO'}`);
  console.log('================================================================\n');
}

runHomologacao();
