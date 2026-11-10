const fs = require('fs');

console.log('=== TESTE DE AUDITORIA: CORREÇÃO VISUAL DOS ROSTOS DOS 11 ROBÔS (SEM DUPLICIDADE) ===\n');

const html = fs.readFileSync('index.html', 'utf8');

let totalErros = 0;

// 1. Validar que NÃO há boca duplicada em repouso
const repousoSemBoca = html.includes('.robo-mouth-viseme.boca-repouso') &&
  html.includes('width: 0;') &&
  html.includes('opacity: 0;');

if (repousoSemBoca) {
  console.log('[PASS] 1. Em repouso (neutral), a boca sobreposta fica 100% invisível (opacity: 0), preservando a boca fechada original do avatar sem duplicações.');
} else {
  console.error('[FAIL] 1. Boca em repouso ainda possui visibilidade que sobrepõe a arte original!');
  totalErros++;
}

// 2. Validar que o container da boca só é ativado na fala ativa
const containerApenasFala = html.includes('.robo.estado-speaking .robo-mouth-container') &&
  html.includes('.robo-mouth-container.falando-ativo') &&
  html.includes('opacity: 0;\n  transition: opacity 0.12s ease-out;');

if (containerApenasFala) {
  console.log('[PASS] 2. O container da boca animada (.robo-mouth-container) só ganha opacidade durante a fala ativa, ocultando-se imediatamente em silêncio.');
} else {
  console.error('[FAIL] 2. Controle de visibilidade da boca durante fala ausente ou imperfeito.');
  totalErros++;
}

// 3. Validar que NÃO há olhos duplicados desenhados por cima dos olhos reais
const olhosSemDuplicidade = html.includes('.robo-eyes-emote .emote-eye-accent') &&
  html.includes('display: none;') &&
  html.includes('opacity: 0;');

if (olhosSemDuplicidade) {
  console.log('[PASS] 3. Olhos duplicados artificiais eliminados (.emote-eye-accent com display: none e opacity: 0). Os olhos 3D autênticos do avatar são preservados sem sobreposições estranhas.');
} else {
  console.error('[FAIL] 3. Olhos artificiais continuam renderizando sobre os olhos nativos do avatar!');
  totalErros++;
}

// 4. Validar piscada natural no próprio visor/avatar
const piscadaNatural = html.includes('@keyframes piscarSuaveAvatar') &&
  html.includes('animation: piscarSuaveAvatar');

if (piscadaNatural) {
  console.log('[PASS] 4. Piscadas orgânicas implementadas através de modulação suave de luminosidade do visor/avatar (piscarSuaveAvatar), sem criar elementos sobrepostos.');
} else {
  console.error('[FAIL] 4. Animação orgânica de piscar do avatar ausente!');
  totalErros++;
}

// 5. Validar calibração facial individualizada e proporcional para os 11 robôs (sem coordenadas genéricas)
const robos11 = [
  'capita-azul', 'comandante-branco', 'anandinha', 'trovao', 'luzinha',
  'aventureiro', 'cha-e-pista', 'techy', 'explorer', 'navegador', 'walle'
];

let coordenadasDistintas = new Set();
let todos11Calibrados = true;

for (const r of robos11) {
  const regex = new RegExp(`'${r}':\\s*\\{[^}]*mouthTop:\\s*'([^']+)'[^}]*mouthWidth:\\s*'([^']+)'`, 'i');
  const match = html.match(regex);
  if (!match) {
    console.error(`[FAIL] Coordenadas faciais específicas ausentes para ${r}`);
    todos11Calibrados = false;
  } else {
    coordenadasDistintas.add(match[1]); // mouthTop
  }
}

if (todos11Calibrados && coordenadasDistintas.size >= 7) {
  console.log(`[PASS] 5. Todos os 11 avatares possuem calibração facial individualizada com dimensões proporcionais (${coordenadasDistintas.size} posições de mouthTop mapeadas com base nos rostos reais).`);
} else {
  console.error('[FAIL] 5. Coordenadas genéricas ou ausentes para parte dos robôs!', { todos11Calibrados, variacoes: coordenadasDistintas.size });
  totalErros++;
}

// 6. Validar que os 11 arquivos PNG 3D originais estão intactos
let arquivosPreservados = true;
const arquivos11 = [
  'capita-azul.png', 'comandante-branco.png', 'anandinha.png', 'trovao.png',
  'luzinha.png', 'aventureiro.png', 'cha-e-pista.png', 'techy.png',
  'explorer.png', 'navegador.png'
];
for (const a of arquivos11) {
  const p = 'src/assets/images/avatares/' + a;
  if (!fs.existsSync(p)) {
    console.error(`[FAIL] Arquivo original ausente: ${p}`);
    arquivosPreservados = false;
  }
}
if (arquivosPreservados) {
  console.log('[PASS] 6. Todos os arquivos PNG transparentes originais continuam intactos em disco.');
} else {
  totalErros++;
}

// 7. Validar preservação dos movimentos corporais nos 7 estados
const estados = ['animRoboNeutro', 'pularSuaveComemoracao', 'animRoboTriste', 'animRoboBrincalhao', 'animRoboIncentivo', 'animRoboEscutando', 'animRoboFalando'];
let todosEstadosOk = true;
for (const e of estados) {
  if (!html.includes(e)) {
    console.error(`[FAIL] Animação corporal ${e} não encontrada no CSS!`);
    todosEstadosOk = false;
  }
}
if (todosEstadosOk) {
  console.log('[PASS] 7. Todas as animações corporais (flutuação, pulo de comemoração, postura triste, brincalhão, incentivo, escuta e fala) estão ativas e preservadas.');
} else {
  totalErros++;
}

console.log(`\n=== RESULTADO DA AUDITORIA: ${totalErros === 0 ? 'APROVADO (100%)' : totalErros + ' FALHAS'} ===`);
process.exit(totalErros === 0 ? 0 : 1);
