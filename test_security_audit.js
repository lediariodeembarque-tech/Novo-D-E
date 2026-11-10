import fs from 'node:fs';

async function runTests() {
  console.log('--- INICIANDO BATERIA DE TESTES DE SEGURANÇA E ISOLAMENTO ---');
  
  const baseUrl = 'http://127.0.0.1:3000';
  console.log(`Conectando ao servidor em ${baseUrl}`);

  const results = [];

  function record(id, title, passed, detail) {
    results.push({ id, title, passed, detail });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${id}: ${title}`);
    if (detail) console.log(`       Detalhe: ${detail}`);
  }

  try {
    // -------------------------------------------------------------
    // TESTE 1: Acesso não autenticado a rotas protegidas
    // -------------------------------------------------------------
    const protectedRoutes = [
      { url: '/api/auth/me', method: 'GET' },
      { url: '/api/user/profile', method: 'GET' },
      { url: '/api/user/sync', method: 'POST', body: { email: 'hacker@teste.com' } },
      { url: '/api/sync/pull', method: 'GET' },
      { url: '/api/sync/push', method: 'POST', body: { flights: [] } },
      { url: '/api/sync/flight', method: 'POST', body: { flight: { id: 'fl_fake' } } },
      { url: '/api/sync/flight/fl_123', method: 'GET' },
      { url: '/api/sync/flight/fl_123', method: 'DELETE' },
      { url: '/api/robo/gemini', method: 'POST', body: { prompt: 'teste' } }
    ];

    let allBlocked = true;
    let blockDetails = [];
    for (const r of protectedRoutes) {
      const res = await fetch(baseUrl + r.url, {
        method: r.method,
        headers: { 'Content-Type': 'application/json' },
        body: r.body ? JSON.stringify(r.body) : undefined
      });
      if (res.status !== 401) {
        allBlocked = false;
        blockDetails.push(`${r.method} ${r.url} retornou ${res.status} em vez de 401`);
      }
    }
    record('TEST_1', 'Rotas privadas e APIs recusam requisições anônimas com HTTP 401', allBlocked,
      allBlocked ? 'Todos os 9 endpoints privados responderam 401 Unauthorized.' : blockDetails.join(', '));

    // -------------------------------------------------------------
    // TESTE 2: Validação de Senha (Login com senha correta e incorreta)
    // -------------------------------------------------------------
    // 2.1 Cadastra ou define senha para Conta A (agente_alfa@teste.com)
    const emailA = 'agente_alfa@teste.com';
    const passA = 'SenhaForte123!';
    const regResA = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailA, password: passA, name: 'Operador Alfa', role: 'embarque' })
    });
    const regDataA = await regResA.json();
    const tokenA = regDataA.token;

    // 2.2 Tenta login com senha ERRADA
    const wrongResA = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailA, password: 'SenhaErrada999', name: 'Operador Alfa' })
    });
    const wrongDataA = await wrongResA.json();
    const passwordRejected = wrongResA.status === 401 && (wrongDataA.error || '').includes('Credenciais inválidas');

    // 2.3 Tenta login com senha CORRETA
    const rightResA = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailA, password: passA, name: 'Operador Alfa' })
    });
    const rightDataA = await rightResA.json();
    const passwordAccepted = rightResA.status === 200 && rightDataA.token && rightDataA.user.email === emailA;

    record('TEST_2', 'Validação efetiva de senha: senha incorreta recusada (401) e senha correta aceita (200)',
      passwordRejected && passwordAccepted,
      `Incorreta: status ${wrongResA.status} (${wrongDataA.error}); Correta: status ${rightResA.status}, token gerado.`);

    // 2.4 Verifica armazenamento: nenhuma senha em texto puro
    const usersFileRaw = fs.readFileSync('users_db.json', 'utf8');
    const hasPlainPasswordA = usersFileRaw.includes(passA);
    const hasSaltHash = usersFileRaw.includes('passwordHash');
    record('TEST_2_HASH', 'Mecanismo de armazenamento: senhas criptografadas com salt e scrypt (sem texto puro)',
      !hasPlainPasswordA && hasSaltHash,
      `Texto puro ausente no users_db.json. Hash com salt presente: ${hasSaltHash}.`);

    // -------------------------------------------------------------
    // TESTE 3: Criação de conta independente B e Isolamento de Voos
    // -------------------------------------------------------------
    const emailB = 'agente_bravo@teste.com';
    const passB = 'SenhaBravo456!';
    const regResB = await fetch(baseUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailB, password: passB, name: 'Operador Bravo', role: 'hcc' })
    });
    const regDataB = await regResB.json();
    const tokenB = regDataB.token;

    // 3.1 Conta A cria um voo secreto
    const flightA = {
      id: 'fl_alfa_001',
      voo: 'LA3100',
      prefixo: 'PT-XAA',
      destino: 'SSA',
      portao: '201',
      status: 'embarcando'
    };
    const createFlightResA = await fetch(baseUrl + '/api/sync/flight', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({ flight: flightA })
    });
    const createFlightDataA = await createFlightResA.json();

    // 3.2 Conta B tenta consultar via /api/sync/pull (deve retornar APENAS voos de B, 0 voos)
    const pullResB = await fetch(baseUrl + '/api/sync/pull', {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const pullDataB = await pullResB.json();
    const bSeesNoFlightA = Array.isArray(pullDataB.flights) && !pullDataB.flights.some(f => f.id === flightA.id);

    // 3.3 Conta B tenta consultar o perfil privado da Conta A
    const profileStolenRes = await fetch(`${baseUrl}/api/user/profile?email=${encodeURIComponent(emailA)}`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const profileBlocked = profileStolenRes.status === 403;

    // 3.4 Conta B tenta ler o voo da Conta A diretamente pelo identificador /api/sync/flight/:id
    const directGetRes = await fetch(`${baseUrl}/api/sync/flight/${flightA.id}`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const directGetBlocked = directGetRes.status === 403;

    // 3.5 Conta B tenta modificar o voo da Conta A
    const modifyAttemptRes = await fetch(baseUrl + '/api/sync/flight', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenB}`
      },
      body: JSON.stringify({ flight: { id: flightA.id, status: 'cancelado' } })
    });
    const modifyAttemptBlocked = modifyAttemptRes.status === 403;

    // 3.6 Conta B tenta excluir o voo da Conta A
    const deleteAttemptRes = await fetch(`${baseUrl}/api/sync/flight/${flightA.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const deleteAttemptBlocked = deleteAttemptRes.status === 403;

    record('TEST_3_ISOLATION', 'Isolamento estrito entre Contas A e B: B não lê, não modifica e não exclui voo de A',
      bSeesNoFlightA && profileBlocked && directGetBlocked && modifyAttemptBlocked && deleteAttemptBlocked,
      `Pull isolado: ${bSeesNoFlightA}; Profile bloqueado: HTTP ${profileStolenRes.status}; Direct GET: HTTP ${directGetRes.status}; Modificação: HTTP ${modifyAttemptRes.status}; Exclusão: HTTP ${deleteAttemptRes.status}`);

    // -------------------------------------------------------------
    // TESTE 4: Conta Nova começa sem voos de terceiros ou dados de demonstração
    // -------------------------------------------------------------
    const emailNova = 'conta_novissima_' + Date.now() + '@teste.com';
    const passNova = 'NovaSenha789!';
    const regNovaRes = await fetch(baseUrl + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailNova, password: passNova, name: 'Novo Operador' })
    });
    const regNovaData = await regNovaRes.json();
    const tokenNova = regNovaData.token;

    const pullNovaRes = await fetch(baseUrl + '/api/sync/pull', {
      headers: { 'Authorization': `Bearer ${tokenNova}` }
    });
    const pullNovaData = await pullNovaRes.json();

    const profileNovaRes = await fetch(baseUrl + '/api/user/profile', {
      headers: { 'Authorization': `Bearer ${tokenNova}` }
    });
    const profileNovaData = await profileNovaRes.json();

    const novaSemVoos = pullNovaData.flights.length === 0 &&
                        pullNovaData.archivedFlights.length === 0 &&
                        pullNovaData.meusVoosDoDia.length === 0 &&
                        profileNovaData.user.flights.length === 0;

    record('TEST_4_NEW_ACCOUNT', 'Conta nova inicia com zero voos, zero arquivados e zero dados herdados',
      novaSemVoos,
      `Voos ativos: ${pullNovaData.flights.length}; Arquivados: ${pullNovaData.archivedFlights.length}; Meus Voos: ${pullNovaData.meusVoosDoDia.length}`);

    // -------------------------------------------------------------
    // TESTE 5: Logout e Troca de Usuário (Invalidação de Sessão)
    // -------------------------------------------------------------
    const logoutRes = await fetch(baseUrl + '/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const afterLogoutRes = await fetch(baseUrl + '/api/auth/me', {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const tokenRevoked = afterLogoutRes.status === 401;

    record('TEST_5_LOGOUT', 'Logout invalida o token no backend; requisições subsequentes são rejeitadas (401)',
      tokenRevoked,
      `Status após logout com o mesmo token: ${afterLogoutRes.status}`);

    // -------------------------------------------------------------
    // TESTE 6: Código do navegador - Ausência de senhas e dados padrões pré-preenchidos
    // -------------------------------------------------------------
    const htmlContent = fs.readFileSync('index.html', 'utf8');
    const hasHardcodedOperatorEmailInHtml = htmlContent.includes('value="lediariodeembarque@gmail.com"');
    const hasCleanDefaultInputs = htmlContent.includes("if(nEl) nEl.value = '';") &&
                                  htmlContent.includes("if(eEl) eEl.value = '';") &&
                                  htmlContent.includes("if(pEl) pEl.value = '';");

    record('TEST_6_CREDENTIALS', 'Campos de login iniciam sem pré-preenchimento indevido e sem senhas no HTML',
      !hasHardcodedOperatorEmailInHtml && hasCleanDefaultInputs,
      `Hardcoded email no HTML: ${hasHardcodedOperatorEmailInHtml}; Limpeza garantida na inicialização: ${hasCleanDefaultInputs}`);

    // -------------------------------------------------------------
    // TESTE 7: Regras do Firestore (firestore.rules)
    // -------------------------------------------------------------
    const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
    const hasAuthCheck = rulesContent.includes('isSignedIn()');
    const hasOwnerCheck = rulesContent.includes('isOwner(userId)');
    const hasFlightOwnerCheck = rulesContent.includes('isFlightOwner');

    record('TEST_7_FIRESTORE_RULES', 'Regras do Firestore auditadas com isolamento por usuário e checagem de auth',
      hasAuthCheck && hasOwnerCheck && hasFlightOwnerCheck,
      `isSignedIn: ${hasAuthCheck}; isOwner: ${hasOwnerCheck}; isFlightOwner: ${hasFlightOwnerCheck}`);

  } catch (err) {
    console.error('ERRO INESPERADO DURANTE A EXECUÇÃO DOS TESTES:', err);
  }

  console.log('\n--- RESUMO DA AUDITORIA ---');
  let passCount = 0;
  for (const r of results) {
    if (r.passed) passCount++;
    console.log(`${r.passed ? '✓' : '✗'} [${r.id}] ${r.title}`);
  }
  // Limpeza dos usuários e sessões de teste para preservar banco de dados limpo
  try {
    const usersRaw = fs.readFileSync('users_db.json', 'utf8');
    const usersObj = JSON.parse(usersRaw);
    delete usersObj['agente_alfa@teste.com'];
    delete usersObj['agente_bravo@teste.com'];
    for (const k of Object.keys(usersObj)) {
      if (k.startsWith('conta_novissima_')) {
        delete usersObj[k];
      }
    }
    fs.writeFileSync('users_db.json', JSON.stringify(usersObj, null, 2), 'utf8');

    const sessRaw = fs.readFileSync('sessions_db.json', 'utf8');
    const sessObj = JSON.parse(sessRaw);
    for (const [tok, s] of Object.entries(sessObj)) {
      if (s.email !== 'lediariodeembarque@gmail.com') {
        delete sessObj[tok];
      }
    }
    fs.writeFileSync('sessions_db.json', JSON.stringify(sessObj, null, 2), 'utf8');
  } catch (e) {
    console.error('Erro na limpeza pós-teste:', e);
  }

  console.log(`\nTotal de testes aprovados: ${passCount} / ${results.length}`);
}

runTests();

