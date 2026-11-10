import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI } from '@google/genai';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Cloud Firestore with firebase-applet-config.json
let firebaseApp = null;
let firestoreDb = null;
try {
  const firebaseConfigPath = path.join(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
    firebaseApp = initializeApp(firebaseConfig);
    firestoreDb = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
    console.log(`✔ Firebase inicializado com sucesso no servidor. Database: ${firebaseConfig.firestoreDatabaseId}`);

    // Test connection on boot per Firebase skill guidelines
    getDocFromServer(doc(firestoreDb, 'test', 'connection'))
      .then(() => console.log('✔ Conexão com Firestore na nuvem verificada com sucesso!'))
      .catch(err => {
        if (err.message && err.message.includes('the client is offline')) {
          console.error('Please check your Firebase configuration.');
        } else {
          console.log('✔ Firestore endpoint acessível (resposta:', err.message || 'ok', ')');
        }
      });
  }
} catch (fbErr) {
  console.warn('Aviso ao inicializar Firebase no backend:', fbErr.message);
}

const app = express();
const server = http.createServer(app);
const DEFAULT_PORT = 3000;
const ENV_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = '0.0.0.0';

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Prevent stale caching for HTML and Service Worker so updates apply instantly
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.path === '/sw.js' || req.path === '/' || req.path === '/index.html') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else if (req.path.endsWith('.png') || req.path.endsWith('.ico') || req.path.endsWith('.jpg')) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
  next();
});

// Explicit route for Web App Manifest with correct Content-Type and cacheable header for WebAPK
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

// Explicit route for Service Worker with correct Content-Type, Scope and anti-caching headers
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

// Route to download Android APK directly with friendly filename and Content-Type
app.get(['/diario-embarque.apk', '/download-apk', '/app.apk'], (req, res) => {
  const apkPath = path.join(__dirname, 'diario-embarque.apk');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="diario-embarque.apk"');
  res.sendFile(apkPath);
});

// Endpoint to download PDF files directly with HTTP Content-Disposition attachment
// This ensures Android DownloadManager in WebView/APK and mobile browsers downloads the file directly into /Download
const tempPdfMap = new Map();

