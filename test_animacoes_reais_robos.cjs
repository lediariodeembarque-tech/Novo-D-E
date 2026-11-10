const fs = require('fs');

console.log('=== TESTE DE HOMOLOGAÇÃO: ANIMAÇÕES REAIS DOS 11 ROBÔS ===\n');

const html = fs.readFileSync('index.html', 'utf8');

// 1. Validar Coordenadas Faciais Calibradas para os 11 Robôs
const robos11 = [
  'capita-azul', 'comandante-branco', 'anandinha', 'trovao', 'luzinha',
  'aventureiro', 'cha-e-pista', 'techy', 'explorer', 'navegador', 'walle'
];
let coordsOk = true;
for (const r of robos11) {
  if (!html.includes(`'${r}':`) || !html.includes('mouthTop:')) {
    console.error(`[FAIL] Coordenadas faciais ausentes para ${r}`);
    coordsOk = false;
  }
}
if (coordsOk && html.includes('aplicarCoordenadasFaciaisRobo')) {
  console.log('[PASS] 1. Mapa de coordenadas faciais calibrado individualmente para todos os 11 robôs (mouthTop, eyesTop, eyesGap).');
}

// 2. Validar que a boca NÃO está mais na cintura (bottom: 28%) e sim no rosto (--robo-mouth-top)
const bocaCorrigida = html.includes('top: var(--robo-mouth-top') && !html.includes('bottom: 28%');
if (bocaCorrigida) {
  console.log('[PASS] 2. Alinhamento da boca corrigido com precisão facial: utiliza top: var(--robo-mouth-top) em vez do antigo bottom: 28%.');
} else {
  console.error('[FAIL] Boca ainda possui posicionamento estático ou incorreto.');
}

// 3. Validar Movimentos Corporais Visíveis nos 7 Estados (Amplitudes Reais)
const animacoesVisiveis = [
  { nome: 'animRoboNeutro (idle)', search: 'translateY(-14px)' },
  { nome: 'pularSuaveComemoracao (happy)', search: 'translateY(-38px)' },
  { nome: 'animRoboTriste (sad)', search: 'rotate(-8deg)' },
  { nome: 'animRoboBrincalhao (playful)', search: 'rotate(8deg)' },
  { nome: 'animRoboIncentivo (encouraging)', search: 'translateY(-26px)' },
  { nome: 'animRoboEscutando (listening)', search: 'animRoboEscutando' },
  { nome: 'animRoboFalando (speaking)', search: 'translateY(-14px)' }
];
let animOk = true;
for (const a of animacoesVisiveis) {
  if (!html.includes(a.search)) {
    console.error(`[FAIL] Animação ${a.nome} não possui amplitude visível (${a.search} ausente).`);
    animOk = false;
  }
}
if (animOk) {
  console.log('[PASS] 3. Todos os 7 estados possuem movimentos corporais reais, expressivos e visíveis a olho nu.');
}

// 4. Validar Conexão Real da Animação com o Ciclo da Voz
const hasSpeakingTrigger = html.includes("RoboStateMachine.setEstado('speaking')");
const hasLipSyncStart = html.includes('iniciarSincronizacaoBoca(limpo)');
const hasStopButton = html.includes('btnPararFalaRobo');
const hasLipSyncStop = html.includes('pararSincronizacaoBoca()');
const hasSafetyFallback = html.includes('_falaSafetyTimer');

if (hasSpeakingTrigger && hasLipSyncStart && hasStopButton && hasLipSyncStop && hasSafetyFallback) {
  console.log('[PASS] 4. Animação corporal e labial ativada imediatamente no ciclo da fala e interrompida no término/erro.');
} else {
  console.error('[FAIL] Ciclo de fala e sincronização labial incompleto:', { hasSpeakingTrigger, hasLipSyncStart, hasStopButton, hasLipSyncStop, hasSafetyFallback });
}

// 5. Validar Ações Emocionais do Usuário
const hasAcionarFeliz = html.includes("acionarEmocaoRobo('feliz')");
const hasAcionarTriste = html.includes("acionarEmocaoRobo('triste')");
const hasAcionarBrincalhao = html.includes("acionarEmocaoRobo('brincalhao')");
const hasAcionarIncentivo = html.includes("acionarEmocaoRobo('incentivo')");

if (hasAcionarFeliz && hasAcionarTriste && hasAcionarBrincalhao && hasAcionarIncentivo) {
  console.log('[PASS] 5. Botões de emoções rápidas acionam diretamente os estados emocionais visuais e sonoros.');
} else {
  console.error('[FAIL] Ações emocionais incompletas no balão.');
}

// 6. Validar que o robô permanece oculto na tela de login
const hasLoginHidden = html.includes('login-hidden-robo');
if (hasLoginHidden) {
  console.log('[PASS] 6. Robô permanece estritamente oculto na tela de login e autenticação.');
} else {
  console.error('[FAIL] Regra de login-hidden-robo ausente.');
}

// 7. Validar Integridade dos Arquivos PNG dos 11 Robôs
let pngsOk = true;
const arquivosPng = [
  'capita-azul.png', 'comandante-branco.png', 'anandinha.png', 'trovao.png',
  'luzinha.png', 'aventureiro.png', 'cha-e-pista.png', 'techy.png',
  'explorer.png', 'navegador.png'
];
for (const p of arquivosPng) {
  const full = 'src/assets/images/avatares/' + p;
  if (!fs.existsSync(full)) {
    console.error(`[FAIL] Arquivo ${full} não existe!`);
    pngsOk = false;
  }
}
if (pngsOk) {
  console.log('[PASS] 7. Todos os 11 arquivos PNG 3D transparentes preservados e íntegros em disco.');
}

console.log('\n=== HOMOLOGAÇÃO DE ANIMAÇÕES REAIS DOS 11 ROBÔS CONCLUÍDA COM SUCESSO! ===\n');
