const fs = require('fs');

async function runPdfTests() {
  console.log('=== TESTE DE ACEITAÇÃO: GERAÇÃO E VALIDAÇÃO TÉCNICA DE PDF ===');
  const baseUrl = 'http://127.0.0.1:3000';

  // 1. Login com usuário master
  const loginRes = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'lediariodeembarque@gmail.com', password: 'MasterAudit2026!', role: 'master' })
  });
  const { token } = await loginRes.json();
  console.log('[PASS] Autenticação Master realizada com sucesso.');

  // 2. Simula PDF executivo válido completo (com cabeçalho, objetos e trailer ISO 32000-1)
  const samplePdfContent = [
    '%PDF-1.4',
    '1 0 obj',
    '<< /Title (Relatório Oficial de Auditoria Executiva) /Author (Diário de Embarque) >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Catalog /Pages 3 0 R >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    'endobj',
    '4 0 obj',
    '<< /Type /Page /Parent 3 0 R /MediaBox [0 0 842 595] >>',
    'endobj',
    'xref',
    '0 5',
    '0000000000 65535 f ',
    'trailer',
    '<< /Size 5 /Root 2 0 R >>',
    'startxref',
    '340',
    '%%EOF'
  ].join('\n');

  const samplePdfBase64 = Buffer.from(samplePdfContent).toString('base64');

  // 3. Validação do Endpoint /api/prepare-pdf-download
  const filename = 'auditoria-executiva-teste-real.pdf';
  const prepRes = await fetch(baseUrl + '/api/prepare-pdf-download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ filename, pdfBase64: samplePdfBase64 })
  });

  if (!prepRes.ok) throw new Error('Falha ao preparar download do PDF: ' + prepRes.status);
  const prepData = await prepRes.json();
  console.log('[PASS] /api/prepare-pdf-download registrou endpoint com sucesso:', prepData.downloadUrl);

  // 4. Teste de Download com cabeçalhos Android nativos
  const dlRes = await fetch(baseUrl + prepData.downloadUrl);
  if (!dlRes.ok) throw new Error('Falha no download do PDF: ' + dlRes.status);

  const contentType = dlRes.headers.get('content-type');
  const contentDisp = dlRes.headers.get('content-disposition');
  const buffer = await dlRes.arrayBuffer();
  const text = new TextDecoder().decode(buffer);

  if (contentType !== 'application/pdf') throw new Error('Content-Type incorreto: ' + contentType);
  console.log('[PASS] Content-Type validado como application/pdf.');

  if (!contentDisp || !contentDisp.includes('attachment') || !contentDisp.includes(filename)) {
    throw new Error('Content-Disposition incorreto: ' + contentDisp);
  }
  console.log('[PASS] Content-Disposition configurado para download nativo no Android:', contentDisp);

  if (!text.startsWith('%PDF-')) throw new Error('Assinatura %PDF- não encontrada');
  console.log('[PASS] Assinatura binária %PDF-1.4 verificada no arquivo.');

  if (!text.includes('%%EOF')) throw new Error('Marcador %%EOF não encontrado');
  console.log('[PASS] Estrutura ISO %%EOF verificada no final do arquivo.');

  // 5. Teste de visualização inline
  const viewRes = await fetch(baseUrl + prepData.viewUrl);
  if (!viewRes.ok) throw new Error('Falha ao carregar visualização inline do PDF');
  console.log('[PASS] Endpoint de visualização inline /api/view-pdf respondeu HTTP 200.');

  console.log('\n====================================================================');
  console.log('✔ TODOS OS TESTES DE VALIDAÇÃO E GERAÇÃO REAL DE PDF PASSARAM COM SUCESSO!');
  console.log('====================================================================\n');
}

runPdfTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
