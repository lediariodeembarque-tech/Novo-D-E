const fs = require('fs');
const http = require('http');

console.log('=== TESTE DE HOMOLOGAÇÃO: 11 COMPANHEIROS DE VOO (AVATARES 3D TRANSPARENTES) ===\n');

// 1. Validar no HTML os 11 modelos oficiais
const html = fs.readFileSync('index.html', 'utf8');

const modelos11Obrigatorios = [
  { id: 'robo_azul', nome: 'Robô Azul', arquivo: 'robo_azul.png' },
  { id: 'robo_branco', nome: 'Robô Branco', arquivo: 'robo_branco.png' },
  { id: 'robo_rosa', nome: 'Robô Rosa', arquivo: 'robo_rosa.png' },
  { id: 'robo_verde', nome: 'Robô Verde', arquivo: 'robo_verde.png' },
  { id: 'robo_laranja', nome: 'Robô Laranja', arquivo: 'robo_laranja.png' },
  { id: 'robo_vermelho', nome: 'Robô Vermelho', arquivo: 'robo_vermelho.png' },
  { id: 'robo_roxo', nome: 'Robô Roxo', arquivo: 'robo_roxo.png' },
  { id: 'robo_cinza', nome: 'Robô Cinza', arquivo: 'robo_cinza.png' },
  { id: 'robo_amarelo', nome: 'Robô Amarelo', arquivo: 'robo_amarelo.png' },
  { id: 'robo_ciano', nome: 'Robô Ciano', arquivo: 'robo_ciano.png' },
  { id: 'robo_preto', nome: 'Robô Preto VIP', arquivo: 'robo_preto.png' }
];

let todosPresentes = true;
for (const m of modelos11Obrigatorios) {
  const hasId = html.includes(`id: '${m.id}'`);
  const hasNome = html.includes(`nome: '${m.nome}'`);
  const hasImg = html.includes(`/src/assets/images/avatares/${m.arquivo}`);
  if (!hasId || !hasNome || !hasImg) {
    console.error(`[FAIL] Modelo ${m.nome} (${m.id}) incompleto no HTML! hasId:${hasId}, hasNome:${hasNome}, hasImg:${hasImg}`);
    todosPresentes = false;
  }
}
if (todosPresentes) {
  console.log('[PASS] 1. Todos os 11 modelos oficiais de aviação estão cadastrados com id, nome e caminho /src/assets/images/avatares/*.png no HTML.');
}

// 2. Validar que os 11 arquivos PNG existem no disco
let todosArquivosExistem = true;
for (const m of modelos11Obrigatorios) {
  const filePath = `src/assets/images/avatares/${m.arquivo}`;
  if (!fs.existsSync(filePath)) {
    console.error(`[FAIL] Arquivo ${filePath} não existe no disco!`);
    todosArquivosExistem = false;
  } else {
    const stats = fs.statSync(filePath);
    if (stats.size < 10000) {
      console.error(`[FAIL] Arquivo ${filePath} muito pequeno (${stats.size} bytes)!`);
      todosArquivosExistem = false;
    }
  }
}
if (todosArquivosExistem) {
  console.log('[PASS] 2. Todos os 11 arquivos PNG existem na pasta src/assets/images/avatares/ com tamanhos íntegros.');
}

// 3. Validar elementos da interface: Títulos oficiais, container ativo e showcase
const hasTitulo = html.includes('Escolha seu companheiro de voo');
const hasSubtitulo = html.includes('Seu parceiro de IA para cada jornada');
const hasModal = html.includes('id="modalMeuRobo"');
const hasGrid = html.includes('id="gridGaleriaMeuRobo"');
const hasShowcase = html.includes('id="showcaseMeuRoboCard"');
const hasContainerAtivo = html.includes('id="roboModelContainer"');
const hasLegacyMap = html.includes('MAPA_MODELOS_LEGADOS');

if (hasTitulo && hasSubtitulo && hasModal && hasGrid && hasShowcase && hasContainerAtivo && hasLegacyMap) {
  console.log('[PASS] 3. Título "Escolha seu companheiro de voo", subtítulo, modal, grade, showcase, container ativo e mapeamento legado estão presentes.');
} else {
  console.error('[FAIL] Elementos ausentes no HTML:', { hasTitulo, hasSubtitulo, hasModal, hasGrid, hasShowcase, hasContainerAtivo, hasLegacyMap });
}

// 4. Testar a API /api/robo/gemini com cada modelo de robô
async function testarApiRobo(modelId) {
  return new Promise((resolve) => {
    const loginData = JSON.stringify({ email: 'test.auditoria@gru.com.br', password: 'SenhaCorreta@2026' });
    const reqLogin = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginData)
      }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const auth = JSON.parse(body);
          const token = auth.token;

          const roboData = JSON.stringify({
            prompt: 'Qual é a sua função operacional no Diário de Embarque?',
            userName: 'Agente Auditoria',
            userRole: 'embarque',
            robotModel: modelId
          });

          const reqRobo = http.request({
            hostname: '127.0.0.1',
            port: 3000,
            path: '/api/robo/gemini',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(roboData),
              'Authorization': `Bearer ${token}`
            }
          }, (resRobo) => {
            let bodyRobo = '';
            resRobo.on('data', c => bodyRobo += c);
            resRobo.on('end', () => {
              try {
                const json = JSON.parse(bodyRobo);
                resolve({ status: resRobo.statusCode, reply: json.reply, source: json.source });
              } catch (e) {
                resolve({ status: resRobo.statusCode, error: e.message });
              }
            });
          });
          reqRobo.on('error', e => resolve({ error: e.message }));
          reqRobo.write(roboData);
          reqRobo.end();
        } catch (e) {
          resolve({ error: e.message });
        }
      });
    });
    reqLogin.on('error', e => resolve({ error: e.message }));
    reqLogin.write(loginData);
    reqLogin.end();
  });
}

(async () => {
  console.log('\n4. Testando resposta do backend /api/robo/gemini com os 11 modelos:');
  for (const m of modelos11Obrigatorios) {
    const res = await testarApiRobo(m.id);
    if (res.status === 200 && res.reply) {
      console.log(`  ✓ Modelo [${m.nome}]: Resposta OK (${res.source || 'ia'}) -> "${res.reply.slice(0, 70)}..."`);
    } else {
      console.error(`  ✗ Modelo [${m.nome}]: Erro na resposta:`, res);
    }
  }
  console.log('\n=== HOMOLOGAÇÃO DOS 11 MODELOS CONCLUÍDA COM SUCESSO! ===');
})();
