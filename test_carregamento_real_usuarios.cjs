const http = require('http');

function post(path, data, token = null) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method: 'POST',
      headers
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(b) });
        } catch(e) {
          resolve({ status: res.statusCode, body: b });
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(data));
    req.end();
  });
}

function get(path, token = null) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method: 'GET',
      headers
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(b) });
        } catch(e) {
          resolve({ status: res.statusCode, body: b });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log('=== TESTE DE VALIDAÇÃO: CARREGAMENTO DE USUÁRIOS REAIS CADASTRADOS ===\n');

  let passed = 0;
  let total = 0;
  function assert(condition, desc) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${desc}`);
    }
  }

  // 1. Login com conta Master
  const masterLogin = await post('/api/auth/login', {
    email: 'lediariodeembarque@gmail.com',
    password: 'SenhaCorreta@2026'
  });
  assert(masterLogin.status === 200 && masterLogin.body.token, '1. Login de Master efetuado com sucesso');
  const masterToken = masterLogin.body.token;

  // 2. Consulta de usuários como Master
  const resUsers = await get('/api/admin/users', masterToken);
  assert(resUsers.status === 200 && resUsers.body.status === 'success', '2. GET /api/admin/users responde status 200 para Master');
  const users = resUsers.body.users || [];
  assert(users.length >= 10, `3. Usuários cadastrados carregados da base real: ${users.length} usuários`);

  // 4. Verificação de contas reais conhecidas
  const emails = users.map(u => u.email.toLowerCase());
  assert(emails.includes('lediariodeembarque@gmail.com'), '4. Conta Master oficial (lediariodeembarque@gmail.com) presente na listagem');
  assert(emails.includes('kethley.cruz@latam.com'), '5. Usuária real Kethley Cruz (kethley.cruz@latam.com) carregada da base');
  assert(emails.includes('leandro.ferrari@latam.com'), '6. Usuário real Leandro Ferrari (leandro.ferrari@latam.com) carregado da base');
  assert(emails.includes('tamirescardoso3010@gmail.com'), '7. Usuária real Tamires (tamirescardoso3010@gmail.com) carregada da base');
  assert(emails.includes('vfranca471@gmail.com'), '8. Usuário real Vfranca471 (vfranca471@gmail.com) carregado da base');
  assert(emails.includes('test.auditoria@gru.com.br'), '9. Auditor GRU (test.auditoria@gru.com.br) presente na listagem');

  // 10. Campos obrigatórios presentes em cada usuário
  const allHaveRequiredFields = users.every(u => u.email && u.name && u.setor && u.role && u.status);
  assert(allHaveRequiredFields, '10. Todos os registros contêm Nome, E-mail, Setor, Perfil e Situação');

  // 11. Teste com conta de Gestão
  const gestaoEmail = `gestor.teste.${Date.now()}@diariodeembarque.com`;
  const regGestao = await post('/api/auth/register', {
    email: gestaoEmail,
    password: 'SenhaGestao@2026',
    name: 'Gestor Teste Aeroporto',
    role: 'admin'
  });
  assert(regGestao.status === 200 && regGestao.body.token, '11. Conta com perfil Gestão registrada para validação');
  const gestaoToken = regGestao.body.token;

  const resGestao = await get('/api/admin/users', gestaoToken);
  assert(resGestao.status === 200 && Array.isArray(resGestao.body.users), '12. Conta de Gestão consulta os usuários reais com sucesso');
  assert(resGestao.body.users.length >= users.length, '13. Listagem sob perfil Gestão contém a totalidade dos usuários reais');

  // 14. Bloqueio para usuário comum de Embarque
  const embarqueEmail = `operador.comum.${Date.now()}@embarque.com`;
  const regEmbarque = await post('/api/auth/register', {
    email: embarqueEmail,
    password: 'SenhaEmbarque@2026',
    name: 'Operador Comum',
    role: 'embarque'
  });
  assert(regEmbarque.status === 200 && regEmbarque.body.token, '14. Conta comum de Embarque criada para teste de restrição');
  const embarqueToken = regEmbarque.body.token;

  const resEmbarque = await get('/api/admin/users', embarqueToken);
  assert(resEmbarque.status === 403, '15. Acesso a /api/admin/users por usuário comum é BLOQUEADO com HTTP 403');

  // 16. Filtros de busca textual
  const searchLatam = await get('/api/admin/users?search=latam', masterToken);
  assert(searchLatam.status === 200 && searchLatam.body.users.length >= 2, 
    `16. Filtro por busca textual ("latam") retornou ${searchLatam.body.users.length} usuários`);

  // 17. Filtro por setor
  const filterSetor = await get('/api/admin/users?setor=hcc', masterToken);
  assert(filterSetor.status === 200 && filterSetor.body.users.every(u => (u.setor || '').toLowerCase() === 'hcc'),
    '17. Filtro por setor ("hcc") retorna apenas os usuários alocados em HCC');

  // 18. Limpeza de usuários temporários de teste
  await post('/api/admin/users/delete', { targetEmail: gestaoEmail }, masterToken);
  await post('/api/admin/users/delete', { targetEmail: embarqueEmail }, masterToken);
  console.log('✔ Limpeza de contas de teste concluída com sucesso.');

  console.log(`\n==============================================`);
  console.log(`RESULTADO: ${passed}/${total} testes aprovados!`);
  console.log(`==============================================`);

  if (passed === total) process.exit(0);
  else process.exit(1);
}

run().catch(err => {
  console.error('Erro na execução do teste:', err);
  process.exit(1);
});