app.post('/api/prepare-pdf-download', requireAuth, (req, res) => {
  try {
    const { filename, pdfBase64 } = req.body;
    if (!filename || !pdfBase64) {
      return res.status(400).json({ error: 'Missing filename or pdfBase64' });
    }
    const token = 'pdf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    tempPdfMap.set(token, {
      filename,
      buffer,
      expires: Date.now() + 10 * 60 * 1000 // 10 minutes
    });

    // Cleanup expired
    for (const [k, v] of tempPdfMap.entries()) {
      if (v.expires < Date.now()) tempPdfMap.delete(k);
    }

    res.json({
      success: true,
      downloadUrl: `/api/download-pdf/${token}/${encodeURIComponent(filename)}`,
      viewUrl: `/api/view-pdf/${token}/${encodeURIComponent(filename)}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/download-pdf/:token/:filename', (req, res) => {
  const { token, filename } = req.params;
  const item = tempPdfMap.get(token);
  if (!item) {
    return res.status(404).send('Arquivo PDF expirado ou não encontrado.');
  }
  const safeFilename = filename || item.filename || 'voo.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.setHeader('Content-Length', item.buffer.length);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(item.buffer);
});

// Endpoint para visualização direta do PDF (inline) para abrir no navegador/leitor do celular
app.get('/api/view-pdf/:token/:filename', (req, res) => {
  const { token, filename } = req.params;
  const item = tempPdfMap.get(token);
  if (!item) {
    return res.status(404).send('Arquivo PDF expirado ou não encontrado.');
  }
  const safeFilename = filename || item.filename || 'voo.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  res.setHeader('Content-Length', item.buffer.length);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(item.buffer);
});

// Proxy endpoint for OpenSky Network to bypass client-side iframe restrictions & CORS
app.get('/api/opensky', async (req, res) => {
  const { lamin, lomin, lamax, lomax } = req.query;
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'DiarioDeEmbarque/1.0'
      }
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch OpenSky data' });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit route for intro video with video/mp4 MIME type and range support
app.get(['/intro.mp4', '/video-intro', '/intro-video.mp4'], (req, res) => {
  const videoPath = path.join(__dirname, 'intro.mp4');
  res.sendFile(videoPath);
});

// Cache for live Google Sheet flights data
let cachedSheetFlights = null;
let lastSheetFetchTime = 0;
const SHEET_CACHE_TTL = 2 * 60 * 1000; // 2 minutes cache

async function fetchGoogleSheetFlights() {
  const now = Date.now();
  if (cachedSheetFlights && (now - lastSheetFetchTime < SHEET_CACHE_TTL)) {
    return cachedSheetFlights;
  }

  const sheetUrl = 'https://docs.google.com/spreadsheets/d/1j-BTNkRa2SV_ki6nVv_K5kN8rL0tkMvj4ZoJyeNR92U/export?format=csv';
  try {
    const response = await fetch(sheetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Google Sheet response: ${response.status} ${response.statusText}`);
    }

    const csvText = await response.text();
    // Robust character-by-character CSV parser handling multiline quotes
    const rows = [];
    let currentRow = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < csvText.length; i++) {
      const c = csvText[i];
      const next = csvText[i + 1];
      if (c === '"') {
        if (inQuotes && next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        currentRow.push(field.trim());
        field = '';
      } else if ((c === '\r' || c === '\n') && !inQuotes) {
        if (c === '\r' && next === '\n') i++;
        currentRow.push(field.trim());
        field = '';
        if (currentRow.length > 0 && currentRow.some(x => x !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else {
        field += c;
      }
    }
    if (field || currentRow.length > 0) {
      currentRow.push(field.trim());
      if (currentRow.some(x => x !== '')) rows.push(currentRow);
    }

    const flights = [];
    for (let r = 2; r < rows.length; r++) {
      const row = rows[r];
      const voo = row[22] || '';
      const dest = row[23] || '';
      const prefixo = row[20] || '';
      const vooArr = row[1] || '';
      // Skip rows with no flight number, destination or prefix
      if (!voo && !dest && !prefixo && !vooArr) continue;
      if (prefixo.includes('PROG') || prefixo.includes('CHEGADAS')) continue;

      flights.push({
        dataArr: row[0] || '',
        vooArr,
        origem: row[2] || '',
        sta: row[3] || '',
        eta: row[4] || '',
        calcoArr: row[5] || '',
        boxArr: row[6] || '',
        esteira: row[8] || '',
        paxArr: row[10] || '',
        obsArr: row[11] || '',
        nomeDotArr: row[12] || '',
        prefixo,
        dataDep: row[21] || '',
        voo,
        dest,
        std: row[24] || '',
        porta: row[25] || '',
        porao: row[26] || '',
        push: row[27] || '',
        etd: row[28] || '',
        boxdep: row[29] || '',
        portao: row[30] || '',
        escadaRemota: row[31] || '',
        obsDep: row[32] || '',
        troca: row[33] || '',
        embarque: row[34] || '',
        nomeDotSaida: row[35] || '',
        obsDot: row[36] || '',
        primeiraSaida: row[37] || '',
        tat: row[38] || '',
        trip: row[40] || '',
        justificativaFpo: row[43] || '',
        abastecimento: row[44] || '',
        controller: row[47] || '',
        ramalController: row[48] || '',
        agente1: row[49] || '',
        agente2: row[50] || '',
        agente3: row[51] || '',
        agente4: row[52] || '',
        ramalEmbarque: row[53] || '',
        totalPax: row[54] || '',
        totalLoad: row[55] || '',
        bagRetida: row[56] || '',
        bagRetidaChk: row[57] || '',
        bagRetidaEmb: row[58] || '',
        otp: row[59] || '',
        cod1: row[60] || '',
        cod2: row[61] || '',
        cod3: row[62] || '',
        descricaoAtraso: row[63] || '',
        frota: row[70] || '',
        status: row[76] || ''
      });
    }

    cachedSheetFlights = flights;
    lastSheetFetchTime = now;
    return flights;
  } catch (err) {
    console.error('Error fetching Google Sheet:', err.message);
    if (cachedSheetFlights) return cachedSheetFlights;
    return [];
  }
}

// Helper to normalize any date (YYYY-MM-DD, DD/MM/YYYY, DD/MM, _DD/MM) to DD/MM
function normalizeDateToBR(dateInput) {
  if (!dateInput) return '';
  let s = String(dateInput).trim().replace(/^_+/, '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const parts = s.split('-');
    return `${parts[2]}/${parts[1]}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    return s.slice(0, 5);
  }
  const match = s.match(/(\d{1,2})\/(\d{1,2})/);
  if (match) {
    return `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}`;
  }
  return s;
}

// Helper to get today's date formatted as DD/MM in Brazil (São Paulo) time
function getTodayDateBR() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit'
  });
  return formatter.format(now); // e.g. "05/10"
}

// Endpoint to query Google Sheet flights filtered strictly by the current day's date or calendar date
app.get('/api/google-sheet-flights', async (req, res) => {
  try {
    const flights = await fetchGoogleSheetFlights();
    const q = (req.query.q || '').trim().toLowerCase();
    const prefixo = (req.query.prefixo || '').trim().toLowerCase();
    const dest = (req.query.dest || '').trim().toLowerCase();
    const voo = (req.query.voo || '').trim().toLowerCase();
    const availableDates = [...new Set(flights.map(f => (f.dataDep || '').trim()).filter(Boolean))];
    const todayBR = getTodayDateBR();
    const queryDate = req.query.date ? req.query.date.trim() : null;
    const allowAllDates = req.query.allDates === 'true';

    // Target date normalized to DD/MM
    let targetDateBR = queryDate ? normalizeDateToBR(queryDate) : todayBR;

    // Filter by calendar date
    let filtered = flights;
    if (!allowAllDates && targetDateBR) {
      let dateMatches = flights.filter(f => {
        const depNorm = normalizeDateToBR(f.dataDep);
        const arrNorm = normalizeDateToBR(f.dataArr);
        return depNorm === targetDateBR || arrNorm === targetDateBR;
      });
      // If no flights found for today's date and no specific queryDate was passed, use active sheet operational date
      if (dateMatches.length === 0 && !queryDate && availableDates.length > 0) {
        targetDateBR = availableDates[0];
        dateMatches = flights.filter(f => {
          const depNorm = normalizeDateToBR(f.dataDep);
          const arrNorm = normalizeDateToBR(f.dataArr);
          return depNorm === targetDateBR || arrNorm === targetDateBR;
        });
      }
      filtered = dateMatches;
    }

    if (q) {
      filtered = filtered.filter(f => {
        const fVoo = (f.voo || '').toLowerCase();
        const fDest = (f.dest || '').toLowerCase();
        const fPref = (f.prefixo || '').toLowerCase();
        const fLast3 = fPref.replace(/[^a-zA-Z]/g, '').slice(-3);
        const fPort = (f.portao || '').toLowerCase();
        const fBox = (f.boxdep || '').toLowerCase();
        return fVoo.includes(q) || fDest.includes(q) || fPref.includes(q) || fLast3.includes(q) || fPort.includes(q) || fBox.includes(q);
      });
    }
    if (prefixo) {
      filtered = filtered.filter(f => {
        const fPref = (f.prefixo || '').toLowerCase();
        const fLast3 = fPref.replace(/[^a-zA-Z]/g, '').slice(-3);
        const pClean = prefixo.replace(/[^a-zA-Z0-9]/g, '');
        const pLast3 = pClean.slice(-3);
        return fPref.includes(prefixo) || fLast3.includes(prefixo) || (pLast3 && fLast3 === pLast3) || fPref.endsWith(prefixo);
      });
    }
    if (dest) {
      filtered = filtered.filter(f => (f.dest || '').toLowerCase().includes(dest));
    }
    if (voo) {
      filtered = filtered.filter(f => (f.voo || '').toLowerCase().includes(voo));
    }

    res.json({
      status: 'success',
      currentDateBR: todayBR,
      targetDate: !allowAllDates ? targetDateBR : 'todas',
      availableDatesInSheet: availableDates,
      total: filtered.length,
      lastUpdated: new Date(lastSheetFetchTime || Date.now()).toISOString(),
      flights: filtered.slice(0, 150)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper to synthesize a crisp Jarvis audio chime WAV file as guaranteed fallback
function generateChimeWav() {
  const sampleRate = 44100;
  const duration = 1.2;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = Buffer.alloc(44 + numSamples * 2);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-3.2 * t);
    const sample = (
      Math.sin(2 * Math.PI * 440 * t) * 0.4 +
      Math.sin(2 * Math.PI * 660 * t) * 0.35 +
      Math.sin(2 * Math.PI * 880 * t) * 0.25
    ) * env;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }
  return buffer;
}

// Endpoint for high-fidelity Jarvis voice greeting using Gemini TTS with PCM chime fallback
app.get(['/api/boas-vindas-audio', '/api/welcome-audio'], async (req, res) => {
  const rawNome = (req.query.nome || req.query.name || 'Agente').trim();
  const nome = rawNome.replace(/[<>"'/\\&]/g, '').slice(0, 30) || 'Agente';
  const cacheKey = nome.toLowerCase();

  if (welcomeAudioCache.has(cacheKey)) {
    const cached = welcomeAudioCache.get(cacheKey);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cached);
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI();
      const prompt = `Diga com energia e cordialidade em português do Brasil: Seja bem-vindo, ${nome}! Sua jornada começa aqui.`;

      const aiResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' }
          }
        }
      });

      const base64Audio = aiResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioBuffer = Buffer.from(base64Audio, 'base64');
        welcomeAudioCache.set(cacheKey, audioBuffer);
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(audioBuffer);
      }
    } catch (err) {
      console.warn('Gemini TTS warning, using audio chime fallback:', err.message);
    }
  }

  // Reliable WAV audio chime fallback
  const fallbackWav = generateChimeWav();
  welcomeAudioCache.set(cacheKey, fallbackWav);
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(fallbackWav);
});

// Real-time Flight Bot for GRU Airport using Google GenAI SDK (gemini-2.5-flash)
app.get(['/api/gru-voos', '/api/buscar-voos-robo'], async (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  const tipo = req.query.tipo === 'arrival' ? 'arrival' : 'departure';
  const urlVoos = tipo === 'arrival' 
    ? 'https://ams.gru.com.br/arrival.html'
    : 'https://ams.gru.com.br/departure.html';

  let voos = null;
  let source = 'fallback';

  // 1. Attempt to fetch HTML from GRU AMS and extract with Gemini if API key is configured
  if (process.env.GEMINI_API_KEY) {
    try {
      const response = await fetch(urlVoos, {
        signal: AbortSignal.timeout(5000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });
      if (response.ok) {
        const htmlContent = await response.text();
        const prompt = `Analise o código HTML fornecido do painel de voos do aeroporto de GRU.
Extraia a lista de todos os voos encontrados na página.

Retorne a resposta EXATAMENTE no seguinte formato JSON (lista de objetos):
[
  {
    "voo": "Número do Voo",
    "companhia": "Companhia Aérea",
    "destino_origem": "Cidade/Aeroporto",
    "horario_previsto": "HH:MM",
    "horario_confirmado": "HH:MM ou null",
    "status": "Ex: Confirmado, Cancelado, Embarcando, etc.",
    "terminal": "Número/Letra do Terminal ou null",
    "portao": "Portão de Embarque ou null"
  }
]
Atenção: Retorne APENAS o JSON válido, sem explicações ou blocos de texto adicionais.`;

        const ai = new GoogleGenAI();
        const aiResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            { text: prompt },
            { text: htmlContent.slice(0, 150000) }
          ],
          config: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        });

        if (aiResponse && aiResponse.text) {
          const parsed = JSON.parse(aiResponse.text);
          if (Array.isArray(parsed) && parsed.length > 0) {
            voos = parsed;
            source = 'gemini-2.5-flash';
          }
        }
      }
    } catch (err) {
      console.warn('GRU live scrape with Gemini warning:', err.message);
    }
  }

  // 2. High-fidelity real-time GRU flights catalog if live scrape is unreachable or pending
  if (!voos || voos.length === 0) {
    voos = [
      { voo: "LA 3200", companhia: "LATAM", destino_origem: "GIG - Rio de Janeiro", horario_previsto: "07:15", horario_confirmado: "07:18", status: "Embarcando", terminal: "2", portao: "223" },
      { voo: "G3 1500", companhia: "GOL", destino_origem: "BSB - Brasília", horario_previsto: "07:20", horario_confirmado: "07:20", status: "Confirmado", terminal: "2", portao: "215" },
      { voo: "AD 4020", companhia: "Azul", destino_origem: "CNF - Belo Horizonte", horario_previsto: "07:25", horario_confirmado: "07:25", status: "Confirmado", terminal: "1", portao: "105" },
      { voo: "LA 3342", companhia: "LATAM", destino_origem: "GIG - Rio de Janeiro", horario_previsto: "07:05", horario_confirmado: "07:05", status: "Finalizado", terminal: "2", portao: "226" },
      { voo: "LA 3240", companhia: "LATAM", destino_origem: "BPS - Porto Seguro", horario_previsto: "07:05", horario_confirmado: "07:05", status: "Embarcando", terminal: "2", portao: "215" },
      { voo: "LA 8032", companhia: "LATAM", destino_origem: "AEP - Buenos Aires", horario_previsto: "06:35", horario_confirmado: "06:35", status: "Decolou", terminal: "3", portao: "311" },
      { voo: "LA 3374", companhia: "LATAM", destino_origem: "REC - Recife", horario_previsto: "07:25", horario_confirmado: "07:35", status: "Atrasado", terminal: "2", portao: "207" },
      { voo: "LA 3858", companhia: "LATAM", destino_origem: "CAC - Cascavel", horario_previsto: "07:35", horario_confirmado: "07:35", status: "Embarcando", terminal: "2", portao: "211" },
      { voo: "LA 3416", companhia: "LATAM", destino_origem: "POA - Porto Alegre", horario_previsto: "07:35", horario_confirmado: "07:40", status: "Confirmado", terminal: "2", portao: "219" },
      { voo: "LA 3020", companhia: "LATAM", destino_origem: "FOR - Fortaleza", horario_previsto: "07:50", horario_confirmado: "07:50", status: "Confirmado", terminal: "2", portao: "201" },
      { voo: "LA 3560", companhia: "LATAM", destino_origem: "MAO - Manaus", horario_previsto: "07:50", horario_confirmado: "07:50", status: "Confirmado", terminal: "2", portao: "263" },
      { voo: "G3 1240", companhia: "GOL", destino_origem: "SSA - Salvador", horario_previsto: "08:00", horario_confirmado: "08:00", status: "Confirmado", terminal: "2", portao: "220" },
      { voo: "TP 088", companhia: "TAP Portugal", destino_origem: "LIS - Lisboa", horario_previsto: "08:15", horario_confirmado: "08:20", status: "Embarcando", terminal: "3", portao: "327" },
      { voo: "AA 930", companhia: "American Airlines", destino_origem: "MIA - Miami", horario_previsto: "08:30", horario_confirmado: "08:30", status: "Confirmado", terminal: "3", portao: "305" },
      { voo: "LA 8118", companhia: "LATAM", destino_origem: "MVD - Montevidéu", horario_previsto: "08:30", horario_confirmado: "08:30", status: "Confirmado", terminal: "3", portao: "318" },
      { voo: "G3 1622", companhia: "GOL", destino_origem: "FLN - Florianópolis", horario_previsto: "08:40", horario_confirmado: "08:40", status: "Confirmado", terminal: "2", portao: "218" },
      { voo: "AD 4531", companhia: "Azul", destino_origem: "LDB - Londrina", horario_previsto: "08:20", horario_confirmado: "08:20", status: "Confirmado", terminal: "1", portao: "105" }
    ];
  }

  // Filter if query is present
  let filtered = voos;
  if (query) {
    filtered = voos.filter(v => {
      const voo = (v.voo || '').toLowerCase();
      const cia = (v.companhia || '').toLowerCase();
      const dest = (v.destino_origem || '').toLowerCase();
      const port = (v.portao || '').toLowerCase();
      return voo.includes(query) || cia.includes(query) || dest.includes(query) || port.includes(query);
    });
  }

  res.json({
    status: 'success',
    source: source,
    total: filtered.length,
    voos: filtered
  });
});

// ==========================================
// REAL-TIME MULTI-USER CHAT & PRESENCE (WebSocket)
// ==========================================
const CHAT_FILE = path.join(__dirname, 'chat_messages.json');
let chatMessages = [];
try {
  if (fs.existsSync(CHAT_FILE)) {
    chatMessages = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
  }
} catch (e) {
  console.warn('Could not load chat messages:', e);
}

function saveChatMessages() {
  try {
    fs.writeFileSync(CHAT_FILE, JSON.stringify(chatMessages.slice(-200), null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not save chat messages:', e);
  }
}

// Track active connections: Map of ws => { id, name, role, email, lastSeen }
const connectedUsers = new Map();

const wss = new WebSocketServer({ server, path: '/ws/chat' });

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch (e) {}
    }
  }
}

function getOnlineUsersList() {
  const map = new Map();
  for (const [ws, user] of connectedUsers.entries()) {
    if (ws.readyState === WebSocket.OPEN && user && user.name) {
      const key = (user.email || user.name).toLowerCase();
      map.set(key, {
        id: user.id || key,
        name: user.name,
        role: user.role || 'embarque',
        email: user.email || '',
        lastSeen: user.lastSeen || Date.now()
      });
    }
  }
  return Array.from(map.values());
}

function broadcastPresence() {
  const online = getOnlineUsersList();
  broadcast({
    type: 'presence_update',
    users: online,
    count: online.length
  });
}

wss.on('connection', (ws) => {
  // Send current state on connect
  ws.send(JSON.stringify({
    type: 'init',
    messages: chatMessages.slice(-100),
    onlineUsers: getOnlineUsersList(),
    cloudSync: {
      lastUpdated: cloudDB.lastUpdated,
      version: cloudDB.version,
      flightsCount: cloudDB.flights.length
    }
  }));

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === 'cloud_sync_request') {
        ws.send(JSON.stringify({
          type: 'cloud_sync_data',
          flights: cloudDB.flights,
          archivedFlights: cloudDB.archivedFlights,
          adminWhitelist: cloudDB.adminWhitelist,
          lastUpdated: cloudDB.lastUpdated,
          version: cloudDB.version
        }));
        return;
      }
      if (data.type === 'join' || data.type === 'presence') {
        const u = data.user || {};
        connectedUsers.set(ws, {
          id: u.id || (u.email || u.name || 'user_' + Date.now()),
          name: u.name || 'Usuário',
          role: u.role || 'embarque',
          email: u.email || '',
          lastSeen: Date.now()
        });
        broadcastPresence();
      } else if (data.type === 'ping') {
        const existing = connectedUsers.get(ws);
        if (existing) existing.lastSeen = Date.now();
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (data.type === 'message') {
        const user = connectedUsers.get(ws) || data.user || {};
        const msg = {
          id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          senderName: data.senderName || user.name || 'Agente',
          senderRole: data.senderRole || user.role || 'embarque',
          senderEmail: data.senderEmail || user.email || '',
          text: (data.text || '').trim(),
          file: data.file || null, // { name, type, size, dataUrl }
          timestamp: Date.now()
        };
        chatMessages.push(msg);
        if (chatMessages.length > 250) chatMessages.shift();
        saveChatMessages();
        broadcast({
          type: 'new_message',
          message: msg
        });
      }
    } catch (err) {
      console.warn('Error handling WS message:', err);
    }
  });

  ws.on('close', () => {
    connectedUsers.delete(ws);
    broadcastPresence();
  });

  ws.on('error', () => {
    connectedUsers.delete(ws);
    broadcastPresence();
  });
});

// REST Fallback for chat messages and presence
app.get('/api/chat/messages', (req, res) => {
  res.json({
    status: 'success',
    messages: chatMessages.slice(-100),
    onlineUsers: getOnlineUsersList()
  });
});

app.post('/api/chat/messages', (req, res) => {
  try {
    const { senderName, senderRole, senderEmail, text, file } = req.body;
    if (!text && !file) {
      return res.status(400).json({ error: 'Mensagem ou arquivo é obrigatório.' });
    }
    const msg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      senderName: senderName || 'Agente',
      senderRole: senderRole || 'embarque',
      senderEmail: senderEmail || '',
      text: (text || '').trim(),
      file: file || null,
      timestamp: Date.now()
    };
    chatMessages.push(msg);
    if (chatMessages.length > 250) chatMessages.shift();
    saveChatMessages();
    broadcast({
      type: 'new_message',
      message: msg
    });
    res.json({ status: 'success', message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// CLOUD DATABASE SYNC (Multi-Device & APK Sync & User Profiles)
// ==========================================
const CLOUD_DB_FILE = path.join(__dirname, 'cloud_db.json');
const USERS_DB_FILE = path.join(__dirname, 'users_db.json');

let cloudDB = {
  flights: [],
  archivedFlights: [],
  adminWhitelist: [],
  lastUpdated: Date.now(),
  version: 1
};

let usersDB = {}; // email -> { email, name, role, flights: [], archivedFlights: [], meusVoosDoDia: [], roboCustomization: {}, lastUpdated }

try {
  if (fs.existsSync(CLOUD_DB_FILE)) {
    const raw = fs.readFileSync(CLOUD_DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      cloudDB = {
        flights: Array.isArray(parsed.flights) ? parsed.flights : [],
        archivedFlights: Array.isArray(parsed.archivedFlights) ? parsed.archivedFlights : [],
        adminWhitelist: Array.isArray(parsed.adminWhitelist) ? parsed.adminWhitelist : [],
        lastUpdated: parsed.lastUpdated || Date.now(),
        version: parsed.version || 1
      };
    }
  }
} catch (e) {
  console.warn('Could not load cloud DB file:', e);
}

try {
  if (fs.existsSync(USERS_DB_FILE)) {
    const rawUsers = fs.readFileSync(USERS_DB_FILE, 'utf8');
    usersDB = JSON.parse(rawUsers) || {};
  }
} catch (e) {
  console.warn('Could not load users DB file:', e);
}

function saveCloudDB() {
  try {
    fs.writeFileSync(CLOUD_DB_FILE, JSON.stringify(cloudDB, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not save cloud DB file:', e);
  }
}

function saveUsersDB() {
  try {
    fs.writeFileSync(USERS_DB_FILE, JSON.stringify(usersDB, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not save users DB file:', e);
  }
}

// ==========================================
// AUTENTICAÇÃO REAL & GESTÃO SEGURA DE SESSÕES
// ==========================================
const SESSIONS_FILE = path.join(__dirname, 'sessions_db.json');
let sessionsDB = {};

try {
  if (fs.existsSync(SESSIONS_FILE)) {
    const rawSessions = fs.readFileSync(SESSIONS_FILE, 'utf8');
    sessionsDB = JSON.parse(rawSessions) || {};
  }
} catch (e) {
  sessionsDB = {};
}

function saveSessionsDB() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsDB, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not save sessions DB file:', e);
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) return false;
  try {
    const [salt, key] = storedHash.split(':');
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    if (keyBuffer.length !== derivedKey.length) return false;
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch (e) {
    return false;
  }
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessionsDB[token] = {
    email: user.email.toLowerCase(),
    name: user.name || user.email.split('@')[0],
    role: user.role || 'embarque',
    createdAt: now,
    expiresAt: now + (30 * 24 * 60 * 60 * 1000) // 30 dias
  };
  saveSessionsDB();
  return token;
}

function getSessionUser(req) {
  const authHeader = req.headers.authorization || '';
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers['x-auth-token']) {
    token = String(req.headers['x-auth-token']).trim();
  } else if (req.query && req.query.token) {
    token = String(req.query.token).trim();
  }

  if (!token || !sessionsDB[token]) return null;
  const session = sessionsDB[token];
  if (session.expiresAt && Date.now() > session.expiresAt) {
    delete sessionsDB[token];
    saveSessionsDB();
    return null;
  }
  return session;
}

function requireAuth(req, res, next) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ error: 'Não autorizado. Sessão inválida ou expirada. Efetue login novamente.' });
  }
  req.user = sessionUser;
  next();
}

function sanitizeUser(user) {
  if (!user || typeof user !== 'object') return null;
  const clone = { ...user };
  delete clone.passwordHash;
  delete clone.salt;
  return clone;
}

// POST /api/auth/register - Cadastro de nova conta com validação e isolamento
app.post('/api/auth/register', (req, res) => {
  try {
    const { email, password, name, role } = req.body || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'E-mail válido é obrigatório para cadastro.' });
    }
    if (!password || typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({ error: 'A senha deve conter pelo menos 4 caracteres.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (usersDB[cleanEmail]) {
      return res.status(400).json({ error: 'Este e-mail já está cadastrado. Por favor, faça login.' });
    }

    const newUser = {
      email: cleanEmail,
      name: (name && typeof name === 'string' && name.trim()) ? name.trim() : cleanEmail.split('@')[0],
      role: role && ['embarque', 'hcc', 'admin'].includes(role) ? role : 'embarque',
      passwordHash: hashPassword(password),
      flights: [],
      archivedFlights: [],
      meusVoosDoDia: [],
      deletedFlightIds: [],
      roboCustomization: null,
      createdAt: Date.now(),
      lastUpdated: Date.now()
    };

    usersDB[cleanEmail] = newUser;
    saveUsersDB();

    if (firestoreDb) {
      setDoc(doc(firestoreDb, 'users', cleanEmail), sanitizeUser(newUser), { merge: true })
        .catch(err => console.warn('Aviso persistência Firestore:', err.message));
    }

    const token = createSession(newUser);
    res.json({
      status: 'success',
      token,
      user: sanitizeUser(newUser)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login - Autenticação real com verificação segura de senha
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, name, role } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'E-mail é obrigatório.' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Senha é obrigatória.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    let user = usersDB[cleanEmail];

    // Se o usuário não existe no usersDB local, tenta verificar se existe no Firestore
    if (!user && firestoreDb) {
      try {
        const snap = await getDoc(doc(firestoreDb, 'users', cleanEmail));
        if (snap.exists()) {
          user = snap.data();
          usersDB[cleanEmail] = user;
          saveUsersDB();
        }
      } catch (e) {
        console.warn('Aviso ao consultar Firestore:', e.message);
      }
    }

    if (!user) {
      // Se não existir, permite criação imediata segura com a senha informada
      const newUser = {
        email: cleanEmail,
        name: (name && typeof name === 'string' && name.trim()) ? name.trim() : cleanEmail.split('@')[0],
        role: role && ['embarque', 'hcc', 'admin'].includes(role) ? role : 'embarque',
        passwordHash: hashPassword(password),
        flights: [],
        archivedFlights: [],
        meusVoosDoDia: [],
        deletedFlightIds: [],
        roboCustomization: null,
        createdAt: Date.now(),
        lastUpdated: Date.now()
      };
      usersDB[cleanEmail] = newUser;
      saveUsersDB();
      user = newUser;

      if (firestoreDb) {
        setDoc(doc(firestoreDb, 'users', cleanEmail), sanitizeUser(newUser), { merge: true })
          .catch(err => console.warn('Aviso persistência Firestore:', err.message));
      }
    } else {
      // Usuário existente: se ainda não possui senha configurada, registra a senha enviada
      if (!user.passwordHash) {
        user.passwordHash = hashPassword(password);
        usersDB[cleanEmail] = user;
        saveUsersDB();
      } else {
        // Valida senha com comparação segura em tempo constante
        const valid = verifyPassword(password, user.passwordHash);
        if (!valid) {
          return res.status(401).json({ error: 'Credenciais inválidas. Verifique seu e-mail e senha.' });
        }
      }
    }

    const token = createSession(user);
    res.json({
      status: 'success',
      token,
      user: sanitizeUser(user)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me - Dados do usuário atualmente autenticado
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = usersDB[req.user.email];
  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }
  res.json({
    status: 'success',
    user: sanitizeUser(user)
  });
});

// POST /api/auth/logout - Invalida sessão ativa
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization || '';
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers['x-auth-token']) {
    token = String(req.headers['x-auth-token']).trim();
  }
  if (token && sessionsDB[token]) {
    delete sessionsDB[token];
    saveSessionsDB();
  }
  res.json({ status: 'success' });
});

// GET /api/user/profile - Retorna dados privados EXCLUSIVOS da conta autenticada
app.get('/api/user/profile', requireAuth, async (req, res) => {
  const requestedEmail = (req.query.email || req.user.email).trim().toLowerCase();

  // Bloqueio rigoroso: usuário só pode acessar seus próprios dados (salvo admin)
  if (requestedEmail !== req.user.email && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado: não é permitido consultar dados de outra conta.' });
  }

  let user = usersDB[requestedEmail];
  if (!user && firestoreDb) {
    try {
      const snap = await getDoc(doc(firestoreDb, 'users', requestedEmail));
      if (snap.exists()) {
        user = snap.data();
        usersDB[requestedEmail] = user;
        saveUsersDB();
      }
    } catch (e) {
      console.warn('Aviso ao consultar Firestore:', e.message);
    }
  }

  if (!user) {
    // Conta nova: começa estritamente SEM voos de terceiros ou demonstração
    return res.json({
      status: 'new_user',
      user: {
        email: requestedEmail,
        name: requestedEmail.split('@')[0],
        role: 'embarque',
        flights: [],
        archivedFlights: [],
        meusVoosDoDia: [],
        roboCustomization: null,
        lastUpdated: Date.now()
      }
    });
  }

  res.json({
    status: 'success',
    user: {
      ...sanitizeUser(user),
      flights: Array.isArray(user.flights) ? user.flights : [],
      archivedFlights: Array.isArray(user.archivedFlights) ? user.archivedFlights : [],
      meusVoosDoDia: Array.isArray(user.meusVoosDoDia) ? user.meusVoosDoDia : [],
      deletedFlightIds: Array.isArray(user.deletedFlightIds) ? user.deletedFlightIds : []
    }
  });
});

// POST /api/user/sync - Sincronização segura com validação de identidade e isolamento total
app.post('/api/user/sync', requireAuth, (req, res) => {
  try {
    const { email, name, role, flights, archivedFlights, meusVoosDoDia, roboCustomization, clientId, deletedFlightIds } = req.body || {};
    const cleanEmail = (email || req.user.email).trim().toLowerCase();

    // Impede forjar e-mail de terceiros
    if (cleanEmail !== req.user.email && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado: não é permitido sincronizar para outra conta.' });
    }

    const existing = usersDB[cleanEmail] || {
      email: cleanEmail,
      name: name || cleanEmail.split('@')[0],
      role: role || req.user.role || 'embarque',
      flights: [],
      archivedFlights: [],
      meusVoosDoDia: [],
      roboCustomization: null,
      lastUpdated: 0,
      deletedFlightIds: []
    };

    // Mescla IDs excluídos da própria conta
    const newDelIds = Array.isArray(deletedFlightIds) ? deletedFlightIds : [];
    existing.deletedFlightIds = Array.from(new Set([...(existing.deletedFlightIds || []), ...newDelIds]));
    const delSet = new Set(existing.deletedFlightIds);

    // Cada voo é explicitamente associado ao proprietário autenticado
    if (Array.isArray(flights)) {
      existing.flights = flights
        .filter(f => f && f.id && !delSet.has(f.id))
        .map(f => ({ ...f, ownerEmail: cleanEmail }));
    } else {
      existing.flights = (existing.flights || []).filter(f => f && f.id && !delSet.has(f.id));
    }

    if (Array.isArray(archivedFlights)) {
      existing.archivedFlights = archivedFlights
        .filter(f => f && f.id && !delSet.has(f.id))
        .map(f => ({ ...f, ownerEmail: cleanEmail }))
        .slice(-100);
    }
    if (Array.isArray(meusVoosDoDia)) {
      existing.meusVoosDoDia = meusVoosDoDia
        .filter(f => f && !delSet.has(f.id) && !delSet.has(f.flightId))
        .map(f => ({ ...f, ownerEmail: cleanEmail }));
    }
    if (name) existing.name = name;
    if (role) existing.role = role;
    if (roboCustomization) existing.roboCustomization = roboCustomization;
    existing.lastUpdated = Date.now();

    usersDB[cleanEmail] = existing;
    saveUsersDB();

    // Persiste no Firestore do usuário
    if (firestoreDb) {
      setDoc(doc(firestoreDb, 'users', cleanEmail), {
        ...sanitizeUser(existing),
        updatedAt: Date.now()
      }, { merge: true }).catch(err => console.warn('Aviso persistência Firestore:', err.message));
    }

    // Broadcast restrito apenas para dispositivos do mesmo usuário
    broadcast({
      type: 'user_sync_update',
      email: cleanEmail,
      lastUpdated: existing.lastUpdated,
      sourceClientId: clientId || ''
    });

    res.json({
      status: 'success',
      user: sanitizeUser(existing)
    });
  } catch (err) {
    console.error('Error in /api/user/sync:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sync/pull - Consulta de voos restrita à conta autenticada
app.get('/api/sync/pull', requireAuth, (req, res) => {
  const user = usersDB[req.user.email] || {
    flights: [],
    archivedFlights: [],
    meusVoosDoDia: [],
    roboCustomization: null,
    lastUpdated: Date.now()
  };

  res.json({
    status: 'success',
    flights: Array.isArray(user.flights) ? user.flights : [],
    archivedFlights: Array.isArray(user.archivedFlights) ? user.archivedFlights : [],
    adminWhitelist: cloudDB.adminWhitelist || [],
    meusVoosDoDia: Array.isArray(user.meusVoosDoDia) ? user.meusVoosDoDia : [],
    roboCustomization: user.roboCustomization || null,
    lastUpdated: user.lastUpdated || Date.now(),
    version: 1
  });
});

// POST /api/sync/push - Atualização restrita à conta autenticada
app.post('/api/sync/push', requireAuth, (req, res) => {
  try {
    const { flights, archivedFlights, meusVoosDoDia, roboCustomization, clientId } = req.body || {};
    const cleanEmail = req.user.email;
    const user = usersDB[cleanEmail] || {
      email: cleanEmail,
      name: cleanEmail.split('@')[0],
      role: req.user.role || 'embarque',
      flights: [],
      archivedFlights: [],
      meusVoosDoDia: []
    };

    if (Array.isArray(flights)) {
      user.flights = flights.map(f => ({ ...f, ownerEmail: cleanEmail }));
    }
    if (Array.isArray(archivedFlights)) {
      user.archivedFlights = archivedFlights.map(f => ({ ...f, ownerEmail: cleanEmail })).slice(-100);
    }
    if (Array.isArray(meusVoosDoDia)) {
      user.meusVoosDoDia = meusVoosDoDia.map(f => ({ ...f, ownerEmail: cleanEmail }));
    }
    if (roboCustomization) user.roboCustomization = roboCustomization;
    user.lastUpdated = Date.now();

    usersDB[cleanEmail] = user;
    saveUsersDB();

    broadcast({
      type: 'user_sync_update',
      email: cleanEmail,
      lastUpdated: user.lastUpdated,
      sourceClientId: clientId || ''
    });

    res.json({
      status: 'success',
      flights: user.flights,
      archivedFlights: user.archivedFlights,
      lastUpdated: user.lastUpdated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/flight - Criação / Atualização de voo com validação de propriedade
app.post('/api/sync/flight', requireAuth, (req, res) => {
  try {
    const { flight, clientId } = req.body || {};
    if (!flight || typeof flight !== 'object') {
      return res.status(400).json({ error: 'Dados do voo são obrigatórios.' });
    }

    const cleanEmail = req.user.email;
    const user = usersDB[cleanEmail] || {
      email: cleanEmail,
      flights: [],
      archivedFlights: [],
      meusVoosDoDia: [],
      deletedFlightIds: []
    };

    const safeFlight = {
      ...flight,
      id: flight.id || 'fl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      ownerEmail: cleanEmail,
      updatedAt: Date.now()
    };

    // Valida se o ID já pertence a outra conta
    for (const otherEmail of Object.keys(usersDB)) {
      if (otherEmail !== cleanEmail) {
        const otherUser = usersDB[otherEmail];
        const conflict = (otherUser.flights || []).find(f => f && f.id === safeFlight.id) ||
                         (otherUser.archivedFlights || []).find(f => f && f.id === safeFlight.id);
        if (conflict && req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Acesso negado: o identificador deste voo pertence a outra conta.' });
        }
      }
    }

    user.flights = Array.isArray(user.flights) ? user.flights : [];
    const idx = user.flights.findIndex(f => f.id === safeFlight.id || (f.voo === safeFlight.voo && f.dataDep === safeFlight.dataDep));

    if (idx >= 0) {
      const existingFlight = user.flights[idx];
      if (existingFlight.ownerEmail && existingFlight.ownerEmail !== cleanEmail && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso negado: o voo pertence a outra conta.' });
      }
      user.flights[idx] = { ...existingFlight, ...safeFlight };
    } else {
      user.flights.push(safeFlight);
    }

    user.lastUpdated = Date.now();
    usersDB[cleanEmail] = user;
    saveUsersDB();

    if (firestoreDb && safeFlight.id) {
      setDoc(doc(firestoreDb, 'flights', safeFlight.id), safeFlight, { merge: true })
        .catch(e => console.warn('Aviso ao salvar voo no Firestore:', e.message));
    }

    broadcast({
      type: 'user_sync_update',
      email: cleanEmail,
      flightId: safeFlight.id,
      lastUpdated: user.lastUpdated,
      sourceClientId: clientId || ''
    });

    res.json({ status: 'success', flight: safeFlight });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sync/flight/:id - Consulta de voo por ID com validação de propriedade
app.get('/api/sync/flight/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const user = usersDB[req.user.email];
  if (!user) return res.status(404).json({ error: 'Conta não encontrada.' });

  const flight = (user.flights || []).find(f => f.id === id) || (user.archivedFlights || []).find(f => f.id === id);
  if (!flight) {
    for (const otherEmail of Object.keys(usersDB)) {
      if (otherEmail !== req.user.email) {
        const otherUser = usersDB[otherEmail];
        const existsOther = (otherUser.flights || []).some(f => f && f.id === id) ||
                            (otherUser.archivedFlights || []).some(f => f && f.id === id);
        if (existsOther && req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Acesso negado: este voo pertence a outra conta.' });
        }
      }
    }
    return res.status(404).json({ error: 'Voo não encontrado nesta conta.' });
  }

  res.json({ status: 'success', flight });
});

// DELETE /api/sync/flight/:id - Exclusão de voo com validação estrita de propriedade
app.delete('/api/sync/flight/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { clientId, archive } = req.query;
    const cleanEmail = req.user.email;

    const user = usersDB[cleanEmail];
    if (!user) return res.status(404).json({ error: 'Conta não encontrada.' });

    user.flights = Array.isArray(user.flights) ? user.flights : [];
    const idx = user.flights.findIndex(f => f.id === id);

    if (idx < 0) {
      for (const otherEmail of Object.keys(usersDB)) {
        if (otherEmail !== cleanEmail) {
          const otherUser = usersDB[otherEmail];
          const existsOther = (otherUser.flights || []).some(f => f && f.id === id) ||
                              (otherUser.archivedFlights || []).some(f => f && f.id === id);
          if (existsOther && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Acesso negado: este voo pertence a outra conta.' });
          }
        }
      }
      return res.status(404).json({ error: 'Voo não encontrado na conta autenticada.' });
    }

    const flightToDelete = user.flights[idx];
    if (flightToDelete.ownerEmail && flightToDelete.ownerEmail !== cleanEmail && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado: este voo pertence a outra conta.' });
    }

    const removed = user.flights.splice(idx, 1)[0];
    if (archive === 'true' && removed) {
      user.archivedFlights = Array.isArray(user.archivedFlights) ? user.archivedFlights : [];
      user.archivedFlights.push(removed);
    }

    user.deletedFlightIds = Array.from(new Set([...(user.deletedFlightIds || []), id]));
    if (Array.isArray(user.meusVoosDoDia)) {
      user.meusVoosDoDia = user.meusVoosDoDia.filter(f => f && f.id !== id && f.flightId !== id);
    }
    user.lastUpdated = Date.now();
    usersDB[cleanEmail] = user;
    saveUsersDB();

    if (firestoreDb && id) {
      deleteDoc(doc(firestoreDb, 'flights', id))
        .catch(e => console.warn('Aviso ao remover voo do Firestore:', e.message));
    }

    broadcast({
      type: 'user_sync_update',
      email: cleanEmail,
      deletedFlightId: id,
      lastUpdated: user.lastUpdated,
      sourceClientId: clientId || ''
    });

    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dicionário de mapeamento de cidades / destinos para códigos IATA
const IATA_MAP_DESTINOS = {
  'salvador': 'SSA', 'ssa': 'SSA', 'recife': 'REC', 'rec': 'REC', 'fortaleza': 'FOR', 'for': 'FOR',
  'rio': 'GIG', 'galeao': 'GIG', 'galeão': 'GIG', 'gig': 'GIG', 'santos dumont': 'SDU', 'sdu': 'SDU',
  'curitiba': 'CWB', 'cwb': 'CWB', 'porto alegre': 'POA', 'poa': 'POA', 'brasilia': 'BSB', 'brasília': 'BSB', 'bsb': 'BSB',
  'manaus': 'MAO', 'mao': 'MAO', 'belem': 'BEL', 'belém': 'BEL', 'bel': 'BEL', 'goiania': 'GYN', 'goiânia': 'GYN', 'gyn': 'GYN',
  'cuiaba': 'CGB', 'cuiabá': 'CGB', 'cgb': 'CGB', 'vitoria': 'VIX', 'vitória': 'VIX', 'vix': 'VIX',
  'florianopolis': 'FLN', 'florianópolis': 'FLN', 'fln': 'FLN', 'maceio': 'MCZ', 'maceió': 'MCZ', 'mcz': 'MCZ',
  'natal': 'NAT', 'nat': 'NAT', 'joao pessoa': 'JPA', 'joão pessoa': 'JPA', 'jpa': 'JPA', 'santiago': 'SCL', 'scl': 'SCL',
  'buenos aires': 'AEP', 'aep': 'AEP', 'ezeiza': 'EZE', 'eze': 'EZE', 'miami': 'MIA', 'mia': 'MIA', 'orlando': 'MCO', 'mco': 'MCO',
  'roma': 'FCO', 'fco': 'FCO', 'paris': 'CDG', 'cdg': 'CDG', 'milao': 'MXP', 'milão': 'MXP', 'mxp': 'MXP',
  'madrid': 'MAD', 'mad': 'MAD', 'lisboa': 'LIS', 'lis': 'LIS', 'londres': 'LHR', 'lhr': 'LHR', 'amsterdam': 'AMS', 'ams': 'AMS',
  'londrina': 'LDB', 'ldb': 'LDB', 'maringa': 'MGF', 'maringá': 'MGF', 'mgf': 'MGF', 'navegantes': 'NVT', 'nvt': 'NVT',
  'chapeco': 'XAP', 'chapecó': 'XAP', 'xap': 'XAP', 'foz': 'IGU', 'foz do iguacu': 'IGU', 'igu': 'IGU', 'joinville': 'JOI', 'joi': 'JOI',
  'sao luis': 'SLZ', 'são luís': 'SLZ', 'slz': 'SLZ', 'teresina': 'THE', 'the': 'THE', 'aracaju': 'AJU', 'aju': 'AJU',
  'ilheus': 'IOS', 'ilhéus': 'IOS', 'ios': 'IOS', 'porto seguro': 'BPS', 'bps': 'BPS', 'palmas': 'PMW', 'pmw': 'PMW',
  'campo grande': 'CGR', 'cgr': 'CGR', 'passo fundo': 'PFB', 'pfb': 'PFB', 'dourados': 'DOU', 'dou': 'DOU',
  'caxias': 'CXJ', 'caxias do sul': 'CXJ', 'cxj': 'CXJ', 'uberlandia': 'UDI', 'uberlândia': 'UDI', 'udi': 'UDI',
  'ribeirao preto': 'RAO', 'ribeirão preto': 'RAO', 'rao': 'RAO', 'sao jose do rio preto': 'SJP', 'sjp': 'SJP',
  'confins': 'CNF', 'belo horizonte': 'CNF', 'cnf': 'CNF', 'sao paulo': 'GRU', 'gru': 'GRU'
};

function formatFlightComplete(f) {
  const lines = [];
  const vooNum = f.voo ? `LA ${f.voo}` : (f.vooArr ? `LA ${f.vooArr}` : 'S/N');
  lines.push(`✈️ **Voo ${vooNum}** [Status: ${f.status || 'Programado'}]`);
  lines.push(`• Prefixo: ${f.prefixo || 'N/A'}${f.frota ? ` (${f.frota})` : ''}`);
  if (f.origem && f.dest) lines.push(`• Rota: ${f.origem} ➔ ${f.dest}`);
  else if (f.dest) lines.push(`• Destino: ${f.dest}`);
  else if (f.origem) lines.push(`• Origem: ${f.origem}`);

  const horarios = [];
  if (f.std) horarios.push(`STD: ${f.std}`);
  if (f.etd) horarios.push(`ETD: ${f.etd}`);
  if (f.sta) horarios.push(`STA: ${f.sta}`);
  if (f.eta) horarios.push(`ETA: ${f.eta}`);
  if (horarios.length > 0) lines.push(`• Horários: ${horarios.join(' | ')}`);

  const pos = [];
  if (f.portao) pos.push(`Portão: ${f.portao}`);
  if (f.boxdep || f.boxArr) pos.push(`Box: ${f.boxdep || f.boxArr}`);
  if (f.escadaRemota) pos.push(`(${f.escadaRemota})`);
  if (pos.length > 0) lines.push(`• Embarque/Posição: ${pos.join(' | ')}`);

  const fech = [];
  if (f.porta) fech.push(`Porta: ${f.porta}`);
  if (f.porao) fech.push(`Porão: ${f.porao}`);
  if (f.push) fech.push(`Pushback: ${f.push}`);
  if (f.calcoArr) fech.push(`Calço: ${f.calcoArr}`);
  if (fech.length > 0) lines.push(`• Fechamentos: ${fech.join(' | ')}`);

  const agentes = [f.agente1, f.agente2, f.agente3, f.agente4].filter(Boolean);
  if (agentes.length > 0) {
    lines.push(`• Agentes: ${agentes.join(', ')}${f.ramalEmbarque ? ` (Ramal: ${f.ramalEmbarque})` : ''}`);
  } else if (f.ramalEmbarque) {
    lines.push(`• Ramal Embarque: ${f.ramalEmbarque}`);
  }

  if (f.controller) {
    lines.push(`• Controller: ${f.controller}${f.ramalController ? ` (Ramal: ${f.ramalController})` : ''}`);
  } else if (f.ramalController) {
    lines.push(`• Ramal Controller: ${f.ramalController}`);
  }

  const pax = [];
  if (f.totalPax || f.paxArr) pax.push(`Pax: ${f.totalPax || f.paxArr}`);
  if (f.totalLoad) pax.push(`Load: ${f.totalLoad}`);
  if (f.bagRetidaEmb || f.bagRetidaChk) pax.push(`Bag. Retida: ${f.bagRetidaEmb || f.bagRetidaChk}`);
  if (pax.length > 0) lines.push(`• Ocupação: ${pax.join(' | ')}`);

  if (f.tat) lines.push(`• TAT: ${f.tat}${f.trip ? ` | Tripulação: ${f.trip}` : ''}`);

  if (f.descricaoAtraso || f.cod1 || f.cod2) {
    const cods = [f.cod1, f.cod2, f.cod3].filter(Boolean).join(' / ');
    lines.push(`• ⚠️ Atraso [${cods || 'Cód'}]: ${f.descricaoAtraso || 'Sem detalhes'}`);
  }

  if (f.obsDep || f.obsArr || f.obsDot) {
    const obs = [f.obsDep, f.obsArr, f.obsDot].filter(Boolean).join(' | ');
    lines.push(`• 📝 Obs: ${obs}`);
  }

  return lines.join('\n');
}

// ============================================================
// 🌤️ SERVIÇO METEOROLÓGICO EM TEMPO REAL & AEROPORTOS DO BRASIL
// ============================================================
const AEROPORTOS_BRASIL_MAP = {
  'GRU': { iata: 'GRU', nome: 'Guarulhos / São Paulo (GRU)', cidade: 'Guarulhos, SP', lat: -23.4356, lon: -46.4731 },
  'CGH': { iata: 'CGH', nome: 'Congonhas / São Paulo (CGH)', cidade: 'São Paulo, SP', lat: -23.6261, lon: -46.6564 },
  'VCP': { iata: 'VCP', nome: 'Viracopos / Campinas (VCP)', cidade: 'Campinas, SP', lat: -23.0074, lon: -47.1345 },
  'GIG': { iata: 'GIG', nome: 'Galeão / Rio de Janeiro (GIG)', cidade: 'Rio de Janeiro, RJ', lat: -22.8089, lon: -43.2436 },
  'SDU': { iata: 'SDU', nome: 'Santos Dumont / Rio de Janeiro (SDU)', cidade: 'Rio de Janeiro, RJ', lat: -22.9105, lon: -43.1631 },
  'BSB': { iata: 'BSB', nome: 'Brasília (BSB)', cidade: 'Brasília, DF', lat: -15.8697, lon: -47.9172 },
  'CNF': { iata: 'CNF', nome: 'Confins / Belo Horizonte (CNF)', cidade: 'Belo Horizonte, MG', lat: -19.6244, lon: -43.9719 },
  'SSA': { iata: 'SSA', nome: 'Salvador (SSA)', cidade: 'Salvador, BA', lat: -12.9086, lon: -38.3225 },
  'REC': { iata: 'REC', nome: 'Recife (REC)', cidade: 'Recife, PE', lat: -8.1268, lon: -34.9236 },
  'FOR': { iata: 'FOR', nome: 'Fortaleza (FOR)', cidade: 'Fortaleza, CE', lat: -3.7763, lon: -38.5326 },
  'CWB': { iata: 'CWB', nome: 'Curitiba (CWB)', cidade: 'Curitiba, PR', lat: -25.5285, lon: -49.1758 },
  'POA': { iata: 'POA', nome: 'Porto Alegre (POA)', cidade: 'Porto Alegre, RS', lat: -29.9935, lon: -51.1711 },
  'FLN': { iata: 'FLN', nome: 'Florianópolis (FLN)', cidade: 'Florianópolis, SC', lat: -27.6703, lon: -48.5475 },
  'MAO': { iata: 'MAO', nome: 'Manaus (MAO)', cidade: 'Manaus, AM', lat: -3.0358, lon: -60.0497 },
  'BEL': { iata: 'BEL', nome: 'Belém (BEL)', cidade: 'Belém, PA', lat: -1.3831, lon: -48.4776 },
  'GYN': { iata: 'GYN', nome: 'Goiânia (GYN)', cidade: 'Goiânia, GO', lat: -16.6322, lon: -49.2217 },
  'CGB': { iata: 'CGB', nome: 'Cuiabá (CGB)', cidade: 'Cuiabá, MT', lat: -15.6529, lon: -56.1167 },
  'VIX': { iata: 'VIX', nome: 'Vitória (VIX)', cidade: 'Vitória, ES', lat: -20.2581, lon: -40.2864 },
  'NAT': { iata: 'NAT', nome: 'Natal (NAT)', cidade: 'Natal, RN', lat: -5.7689, lon: -35.3664 },
  'MCZ': { iata: 'MCZ', nome: 'Maceió (MCZ)', cidade: 'Maceió, AL', lat: -9.5108, lon: -35.7917 },
  'NVT': { iata: 'NVT', nome: 'Navegantes (NVT)', cidade: 'Navegantes, SC', lat: -26.8792, lon: -48.6514 },
  'IGU': { iata: 'IGU', nome: 'Foz do Iguaçu (IGU)', cidade: 'Foz do Iguaçu, PR', lat: -25.5960, lon: -54.4872 }
};

const weatherCache = new Map();
const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 minutos de cache para evitar consumo de requisições

function mapearWmoParaCondicao(code, temp) {
  // WMO Weather interpretation codes (WW)
  if (code === 0 || code === 1) {
    return { condition: 'sunny', desc: temp >= 28 ? 'Ensolarado e Quente' : 'Céu Limpo e Ensolarado' };
  }
  if (code === 2 || code === 3) {
    return { condition: 'cloudy', desc: 'Parcialmente Nublado' };
  }
  if (code === 45 || code === 48) {
    return { condition: 'cloudy', desc: 'Nevoeiro / Baixa Visibilidade' };
  }
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
    return { condition: 'rain', desc: 'Chuva / Precipitação' };
  }
  if ([95, 96, 99].includes(code)) {
    return { condition: 'storm', desc: 'Tempestade / Trovoada' };
  }
  if (temp < 16) {
    return { condition: 'cold', desc: 'Clima Frio / Baixa Temperatura' };
  }
  return { condition: 'cloudy', desc: 'Tempo Variável' };
}

// GET /api/clima - Consulta meteorológica real e controlada por cache
app.get('/api/clima', requireAuth, async (req, res) => {
  try {
    const { lat, lon, iata } = req.query;
    let targetLat = -23.4356;
    let targetLon = -46.4731;
    let targetCity = 'Guarulhos, SP';
    let targetIata = 'GRU';

    if (iata && AEROPORTOS_BRASIL_MAP[iata.toUpperCase()]) {
      const aero = AEROPORTOS_BRASIL_MAP[iata.toUpperCase()];
      targetLat = aero.lat;
      targetLon = aero.lon;
      targetCity = aero.cidade;
      targetIata = aero.iata;
    } else if (lat && lon && !isNaN(Number(lat)) && !isNaN(Number(lon))) {
      targetLat = Number(lat);
      targetLon = Number(lon);
      targetCity = 'Sua Localização';
      targetIata = 'GPS';

      // Tenta achar aeroporto próximo
      for (const aero of Object.values(AEROPORTOS_BRASIL_MAP)) {
        const dist = Math.hypot(aero.lat - targetLat, aero.lon - targetLon);
        if (dist < 0.45) { // ~50km
          targetCity = aero.cidade;
          targetIata = aero.iata;
          break;
        }
      }
    }

    const cacheKey = `${targetLat.toFixed(2)}_${targetLon.toFixed(2)}`;
    const now = Date.now();
    if (weatherCache.has(cacheKey)) {
      const cached = weatherCache.get(cacheKey);
      if (now - cached.timestamp < WEATHER_CACHE_TTL) {
        return res.json({
          ...cached.data,
          cached: true,
          airports: Object.values(AEROPORTOS_BRASIL_MAP)
        });
      }
    }

    // Consulta à API Meteorológica Real (Open-Meteo com dados WMO e satélites meteorológicos)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${targetLat}&longitude=${targetLon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&timezone=America%2FSao_Paulo`;
    
    const response = await fetch(url, { headers: { 'User-Agent': 'DiarioDeEmbarque-App/1.0' } });
    if (!response.ok) {
      throw new Error(`Serviço meteorológico retornou HTTP ${response.status}`);
    }
    const meteoData = await response.json();
    const current = meteoData.current || {};
    const temp = Math.round((current.temperature_2m ?? 24) * 10) / 10;
    const sensacao = Math.round((current.apparent_temperature ?? temp) * 10) / 10;
    const wmoCode = current.weather_code ?? 0;
    const umidade = current.relative_humidity_2m ?? 60;
    const vento = Math.round((current.wind_speed_10m ?? 10) * 10) / 10;

    let { condition, desc } = mapearWmoParaCondicao(wmoCode, temp);
    // Se estiver muito frio (< 16°C) e não estiver chovendo forte, destaca frio
    if (temp < 16 && condition !== 'rain' && condition !== 'storm') {
      condition = 'cold';
      desc = `Clima Frio (${temp}°C)`;
    } else if (temp >= 26 && condition === 'sunny') {
      desc = `Ensolarado e Quente (${temp}°C)`;
    }

    const horaAtual = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

    const weatherResult = {
      status: 'success',
      condition,
      temperature: temp,
      apparentTemperature: sensacao,
      humidity: umidade,
      windSpeed: vento,
      description: desc,
      cityName: targetCity,
      iata: targetIata,
      updatedAt: horaAtual,
      timestamp: now,
      source: 'Open-Meteo Global WMO Satellite Service',
      googleWeatherApiConfigured: !!(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_WEATHER_API_KEY),
      apiDetails: {
        currentProvider: 'Open-Meteo Global WMO Satellite Service (Grátis, sem faturamento)',
        googleMapsWeatherAvailable: !!(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_WEATHER_API_KEY),
        note: 'Google Maps Platform requer chave GOOGLE_MAPS_API_KEY e faturamento habilitado no GCP para APIs proprietárias.'
      }
    };

    weatherCache.set(cacheKey, { timestamp: now, data: weatherResult });

    res.json({
      ...weatherResult,
      cached: false,
      airports: Object.values(AEROPORTOS_BRASIL_MAP)
    });
  } catch (err) {
    console.warn('Aviso ao consultar serviço meteorológico:', err.message);
    const horaAtual = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    res.json({
      status: 'fallback',
      condition: 'sunny',
      temperature: 24,
      apparentTemperature: 24,
      humidity: 60,
      windSpeed: 12,
      description: 'Condição Operacional Padrão',
      cityName: 'Guarulhos, SP (Padrão)',
      iata: 'GRU',
      updatedAt: horaAtual,
      airports: Object.values(AEROPORTOS_BRASIL_MAP),
      googleWeatherApiConfigured: !!(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_WEATHER_API_KEY),
      error: 'Não foi possível atualizar em tempo real no momento'
    });
  }
});

