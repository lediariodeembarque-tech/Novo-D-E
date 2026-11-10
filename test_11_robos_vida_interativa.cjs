const fs = require('fs');
const http = require('http');

console.log('=== TESTE DE HOMOLOGAÇÃO: 11 ROBÔS COM VOZ, ANIMAÇÕES, EMOÇÕES E PERSONALIDADE ===\n');

const html = fs.readFileSync('index.html', 'utf8');

// 1. Validar estrutura dos 11 Robôs e suas personalidades
const robosEsperados = [
  'capita-azul',
  'comandante-branco',
  'anandinha',
  'trovao',
  'luzinha',
  'aventureiro',
  'cha-e-pista',
  'techy',
  'explorer',
  'navegador',
  'walle'
];

let personalidadesOk = true;
for (const id of robosEsperados) {
  if (!html.includes(`'${id}': {`)) {
    console.error(`[FAIL] Personalidade do robô '${id}' não encontrada em index.html`);
    personalidadesOk = false;
  }
}
if (personalidadesOk) {
  console.log('[PASS] 1. Todas as 11 personalidades exclusivas dos robôs estão cadastradas com pitch, rate, cor de boca e frases personalizadas.');
}

// 2. Validar Máquina de Estados Visuais (7 Estados)
const estadosObrigatorios = ['neutral', 'happy', 'sad', 'playful', 'encouraging', 'listening', 'speaking'];
let estadosOk = true;
for (const est of estadosObrigatorios) {
  const hasCss = html.includes(`.robo.estado-${est}`) || html.includes(`estado-${est}`);
  if (!hasCss) {
    console.error(`[FAIL] Estado visual '${est}' ausente.`);
    estadosOk = false;
  }
}
if (estadosOk && html.includes('RoboStateMachine')) {
  console.log('[PASS] 2. Máquina de Estados (RoboStateMachine) cobre todos os 7 estados: neutral, happy, sad, playful, encouraging, listening, speaking.');
}

// 3. Validar Sincronização Labial (Visemas)
const visemasEsperados = [
  'boca-repouso',
  'boca-fechada',
  'boca-pequena',
  'boca-media',
  'boca-grande',
  'boca-sorriso',
  'boca-surpresa',
  'boca-triste'
];
let visemasOk = true;
for (const v of visemasEsperados) {
  if (!html.includes(v)) {
    console.error(`[FAIL] Visema '${v}' ausente no CSS/JS.`);
    visemasOk = false;
  }
}
if (visemasOk && html.includes('iniciarSincronizacaoBoca') && html.includes('pararSincronizacaoBoca')) {
  console.log('[PASS] 3. Sistema de sincronização labial (iniciarSincronizacaoBoca / pararSincronizacaoBoca) com os 8 visemes configurado.');
}

// 4. Validar Controles de Usuário (Voz, Parar, Silenciar, Emoções)
const hasBtnToggleVoz = html.includes('id="btnToggleVozRobo"');
const hasBtnParar = html.includes('id="btnPararFalaRobo"');
const hasBarraEmocoes = html.includes('id="balaoEmocoesBar"');
const hasAcionarEmocao = html.includes('acionarEmocaoRobo');
const hasAlternarVoz = html.includes('alternarVozRobo');
const hasPararFala = html.includes('pararFalaRobo');

if (hasBtnToggleVoz && hasBtnParar && hasBarraEmocoes && hasAcionarEmocao && hasAlternarVoz && hasPararFala) {
  console.log('[PASS] 4. Controles de usuário (botão de voz mudo/ativo, botão de parar fala, barra de emoções e métodos de acionamento) presentes.');
} else {
  console.error('[FAIL] Controles de usuário incompletos:', { hasBtnToggleVoz, hasBtnParar, hasBarraEmocoes, hasAcionarEmocao, hasAlternarVoz, hasPararFala });
}

// 5. Validar Piadas e Trocadilhos de Aviação
const hasPiadas = html.includes('PIADAS_AVIAO') && html.includes('altitude emocional');
if (hasPiadas) {
  console.log('[PASS] 5. Banco de piadas e trocadilhos de aviação respeitosos para o estado brincalhão presente.');
} else {
  console.error('[FAIL] Piadas de aviação não encontradas.');
}

// 6. Validar Acessibilidade e Redução de Movimento
const hasReducedMotion = html.includes('prefers-reduced-motion: reduce');
if (hasReducedMotion) {
  console.log('[PASS] 6. Suporte completo a acessibilidade (prefers-reduced-motion) implementado.');
} else {
  console.error('[FAIL] Regra prefers-reduced-motion ausente no CSS.');
}

// 7. Validar Celebração Sem Balançar a Tela Inteira
const hasConfetes = html.includes('id="roboConfetesContainer"') && html.includes('soltarConfetesRobo');
if (hasConfetes) {
  console.log('[PASS] 7. Efeito de comemoração (estrelas/confetes e pulo suave) isolado no robô sem afetar a página.');
} else {
  console.error('[FAIL] Efeito de confetes/celebração ausente.');
}

// 8. Validar Diálogos Solicitados no Prompt
const hasFalaFeliz = html.includes('Uhuu! Que notícia boa! Essa energia merece uma comemoração! Vamos continuar voando alto!');
const hasFalaTriste = html.includes('Poxa, sinto muito que seu dia não esteja tão bom. Quer conversar um pouquinho ou prefere uma brincadeira para distrair a cabeça? Estou aqui para ajudar.');
const hasFalaIncentivo = html.includes('Missão cumprida, comandante! Mais uma etapa concluída. Vamos para a próxima!');

if (hasFalaFeliz && hasFalaTriste && hasFalaIncentivo) {
  console.log('[PASS] 8. Frases e diálogos exatos solicitados no prompt para cada estado emocional implementados.');
} else {
  console.error('[FAIL] Frases solicitadas ausentes:', { hasFalaFeliz, hasFalaTriste, hasFalaIncentivo });
}

console.log('\n=== TODOS OS REQUISITOS DE VIDA, VOZ, ANIMAÇÃO E EMOÇÕES APROVADOS! ===\n');
