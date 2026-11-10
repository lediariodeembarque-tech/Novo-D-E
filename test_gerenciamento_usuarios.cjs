const http = require('http');
const fs = require('fs');
const path = require('path');

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== TESTE DE HOMOLOGAÇÃO: GERENCIAMENTO DE USUÁRIOS (GESTÃO E MASTER) ===\n');
  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
    }
  }

  // 1. Validar index.html para regras de menu e permissões
  console.log('--- 1. Verificando index.html (Menu, Permissões e Elementos Visuais) ---');
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

  // Extrair VIEW_ALLOWED de index.html
  const viewAllowedMatch = indexHtml.match(/const VIEW_ALLOWED = \{([\s\S]*?)\};/);
  assert(viewAllowedMatch !== null, 'Objeto VIEW_ALLOWED encontrado em index.html');
  const viewAllowedContent = viewAllowedMatch ? viewAllowedMatch[1] : '';

  const adminHasUsuarios = /admin:\s*\[[^\]]*'usuarios'[^\]]*\]/.test(viewAllowedContent);
  const masterHasUsuarios = /master:\s*\[[^\]]*'usuarios'[^\]]*\]/.test(viewAllowedContent);
  const gestaoHasUsuarios = /gestao:\s*\[[^\]]*'usuarios'[^\]]*\]/.test(viewAllowedContent);
  const embarqueHasUsuarios = /embarque:\s*\[[^\]]*'usuarios'[^\]]*\]/.test(viewAllowedContent);
  const hccHasUsuarios = /hcc:\s*\[[^\]]*'usuarios'[^\]]*\]/.test(viewAllowedContent);

  assert(adminHasUsuarios && masterHasUsuarios && gestaoHasUsuarios, 
    'VIEW_ALLOWED autoriza a view "usuarios" para admin, master e gestao');

  assert(!embarqueHasUsuarios, 
    'A view "usuarios" NÃO é permitida para perfil embarque');

  assert(!hccHasUsuarios, 
    'A view "usuarios" NÃO é permitida para perfil hcc');

  assert(indexHtml.includes("['usuarios','👥 Usuários']") || indexHtml.includes("['usuarios', '👥 Usuários']"), 
    'Item de menu "👥 Usuários" está presente no buildMenu para gestao/master');

  assert(indexHtml.includes('id="usuarios" class="view"'), 
    'A view container #usuarios está presente no HTML');

  assert(indexHtml.includes('id="usrSearchInput"') && indexHtml.includes('id="usrFilterSetor"') && indexHtml.includes('id="usrFilterRole"') && indexHtml.includes('id="usrFilterStatus"'), 
    'Campos de busca e filtros (setor, perfil, status) estão presentes');

  assert(indexHtml.includes('id="modalEditarUsuario"') && indexHtml.includes('id="modalExcluirUsuario"'), 
    'Modais de edição e de exclusão com confirmação estão presentes');

  // 2. Autenticação e chamadas na API do Servidor
  console.log('\n--- 2. Verificando API Backend (/api/admin/users) ---');
  
  // Login como Master
  const loginMaster = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'lediariodeembarque@gmail.com', password: 'SenhaCorreta@2026' });

  assert(loginMaster.status === 200 && (loginMaster.body.status === 'success' || loginMaster.body.token), 'Login do usuário Master executado com sucesso');
  const masterToken = loginMaster.body.token;

  // 3. Obter lista de usuários
  const usersList = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/admin/users',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${masterToken}` }
  });

  assert(usersList.status === 200 && usersList.body.status === 'success' && Array.isArray(usersList.body.users), 
    'GET /api/admin/users retorna lista de usuários cadastrados');

  const users = usersList.body.users || [];
  assert(users.length > 0, `Usuários encontrados no banco: ${users.length}`);

  const masterInList = users.find(u => u.email === 'lediariodeembarque@gmail.com');
  assert(masterInList && masterInList.role === 'master', 'Usuário Master consta na listagem com campos completos');
  assert(masterInList && masterInList.setor, `Usuário Master possui setor definido: ${masterInList?.setor}`);
  assert(masterInList && masterInList.status === 'Ativo', 'Situação do usuário Master é Ativo');

  // 4. Teste de Busca e Filtros via API
  const filteredSearch = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/admin/users?search=lediariodeembarque',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${masterToken}` }
  });
  assert(filteredSearch.status === 200 && filteredSearch.body.users.length === 1 && filteredSearch.body.users[0].email === 'lediariodeembarque@gmail.com', 
    'Filtro por busca textual (e-mail) retorna o usuário correto');

  const filteredRole = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/admin/users?role=master',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${masterToken}` }
  });
  assert(filteredRole.status === 200 && filteredRole.body.users.every(u => u.role === 'master'), 
    'Filtro por perfil (role=master) retorna apenas usuários do perfil');

  // 5. Segurança: Acesso negado para não autenticado ou perfil sem permissão
  console.log('\n--- 3. Verificando Regras de Segurança e Proteção ---');
  const noTokenReq = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/admin/users',
    method: 'GET'
  });
  assert(noTokenReq.status === 401 || noTokenReq.status === 403, 'Acesso a /api/admin/users sem token é bloqueado');

  // Criar usuário operador para testar restrição
  const tempOpEmail = `operador.teste.${Date.now()}@exemplo.com`;
  const registerOp = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/auth/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: tempOpEmail, password: 'SenhaSegura@2026', name: 'Operador Teste' });

  assert(registerOp.status === 200 && (registerOp.body.status === 'success' || registerOp.body.token), 'Cadastro de usuário de teste com perfil padrão');
  const opToken = registerOp.body.token;

  // Operador tentando acessar /api/admin/users
  const opAccess = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/admin/users',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${opToken}` }
  });
  assert(opAccess.status === 403, 'Operador comum (embarque) tem acesso BLOQUEADO com status 403');

  // 6. Teste de Edição de Usuário (Setor, Nome, Status)
  console.log('\n--- 4. Testando Edição, Ativação/Inativação e Bloqueio de Sessão ---');
  const updateResp = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/admin/users/update',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${masterToken}` }
  }, {
    targetEmail: tempOpEmail,
    name: 'Operador Teste Atualizado',
    setor: 'Rampa',
    role: 'embarque',
    status: 'Inativo'
  });

  assert(updateResp.status === 200 && updateResp.body.status === 'success', 'Atualização de dados e inativação do usuário realizada');

  // Verificar se o usuário inativo tem login bloqueado
  const loginInativo = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: tempOpEmail, password: 'SenhaSegura@2026' });

  assert(loginInativo.status === 403 && (loginInativo.body.error || '').toLowerCase().includes('inativ'), 
    'Usuário inativo é impedido de realizar login com mensagem clara de conta desativada');

  // Reativar usuário
  const reativarResp = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/admin/users/status',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${masterToken}` }
  }, { email: tempOpEmail, status: 'Ativo' });

  assert(reativarResp.status === 200 && reativarResp.body.status === 'success', 'Reativação rápida de usuário realizada com sucesso');

  // 7. Teste de Proteção contra Exclusão Indevida
  console.log('\n--- 5. Testando Proteção de Exclusão (Autoexclusão e Master) ---');
  
  // Tentar excluir o Master raiz lediariodeembarque@gmail.com
  const deleteMasterReq = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/admin/users/delete',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${masterToken}` }
  }, { email: 'lediariodeembarque@gmail.com' });

  assert(deleteMasterReq.status === 400 || deleteMasterReq.status === 403, 
    'Servidor impede estritamente a exclusão do e-mail Master do sistema (lediariodeembarque@gmail.com)');

  // 8. Teste de Exclusão Permitida com Limpeza de Sessões
  console.log('\n--- 6. Testando Exclusão Segura de Conta de Usuário ---');
  const deleteOpReq = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/admin/users/delete',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${masterToken}` }
  }, { email: tempOpEmail });

  assert(deleteOpReq.status === 200 && deleteOpReq.body.status === 'success', 'Exclusão segura de usuário executada com sucesso');

  // Confirmar que o usuário foi removido da listagem
  const checkDeleted = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: `/api/admin/users?search=${encodeURIComponent(tempOpEmail)}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${masterToken}` }
  });

  assert(checkDeleted.status === 200 && checkDeleted.body.users.length === 0, 
    'Usuário excluído não consta mais na lista de usuários cadastrados');

  console.log(`\n========================================`);
  console.log(`RESULTADO FINAL: ${passed}/${total} asserções passaram com sucesso!`);
  console.log(`========================================`);

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
