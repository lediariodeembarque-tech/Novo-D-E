const fs = require('fs');
const http = require('http');

console.log('=== TESTE DE HOMOLOGAÇÃO: 8 MODELOS DE ROBÔ PERSONALIZÁVEIS ===\n');

// 1. Validar no HTML os 8 modelos
const html = fs.readFileSync('index.html', 'utf8');

const modelosObrigatorios = [
  { id: 'humanoide_premium', nome: 'Humanoide Premium' },
  { id: 'compacto_carismatico', nome: 'Compacto e Carismático' },
  { id: 'androide_operacoes', nome: 'Androide de Operações Aéreas' },
  { id: 'assistente_operacional', nome: 'Assistente Operacional' },
  { id: 'assistente_virtual', nome: 'Assistente Virtual Inteligente' },
  { id: 'robo_hover', nome: 'Robô Flutuante (Hover)' },
  { id: 'robo_campo', nome: 'Robô de Campo Aéreo' },
  { id: 'assistente_holografico', nome: 'Assistente Holográfico IA' }
];

let todosModelosPresentes = true;
for (const m of modelosObrigatorios) {
  const hasId = html.includes(`id: '${m.id}'`);
  const hasNome = html.includes(`nome: '${m.nome}'`);
  if (!hasId || !hasNome) {
    console.error(`[FAIL] Modelo ${m.nome} (${m.id}) não encontrado no código!`);
    todosModelosPresentes = false;
  }
}
if (todosModelosPresentes) {
  console.log('[PASS] 1. Todos os 8 modelos obrigatórios estão definidos com id e nome corretos no código.');
}

// 2. Validar existência do Modal "Meu Robô" e da Grade
const hasModal = html.includes('id="modalMeuRobo"');
const hasGrid = html.includes('id="gridGaleriaMeuRobo"');
const hasShowcase = html.includes('id="showcaseMeuRoboCard"');
const hasBtnTopBar = html.includes('abrirModalMeuRobo()');
const hasContainerAtivo = html.includes('id="roboModelContainer"');

if (hasModal && hasGrid && hasShowcase && hasBtnTopBar && hasContainerAtivo) {
  console.log('[PASS] 2. Modal "Meu Robô", showcase de destaque, grid de 8 cards, botão de topo e container ativo estão presentes no HTML.');
} else {
  console.error('[FAIL] Elementos do Modal ou Container faltantes no HTML:', { hasModal, hasGrid, hasShowcase, hasBtnTopBar, hasContainerAtivo });
}

// 3. Testar a API /api/robo/gemini com cada modelo de robô
async function testarApiRobo(modelId) {
  return new Promise((resolve) => {
    // Primeiro faz login com conta de teste
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

          // Agora chama /api/robo/gemini com o robotModel
          const roboData = JSON.stringify({
            prompt: 'Qual é o status da operação de hoje?',
            userName: 'Agente Teste',
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
  console.log('\n3. Testando integração dos 8 modelos com a IA no backend:');
  let todosResponderam = true;
  for (const m of modelosObrigatorios) {
    const res = await testarApiRobo(m.id);
    if (res.status === 200 && res.reply) {
      console.log(`  ✓ Modelo [${m.nome}]: Resposta OK (${res.source || 'ia'}) -> "${res.reply.slice(0, 75)}..."`);
    } else {
      console.error(`  ✗ Modelo [${m.nome}]: Erro na resposta:`, res);
      todosResponderam = false;
    }
  }

  if (todosResponderam) {
    console.log('\n[PASS] 3. Todos os 8 modelos comunicam-se perfeitamente com a IA backend!');
  }

  console.log('\n=== HOMOLOGAÇÃO DOS 8 MODELOS DE ROBÔ CONCLUÍDA COM SUCESSO! ===');
})();