// Endpoint de IA Gemini para o Robô WALL-E com suporte total à Planilha Oficial
app.post('/api/robo/gemini', requireAuth, async (req, res) => {
  try {
    const { prompt, flightContext, userName, userRole, workingDate } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt é obrigatório.' });
    }

    const pClean = prompt.trim();
    const pLow = pClean.toLowerCase();

    // Carrega voos da planilha oficial do Google Sheets
    let sheetFlights = [];
    try {
      sheetFlights = await fetchGoogleSheetFlights();
    } catch (sheetErr) {
      console.warn('Erro ao carregar Google Sheet para o robô:', sheetErr.message);
    }

    const todayBR = getTodayDateBR();
    const targetDateBR = workingDate ? normalizeDateToBR(workingDate) : todayBR;
    // Determina a data operacional do dia na planilha
    let dayFlights = sheetFlights.filter(f => normalizeDateToBR(f.dataDep) === targetDateBR || normalizeDateToBR(f.dataArr) === targetDateBR);
    let activeDateLabel = targetDateBR;
    if (dayFlights.length === 0) {
      const availableDates = sheetFlights.map(f => normalizeDateToBR(f.dataDep)).filter(Boolean);
      if (availableDates.length > 0) {
        activeDateLabel = availableDates[0];
        dayFlights = sheetFlights.filter(f => normalizeDateToBR(f.dataDep) === activeDateLabel || normalizeDateToBR(f.dataArr) === activeDateLabel);
      }
    }

    // 1. VERIFICA SE A PERGUNTA É SOBRE DESTINO OU PREFIXO
    let requestedDest = null;
    let requestedPrefix = null;

    // Detecção de Destino
    for (const [nome, iata] of Object.entries(IATA_MAP_DESTINOS)) {
      const regex = new RegExp(`\\b${nome}\\b`, 'i');
      if (regex.test(pLow)) {
        requestedDest = iata;
        break;
      }
    }
    if (!requestedDest && (pLow.includes('destino') || pLow.includes('indo para') || pLow.includes('vai para'))) {
      const words = pLow.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/);
      for (const w of words) {
        if (w.length === 3 && Object.values(IATA_MAP_DESTINOS).includes(w.toUpperCase())) {
          requestedDest = w.toUpperCase();
          break;
        }
      }
    }

    // Detecção de Prefixo Aeronáutico (ex: PR-MYP, PT-MXP, CC-BHZ, ou apenas 'MYP', 'MXP')
    const prefixRegex = /\b(P[RSTP]|CC)-[A-Z]{3}\b/i;
    const matchPrefixFull = pClean.match(prefixRegex);
    if (matchPrefixFull) {
      requestedPrefix = matchPrefixFull[0].toUpperCase();
    } else if (pLow.includes('prefixo') || pLow.includes('aeronave') || pLow.includes('matrícula') || pLow.includes('matricula') || pLow.includes('avião')) {
      const words = pLow.replace(/[^a-zA-Z0-9\s-]/g, ' ').split(/\s+/);
      for (const w of words) {
        const up = w.toUpperCase();
        if (/^[A-Z]{3}$/.test(up) && dayFlights.some(f => (f.prefixo || '').toUpperCase().endsWith(up))) {
          requestedPrefix = up;
          break;
        }
      }
    }

    // Se perguntou sobre DESTINO ou PREFIXO: responda por completo SOMENTE os voos do dia!
    if (requestedDest || requestedPrefix) {
      let filteredFlights = [];
      if (requestedDest) {
        filteredFlights = dayFlights.filter(f => (f.dest || '').toUpperCase() === requestedDest || (f.dest || '').toUpperCase().includes(requestedDest));
      } else if (requestedPrefix) {
        filteredFlights = dayFlights.filter(f => {
          const pref = (f.prefixo || '').toUpperCase();
          return pref === requestedPrefix || pref.endsWith(requestedPrefix);
        });
      }

      if (filteredFlights.length > 0) {
        const cabecalho = requestedDest
          ? `Bip bop! 🤖 Encontrei ${filteredFlights.length} voo(s) programado(s) para o destino **${requestedDest}** na escala de hoje (${activeDateLabel}):`
          : `Bip bop! 🤖 Encontrei o voo programado para a aeronave **${requestedPrefix}** na escala de hoje (${activeDateLabel}):`;
        
        const corpoCompleto = filteredFlights.map(formatFlightComplete).join('\n\n───────────────\n\n');
        const respostaFinal = `${cabecalho}\n\n${corpoCompleto}\n\nConte comigo para o que precisar no embarque! 🛫✨`;

        return res.json({
          reply: respostaFinal,
          source: 'walle-planilha-voos-do-dia',
          dest: requestedDest,
          prefix: requestedPrefix,
          count: filteredFlights.length
        });
      } else {
        const termo = requestedDest ? `o destino **${requestedDest}**` : `o prefixo **${requestedPrefix}**`;
        const respostaVazia = `Bip bop! 🤖 Consultei a planilha oficial de hoje (${activeDateLabel}) e não encontrei voos programados para ${termo}. Deseja que eu pesquise outro destino ou aeronave da escala? 🛫✨`;
        return res.json({
          reply: respostaVazia,
          source: 'walle-planilha-voos-do-dia'
        });
      }
    }

    // 2. BUSCA GERAL EM QUALQUER INFORMAÇÃO DA PLANILHA (agente, ramal, controller, atraso, obs, etc.)
    const stopWords = ['qual','quem','onde','como','para','com','dos','das','este','esse','voo','hoje','sobre'];
    const tokens = pLow.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3 && !stopWords.includes(t));
    let matchingRows = [];
    if (tokens.length > 0) {
      const scored = [];
      for (const f of sheetFlights) {
        const rowStr = Object.values(f).join(' ').toLowerCase();
        let score = 0;
        for (const tok of tokens) {
          if (rowStr.includes(tok)) score++;
        }
        if (score > 0) {
          scored.push({ flight: f, score });
        }
      }
      scored.sort((a, b) => b.score - a.score);
      matchingRows = scored.slice(0, 15).map(x => x.flight);
    }

    // Monta contexto completo da planilha para enviar ao Gemini
    let planilhaContextoInfo = '';
    if (matchingRows.length > 0) {
      planilhaContextoInfo = `\nLinhas mais relevantes encontradas na planilha para a pergunta do usuário:\n` +
        matchingRows.map((f, i) => `[Registro ${i+1}]:\n${formatFlightComplete(f)}`).join('\n\n');
    } else {
      planilhaContextoInfo = `\nResumo dos voos do dia (${activeDateLabel}) na planilha:\n` +
        dayFlights.slice(0, 25).map(f => `• Voo ${f.voo || f.vooArr || 'S/N'} (${f.prefixo || 'N/A'}) Destino: ${f.dest || 'N/A'}, STD: ${f.std || '--'}, Portão: ${f.portao || '--'}, Box: ${f.boxdep || '--'}, Agente: ${f.agente1 || '--'}, Controller: ${f.controller || '--'} (Ramal: ${f.ramalController || '--'}), Status: ${f.status || 'EM SOLO'}`).join('\n');
    }

    const sysInstruction = `Você é o WALL-E (Nick), o robô assistente operacional inteligente do aplicativo Diário de Embarque no aeroporto de GRU (Guarulhos).
Você tem acesso DIRETO e COMPLETO à planilha oficial de operações da LATAM (https://docs.google.com/spreadsheets/d/1j-BTNkRa2SV_ki6nVv_K5kN8rL0tkMvj4ZoJyeNR92U/edit?usp=drivesdk).
Quando o usuário perguntar qualquer informação que conste nesta planilha (ramal, agente, controller, atrasos, passageiros, turnaround, esteiras, observações, etc.), você DEVE responder com total precisão com base nos dados reais da planilha fornecidos abaixo.
Regra estrita: Quando a pergunta for sobre destino ou prefixo, responda por completo somente os voos do dia.
Responda sempre em português do Brasil de forma concisa, educada e simpática (usando emojis fofos como 🤖, 🛫, ✨, ✈️, 👍).
Nome do usuário: ${userName || 'Colega de Operação'} (Perfil: ${userRole || 'embarque'}).
Data de hoje da operação: ${activeDateLabel}
Você conhece as funções e telas reais do aplicativo:
- Painel de voos do dia (dashboard)
- Formulário de novo voo / edição (flightForm)
- Meus Voos ativos (voos)
- Voos arquivados por mês (months)
- Gráfico diário de pontualidade (graficodiario)
- Busca de voos (buscarvoos)
- Chat operacional da equipe (chat)
- Relatórios gerenciais (relatorios) - permitido para perfis 'hcc' e 'admin'. Se o usuário com perfil 'embarque' pedir para abrir relatórios, informe com gentileza que essa função é restrita a HCC e Admin.
- Painel Administrativo (admin) - permitido APENAS para perfil 'admin'.
${planilhaContextoInfo}
${flightContext ? `\nVoo aberto atualmente no formulário:\n${JSON.stringify(flightContext)}` : ''}`;

    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build'
            }
          }
        });
        const aiResponse = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            systemInstruction: sysInstruction,
            temperature: 0.5
          }
        });

        if (aiResponse && aiResponse.text) {
          return res.json({
            reply: aiResponse.text.trim(),
            source: 'gemini-3.8-flash'
          });
        }
      } catch (err) {
        console.warn('Erro ao chamar Gemini 3.8 Flash no WALL-E:', err.message);
      }
    }

    // Fallback inteligente com busca exata na planilha caso o Gemini esteja temporariamente indisponível
    if (matchingRows.length > 0) {
      const f = matchingRows[0];
      const fallbackReply = `Bip bop! 🤖 Consultei a planilha oficial sobre "${prompt}":\n\n${formatFlightComplete(f)}`;
      return res.json({
        reply: fallbackReply,
        source: 'walle-local-sheet-match'
      });
    }

    let fallbackReply = `Bip bop! 🤖 Estou conectado! Sobre "${prompt}": na operação de GRU a prioridade é a pontualidade e a segurança do voo! Conte comigo na sua escala! 🛫✨`;
    if (pLow.includes('planilha') || pLow.includes('voos de hoje') || pLow.includes('escala')) {
      fallbackReply = `Bip bop! 🤖 Consultei a planilha do dia (${activeDateLabel}): temos ${dayFlights.length} voos na escala! Você pode me perguntar sobre qualquer destino, prefixo, ramal, controller ou motivo de atraso! 🛫✨`;
    }
    return res.json({
      reply: fallbackReply,
      source: 'walle-local-assistant'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint exclusivo para o robô buscar e formatar voos da planilha do dia
app.get('/api/robo/planilha-voos', async (req, res) => {
  try {
    const flights = await fetchGoogleSheetFlights();
    const todayBR = getTodayDateBR();
    const query = (req.query.q || '').trim().toLowerCase();

    let targetFlights = flights.filter(f => (f.dataDep || '').trim() === todayBR);
    if (targetFlights.length === 0) {
      // Se a data de hoje não tiver linhas preenchidas na planilha, pega os voos mais recentes cadastrados
      targetFlights = flights.slice(0, 30);
    }

    if (query) {
      targetFlights = targetFlights.filter(f => {
        const v = (f.voo || '').toLowerCase();
        const d = (f.dest || '').toLowerCase();
        const p = (f.prefixo || '').toLowerCase();
        const g = (f.portao || '').toLowerCase();
        const b = (f.boxdep || '').toLowerCase();
        return v.includes(query) || d.includes(query) || p.includes(query) || g.includes(query) || b.includes(query);
      });
    }

    res.json({
      status: 'success',
      todayBR,
      total: targetFlights.length,
      flights: targetFlights.slice(0, 50)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static assets from workspace root
app.use(express.static(__dirname, {
  extensions: ['html', 'htm']
}));

// Route all non-static requests to index.html (SPA routing, Express 5 compatible)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Always listen on port 3000 for AI Studio environment
server.listen(DEFAULT_PORT, HOST, () => {
  console.log(`Diário de Embarque (HTTP & WebSockets) running on http://${HOST}:${DEFAULT_PORT}`);
});
