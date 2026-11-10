// test_suite_master_busca.cjs
// Teste de ponta a ponta: Acesso Master/Gestão e Busca Avançada de Voos

const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch(e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    if(data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🚀 INICIANDO BATERIA DE TESTES DE INTEGRAÇÃO E AUTORIZAÇÃO');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if(condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // PARTE 1: AUTORIZAÇÃO & ACESSO À ANÁLISE DE COLABORADOR
  // -------------------------------------------------------------------------
  console.log('--- PARTE 1: Testes de Autorização e Acesso ao Dataset Executivo ---');

  // 1. Login Master Oficial (lediariodeembarque@gmail.com)
  const resMasterLogin = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'lediariodeembarque@gmail.com', password: 'SenhaCorreta@2026' });

  assert(resMasterLogin.status === 200, 'Login Master retorna status 200');
  assert(resMasterLogin.data && resMasterLogin.data.user && resMasterLogin.data.user.role === 'master', 
    `Role do usuário oficial Master é estritamente "master" (obtido: "${resMasterLogin.data?.user?.role}")`);
  const masterToken = resMasterLogin.data?.token;

  // 2. Login com Perfil Admin
  const resAdminLogin = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'admin@aeroporto.com', password: '123', role: 'admin' });
  assert(resAdminLogin.status === 200, 'Login Admin retorna status 200');
  const adminToken = resAdminLogin.data?.token;

  // 3. Login com Perfil Gestao
  const resGestaoLogin = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'gestao@aeroporto.com', password: '123', role: 'admin' });
  assert(resGestaoLogin.status === 200, 'Login Gestão retorna status 200');
  const gestaoToken = resGestaoLogin.data?.token;

  // 4. Login com Perfil Operacional Embarque
  const resEmbarqueLogin = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'operador.embarque@aeroporto.com', password: '123', role: 'embarque', turno: 'T1' });
  assert(resEmbarqueLogin.status === 200, 'Login Embarque retorna status 200');
  assert(resEmbarqueLogin.data?.user?.role === 'embarque', 'Role do usuário Embarque é "embarque"');
  const embarqueToken = resEmbarqueLogin.data?.token;

  // 5. Login com Perfil Operacional HCC
  const resHccLogin = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'operador.hcc@aeroporto.com', password: '123', role: 'hcc', turno: 'T2' });
  assert(resHccLogin.status === 200, 'Login HCC retorna status 200');
  assert(resHccLogin.data?.user?.role === 'hcc', `Role do usuário HCC é "hcc" (obtido: "${resHccLogin.data?.user?.role}")`);
  const hccToken = resHccLogin.data?.token;

  // Testes de Acesso ao Endpoint Protegido /api/analise-colaborador/dataset
  // Cenário 1: Master
  const resDatasetMaster = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/analise-colaborador/dataset',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${masterToken}` }
  });
  assert(resDatasetMaster.status === 200, 'Master autenticado acessa dataset com sucesso (200 OK)');
  const colabCount = typeof resDatasetMaster.data?.colaboradores === 'object' 
    ? Object.keys(resDatasetMaster.data.colaboradores).length 
    : 0;
  assert(colabCount > 0, `Master recebe colaboradores reais (${colabCount} colaboradores encontrados)`);

  // Cenário 2: Admin
  const resDatasetAdmin = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/analise-colaborador/dataset',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert(resDatasetAdmin.status === 200, 'Admin autenticado acessa dataset com sucesso (200 OK)');

  // Cenário 3: Gestão
  const resDatasetGestao = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/analise-colaborador/dataset',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${gestaoToken}` }
  });
  assert(resDatasetGestao.status === 200, 'Gestão autenticado acessa dataset com sucesso (200 OK)');

  // Cenário 4: Embarque (deve ser bloqueado com 403 Forbidden)
  const resDatasetEmbarque = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/analise-colaborador/dataset',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${embarqueToken}` }
  });
  assert(resDatasetEmbarque.status === 403, `Perfil Embarque é bloqueado no dataset (status 403, recebido: ${resDatasetEmbarque.status})`);
  assert(resDatasetEmbarque.data?.error?.includes('exclusivo'), 'Mensagem de erro informa exclusividade para Gestão e Master');

  // Cenário 5: HCC (deve ser bloqueado com 403 Forbidden)
  const resDatasetHcc = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/analise-colaborador/dataset',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${hccToken}` }
  });
  assert(resDatasetHcc.status === 403, `Perfil HCC é bloqueado no dataset (status 403, recebido: ${resDatasetHcc.status})`);

  // Cenário 6: Sem autenticação (deve ser 401 Unauthorized)
  const resDatasetAnon = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/analise-colaborador/dataset',
    method: 'GET'
  });
  assert(resDatasetAnon.status === 401, 'Requisição sem autenticação retorna 401 Unauthorized');

  // Cenário 7: Token inválido / adulterado
  const resDatasetTokenInvalido = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/analise-colaborador/dataset',
    method: 'GET',
    headers: { 'Authorization': 'Bearer token-falso-malicioso-12345' }
  });
  assert(resDatasetTokenInvalido.status === 401, 'Token inválido retorna 401 Unauthorized');

  // -------------------------------------------------------------------------
  // PARTE 2: BUSCA AVANÇADA DE VOOS
  // -------------------------------------------------------------------------
  console.log('\n--- PARTE 2: Testes de Busca Avançada de Voos (/api/google-sheet-flights) ---');

  // 1. Busca por Prefixo Completo (ex: PR-XMA ou PR-TYF)
  const resBuscaPrefixoCompleto = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/google-sheet-flights?prefixo=PR-TYF&allDates=true',
    method: 'GET'
  });
  assert(resBuscaPrefixoCompleto.status === 200, 'Busca por prefixo completo PR-TYF retorna 200');
  const voosPrefixoCompleto = resBuscaPrefixoCompleto.data?.flights || [];
  assert(voosPrefixoCompleto.length > 0 && voosPrefixoCompleto.some(f => (f.prefixo || '').includes('TYF')),
    `Prefixo completo localizou ${voosPrefixoCompleto.length} voo(s) com PR-TYF`);

  // 2. Busca por 3 Últimas Letras do Prefixo (ex: "TYF")
  const resBusca3Letras = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/google-sheet-flights?prefixo=TYF&allDates=true',
    method: 'GET'
  });
  assert(resBusca3Letras.status === 200, 'Busca por 3 últimas letras TYF retorna 200');
  const voos3Letras = resBusca3Letras.data?.flights || [];
  assert(voos3Letras.length > 0, `Busca de 3 letras localizou ${voos3Letras.length} voo(s)`);

  // 3. Busca por Número do Voo Completo (ex: 3374)
  const resBuscaVooCompleto = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/google-sheet-flights?voo=3374&allDates=true',
    method: 'GET'
  });
  assert(resBuscaVooCompleto.status === 200, 'Busca por número de voo completo 3374 retorna 200');
  const voosNumCompleto = resBuscaVooCompleto.data?.flights || [];
  assert(voosNumCompleto.length > 0 && voosNumCompleto.some(f => String(f.voo).includes('3374')),
    `Busca por voo 3374 encontrou ${voosNumCompleto.length} voo(s) com numeração correspondente`);

  // 4. Busca por Número do Voo Parcial (ex: "337")
  const resBuscaVooParcial = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/google-sheet-flights?voo=337&allDates=true',
    method: 'GET'
  });
  assert(resBuscaVooParcial.status === 200, 'Busca por número de voo parcial 337 retorna 200');
  const voosNumParcial = resBuscaVooParcial.data?.flights || [];
  assert(voosNumParcial.length > 0, `Busca por número parcial 337 retornou ${voosNumParcial.length} voo(s)`);

  // 5. Busca por Destino IATA (ex: REC)
  const resBuscaDestIATA = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/google-sheet-flights?dest=REC&allDates=true',
    method: 'GET'
  });
  assert(resBuscaDestIATA.status === 200, 'Busca por destino IATA REC retorna 200');
  const voosDestIATA = resBuscaDestIATA.data?.flights || [];
  assert(voosDestIATA.length > 0 && voosDestIATA.some(f => (f.dest || f.destino || '').includes('REC')),
    `Busca IATA REC encontrou ${voosDestIATA.length} voo(s)`);

  // 6. Busca por Nome de Destino (ex: RECIFE mapeia para REC)
  const resBuscaDestNome = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/google-sheet-flights?dest=RECIFE&allDates=true',
    method: 'GET'
  });
  assert(resBuscaDestNome.status === 200, 'Busca por nome de destino "RECIFE" mapeia para REC com status 200');
  const voosDestNome = resBuscaDestNome.data?.flights || [];
  assert(voosDestNome.length > 0 && voosDestNome.some(f => (f.dest || '').includes('REC')), 
    `Busca por nome "RECIFE" encontrou ${voosDestNome.length} voo(s) com destino REC`);

  // 7. Busca Combinada: Prefixo + Número do Voo + Destino (ex: MYH + 3374 + REC)
  const resBuscaCombinada = await request({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/google-sheet-flights?prefixo=MYH&voo=3374&dest=REC&allDates=true',
    method: 'GET'
  });
  assert(resBuscaCombinada.status === 200, 'Busca combinada (MYH + 3374 + REC) retorna status 200');
  const voosCombinados = resBuscaCombinada.data?.flights || [];
  assert(voosCombinados.length > 0, `Busca combinada encontrou ${voosCombinados.length} voo(s) correspondente(s)`);

  // 8. Busca Respeitando Data Operacional Específica
  const datasDisponiveis = resBuscaPrefixoCompleto.data?.availableDatesInSheet || [];
  if(datasDisponiveis.length > 0) {
    const dataAlvo = datasDisponiveis[0].replace(/^_+/, '');
    const resBuscaComData = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: `/api/google-sheet-flights?prefixo=TYF&date=${encodeURIComponent('2026-10-' + dataAlvo.split('/')[0])}`,
      method: 'GET'
    });
    assert(resBuscaComData.status === 200, `Busca respeitando data operacional (${dataAlvo}) retorna 200`);
    assert(Array.isArray(resBuscaComData.data?.flights), 'Retorno contém lista de voos para o dia especificado');
  }

  // -------------------------------------------------------------------------
  // PARTE 3: VERIFICAÇÃO DAS REGRAS CLIENT-SIDE
  // -------------------------------------------------------------------------
  console.log('\n--- PARTE 3: Testes de Lógica e Normalização Client-Side ---');

  // Simulação da função isUserGestaoOuMaster()
  function testIsUserGestaoOuMaster(currentUser, sessionObj) {
    const norm = (r) => (r || '').toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const email = (currentUser?.email || sessionObj?.email || '').trim().toLowerCase();
    if (email === 'lediariodeembarque@gmail.com') return true;
    const r1 = norm(currentUser?.role);
    const r2 = norm(sessionObj?.role);
    const authorized = ['master', 'admin', 'gestao'];
    return authorized.includes(r1) || authorized.includes(r2);
  }

  assert(testIsUserGestaoOuMaster({ email: 'lediariodeembarque@gmail.com', role: 'embarque' }, null) === true,
    'Regra client: lediariodeembarque@gmail.com é sempre autorizado mesmo se role transitório for embarque');
  assert(testIsUserGestaoOuMaster({ email: 'supervisor@aeroporto.com', role: 'gestão' }, null) === true,
    'Regra client: Role com acento "gestão" é normalizado para "gestao" e autorizado');
  assert(testIsUserGestaoOuMaster({ email: 'admin@aeroporto.com', role: 'ADMIN' }, null) === true,
    'Regra client: Role "ADMIN" em caixa alta é autorizado');
  assert(testIsUserGestaoOuMaster({ email: 'op@aeroporto.com', role: 'embarque' }, null) === false,
    'Regra client: Role "embarque" é bloqueado');
  assert(testIsUserGestaoOuMaster({ email: 'op@aeroporto.com', role: 'hcc' }, null) === false,
    'Regra client: Role "hcc" é bloqueado');
  assert(testIsUserGestaoOuMaster(null, null) === false,
    'Regra client: Usuário deslogado / nulo é bloqueado');
  assert(testIsUserGestaoOuMaster({ email: 'teste@teste.com', role: 'invalido' }, null) === false,
    'Regra client: Role desconhecido / inválido é bloqueado');

  // Simulação dos matchers de busca
  function testMatchPrefixo(prefixoVoo, termo) {
    if(!termo) return true;
    const t = termo.trim().toUpperCase();
    const p = (prefixoVoo || '').toUpperCase();
    const u3 = t.replace(/[^A-Z0-9]/g, '').slice(-3);
    const pU3 = p.replace(/[^A-Z0-9]/g, '').slice(-3);
    return p.includes(t) || t.includes(p) || p.endsWith(t) || (u3 && pU3 === u3);
  }
  assert(testMatchPrefixo('PR-TYF', 'TYF') === true, 'Matcher: "PR-TYF" casa com "TYF"');
  assert(testMatchPrefixo('PR-TYF', 'PR-TYF') === true, 'Matcher: "PR-TYF" casa com "PR-TYF"');
  assert(testMatchPrefixo('PS-LBA', 'TYF') === false, 'Matcher: "PS-LBA" não casa com "TYF"');

  function testMatchVoo(voo, termo) {
    if(!termo) return true;
    const v = termo.trim().toUpperCase();
    const fVoo = String(voo || '').toUpperCase();
    return fVoo.includes(v) || v.includes(fVoo);
  }
  assert(testMatchVoo('3374', '3374') === true, 'Matcher: "3374" casa com voo completo "3374"');
  assert(testMatchVoo('3374', '337') === true, 'Matcher: "3374" casa com parcial "337"');
  assert(testMatchVoo('4776', '3374') === false, 'Matcher: "4776" não casa com "3374"');

  const MAPA = { 'RECIFE': 'REC', 'BUENOS AIRES': 'AEP' };
  function testMatchDestino(dest, termo) {
    if(!termo) return true;
    const d = termo.trim().toUpperCase();
    const fDest = String(dest || '').toUpperCase();
    if (fDest.includes(d)) return true;
    if (MAPA[d] && fDest.includes(MAPA[d])) return true;
    return false;
  }
  assert(testMatchDestino('REC', 'REC') === true, 'Matcher: "REC" casa com sigla "REC"');
  assert(testMatchDestino('REC', 'RECIFE') === true, 'Matcher: "REC" casa com nome de cidade "RECIFE"');
  assert(testMatchDestino('AEP', 'BUENOS AIRES') === true, 'Matcher: "AEP" casa com "BUENOS AIRES"');
  assert(testMatchDestino('FOR', 'RECIFE') === false, 'Matcher: "FOR" não casa com "RECIFE"');

  // Validação de busca vazia (UI prompt)
  function testValidacaoBuscaVazia(prefixo, voo, destino) {
    const p = (prefixo || '').trim();
    const v = (voo || '').trim();
    const d = (destino || '').trim();
    return Boolean(p || v || d);
  }
  assert(testValidacaoBuscaVazia('', '', '') === false, 'UI: Busca sem critérios é identificada como vazia');
  assert(testValidacaoBuscaVazia('TYF', '', '') === true, 'UI: Busca com prefixo é válida');
  assert(testValidacaoBuscaVazia('', '3374', '') === true, 'UI: Busca com número de voo é válida');
  assert(testValidacaoBuscaVazia('', '', 'REC') === true, 'UI: Busca com destino é válida');

  console.log('\n================================================================');
  console.log(`📊 RESULTADO DOS TESTES: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('================================================================\n');

  if(failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Erro fatal durante a execução dos testes:', err);
  process.exit(1);
});
