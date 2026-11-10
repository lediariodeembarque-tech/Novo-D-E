const http = require('http');
const fs = require('fs');

function get(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method: 'GET',
      headers: {
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.end();
  });
}

function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runHomologacaoFinal() {
  console.log('================================================================');
  console.log('HOMOLOGAÇÃO FINAL DO DIÁRIO DE EMBARQUE — AUDITORIA COMPLETA');
  console.log('================================================================');

  let passed = 0;
  let total = 0;

  function assert(name, condition, detail = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✓ [APROVADO] ${name} ${detail ? '(' + detail + ')' : ''}`);
    } else {
      console.log(`  ✗ [FALHOU] ${name} ${detail ? '(' + detail + ')' : ''}`);
    }
  }

  // 1. AUTENTICAÇÃO E PERMISSÕES
  console.log('\n--- ITEM 1: AUTENTICAÇÃO E PERMISSÕES ---');
  const masterToken = 'fa831b00c23720007c3014dc43df3e0144efdd86abdaa0e2d64708c5541fbb3c';
  const meRes = await get('/api/auth/me', masterToken);
  const meData = JSON.parse(meRes.body);
  assert('Sessão legítima do usuário Master ativa', meRes.status === 200 && meData.user.email === 'lediariodeembarque@gmail.com');

  const invalidLogin = await post('/api/auth/login', {
    email: 'lediariodeembarque@gmail.com',
    password: 'SenhaErrada123'
  });
  const invalidBody = JSON.parse(invalidLogin.body);
  assert('Rejeição segura de credencial incorreta', invalidLogin.status === 401 && invalidBody.error === 'Credenciais inválidas. Verifique seu e-mail e senha.');
  assert('Mensagem de erro segura sem expor URL do servidor', !invalidBody.error.includes('http') && !invalidBody.error.includes('run.app'));

  const auditorLogin = await post('/api/auth/login', {
    email: 'test.auditoria@gru.com.br',
    password: 'SenhaCorreta@2026'
  });
  const auditorData = JSON.parse(auditorLogin.body);
  assert('Login de usuário operacional autorizado com sucesso', auditorLogin.status === 200 && auditorData.token);

  // 2. OITO MODELOS DE ROBÔ E GEMINI
  console.log('\n--- ITEM 2: OITO MODELOS DE ROBÔ E IA GEMINI ---');
  const html = fs.readFileSync('index.html', 'utf8');
  const modelosEsperados = [
    'humanoide_premium', 'compacto_carismatico', 'androide_operacoes', 'assistente_operacional',
    'assistente_virtual', 'robo_hover', 'robo_campo', 'assistente_holografico'
  ];
  const todosModelosNoHtml = modelosEsperados.every(m => html.includes(m));
  assert('Presença dos 8 modelos distintos no catálogo do front-end', todosModelosNoHtml);

  const geminiTest = await post('/api/robo/gemini', {
    message: 'Qual é o status da operação?',
    modelo: 'androide_operacoes'
  }, auditorData.token);
  const geminiData = JSON.parse(geminiTest.body);
  assert('Comunicação do robô com backend Gemini/IA protegida', geminiTest.status === 200 && geminiData.reply);

  // 3. OPERAÇÃO E CONTINUIDADE DE VOOS
  console.log('\n--- ITEM 3: VOOS E CONTINUIDADE OPERACIONAL ---');
  assert('Preservação de voo em andamento via sessionStorage', html.includes('diario_last_active_flight_id'));
  assert('Novo dia não carrega voos fictícios antigos (CNF, IOS, FOR)', !html.includes("voo: '3254'") && !html.includes("origem: 'CNF'"));
  assert('Arquivamento automático em Meses Trabalhados preservado', html.includes('checkAndResetDailyData') && html.includes('archivedFlights'));

  // 4. COMPATIBILIDADE MÓVEL
  console.log('\n--- ITEM 4: COMPATIBILIDADE MÓVEL (iOS E ANDROID) ---');
  assert('Meta viewport responsivo com user-scalable=yes', html.includes('user-scalable=yes') && html.includes('width=device-width'));
  assert('Prevenção de auto-zoom no iOS Safari (font-size: 16px)', html.includes('input, select, textarea { font-size: 16px !important; }'));
  assert('Header responsivo sem overflow horizontal no celular', html.includes('btn-header-mobile-text') && html.includes('max-width: calc(100vw - 150px)'));

  // 5. BACKUP E RECUPERAÇÃO DIÁRIA (12H BRT / GOOGLE DRIVE)
  console.log('\n--- ITEM 5: BACKUP E RECUPERAÇÃO DIÁRIA ---');
  const backupStatus = await get('/api/backup/status', masterToken);
  const bsData = JSON.parse(backupStatus.body);
  assert('Agendamento diário de backup ativo às 12:00 BRT', backupStatus.status === 200 && bsData.agendamentoDiario.includes('12:00 BRT'));
  assert('Destinatário do backup configurado para o responsável', bsData.destinatarioResponsavel === 'lediariodeembarque@gmail.com');

  const backupExport = await get('/api/backup/export', masterToken);
  const beData = JSON.parse(backupExport.body);
  assert('Exportação de backup completo com integridade de dados', backupExport.status === 200 && beData.estatisticas?.totalUsuarios >= 5);

  const nonAdminExport = await get('/api/backup/export', auditorData.token);
  assert('Restrição estrita: backup bloqueado para contas não-admin', nonAdminExport.status === 403);

  console.log('\n================================================================');
  console.log(`RESULTADO DA HOMOLOGAÇÃO: ${passed} / ${total} TESTES APROVADOS (${Math.round((passed/total)*100)}%)`);
  console.log('================================================================');
}

runHomologacaoFinal().catch(console.error);
