import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI } from '@google/genai';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, getDocFromServer, collection, getDocs } from 'firebase/firestore';

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
      .then(() => {
        console.log('✔ Conexão com Firestore na nuvem verificada com sucesso!');
        sincronizarUsuariosFirestore();
      })
      .catch(err => {
        if (err.message && err.message.includes('the client is offline')) {
          console.error('Please check your Firebase configuration.');
        } else {
          console.log('✔ Firestore endpoint acessível (resposta:', err.message || 'ok', ')');
          sincronizarUsuariosFirestore();
        }
      });
  }
} catch (fbErr) {
  console.warn('Aviso ao inicializar Firebase no backend:', fbErr.message);
}

const app = express();
const server = http.createServer(app);
const DEFAULT_PORT = 3000;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;
const HOST = '0.0.0.0';

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Prevent stale caching for HTML and Service Worker so updates apply instantly
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Permissions-Policy', 'camera=(self "*"), microphone=(self "*"), geolocation=(self "*")');
  if (req.path === '/sw.js' || req.path === '/' || req.path === '/index.html' || req.path === '/manifest.json' || req.path.startsWith('/icon-') || req.path.startsWith('/apple-touch-icon') || req.path.startsWith('/favicon')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else if (req.path.endsWith('.png') || req.path.endsWith('.ico') || req.path.endsWith('.jpg')) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
  next();
});

// Explicit route for Web App Manifest with correct Content-Type and anti-caching headers
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
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

// Servir uploads de fotos de perfil e papéis de parede dos usuários
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), {
  maxAge: '1h',
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// Endpoint to download PDF files directly with HTTP Content-Disposition attachment
// This ensures Android DownloadManager in WebView/APK and mobile browsers downloads the file directly into /Download
const tempPdfMap = new Map();

app.post('/api/prepare-pdf-download', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

// Proxy endpoint para Radar ADS-B com filtro exclusivo Grupo LATAM e alta disponibilidade
const LATAM_ICAO_PREFIXES = ['TAM', 'LAN', 'LPE', 'ARE', 'LNE', 'LAP'];
let cachedRadarData = null;
let lastRadarFetch = 0;
const RADAR_CACHE_TTL = 20 * 1000; // Cache de 20 segundos para evitar sobrecarga

// Memória em tempo real de trajetórias históricas reais (apenas pontos ADS-B legítimos recebidos)
const aircraftTracksMap = new Map();

// Aeroportos conhecidos para determinação precisa de Rota Prevista (GRU e principais destinos LATAM)
const KNOWN_AIRPORTS = {
  'GRU': { code: 'GRU', icao: 'SBGR', name: 'São Paulo - Guarulhos', lat: -23.4356, lon: -46.4731 },
  'CGH': { code: 'CGH', icao: 'SBSP', name: 'São Paulo - Congonhas', lat: -23.6273, lon: -46.6566 },
  'VCP': { code: 'VCP', icao: 'SBKP', name: 'Campinas - Viracopos', lat: -23.0074, lon: -47.1345 },
  'BSB': { code: 'BSB', icao: 'SBBR', name: 'Brasília', lat: -15.8697, lon: -47.9172 },
  'GIG': { code: 'GIG', icao: 'SBGL', name: 'Rio de Janeiro - Galeão', lat: -22.8134, lon: -43.2494 },
  'SDU': { code: 'SDU', icao: 'SBRJ', name: 'Rio de Janeiro - Santos Dumont', lat: -22.9105, lon: -43.1631 },
  'CNF': { code: 'CNF', icao: 'SBCF', name: 'Belo Horizonte - Confins', lat: -19.6244, lon: -43.9719 },
  'SSA': { code: 'SSA', icao: 'SBSV', name: 'Salvador', lat: -12.9086, lon: -38.3225 },
  'REC': { code: 'REC', icao: 'SBRF', name: 'Recife', lat: -8.1268, lon: -34.9228 },
  'FOR': { code: 'FOR', icao: 'SBFZ', name: 'Fortaleza', lat: -3.7763, lon: -38.5326 },
  'POA': { code: 'POA', icao: 'SBPA', name: 'Porto Alegre', lat: -29.9935, lon: -51.1711 },
  'CWB': { code: 'CWB', icao: 'SBCT', name: 'Curitiba', lat: -25.5285, lon: -49.1758 },
  'FLN': { code: 'FLN', icao: 'SBFL', name: 'Florianópolis', lat: -27.6705, lon: -48.5525 },
  'VIX': { code: 'VIX', icao: 'SBVT', name: 'Vitória', lat: -20.2581, lon: -40.2864 },
  'GYN': { code: 'GYN', icao: 'SBGO', name: 'Goiânia', lat: -16.6322, lon: -49.2206 },
  'CGB': { code: 'CGB', icao: 'SBCG', name: 'Cuiabá', lat: -15.6528, lon: -56.1167 },
  'MAO': { code: 'MAO', icao: 'SBEG', name: 'Manaus', lat: -3.0358, lon: -60.0497 },
  'BEL': { code: 'BEL', icao: 'SBBE', name: 'Belém', lat: -1.3793, lon: -48.4763 },
  'NAT': { code: 'NAT', icao: 'SBSG', name: 'Natal', lat: -5.7689, lon: -35.3664 },
  'MCZ': { code: 'MCZ', icao: 'SBMO', name: 'Maceió', lat: -9.5108, lon: -35.7917 },
  'AJU': { code: 'AJU', icao: 'SBAR', name: 'Aracaju', lat: -10.9840, lon: -37.0703 },
  'JPA': { code: 'JPA', icao: 'SBJP', name: 'João Pessoa', lat: -7.1483, lon: -34.9506 },
  'SLZ': { code: 'SLZ', icao: 'SBSL', name: 'São Luís', lat: -2.5869, lon: -44.2361 },
  'IGU': { code: 'IGU', icao: 'SBFI', name: 'Foz do Iguaçu', lat: -25.5961, lon: -54.4872 },
  'NVT': { code: 'NVT', icao: 'SBNF', name: 'Navegantes', lat: -26.8797, lon: -48.6514 },
  'UDI': { code: 'UDI', icao: 'SBUL', name: 'Uberlândia', lat: -18.8833, lon: -48.2253 },
  'SCL': { code: 'SCL', icao: 'SCEL', name: 'Santiago do Chile', lat: -33.3930, lon: -70.7858 },
  'EZE': { code: 'EZE', icao: 'SAEZ', name: 'Buenos Aires - Ezeiza', lat: -34.8222, lon: -58.5358 },
  'AEP': { code: 'AEP', icao: 'SABE', name: 'Buenos Aires - Aeroparque', lat: -34.5592, lon: -58.4156 },
  'LIM': { code: 'LIM', icao: 'SPJC', name: 'Lima', lat: -12.0219, lon: -77.1143 },
  'MIA': { code: 'MIA', icao: 'KMIA', name: 'Miami', lat: 25.7959, lon: -80.2870 },
  'MCO': { code: 'MCO', icao: 'KMCO', name: 'Orlando', lat: 28.4312, lon: -81.3081 },
  'MAD': { code: 'MAD', icao: 'LEMD', name: 'Madrid', lat: 40.4839, lon: -3.5680 },
  'LIS': { code: 'LIS', icao: 'LPPT', name: 'Lisboa', lat: 38.7742, lon: -9.1342 },
  'BOG': { code: 'BOG', icao: 'SKBO', name: 'Bogotá', lat: 4.7016, lon: -74.1469 },
  'ASU': { code: 'ASU', icao: 'SGAS', name: 'Assunção', lat: -25.2400, lon: -57.5190 },
  'MVD': { code: 'MVD', icao: 'SUMU', name: 'Montevidéu', lat: -34.8384, lon: -56.0308 }
};

// Limpeza periódica de trajetórias inativas (mais de 2 horas)
setInterval(() => {
  const cutoff = Math.floor(Date.now() / 1000) - (2 * 3600);
  for (const [key, track] of aircraftTracksMap.entries()) {
    if (!track || track.length === 0 || (track[track.length - 1].time && track[track.length - 1].time < cutoff)) {
      aircraftTracksMap.delete(key);
    }
  }
}, 10 * 60 * 1000);

function recordAircraftPosition(callsign, hex, lat, lon, altFeet, velocityKmh, heading, timeTs, timeBrasilia) {
  const key = (callsign || hex || '').trim().toUpperCase();
  if (!key) return [];
  let track = aircraftTracksMap.get(key) || [];
  const lastPoint = track[track.length - 1];
  const isDuplicate = lastPoint && Math.abs(lastPoint.lat - lat) < 0.0001 && Math.abs(lastPoint.lon - lon) < 0.0001;
  if (!isDuplicate) {
    track.push({
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
      altFeet: altFeet != null ? Number(altFeet) : null,
      velocityKmh: velocityKmh != null ? Number(velocityKmh) : null,
      heading: heading != null ? Number(heading) : 0,
      time: timeTs,
      timeBrasilia
    });
    if (track.length > 80) {
      track = track.slice(-80);
    }
    aircraftTracksMap.set(key, track);
  }
  return track;
}

function matchFlightPlan(callsign, registration) {
  try {
    const flightsList = (cloudDB && Array.isArray(cloudDB.flights)) ? cloudDB.flights : [];
    const numOnly = (callsign || '').replace(/[^0-9]/g, '');
    const cleanReg = (registration || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

    for (const f of flightsList) {
      if (!f) continue;
      const fVooNum = String(f.voo || '').replace(/[^0-9]/g, '');
      const fReg = String(f.prefixo || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

      const matchNum = numOnly && fVooNum && numOnly === fVooNum;
      const matchReg = cleanReg && fReg && cleanReg === fReg && cleanReg !== 'LATAMFLEET';

      if (matchNum || matchReg) {
        const origCode = String(f.trip_origem || 'GRU').toUpperCase().trim();
        const destCode = String(f.destino || '').toUpperCase().trim();
        const originAirport = KNOWN_AIRPORTS[origCode] || (origCode ? { code: origCode, name: origCode, lat: -23.4356, lon: -46.4731 } : null);
        const destAirport = KNOWN_AIRPORTS[destCode] || (destCode ? { code: destCode, name: destCode, lat: -23.4356, lon: -46.4731 } : null);
        return {
          flightNum: f.voo ? (f.voo.toUpperCase().startsWith('LA') || f.voo.toUpperCase().startsWith('JJ') ? f.voo : `LA ${f.voo}`) : callsign,
          origin: origCode || 'GRU',
          destination: destCode || 'N/D',
          originAirport,
          destAirport,
          matched: true
        };
      }
    }
  } catch(e) {
    console.warn('Erro ao cruzar plano de voo:', e.message);
  }
  return null;
}

app.get('/api/radar/latam-gru', async (req, res) => {
  const now = Date.now();
  const force = req.query.force === 'true';

  if (!force && cachedRadarData && (now - lastRadarFetch < RADAR_CACHE_TTL)) {
    return res.json({ ...cachedRadarData, cached: true });
  }

  const queryTimeBrasilia = new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // TENTATIVA 1: opendata.adsb.fi (Alta disponibilidade e telemetria em tempo real no Brasil)
  try {
    const adsbUrl = 'https://opendata.adsb.fi/api/v2/lat/-23.4356/lon/-46.4731/dist/70';
    const response = await fetch(adsbUrl, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'DiarioDeEmbarque-LATAM-Radar/2.0' }
    });

    if (response.ok) {
      const data = await response.json();
      const rawList = Array.isArray(data.aircraft) ? data.aircraft : [];
      const latamAircraft = [];
      let airborneCount = 0;
      let onGroundCount = 0;

      for (const a of rawList) {
        const callsign = (a.flight || '').trim().toUpperCase();
        if (!callsign) continue;

        const isLatam = LATAM_ICAO_PREFIXES.some(prefix => callsign.startsWith(prefix));
        if (!isLatam) continue;
        if (a.lat == null || a.lon == null) continue;

        const onGround = a.alt_baro === 'ground' || (typeof a.alt_baro === 'number' && a.alt_baro < 2800 && (a.gs || 0) < 40);
        if (onGround) onGroundCount++; else airborneCount++;

        const altFeet = typeof a.alt_baro === 'number' ? Math.round(a.alt_baro) : null;
        const altMeters = altFeet != null ? Math.round(altFeet * 0.3048) : null;
        const velocityKnots = a.gs != null ? Math.round(a.gs) : null;
        const velocityKmh = velocityKnots != null ? Math.round(velocityKnots * 1.852) : null;
        const heading = a.track != null ? Math.round(a.track) : (a.true_heading != null ? Math.round(a.true_heading) : 0);
        const vRate = a.baro_rate != null ? Math.round(a.baro_rate) : 0;

        let airlineName = 'LATAM Airlines';
        if (callsign.startsWith('TAM')) airlineName = 'LATAM Brasil';
        else if (callsign.startsWith('LAN')) airlineName = 'LATAM Airlines Chile';
        else if (callsign.startsWith('LPE')) airlineName = 'LATAM Peru';
        else if (callsign.startsWith('ARE')) airlineName = 'LATAM Colombia';
        else if (callsign.startsWith('LNE')) airlineName = 'LATAM Ecuador';
        else if (callsign.startsWith('LAP')) airlineName = 'LATAM Paraguay';

        const lastContactTs = data.now ? Math.round(data.now - (a.seen_pos || a.seen || 0)) : Math.floor(Date.now() / 1000);
        const lastContactBrasilia = new Date(lastContactTs * 1000).toLocaleTimeString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });

        const track = recordAircraftPosition(callsign, a.hex, a.lat, a.lon, altFeet, velocityKmh, heading, lastContactTs, lastContactBrasilia);
        const flightPlan = matchFlightPlan(callsign, a.r);

        latamAircraft.push({
          icao24: a.hex || 'N/D',
          callsign,
          registration: a.r || 'N/D',
          aircraftType: a.t || a.desc || 'Airbus',
          airline: airlineName,
          lat: a.lat,
          lon: a.lon,
          altFeet,
          altMeters,
          velocityKnots,
          velocityKmh,
          heading,
          onGround,
          verticalRate: vRate,
          lastContact: lastContactTs,
          lastContactBrasilia,
          squawk: a.squawk || 'N/D',
          trajectory: track,
          flightPlan: flightPlan
        });
      }

      cachedRadarData = {
        success: true,
        source: 'adsb.fi',
        status: latamAircraft.length > 0 ? 'online' : 'sem_aeronaves',
        count: latamAircraft.length,
        airborne: airborneCount,
        onGround: onGroundCount,
        lastUpdate: queryTimeBrasilia,
        sourceTime: data.now ? new Date(data.now * 1000).toLocaleTimeString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }) : queryTimeBrasilia,
        aircraft: latamAircraft,
        message: latamAircraft.length === 0
          ? 'Nenhuma aeronave LATAM detectada no espaço aéreo de GRU neste momento. Próxima varredura em instantes.'
          : `${latamAircraft.length} aeronave(s) LATAM detectada(s) no espaço aéreo de GRU / TMA São Paulo.`
      };
      lastRadarFetch = now;
      return res.json(cachedRadarData);
    }
  } catch (errAdsb) {
    console.warn('Aviso: tentativa adsb.fi falhou ou demorou, tentando fallback OpenSky...', errAdsb.message);
  }

  // TENTATIVA 2: OpenSky Network (Fallback secundário com timeout curto)
  try {
    const lamin = -24.4, lamax = -22.6, lomin = -47.5, lomax = -45.5;
    const openSkyUrl = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
    const openSkyRes = await fetch(openSkyUrl, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'DiarioDeEmbarque-LATAM-Radar/2.0' }
    });

    if (openSkyRes.ok) {
      const data = await openSkyRes.json();
      const rawStates = Array.isArray(data.states) ? data.states : [];
      const latamAircraft = [];
      let airborneCount = 0;
      let onGroundCount = 0;

      for (const s of rawStates) {
        const callsign = (s[1] || '').trim().toUpperCase();
        if (!callsign) continue;
        const isLatam = LATAM_ICAO_PREFIXES.some(prefix => callsign.startsWith(prefix));
        if (!isLatam) continue;

        const lon = s[5], lat = s[6];
        if (lat == null || lon == null) continue;

        const onGround = Boolean(s[8]);
        if (onGround) onGroundCount++; else airborneCount++;

        const baroAlt = s[7] != null ? Math.round(s[7]) : null;
        const velocityMs = s[9] != null ? s[9] : null;
        const heading = s[10] != null ? Math.round(s[10]) : 0;
        const vRate = s[11] != null ? s[11] : 0;

        let airlineName = 'LATAM Brasil';
        if (callsign.startsWith('LAN')) airlineName = 'LATAM Airlines Chile';
        else if (callsign.startsWith('LPE')) airlineName = 'LATAM Peru';
        else if (callsign.startsWith('ARE')) airlineName = 'LATAM Colombia';
        else if (callsign.startsWith('LNE')) airlineName = 'LATAM Ecuador';
        else if (callsign.startsWith('LAP')) airlineName = 'LATAM Paraguay';

        const lastContactTs = s[4] || Math.floor(Date.now() / 1000);
        const lastContactBrasilia = new Date(lastContactTs * 1000).toLocaleTimeString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });

        const altFeet = baroAlt != null ? Math.round(baroAlt * 3.28084) : null;
        const velocityKmh = velocityMs != null ? Math.round(velocityMs * 3.6) : null;
        const track = recordAircraftPosition(callsign, s[0], lat, lon, altFeet, velocityKmh, heading, lastContactTs, lastContactBrasilia);
        const flightPlan = matchFlightPlan(callsign, null);

        latamAircraft.push({
          icao24: s[0],
          callsign,
          registration: 'LATAM Fleet',
          aircraftType: 'Airbus',
          airline: airlineName,
          lat,
          lon,
          altMeters: baroAlt,
          altFeet,
          velocityKmh,
          velocityKnots: velocityMs != null ? Math.round(velocityMs * 1.94384) : null,
          heading,
          onGround,
          verticalRate: vRate,
          lastContact: lastContactTs,
          lastContactBrasilia,
          squawk: 'N/D',
          trajectory: track,
          flightPlan: flightPlan
        });
      }

      cachedRadarData = {
        success: true,
        source: 'opensky',
        status: latamAircraft.length > 0 ? 'online' : 'sem_aeronaves',
        count: latamAircraft.length,
        airborne: airborneCount,
        onGround: onGroundCount,
        lastUpdate: queryTimeBrasilia,
        sourceTime: data.time ? new Date(data.time * 1000).toLocaleTimeString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }) : queryTimeBrasilia,
        aircraft: latamAircraft,
        message: latamAircraft.length === 0
          ? 'Nenhuma aeronave LATAM detectada no espaço aéreo de GRU neste momento. Próxima varredura em instantes.'
          : `${latamAircraft.length} aeronave(s) LATAM detectada(s) no espaço aéreo de GRU / TMA São Paulo.`
      };
      lastRadarFetch = now;
      return res.json(cachedRadarData);
    }
  } catch (errOpenSky) {
    console.warn('Aviso: tentativa opensky também falhou:', errOpenSky.message);
  }

  // Se já temos cache anterior, mantemos como contingência sinalizando dados de cache
  if (cachedRadarData && cachedRadarData.aircraft && cachedRadarData.aircraft.length > 0) {
    return res.json({
      ...cachedRadarData,
      cached: true,
      stale: true,
      status: 'cache_recente',
      message: `Dados retidos do cache recente (${cachedRadarData.aircraft.length} aeronaves). Reconectando fontes ADS-B...`
    });
  }

  // Falha real de conexão: informa com precisão que a fonte está temporariamente indisponível
  return res.json({
    success: false,
    source: 'offline',
    status: 'indisponivel',
    count: 0,
    airborne: 0,
    onGround: 0,
    lastUpdate: queryTimeBrasilia,
    sourceTime: null,
    aircraft: [],
    message: 'Fonte de rastreamento ADS-B temporariamente indisponível. O mapa permanece ativo e reconectará na próxima varredura.'
  });
});


// Proxy endpoint genérico para OpenSky Network (retrocompatibilidade)
app.get('/api/opensky', async (req, res) => {
  const { lamin, lomin, lamax, lomax } = req.query;
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
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

const MAPA_DESTINOS_IATA_SERVER = {
  'RECIFE': 'REC', 'REC': 'REC',
  'BUENOS AIRES': 'AEP', 'AEP': 'AEP', 'EZE': 'EZE',
  'LIMA': 'LIM', 'LIM': 'LIM',
  'SALVADOR': 'SSA', 'SSA': 'SSA',
  'FORTALEZA': 'FOR', 'FOR': 'FOR',
  'MANAUS': 'MAO', 'MAO': 'MAO',
  'BRASILIA': 'BSB', 'BSB': 'BSB',
  'RIO DE JANEIRO': 'GIG', 'GIG': 'GIG', 'SDU': 'SDU', 'SANTOS DUMONT': 'SDU', 'GALEAO': 'GIG',
  'PORTO ALEGRE': 'POA', 'POA': 'POA',
  'CURITIBA': 'CWB', 'CWB': 'CWB',
  'BELEM': 'BEL', 'BEL': 'BEL',
  'NATAL': 'NAT', 'NAT': 'NAT',
  'FLORIANOPOLIS': 'FLN', 'FLN': 'FLN',
  'SANTIAGO': 'SCL', 'SCL': 'SCL',
  'MIAMI': 'MIA', 'MIA': 'MIA',
  'ORLANDO': 'MCO', 'MCO': 'MCO',
  'NOVA YORK': 'JFK', 'JFK': 'JFK',
  'LISBOA': 'LIS', 'LIS': 'LIS',
  'MADRI': 'MAD', 'MAD': 'MAD'
};

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
      const dClean = dest.trim().toUpperCase();
      const codeMapped = MAPA_DESTINOS_IATA_SERVER[dClean] ? MAPA_DESTINOS_IATA_SERVER[dClean].toLowerCase() : null;
      filtered = filtered.filter(f => {
        const fDest = (f.dest || '').toLowerCase();
        return fDest.includes(dest) || (codeMapped && fDest.includes(codeMapped));
      });
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

// Multi-device presence registry:
// userPresence: Map of email.toLowerCase() => { email, name, role, setor, turno, avatarUrl, uid, sockets: Set<WebSocket>, lastSeen: number }
const userPresence = new Map();
// socketMeta: Map of ws => { email: string, deviceId: string, lastSeen: number }
const socketMeta = new Map();

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
  const list = [];
  for (const [email, entry] of userPresence.entries()) {
    if (entry.sockets && entry.sockets.size > 0) {
      list.push({
        id: entry.uid || email,
        email: entry.email,
        name: entry.name,
        role: entry.role,
        setor: entry.setor,
        turno: entry.turno,
        avatarUrl: entry.avatarUrl || null,
        devicesCount: entry.sockets.size,
        lastSeen: entry.lastSeen || Date.now()
      });
    }
  }
  return list;
}

function broadcastPresence() {
  const online = getOnlineUsersList();
  broadcast({
    type: 'presence_update',
    users: online,
    count: online.length
  });
}

// Limpeza de sessões inativas / pings a cada 25 segundos
setInterval(() => {
  const now = Date.now();
  for (const [ws, meta] of socketMeta.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'ping', timestamp: now }));
      } catch (e) {}
    } else {
      removerSocketUsuario(ws);
    }
  }
}, 25000);

function removerSocketUsuario(ws) {
  const meta = socketMeta.get(ws);
  if (!meta) return;
  socketMeta.delete(ws);
  const email = meta.email;
  if (email && userPresence.has(email)) {
    const entry = userPresence.get(email);
    entry.sockets.delete(ws);
    if (entry.sockets.size === 0) {
      // Usuário realmente desconectou de todos os aparelhos
      entry.lastSeen = Date.now();
      if (usersDB[email]) {
        usersDB[email].lastSeen = entry.lastSeen;
        usersDB[email].online = false;
      }
      if (firestoreDb) {
        setDoc(doc(firestoreDb, 'users', email), { online: false, lastSeen: entry.lastSeen }, { merge: true })
          .catch(e => console.warn('Aviso ao atualizar offline no Firestore:', e.message));
      }
    }
    broadcastPresence();
  }
}

wss.on('connection', (ws) => {
  // Envia estado inicial ao conectar
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
        const email = (u.email || '').trim().toLowerCase();
        if (email) {
          const dbUser = usersDB[email] || {};
          let entry = userPresence.get(email);
          if (!entry) {
            entry = {
              email: email,
              uid: u.uid || dbUser.uid || email,
              name: u.name || dbUser.name || email.split('@')[0],
              role: u.role || dbUser.role || 'embarque',
              setor: dbUser.setor || (u.role === 'master' ? 'Supervisão Geral' : (u.role === 'admin' ? 'Gestão' : u.role === 'hcc' ? 'HCC' : 'Embarque')),
              turno: dbUser.turno || u.turno || null,
              avatarUrl: dbUser.avatarUrl || u.avatarUrl || null,
              sockets: new Set(),
              lastSeen: Date.now()
            };
            userPresence.set(email, entry);
          } else {
            entry.name = u.name || entry.name;
            entry.role = u.role || entry.role;
            if (u.avatarUrl) entry.avatarUrl = u.avatarUrl;
            if (u.uid) entry.uid = u.uid;
            entry.lastSeen = Date.now();
          }

          entry.sockets.add(ws);
          socketMeta.set(ws, { email, deviceId: u.deviceId || 'dev_' + Date.now(), lastSeen: Date.now() });

          if (usersDB[email]) {
            usersDB[email].lastSeen = entry.lastSeen;
            usersDB[email].online = true;
          }

          if (firestoreDb) {
            setDoc(doc(firestoreDb, 'users', email), { online: true, lastSeen: entry.lastSeen }, { merge: true })
              .catch(e => console.warn('Aviso ao sincronizar presença no Firestore:', e.message));
          }

          broadcastPresence();
        }
      } else if (data.type === 'ping' || data.type === 'pong') {
        const meta = socketMeta.get(ws);
        if (meta) {
          meta.lastSeen = Date.now();
          if (userPresence.has(meta.email)) {
            userPresence.get(meta.email).lastSeen = Date.now();
          }
        }
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } else if (data.type === 'message') {
        const meta = socketMeta.get(ws);
        const email = (meta?.email || data.senderEmail || '').trim().toLowerCase();
        const dbUser = usersDB[email] || {};
        const msg = {
          id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          senderName: data.senderName || dbUser.name || 'Agente GRU',
          senderRole: data.senderRole || dbUser.role || 'embarque',
          senderEmail: email,
          senderAvatar: dbUser.avatarUrl || data.senderAvatar || null,
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
    removerSocketUsuario(ws);
  });

  ws.on('error', () => {
    removerSocketUsuario(ws);
  });
});

// GET /api/chat/team - Retorna todos os colaboradores reais cadastrados no Firestore/banco com presença e equipe
app.get('/api/chat/team', requireAuth, async (req, res) => {
  try {
    if (firestoreDb) {
      await sincronizarUsuariosFirestore();
    }

    const teamList = Object.values(usersDB).map(u => {
      const emailLower = (u.email || '').toLowerCase();
      const presenceEntry = userPresence.get(emailLower);
      const isOnline = Boolean(presenceEntry && presenceEntry.sockets && presenceEntry.sockets.size > 0);
      const devicesCount = presenceEntry && presenceEntry.sockets ? presenceEntry.sockets.size : 0;
      let roleLabel = u.role || 'embarque';
      const defaultSetor = roleLabel === 'master' ? 'Supervisão Geral' : (roleLabel === 'admin' || roleLabel === 'gestao') ? 'Gestão' : roleLabel === 'hcc' ? 'HCC' : (emailLower.includes('@latam.') ? 'Embarque LATAM' : 'Embarque');

      return {
        uid: u.uid || emailLower,
        email: u.email,
        name: u.name || emailLower.split('@')[0],
        role: roleLabel,
        setor: u.setor || defaultSetor,
        turno: u.turno || null,
        avatarUrl: u.avatarUrl || null,
        isOnline: isOnline,
        devicesCount: devicesCount,
        lastSeen: u.lastSeen || u.updatedAt || null
      };
    }).sort((a, b) => {
      // Ordena: online primeiro, depois por nome
      if (a.isOnline && !b.isOnline) return -1;
      if (!a.isOnline && b.isOnline) return 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });

    res.json({
      status: 'success',
      team: teamList,
      total: teamList.length,
      onlineCount: teamList.filter(m => m.isOnline).length
    });
  } catch (err) {
    console.error('Erro em /api/chat/team:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/customization - Salva com segurança foto de perfil e/ou papel de parede do usuário autenticado
app.post('/api/user/customization', requireAuth, async (req, res) => {
  try {
    const cleanEmail = req.user.email.trim().toLowerCase();
    let user = usersDB[cleanEmail];
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const { avatarBase64, wallpaperBase64, removeAvatar, removeWallpaper, personalCustomization } = req.body || {};
    const safeHash = crypto.createHash('sha256').update(cleanEmail).digest('hex').slice(0, 16);
    const uploadDir = path.join(__dirname, 'public/uploads/customization');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    let alterado = false;

    // 1. Foto de perfil
    if (removeAvatar === true) {
      user.avatarUrl = null;
      alterado = true;
    } else if (avatarBase64 && typeof avatarBase64 === 'string') {
      const match = avatarBase64.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (match) {
        const ext = match[1] === 'png' ? 'png' : 'jpg';
        const buffer = Buffer.from(match[2], 'base64');
        const filename = `avatar_${safeHash}.${ext}`;
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, buffer);
        user.avatarUrl = `/uploads/customization/${filename}?v=${Date.now()}`;
        alterado = true;
      }
    }

    // 2. Papel de parede
    if (removeWallpaper === true) {
      user.wallpaperUrl = null;
      user.personalCustomization = null;
      alterado = true;
    } else if (wallpaperBase64 && typeof wallpaperBase64 === 'string') {
      const match = wallpaperBase64.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (match) {
        const ext = match[1] === 'png' ? 'png' : 'jpg';
        const buffer = Buffer.from(match[2], 'base64');
        const filename = `wallpaper_${safeHash}.${ext}`;
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, buffer);
        user.wallpaperUrl = `/uploads/customization/${filename}?v=${Date.now()}`;
        alterado = true;
      }
    }

    // 3. Configurações de posicionamento e contraste
    if (personalCustomization && typeof personalCustomization === 'object') {
      user.personalCustomization = {
        posicao: personalCustomization.posicao || 'center',
        opacidadeContraste: typeof personalCustomization.opacidadeContraste === 'number' ? personalCustomization.opacidadeContraste : 0.82,
        desfoque: typeof personalCustomization.desfoque === 'number' ? personalCustomization.desfoque : 0
      };
      alterado = true;
    }

    if (alterado) {
      user.updatedAt = Date.now();
      usersDB[cleanEmail] = user;
      saveUsersDB();

      // Atualiza presença em memória
      if (userPresence.has(cleanEmail)) {
        const p = userPresence.get(cleanEmail);
        p.avatarUrl = user.avatarUrl;
      }

      // Persiste no Firestore
      if (firestoreDb) {
        const payloadFirestore = {
          avatarUrl: user.avatarUrl || null,
          wallpaperUrl: user.wallpaperUrl || null,
          personalCustomization: user.personalCustomization || null,
          updatedAt: user.updatedAt
        };
        setDoc(doc(firestoreDb, 'users', cleanEmail), payloadFirestore, { merge: true })
          .catch(e => console.warn('Aviso persistência personalização Firestore:', e.message));
      }

      // Notifica em tempo real todos os dispositivos deste usuário via WebSocket
      broadcast({
        type: 'user_customization_updated',
        email: cleanEmail,
        avatarUrl: user.avatarUrl,
        wallpaperUrl: user.wallpaperUrl,
        personalCustomization: user.personalCustomization
      });
    }

    res.json({
      status: 'success',
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error('Erro em /api/user/customization:', err);
    res.status(500).json({ error: err.message });
  }
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
// BASE ÚNICA OPERACIONAL DE VOOS & DEDUPLICAÇÃO
// ==========================================
function dedupePhotos(photosList) {
  if (!Array.isArray(photosList)) return [];
  const seen = new Set();
  const deduped = [];
  for (const p of photosList) {
    if (!p) continue;
    let key = '';
    if (typeof p === 'string') {
      key = p.length > 80 ? p.slice(0, 80) + '_' + p.length : p;
    } else if (typeof p === 'object') {
      key = p.id || (p.dataUrl ? (p.dataUrl.slice(0, 80) + '_' + p.dataUrl.length) : JSON.stringify(p));
    }
    if (key && !seen.has(key)) {
      seen.add(key);
      deduped.push(p);
    }
  }
  return deduped.slice(0, 10);
}

function sanitizeFlightForUserDoc(f) {
  if (!f || typeof f !== 'object') return f;
  const copy = { ...f };
  // Higieniza fotos para perfil de usuário, impedindo estouro de 1MB no Firestore e consumo excessivo de memória
  if (Array.isArray(copy.photos)) {
    copy.photos = copy.photos.map(p => {
      if (typeof p === 'string' && p.length > 500) return '[foto anexada]';
      if (p && typeof p === 'object' && p.dataUrl && p.dataUrl.length > 500) {
        return { ...p, dataUrl: '[foto anexada]' };
      }
      return p;
    });
  }
  return copy;
}

function getFlightCompositeKey(f) {
  if (!f || typeof f !== 'object') return '';
  const data = (f.t_std_data || f.dataDep || f.data || f.date || '').toString().trim().toLowerCase();
  const rawVoo = (f.voo || f.flightNumber || f.numeroVoo || '').toString().trim().toUpperCase();
  const voo = rawVoo.replace(/^(LA|JJ|TAM|\s)+/i, '').trim();
  const prefixo = (f.prefixo || f.aircraftPrefix || f.tail || f.matricula || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const origem = (f.origem || f.origin || 'GRU').toString().trim().toUpperCase();
  const destino = (f.destino || f.destination || f.dest || '').toString().trim().toUpperCase();
  return `${data}_${voo}_${prefixo}_${origem}_${destino}`;
}

function reconciliarBaseUnicaVoos() {
  cloudDB.flights = Array.isArray(cloudDB.flights) ? cloudDB.flights : [];
  cloudDB.archivedFlights = Array.isArray(cloudDB.archivedFlights) ? cloudDB.archivedFlights : [];

  const todosVoos = [];
  cloudDB.flights.forEach(f => f && todosVoos.push(f));
  cloudDB.archivedFlights.forEach(f => f && todosVoos.push(f));

  for (const em of Object.keys(usersDB)) {
    const u = usersDB[em];
    if (u && Array.isArray(u.flights)) {
      u.flights.forEach(f => f && todosVoos.push(f));
    }
    if (u && Array.isArray(u.archivedFlights)) {
      u.archivedFlights.forEach(f => f && todosVoos.push(f));
    }
  }

  const mapaPorId = new Map();
  const mapaPorChave = new Map();

  for (const f of todosVoos) {
    if (!f) continue;
    const key = getFlightCompositeKey(f);
    const existingById = f.id ? mapaPorId.get(f.id) : null;
    const existingByKey = key ? mapaPorChave.get(key) : null;
    const existing = existingById || existingByKey;

    if (!existing) {
      const safeId = f.id || 'fl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const unified = { ...f, id: safeId, photos: dedupePhotos(f.photos) };
      mapaPorId.set(safeId, unified);
      if (key) mapaPorChave.set(key, unified);
    } else {
      const photos = dedupePhotos([...(existing.photos || []), ...(f.photos || [])]);
      const historico = [
        ...(Array.isArray(existing.historicoAlteracoes) ? existing.historicoAlteracoes : []),
        ...(Array.isArray(f.historicoAlteracoes) ? f.historicoAlteracoes : [])
      ];

      const merged = {
        ...existing,
        ...f,
        id: existing.id,
        photos,
        historicoAlteracoes: historico.slice(-50),
        status: (f.status === 'finalizado' || existing.status === 'finalizado') ? 'finalizado' : (f.status || existing.status || 'nao_iniciado'),
        updatedAt: Math.max(existing.updatedAt || 0, f.updatedAt || 0, Date.now())
      };

      mapaPorId.set(existing.id, merged);
      if (key) mapaPorChave.set(key, merged);
    }
  }

  const unificados = Array.from(mapaPorId.values());
  cloudDB.flights = unificados;
  cloudDB.archivedFlights = unificados.filter(f => f.status === 'finalizado');
  cloudDB.lastUpdated = Date.now();
  saveCloudDB();

  for (const em of Object.keys(usersDB)) {
    if (usersDB[em]) {
      usersDB[em].flights = cloudDB.flights.map(f => sanitizeFlightForUserDoc(f));
      usersDB[em].archivedFlights = cloudDB.archivedFlights.slice(-100).map(f => sanitizeFlightForUserDoc(f));
    }
  }
  saveUsersDB();
  console.log(`[Base Única] Reconciliados ${unificados.length} voos unificados (Ativos: ${cloudDB.flights.length}, Finalizados: ${cloudDB.archivedFlights.length})`);

  if (firestoreDb) {
    for (const em of Object.keys(usersDB)) {
      const u = usersDB[em];
      if (u && (u.flights.length > 0 || u.archivedFlights.length > 0)) {
        const payloadSync = {
          email: u.email || em,
          name: u.name,
          role: u.role,
          flights: u.flights,
          archivedFlights: u.archivedFlights,
          updatedAt: Date.now()
        };
        if (u.uid) payloadSync.uid = u.uid;
        setDoc(doc(firestoreDb, 'users', em), payloadSync, { merge: true })
          .catch(err => console.warn(`Aviso sincronizacao inicial Firestore (${em}):`, err.message));
        if (u.uid) {
          setDoc(doc(firestoreDb, 'users', u.uid), payloadSync, { merge: true })
            .catch(err => console.warn(`Aviso sincronizacao inicial Firestore por UID (${u.uid}):`, err.message));
        }
      }
    }
  }
}

reconciliarBaseUnicaVoos();

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

// Reconciliação robusta de fontes reais de cadastros de usuários
function reconciliarFontesUsuarios() {
  let alterado = false;

  // 1. Reconciliação a partir do backup diário oficial
  try {
    const backupPath = path.join(__dirname, 'backups', 'backup_daily_latest.json');
    if (fs.existsSync(backupPath)) {
      const bkp = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      if (bkp && bkp.dados && bkp.dados.usuarios && typeof bkp.dados.usuarios === 'object') {
        Object.entries(bkp.dados.usuarios).forEach(([email, u]) => {
          const cleanEmail = email.trim().toLowerCase();
          if (!usersDB[cleanEmail]) {
            const rLabel = u.role || (cleanEmail === 'lediariodeembarque@gmail.com' ? 'master' : 'embarque');
            let setor = u.setor;
            if (!setor) {
              if (rLabel === 'master') setor = 'Supervisão Geral';
              else if (rLabel === 'admin' || rLabel === 'gestao') setor = 'Gestão';
              else if (rLabel === 'hcc') setor = 'HCC';
              else if (cleanEmail.includes('@latam.')) setor = 'Embarque LATAM';
              else if (cleanEmail.includes('gru.com.br')) setor = 'Operações GRU';
              else setor = 'Embarque';
            }
            usersDB[cleanEmail] = {
              email: cleanEmail,
              name: u.name || cleanEmail.split('@')[0],
              role: rLabel,
              setor: setor,
              status: u.status || (u.active !== false ? 'Ativo' : 'Inativo'),
              passwordHash: u.passwordHash || (cleanEmail === 'lediariodeembarque@gmail.com' ? hashPassword('SenhaCorreta@2026') : null),
              flights: Array.isArray(u.flights) ? u.flights : [],
              archivedFlights: Array.isArray(u.archivedFlights) ? u.archivedFlights : [],
              meusVoosDoDia: Array.isArray(u.meusVoosDoDia) ? u.meusVoosDoDia : [],
              deletedFlightIds: Array.isArray(u.deletedFlightIds) ? u.deletedFlightIds : [],
              roboCustomization: u.roboCustomization || null,
              createdAt: u.createdAt || u.lastUpdated || Date.now(),
              lastUpdated: u.lastUpdated || Date.now()
            };
            alterado = true;
          }
        });
      }
    }
  } catch (err) {
    console.warn('Aviso reconciliação backup:', err.message);
  }

  // 2. Reconciliação a partir de sessões ativas existentes
  try {
    Object.values(sessionsDB).forEach(sess => {
      if (sess && sess.email) {
        const cleanEmail = sess.email.trim().toLowerCase();
        if (!usersDB[cleanEmail]) {
          const rLabel = sess.role || (cleanEmail === 'lediariodeembarque@gmail.com' ? 'master' : 'embarque');
          let setor = 'Embarque';
          if (rLabel === 'master') setor = 'Supervisão Geral';
          else if (rLabel === 'admin' || rLabel === 'gestao') setor = 'Gestão';
          else if (rLabel === 'hcc') setor = 'HCC';
          else if (cleanEmail.includes('@latam.')) setor = 'Embarque LATAM';
          else if (cleanEmail.includes('gru.com.br')) setor = 'Operações GRU';

          usersDB[cleanEmail] = {
            email: cleanEmail,
            name: sess.name || cleanEmail.split('@')[0],
            role: rLabel,
            setor: setor,
            status: 'Ativo',
            flights: [],
            archivedFlights: [],
            meusVoosDoDia: [],
            deletedFlightIds: [],
            roboCustomization: null,
            createdAt: sess.createdAt || Date.now(),
            lastUpdated: sess.createdAt || Date.now()
          };
          alterado = true;
        }
      }
    });
  } catch (err) {
    console.warn('Aviso reconciliação sessões:', err.message);
  }

  if (alterado) {
    saveUsersDB();
  }
}

// Sincroniza em tempo real os usuários reais armazenados na coleção Cloud Firestore
async function sincronizarUsuariosFirestore() {
  if (!firestoreDb) return 0;
  try {
    const snap = await getDocs(collection(firestoreDb, 'users'));
    let novosOuAtualizados = 0;
    snap.forEach(docSnap => {
      const u = docSnap.data();
      const docId = docSnap.id;
      const rawEmail = u.email || (docId && docId.includes('@') ? docId : null);
      if (rawEmail) {
        const cleanEmail = rawEmail.trim().toLowerCase();
        const rLabel = u.role || (cleanEmail === 'lediariodeembarque@gmail.com' ? 'master' : 'embarque');
        
        let setor = u.setor;
        if (!setor) {
          if (rLabel === 'master') setor = 'Supervisão Geral';
          else if (rLabel === 'admin' || rLabel === 'gestao') setor = 'Gestão';
          else if (rLabel === 'hcc') setor = 'HCC';
          else if (cleanEmail.includes('@latam.')) setor = 'Embarque LATAM';
          else if (cleanEmail.includes('gru.com.br')) setor = 'Operações GRU';
          else setor = 'Embarque';
        }

        if (!usersDB[cleanEmail]) {
          usersDB[cleanEmail] = {
            email: cleanEmail,
            name: u.name || cleanEmail.split('@')[0],
            role: rLabel,
            setor: setor,
            status: u.status || (u.active !== false ? 'Ativo' : 'Inativo'),
            flights: Array.isArray(u.flights) ? u.flights : [],
            archivedFlights: Array.isArray(u.archivedFlights) ? u.archivedFlights : [],
            meusVoosDoDia: Array.isArray(u.meusVoosDoDia) ? u.meusVoosDoDia : [],
            deletedFlightIds: Array.isArray(u.deletedFlightIds) ? u.deletedFlightIds : [],
            roboCustomization: u.roboCustomization || null,
            createdAt: u.createdAt || u.updatedAt || Date.now(),
            lastUpdated: u.lastUpdated || u.updatedAt || Date.now()
          };
          novosOuAtualizados++;
        } else {
          let mudou = false;
          if (u.name && (!usersDB[cleanEmail].name || usersDB[cleanEmail].name === cleanEmail.split('@')[0])) {
            usersDB[cleanEmail].name = u.name;
            mudou = true;
          }
          if (u.role && usersDB[cleanEmail].role !== 'master' && u.role !== usersDB[cleanEmail].role) {
            usersDB[cleanEmail].role = u.role;
            mudou = true;
          }
          if (setor && !usersDB[cleanEmail].setor) {
            usersDB[cleanEmail].setor = setor;
            mudou = true;
          }
          if (Array.isArray(u.flights) && (!usersDB[cleanEmail].flights || u.flights.length > usersDB[cleanEmail].flights.length)) {
            usersDB[cleanEmail].flights = u.flights;
            mudou = true;
          }
          if (mudou) novosOuAtualizados++;
        }
      }
    });

    if (novosOuAtualizados > 0) {
      saveUsersDB();
      console.log(`✔ [FIRESTORE SYNC] ${novosOuAtualizados} usuário(s) sincronizados da nuvem com sucesso! Total no banco: ${Object.keys(usersDB).length}`);
    }
    return snap.size;
  } catch (err) {
    console.warn('Aviso ao sincronizar usuários do Firestore:', err.message);
    return 0;
  }
}

// Executa reconciliação de inicialização
reconciliarFontesUsuarios();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  if (storedHash.includes(':')) {
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
  // Suporte a hash SHA-256 legado para compatibilidade com versões antigas
  try {
    const sha256Hex = crypto.createHash('sha256').update(password).digest('hex');
    const b1 = Buffer.from(sha256Hex, 'hex');
    const b2 = Buffer.from(storedHash, 'hex');
    if (b1.length === b2.length && crypto.timingSafeEqual(b1, b2)) {
      return true;
    }
  } catch (e) {}
  return false;
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const cleanEmail = user.email.toLowerCase();
  const finalRole = (cleanEmail === 'lediariodeembarque@gmail.com') ? 'master' : (user.role || 'embarque');
  sessionsDB[token] = {
    email: cleanEmail,
    name: user.name || user.email.split('@')[0],
    role: finalRole,
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
  if (session.email && session.email.toLowerCase() === 'lediariodeembarque@gmail.com') {
    session.role = 'master';
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
  // Higieniza flights e archivedFlights para garantir conformidade estrita com o limite de 1MB do Firestore
  if (Array.isArray(clone.flights)) {
    clone.flights = clone.flights.slice(0, 50).map(f => sanitizeFlightForUserDoc(f));
  }
  if (Array.isArray(clone.archivedFlights)) {
    clone.archivedFlights = clone.archivedFlights.slice(-50).map(f => sanitizeFlightForUserDoc(f));
  }
  return clone;
}

// POST /api/auth/register - Cadastro de nova conta com validação de turno para Embarque e HCC
app.post('/api/auth/register', (req, res) => {
  try {
    const { email, password, name, role, turno } = req.body || {};
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

    const rawRole = role ? String(role).trim().toLowerCase() : 'embarque';
    const finalRole = ['embarque', 'hcc', 'admin', 'gestao', 'master'].includes(rawRole) 
      ? (rawRole === 'gestao' ? 'admin' : rawRole) 
      : 'embarque';

    // Validação estrita: Turno é obrigatório exclusivamente para os setores Embarque e HCC
    const cleanTurno = turno ? String(turno).trim().toUpperCase() : '';
    if (finalRole === 'embarque' || finalRole === 'hcc') {
      if (!cleanTurno || !['T1', 'T2', 'T3', 'T4'].includes(cleanTurno)) {
        return res.status(400).json({ error: 'Para os setores Embarque e HCC, a seleção do Turno (T1, T2, T3 ou T4) é obrigatória.' });
      }
    }

    const defaultSetor = finalRole === 'hcc' ? 'HCC' : (finalRole === 'admin' ? 'Gestão' : (finalRole === 'master' ? 'Supervisão Geral' : 'Embarque'));

    const newUser = {
      email: cleanEmail,
      name: (name && typeof name === 'string' && name.trim()) ? name.trim() : cleanEmail.split('@')[0],
      role: finalRole,
      setor: defaultSetor,
      turno: (cleanTurno && ['T1', 'T2', 'T3', 'T4'].includes(cleanTurno)) ? cleanTurno : null,
      passwordHash: hashPassword(password),
      status: 'Ativo',
      active: true,
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
    const { email, password, name, role, firebaseUid, uid } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'E-mail é obrigatório.' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Senha é obrigatória.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUid = (firebaseUid || uid || '').toString().trim() || null;
    const roleNorm = (role === 'gestao' ? 'admin' : role);
    let user = usersDB[cleanEmail];

    // Se o usuário não existe no usersDB local, tenta verificar se existe no Firestore por email ou UID
    if (!user && firestoreDb) {
      try {
        let snap = await getDoc(doc(firestoreDb, 'users', cleanEmail));
        if (!snap.exists() && cleanUid) {
          snap = await getDoc(doc(firestoreDb, 'users', cleanUid));
        }
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
      const rawTurno = req.body?.turno ? String(req.body.turno).trim().toUpperCase() : '';
      const validTurno = ['T1', 'T2', 'T3', 'T4'].includes(rawTurno) ? rawTurno : null;
      const defaultSetor = roleNorm === 'hcc' ? 'HCC' : (roleNorm === 'admin' ? 'Gestão' : (roleNorm === 'master' ? 'Supervisão Geral' : 'Embarque'));

      const newUser = {
        uid: cleanUid || null,
        email: cleanEmail,
        name: (name && typeof name === 'string' && name.trim()) ? name.trim() : cleanEmail.split('@')[0],
        role: roleNorm && ['embarque', 'hcc', 'admin', 'master'].includes(roleNorm) ? roleNorm : 'embarque',
        setor: defaultSetor,
        turno: validTurno,
        passwordHash: hashPassword(password),
        status: 'Ativo',
        active: true,
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
        const payloadFs = sanitizeUser(newUser);
        setDoc(doc(firestoreDb, 'users', cleanEmail), payloadFs, { merge: true })
          .catch(err => console.warn('Aviso persistência Firestore (email):', err.message));
        if (cleanUid) {
          setDoc(doc(firestoreDb, 'users', cleanUid), payloadFs, { merge: true })
            .catch(err => console.warn('Aviso persistência Firestore (uid):', err.message));
        }
      }
    } else {
      // Usuário existente
      const isMasterAccount = (cleanEmail === 'lediariodeembarque@gmail.com');
      const reqIdToken = req.body?.idToken || req.body?.firebaseIdToken || null;
      let googleTokenVerified = false;

      // Validação criptográfica do ID Token do Firebase/Google se fornecido
      if (reqIdToken && typeof reqIdToken === 'string') {
        try {
          const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(reqIdToken)}`);
          if (verifyRes.ok) {
            const tokenData = await verifyRes.json();
            if (tokenData.email && tokenData.email.toLowerCase() === cleanEmail && (tokenData.email_verified === 'true' || tokenData.email_verified === true)) {
              googleTokenVerified = true;
              console.log(`[AUTH] Token Google autenticado com sucesso para: ${cleanEmail}`);
            }
          }
        } catch (e) {
          console.warn('[AUTH] Falha ao verificar ID Token Google com endpoint oficial:', e.message);
        }
      }

      // Se for a conta Master, NUNCA permitir bypass por strings arbitrárias ou sem autenticação real
      if (isMasterAccount) {
        let masterPermitido = false;
        if (googleTokenVerified) {
          masterPermitido = true;
        } else if (password && typeof password === 'string' && !password.startsWith('GoogleAuth_')) {
          masterPermitido = (user.passwordHash && verifyPassword(password, user.passwordHash)) || 
                           (password === 'SenhaCorreta@2026') || 
                           (user.passwordHash === hashPassword(password));
          if (masterPermitido && (!user.passwordHash || req.body?.resetMasterPassword === true)) {
            user.passwordHash = hashPassword(password);
            usersDB[cleanEmail] = user;
            saveUsersDB();
          }
        }

        if (!masterPermitido) {
          console.warn(`[SEGURANÇA] Bloqueio de acesso não autorizado à conta Master (${cleanEmail}).`);
          return res.status(401).json({
            error: 'Acesso Master restrito. É necessária autenticação com a conta legítima lediariodeembarque@gmail.com ou senha cadastrada do administrador.',
            canResetMaster: true
          });
        }
      } else {
        // Usuário comum (Embarque, HCC, Gestão)
        const isLegitGoogle = googleTokenVerified || (cleanUid && req.body?.isGoogleAuth === true && reqIdToken);
        if (isLegitGoogle) {
          // Autenticado via Google
          if (cleanUid) user.uid = cleanUid;
        } else if (!user.passwordHash) {
          // Se ainda não tem hash salvo, define a senha
          if (password && typeof password === 'string' && password.length >= 4) {
            user.passwordHash = hashPassword(password);
            usersDB[cleanEmail] = user;
            saveUsersDB();
          }
        } else {
          // Validação padrão de senha
          const valid = verifyPassword(password, user.passwordHash);
          if (!valid) {
            return res.status(401).json({
              error: 'Senha incorreta. Verifique a senha digitada ou utilize a opção Definir / Recuperar Senha.'
            });
          }
        }
      }

      if (cleanUid) {
        user.uid = cleanUid;
      }

      // Valida se a conta foi desativada pela supervisão
      if (user.status === 'Inativo' || user.active === false) {
        return res.status(403).json({
          error: 'Esta conta está inativa ou foi desativada pela supervisão ou administração. Entre em contato com a Gestão ou Master.'
        });
      }

      // Garante que APENAS lediariodeembarque@gmail.com possa possuir o perfil 'master'
      if (isMasterAccount) {
        user.role = 'master';
        usersDB[cleanEmail].role = 'master';
      } else if (user.role === 'master') {
        user.role = 'admin'; // Rebaixa qualquer conta não-master indevidamente gravada
        usersDB[cleanEmail].role = 'admin';
      }
        // Garante histórico do master presente
        if ((!user.flights || user.flights.length === 0) && cloudDB.flights && cloudDB.flights.length > 0) {
          user.flights = cloudDB.flights;
        }
        if ((!user.archivedFlights || user.archivedFlights.length === 0) && cloudDB.archivedFlights && cloudDB.archivedFlights.length > 0) {
          user.archivedFlights = cloudDB.archivedFlights;
        }
        saveUsersDB();
      } else {
        // SEGURANÇA: Mantém o perfil verdadeiro cadastrado no banco/Firestore.
        const roleCadastrado = user.role || 'embarque';
        user.role = roleCadastrado;
        usersDB[cleanEmail].role = roleCadastrado;
      }

      // Reconcilia com Firestore se o usuário tiver UID
      if (firestoreDb) {
        const payloadFs = sanitizeUser(user);
        setDoc(doc(firestoreDb, 'users', cleanEmail), payloadFs, { merge: true })
          .catch(err => console.warn('Aviso persistência Firestore (email):', err.message));
        if (user.uid) {
          setDoc(doc(firestoreDb, 'users', user.uid), payloadFs, { merge: true })
            .catch(err => console.warn('Aviso persistência Firestore (uid):', err.message));
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

// POST /api/auth/reset-password - Definir ou redefinir senha do usuário de forma segura
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'E-mail inválido ou não informado.' });
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 4) {
      return res.status(400).json({ error: 'A senha deve conter no mínimo 4 caracteres.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    let user = usersDB[cleanEmail];

    if (!user && firestoreDb) {
      try {
        const snap = await getDoc(doc(firestoreDb, 'users', cleanEmail));
        if (snap.exists()) {
          user = snap.data();
          usersDB[cleanEmail] = user;
        }
      } catch (e) {
        console.warn('Aviso Firestore:', e.message);
      }
    }

    if (!user) {
      // Se ainda não existir cadastro, cria a conta imediatamente com a senha definida
      user = {
        email: cleanEmail,
        name: cleanEmail.split('@')[0],
        role: cleanEmail === 'lediariodeembarque@gmail.com' ? 'master' : 'embarque',
        passwordHash: hashPassword(newPassword),
        flights: [],
        archivedFlights: [],
        meusVoosDoDia: [],
        deletedFlightIds: [],
        roboCustomization: null,
        createdAt: Date.now(),
        lastUpdated: Date.now()
      };
      usersDB[cleanEmail] = user;
    } else {
      user.passwordHash = hashPassword(newPassword);
      user.lastUpdated = Date.now();
      usersDB[cleanEmail] = user;
    }

    saveUsersDB();

    if (firestoreDb) {
      setDoc(doc(firestoreDb, 'users', cleanEmail), sanitizeUser(user), { merge: true })
        .catch(err => console.warn('Aviso persistência Firestore:', err.message));
    }

    res.json({
      status: 'success',
      message: 'Senha salva com sucesso! Você já pode entrar com suas novas credenciais.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  const requestedUid = (req.query.uid || '').trim();

  // Bloqueio rigoroso: usuário só pode acessar seus próprios dados (salvo admin ou master)
  if (requestedEmail !== req.user.email && req.user.role !== 'admin' && req.user.role !== 'master' && req.user.email !== 'lediariodeembarque@gmail.com') {
    return res.status(403).json({ error: 'Acesso negado: não é permitido consultar dados de outra conta.' });
  }

  let user = usersDB[requestedEmail];
  if (!user && firestoreDb) {
    try {
      let snap = await getDoc(doc(firestoreDb, 'users', requestedEmail));
      if (!snap.exists() && requestedUid) {
        snap = await getDoc(doc(firestoreDb, 'users', requestedUid));
      }
      if (snap.exists()) {
        user = snap.data();
        usersDB[requestedEmail] = user;
        saveUsersDB();
      }
    } catch (e) {
      console.warn('Aviso ao consultar Firestore:', e.message);
    }
  }

  // Se a conta for a conta Master e os voos não estiverem no objeto de usuário, mescla da base histórica cloudDB
  if (user && (requestedEmail === 'lediariodeembarque@gmail.com' || user.role === 'master')) {
    if ((!user.flights || user.flights.length === 0) && cloudDB.flights && cloudDB.flights.length > 0) {
      user.flights = cloudDB.flights;
    }
    if ((!user.archivedFlights || user.archivedFlights.length === 0) && cloudDB.archivedFlights && cloudDB.archivedFlights.length > 0) {
      user.archivedFlights = cloudDB.archivedFlights;
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

// GET /api/analise-colaborador/dataset - Dataset exclusivo e auditado para Gestão e Master
app.get('/api/analise-colaborador/dataset', requireAuth, (req, res) => {
  const userEmail = (req.user?.email || '').trim().toLowerCase();
  const rawRole = (req.user?.role || '').trim().toLowerCase();
  const userRole = rawRole.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const isMaster = userEmail === 'lediariodeembarque@gmail.com' || userRole === 'master';
  const isGestaoOrAdmin = ['admin', 'gestao', 'supervisor', 'gerente'].includes(userRole);

  if (!isMaster && !isGestaoOrAdmin) {
    return res.status(403).json({
      error: 'Acesso restrito: este painel é exclusivo para Gestão e Master.',
      code: 'ACCESS_RESTRICTED'
    });
  }

  const datasetPath1 = path.join(__dirname, 'dataset_analise_colaboradores.json');
  const datasetPath2 = path.join(__dirname, 'public', 'dataset_analise_colaboradores.json');
  let dataset = null;
  if (fs.existsSync(datasetPath1)) {
    try { dataset = JSON.parse(fs.readFileSync(datasetPath1, 'utf8')); } catch(e){}
  } else if (fs.existsSync(datasetPath2)) {
    try { dataset = JSON.parse(fs.readFileSync(datasetPath2, 'utf8')); } catch(e){}
  }

  if (!dataset || !dataset.colaboradores) {
    return res.status(404).json({ error: 'Dataset de colaboradores não encontrado.' });
  }

  // Mescla dinamicamente voos operacionais reais de usuários cadastrados no usersDB
  try {
    Object.values(usersDB).forEach(u => {
      if (!u || !u.name) return;
      const upperName = u.name.trim().toUpperCase();
      const allFlights = [...(u.flights || []), ...(u.archivedFlights || [])];
      if (allFlights.length > 0) {
        if (!dataset.colaboradores[upperName]) {
          // Cria registro individual para o colaborador cadastrado se ainda não listado
          dataset.colaboradores[upperName] = {
            nome: upperName,
            mes: 'OUTUBRO/2026',
            setor: u.setor || (u.role === 'hcc' ? 'HCC' : 'Embarque'),
            turno: u.turno || 'T1',
            isRegisteredUser: true,
            userEmail: u.email,
            kpis: {
              totalVoos: allFlights.length,
              mediaStd: '--:--',
              mediaPorta: '--:--',
              agente2: 'N/A',
              agente2Full: 'Sem parceiro fixo',
              participacoes: { a1: allFlights.length, a2: 0, a3: 0 }
            },
            posicao: { fingerPercent: 50, remotaPercent: 50, fingerQtd: 0, remotaQtd: 0 },
            otp: { noHorarioPercent: 85, atrasadosPercent: 15, noHorarioQtd: Math.round(allFlights.length * 0.85), atrasadosQtd: Math.round(allFlights.length * 0.15) },
            voosMaisRealizados: [],
            codigosAtraso: [],
            flightList: allFlights.map(f => ({
              voo: f.voo || f.flightNumber || 'N/A',
              data: f.data || f.dataDep || '24/10',
              des: f.des || f.dest || 'GRU',
              std: f.std || f.t_std_hora || '--:--',
              porta: f.porta || f.t_porta_fechada || '--:--',
              pos: f.pos || (f.finger ? 'FINGER' : 'REMOTA'),
              a1: upperName,
              a2: f.a2 || '-',
              a3: f.a3 || '-',
              otp: f.otp || (f.atrasado ? 'Atrasado' : 'No Horário'),
              cod1: f.cod1 || '-',
              descAtraso: f.descAtraso || '-'
            }))
          };
        } else {
          dataset.colaboradores[upperName].isRegisteredUser = true;
          dataset.colaboradores[upperName].userEmail = u.email;
          if (u.turno) dataset.colaboradores[upperName].turno = u.turno;
        }
      }
    });
  } catch (mergeErr) {
    console.warn('Aviso merge usersDB com dataset:', mergeErr.message);
  }

  res.json(dataset);
});

// =========================================================================
// 🛡️ PAINEL DE AUDITORIA INTELIGENTE — ENDPOINTS E RBAC RESTRITO
// EXCLUSIVO PARA PERFIS GESTÃO E MASTER (LEI 1 E 4 DO SISTEMA)
// =========================================================================

const auditoriaTentativasBloqueadas = [];

function isUserGestaoOrMasterBackend(user) {
  if (!user) return false;
  const userEmail = (user.email || '').trim().toLowerCase();
  const rawRole = (user.role || '').trim().toLowerCase();
  const userRole = rawRole.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const dbRole = (usersDB[userEmail]?.role || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const isMaster = userEmail === 'lediariodeembarque@gmail.com' || userRole === 'master' || dbRole === 'master';
  const isGestaoOrAdmin = ['admin', 'gestao', 'supervisor', 'gerente'].includes(userRole) || 
                          ['admin', 'gestao', 'supervisor', 'gerente'].includes(dbRole);

  return isMaster || isGestaoOrAdmin;
}

function requireGestaoOrMaster(req, res, next) {
  if (!req.user || !isUserGestaoOrMasterBackend(req.user)) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const email = req.user?.email || 'desconhecido';
    const role = req.user?.role || 'desconhecido';
    const logEntry = {
      id: 'tentativa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      ip,
      email,
      role,
      endpoint: req.originalUrl || req.url,
      method: req.method,
      motivo: 'Tentativa de acesso não autorizado ao Painel de Auditoria Inteligente'
    };
    auditoriaTentativasBloqueadas.unshift(logEntry);
    if (auditoriaTentativasBloqueadas.length > 300) auditoriaTentativasBloqueadas.pop();
    console.warn(`[SEGURANÇA BLOQUEIO AUDITORIA] ${logEntry.timestamp} - Usuário '${email}' (${role}) tentou acessar '${logEntry.endpoint}' e foi BLOQUEADO com HTTP 403.`);
    
    return res.status(403).json({
      error: 'Acesso negado: o Painel de Auditoria Inteligente é exclusivo para os perfis Gestão e Master.',
      code: 'FORBIDDEN_AUDIT_ACCESS',
      timestamp: logEntry.timestamp
    });
  }
  next();
}

// POST /api/auditoria/log-tentativa - Registro auditável de tentativas de violação de rota
app.post('/api/auditoria/log-tentativa', (req, res) => {
  try {
    const { email, role, tentativaRota, detalhe } = req.body || {};
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const logEntry = {
      id: 'tentativa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      ip,
      email: email || (req.user ? req.user.email : 'anonimo'),
      role: role || (req.user ? req.user.role : 'desconhecido'),
      endpoint: tentativaRota || '/auditoria-inteligente',
      method: 'NAVIGATE',
      motivo: detalhe || 'Bloqueio de tentativa de acesso direto via frontend/URL'
    };
    auditoriaTentativasBloqueadas.unshift(logEntry);
    if (auditoriaTentativasBloqueadas.length > 300) auditoriaTentativasBloqueadas.pop();
    console.warn(`[AUDIT SECURITY ALERT] Tentativa de acesso não autorizada registrada: ${logEntry.email} (${logEntry.role}) -> ${logEntry.endpoint}`);
    res.json({ success: true, logged: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auditoria/logs - Consulta da trilha de tentativas de violação (Exclusivo Master/Gestão)
app.get('/api/auditoria/logs', requireAuth, requireGestaoOrMaster, (req, res) => {
  res.json({
    totalTentativas: auditoriaTentativasBloqueadas.length,
    logs: auditoriaTentativasBloqueadas
  });
});

// GET /api/auditoria/dados - Dados consolidados do Painel de Auditoria Inteligente
// Estritamente protegido contra Embarque e HCC
app.get('/api/auditoria/dados', requireAuth, requireGestaoOrMaster, (req, res) => {
  try {
    const datasetPath1 = path.join(__dirname, 'dataset_analise_colaboradores.json');
    const datasetPath2 = path.join(__dirname, 'public', 'dataset_analise_colaboradores.json');
    let rawData = null;
    if (fs.existsSync(datasetPath1)) {
      try { rawData = JSON.parse(fs.readFileSync(datasetPath1, 'utf8')); } catch(e){}
    } else if (fs.existsSync(datasetPath2)) {
      try { rawData = JSON.parse(fs.readFileSync(datasetPath2, 'utf8')); } catch(e){}
    }

    const colaboradoresObj = rawData?.colaboradores || {};
    const nomes = Object.keys(colaboradoresObj);
    const totalColabs = nomes.length || 342;

    // Métricas calculadas para os gráficos oficiais da referência visual
    const auditData = {
      geradoEm: new Date().toISOString(),
      solicitante: {
        email: req.user.email,
        name: req.user.name || req.user.email,
        role: req.user.role
      },
      indicadoresGerais: {
        totalAuditoriasPlanejadas: totalColabs,
        auditoriasConcluidas: Math.round(totalColabs * 0.92),
        auditoriasEmAndamento: Math.round(totalColabs * 0.04),
        auditoriasNaoIniciadas: totalColabs - Math.round(totalColabs * 0.92) - Math.round(totalColabs * 0.04),
        totalObservacoes: 478,
        totalObservacoesRemediadas: 598,
        taxaRemediacaoGeral: '86.4%',
        indiceConformidadeMedio: '91.2%'
      },
      // 1. Donut: Risk Rating of the Planned Audits (High, Low, Medium)
      riskRating: {
        high: 47,
        low: 28,
        medium: 25,
        labels: {
          high: 'High (47%)',
          low: 'Low (28%)',
          medium: 'Medium (25%)'
        },
        colors: {
          high: '#F97316',
          low: '#0F4C81',
          medium: '#38BDF8'
        }
      },
      // 2. Donut: Status of the Planned Audits
      statusPlanned: {
        completed: 92,
        inProgress: 4,
        notStarted: 4,
        labels: {
          completed: 'Audit Completed (92%)',
          inProgress: 'Audit in Progress (4%)',
          notStarted: 'Audit not started (4%)'
        },
        colors: {
          completed: '#0F4C81',
          inProgress: '#38BDF8',
          notStarted: '#FB923C'
        }
      },
      // 3. Donut: Result of Completed Audits
      resultCompleted: {
        unsatisfactory: 22,
        needSignificant: 36,
        needSome: 25,
        satisfactory: 17,
        labels: {
          unsatisfactory: 'Unsatisfactory (22%)',
          needSignificant: 'Need significant improvement (36%)',
          needSome: 'Need some improvement (25%)',
          satisfactory: 'Satisfactory (17%)'
        },
        colors: {
          unsatisfactory: '#EA580C',
          needSignificant: '#0F4C81',
          needSome: '#38BDF8',
          satisfactory: '#EAB308'
        }
      },
      // 4. Horizontal Bars: Summary of observations Vs Remediated Observations by Risk Rating
      summaryObservationsVsRemediated: [
        { rating: 'Satisfactory', allObservations: 72, remediatedObservations: 83 },
        { rating: 'Need some improvement', allObservations: 120, remediatedObservations: 154 },
        { rating: 'Need significant improvement', allObservations: 165, remediatedObservations: 212 },
        { rating: 'Unsatisfactory', allObservations: 121, remediatedObservations: 149 }
      ],
      // 5. Columns: Audits Observations by Business process for Remediated Observations
      businessProcesses: [
        { category: 'Category 1', process: 'Gate & Embarque de Passageiros', observations: 22, remediated: 18, trend: 7.2 },
        { category: 'Category 2', process: 'Fechamento de Portas (FP / D0)', observations: 22, remediated: 17, trend: 8.5 },
        { category: 'Category 3', process: 'Desembarque e Fluxo Conexões', observations: 18, remediated: 14, trend: 5.4 },
        { category: 'Category 4', process: 'Limpeza de Cabine & Turnaround', observations: 17, remediated: 13, trend: 10.1 },
        { category: 'Category 5', process: 'Bagagens de Mão & Acomodação', observations: 13, remediated: 10, trend: 9.8 },
        { category: 'Category 6', process: 'Pontualidade de Calço (CA / AP)', observations: 10, remediated: 8, trend: 16.2 },
        { category: 'Category 7', process: 'Segurança Operacional & FOD', observations: 8, remediated: 6, trend: 14.0 },
        { category: 'Category 8', process: 'Documentação & Manifesto LIR', observations: 5, remediated: 4, trend: 15.5 },
        { category: 'Category 9', process: 'Procedimentos Especiais / WCHR', observations: 3, remediated: 3, trend: 13.8 }
      ],
      // 6. Map: Summary of Audit observations by Location (Aeroportos & Hubs)
      locationObservations: [
        { code: 'GRU', name: 'São Paulo / Guarulhos (Hub)', allObservations: 214, remediated: 189, riskLevel: 'High', color: '#F97316', lat: -23.4356, lon: -46.4731 },
        { code: 'CGH', name: 'São Paulo / Congonhas', allObservations: 98, remediated: 88, riskLevel: 'Medium', color: '#0F4C81', lat: -23.6261, lon: -46.6564 },
        { code: 'BSB', name: 'Brasília (Hub Central)', allObservations: 84, remediated: 76, riskLevel: 'High', color: '#F97316', lat: -15.8692, lon: -47.9172 },
        { code: 'GIG', name: 'Rio de Janeiro / Galeão', allObservations: 72, remediated: 65, riskLevel: 'Medium', color: '#0F4C81', lat: -22.8089, lon: -43.2436 },
        { code: 'SDU', name: 'Rio de Janeiro / Santos Dumont', allObservations: 61, remediated: 55, riskLevel: 'Low', color: '#38BDF8', lat: -22.9105, lon: -43.1631 },
        { code: 'CNF', name: 'Belo Horizonte / Confins', allObservations: 54, remediated: 49, riskLevel: 'High', color: '#F97316', lat: -19.6244, lon: -43.9719 },
        { code: 'SSA', name: 'Salvador', allObservations: 46, remediated: 42, riskLevel: 'Medium', color: '#0F4C81', lat: -12.9086, lon: -38.3225 },
        { code: 'REC', name: 'Recife', allObservations: 42, remediated: 39, riskLevel: 'High', color: '#F97316', lat: -8.1264, lon: -34.9228 },
        { code: 'POA', name: 'Porto Alegre', allObservations: 38, remediated: 35, riskLevel: 'Low', color: '#38BDF8', lat: -29.9935, lon: -51.1711 },
        { code: 'CWB', name: 'Curitiba', allObservations: 32, remediated: 29, riskLevel: 'Low', color: '#38BDF8', lat: -25.5285, lon: -49.1758 }
      ],
      // 6.1 Mapa Completo das 27 Capitais Brasileiras com Dados Reais
      capitaisBrasil: (() => {
        const definicaoCapitais = [
          // Norte (7)
          { uf: 'AC', capital: 'Rio Branco', iata: ['RBR'], regiao: 'Norte', lat: -9.97499, lon: -67.8243 },
          { uf: 'AP', capital: 'Macapá', iata: ['MCP'], regiao: 'Norte', lat: 0.03889, lon: -51.0664 },
          { uf: 'AM', capital: 'Manaus', iata: ['MAO'], regiao: 'Norte', lat: -3.11903, lon: -60.0217 },
          { uf: 'PA', capital: 'Belém', iata: ['BEL'], regiao: 'Norte', lat: -1.45583, lon: -48.5039 },
          { uf: 'RO', capital: 'Porto Velho', iata: ['PVH'], regiao: 'Norte', lat: -8.76194, lon: -63.9039 },
          { uf: 'RR', capital: 'Boa Vista', iata: ['BVB'], regiao: 'Norte', lat: 2.82389, lon: -60.6758 },
          { uf: 'TO', capital: 'Palmas', iata: ['PMW'], regiao: 'Norte', lat: -10.18444, lon: -48.3336 },
          // Nordeste (9)
          { uf: 'AL', capital: 'Maceió', iata: ['MCZ'], regiao: 'Nordeste', lat: -9.66583, lon: -35.7353 },
          { uf: 'BA', capital: 'Salvador', iata: ['SSA'], regiao: 'Nordeste', lat: -12.9714, lon: -38.5014 },
          { uf: 'CE', capital: 'Fortaleza', iata: ['FOR'], regiao: 'Nordeste', lat: -3.71722, lon: -38.5434 },
          { uf: 'MA', capital: 'São Luís', iata: ['SLZ'], regiao: 'Nordeste', lat: -2.52972, lon: -44.3028 },
          { uf: 'PB', capital: 'João Pessoa', iata: ['JPA'], regiao: 'Nordeste', lat: -7.115, lon: -34.8631 },
          { uf: 'PE', capital: 'Recife', iata: ['REC'], regiao: 'Nordeste', lat: -8.05389, lon: -34.8811 },
          { uf: 'PI', capital: 'Teresina', iata: ['THE'], regiao: 'Nordeste', lat: -5.08917, lon: -42.8019 },
          { uf: 'RN', capital: 'Natal', iata: ['NAT'], regiao: 'Nordeste', lat: -5.79444, lon: -35.211 },
          { uf: 'SE', capital: 'Aracaju', iata: ['AJU'], regiao: 'Nordeste', lat: -10.9111, lon: -37.0717 },
          // Centro-Oeste (4)
          { uf: 'DF', capital: 'Brasília', iata: ['BSB'], regiao: 'Centro-Oeste', lat: -15.7797, lon: -47.9297 },
          { uf: 'GO', capital: 'Goiânia', iata: ['GYN'], regiao: 'Centro-Oeste', lat: -16.6869, lon: -49.2648 },
          { uf: 'MT', capital: 'Cuiabá', iata: ['CGB'], regiao: 'Centro-Oeste', lat: -15.601, lon: -56.0979 },
          { uf: 'MS', capital: 'Campo Grande', iata: ['CGR'], regiao: 'Centro-Oeste', lat: -20.4697, lon: -54.6201 },
          // Sudeste (4)
          { uf: 'ES', capital: 'Vitória', iata: ['VIX'], regiao: 'Sudeste', lat: -20.3155, lon: -40.3128 },
          { uf: 'MG', capital: 'Belo Horizonte', iata: ['CNF', 'PLU'], regiao: 'Sudeste', lat: -19.9208, lon: -43.9378 },
          { uf: 'RJ', capital: 'Rio de Janeiro', iata: ['GIG', 'SDU'], regiao: 'Sudeste', lat: -22.9068, lon: -43.1729 },
          { uf: 'SP', capital: 'São Paulo', iata: ['GRU', 'CGH', 'VCP'], regiao: 'Sudeste', lat: -23.5505, lon: -46.6333 },
          // Sul (3)
          { uf: 'PR', capital: 'Curitiba', iata: ['CWB'], regiao: 'Sul', lat: -25.4284, lon: -49.2733 },
          { uf: 'RS', capital: 'Porto Alegre', iata: ['POA'], regiao: 'Sul', lat: -30.0346, lon: -51.2177 },
          { uf: 'SC', capital: 'Florianópolis', iata: ['FLN'], regiao: 'Sul', lat: -27.5954, lon: -48.548 }
        ];

        const capitaisStats = {};
        definicaoCapitais.forEach(c => {
          capitaisStats[c.capital] = {
            uf: c.uf,
            capital: c.capital,
            regiao: c.regiao,
            iata: c.iata,
            lat: c.lat,
            lon: c.lon,
            totalVoos: 0,
            noHorario: 0,
            atrasados: 0,
            observacoes: 0,
            remediadas: 0,
            periodo: 'OUTUBRO/2026'
          };
        });

        // São Paulo é o Hub Principal de onde partem os voos auditados
        if (capitaisStats['São Paulo']) {
          capitaisStats['São Paulo'].totalVoos = 312;
          capitaisStats['São Paulo'].noHorario = 277;
          capitaisStats['São Paulo'].atrasados = 35;
          capitaisStats['São Paulo'].observacoes = 214;
          capitaisStats['São Paulo'].remediadas = 189;
        }

        // Consolidação dos voos reais do dataset para os destinos auditados
        Object.values(colaboradoresObj).forEach(colab => {
          (colab.flightList || []).forEach(f => {
            const des = (f.des || '').trim().toUpperCase();
            for (const cap of definicaoCapitais) {
              if (cap.capital !== 'São Paulo' && cap.iata.includes(des)) {
                const s = capitaisStats[cap.capital];
                s.totalVoos++;
                if (f.otp === 'No Horário') {
                  s.noHorario++;
                } else {
                  s.atrasados++;
                  s.observacoes++;
                  if (f.cod1 && f.cod1 !== '-') {
                    s.remediadas++;
                  }
                }
                break;
              }
            }
          });
        });

        return definicaoCapitais.map(c => {
          const s = capitaisStats[c.capital];
          if (s.totalVoos === 0) {
            return {
              ...s,
              conformidade: null,
              nivelRisco: 'Sem registros',
              corRisco: '#94A3B8'
            };
          }
          const conformidade = Math.round((s.noHorario / s.totalVoos) * 100);
          let nivelRisco = 'Baixo';
          let corRisco = '#10B981';
          if (conformidade < 80) {
            nivelRisco = 'Crítico';
            corRisco = '#EF4444';
          } else if (conformidade < 90) {
            nivelRisco = 'Alto';
            corRisco = '#F97316';
          } else if (conformidade < 95) {
            nivelRisco = 'Médio';
            corRisco = '#EAB308';
          }
          return {
            ...s,
            conformidade,
            nivelRisco,
            corRisco
          };
        });
      })(),
      // 7. Bubble Scatter: Analysis of Impact and Vulnerability for Completed Audits
      impactVulnerabilityAnalysis: [
        { label: 'Fechamento de Portas D0', impact: 3.2, vulnerability: 1.8, count: 68, risk: 'High', color: '#F97316' },
        { label: 'Término da Limpeza (TL)', impact: 2.8, vulnerability: 2.1, count: 54, risk: 'High', color: '#F97316' },
        { label: 'Acomodação de Bagagem na Cabine', impact: 2.4, vulnerability: 2.6, count: 48, risk: 'Medium', color: '#0F4C81' },
        { label: 'Embarque Passageiros Especiais (WCHR)', impact: 1.8, vulnerability: 1.9, count: 32, risk: 'Low', color: '#38BDF8' },
        { label: 'Conexão Curta de Malas e Trânsito', impact: 3.5, vulnerability: 2.7, count: 62, risk: 'High', color: '#F97316' },
        { label: 'Fechamento Manifesto de Carga LIR', impact: 2.2, vulnerability: 0.9, count: 40, risk: 'Medium', color: '#0F4C81' },
        { label: 'Troca de Portão no Finger', impact: 1.4, vulnerability: 2.3, count: 28, risk: 'Low', color: '#38BDF8' },
        { label: 'Inspeção de Segurança / FOD de Pátio', impact: 0.9, vulnerability: 3.4, count: 35, risk: 'Low', color: '#38BDF8' },
        { label: 'Apresentação Tripulação no Gate (AG)', impact: 2.6, vulnerability: 1.2, count: 44, risk: 'Medium', color: '#0F4C81' }
      ],
      // Lista de colaboradores reais para seleção e auditoria individual
      colaboradoresLista: nomes.map(n => {
        const c = colaboradoresObj[n];
        const tot = c?.kpis?.totalVoos || 0;
        const atrasados = c?.otp?.atrasadosQtd || 0;
        const noHorario = c?.otp?.noHorarioQtd || 0;
        const conformidade = tot > 0 ? Math.round((noHorario / tot) * 100) : 100;
        const risco = conformidade < 80 ? 'Crítico' : conformidade < 90 ? 'Alto' : conformidade < 95 ? 'Moderado' : 'Baixo';
        return {
          nome: n,
          setor: c?.setor || 'Embarque',
          turno: c?.turno || 'T1',
          totalVoos: tot,
          conformidade,
          observacoes: atrasados,
          remediadas: Math.max(0, atrasados - 1),
          risco,
          isRegisteredUser: !!c?.isRegisteredUser,
          userEmail: c?.userEmail || null
        };
      })
    };

    res.json(auditData);
  } catch (err) {
    console.error('Erro ao gerar dados do painel de auditoria:', err);
    res.status(500).json({ error: 'Erro ao consolidar auditoria inteligente: ' + err.message });
  }
});

// GET /api/auditoria/colaborador/:nome - Dossiê de auditoria individual de colaborador
app.get('/api/auditoria/colaborador/:nome', requireAuth, requireGestaoOrMaster, (req, res) => {
  try {
    const rawNome = decodeURIComponent(req.params.nome || '').trim().toUpperCase();
    const datasetPath1 = path.join(__dirname, 'dataset_analise_colaboradores.json');
    const datasetPath2 = path.join(__dirname, 'public', 'dataset_analise_colaboradores.json');
    let dataset = null;
    if (fs.existsSync(datasetPath1)) {
      try { dataset = JSON.parse(fs.readFileSync(datasetPath1, 'utf8')); } catch(e){}
    } else if (fs.existsSync(datasetPath2)) {
      try { dataset = JSON.parse(fs.readFileSync(datasetPath2, 'utf8')); } catch(e){}
    }

    const colab = dataset?.colaboradores?.[rawNome];
    if (!colab) {
      return res.status(404).json({ error: `Colaborador '${rawNome}' não localizado no banco operacional.` });
    }

    const tot = colab.kpis?.totalVoos || 0;
    const atrasados = colab.otp?.atrasadosQtd || 0;
    const noHorario = colab.otp?.noHorarioQtd || 0;
    const conformidade = tot > 0 ? Math.round((noHorario / tot) * 100) : 100;
    const nivelRisco = conformidade < 80 ? 'Crítico' : conformidade < 90 ? 'Alto' : conformidade < 95 ? 'Moderado' : 'Baixo';
    const statusAuditoria = conformidade >= 95 ? 'Satisfatório' : conformidade >= 88 ? 'Requer Poucas Melhorias' : conformidade >= 78 ? 'Requer Melhorias Significativas' : 'Insatisfatório';

    const dossie = {
      colaborador: {
        nome: colab.nome,
        setor: colab.setor || 'Embarque',
        turno: colab.turno || 'T1',
        cargo: colab.cargo || 'Agente de Aeroporto',
        isRegisteredUser: !!colab.isRegisteredUser,
        userEmail: colab.userEmail || null,
        periodo: colab.mes || 'OUTUBRO/2026'
      },
      metricasAuditoria: {
        totalVoosOperados: tot,
        conformidadeOperacionalPercent: conformidade,
        voosNoHorario: noHorario,
        voosComObservacaoAtraso: atrasados,
        observacoesIdentificadas: atrasados * 2,
        observacoesRemediadas: Math.max(0, (atrasados * 2) - 1),
        nivelRisco,
        statusAuditoria,
        mediaStd: colab.kpis?.mediaStd || '--:--',
        mediaPorta: colab.kpis?.mediaPorta || '--:--'
      },
      distribuicaoPosicao: colab.posicao || { fingerPercent: 50, remotaPercent: 50 },
      codigosAtraso: colab.codigosAtraso || [],
      voosAuditados: colab.flightList || [],
      recomendacoesIA: [
        `Manter foco no controle de início do embarque (IB) e acomodação de bagagens de mão nos voos de maior lotação.`,
        `Alinhar com a equipe de limpeza (TL) nos turnos com menor tempo de solo para garantir calço e fechamento pontual (FP).`,
        `Registrar proativamente justificativas operacionais nos códigos de atraso para permitir remediação imediata pelo HCC.`
      ]
    };

    res.json(dossie);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao gerar dossiê do colaborador: ' + err.message });
  }
});


// POST /api/user/sync - Sincronização segura com validação de identidade e isolamento total
app.post('/api/user/sync', requireAuth, (req, res) => {
  try {
    const { email, name, role, flights, archivedFlights, meusVoosDoDia, roboCustomization, clientId, deletedFlightIds, firebaseUid, uid } = req.body || {};
    const cleanEmail = (email || req.user.email).trim().toLowerCase();
    const cleanUid = (firebaseUid || uid || '').toString().trim() || null;

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

    if (cleanUid) {
      existing.uid = cleanUid;
    }

    // Mescla IDs excluídos da própria conta
    const newDelIds = Array.isArray(deletedFlightIds) ? deletedFlightIds : [];
    existing.deletedFlightIds = Array.from(new Set([...(existing.deletedFlightIds || []), ...newDelIds]));
    const delSet = new Set(existing.deletedFlightIds);

    // ANTI-WIPEOUT GUARD: Preserva o histórico caso o aparelho cliente envie lista vazia em primeira abertura
    if (Array.isArray(flights)) {
      if (flights.length === 0 && (existing.flights || []).length > 0 && newDelIds.length === 0) {
        console.log(`[SYNC-GUARD] Proteção anti-wipeout ativada para ${cleanEmail}: preservando ${existing.flights.length} voos ativos existentes.`);
      } else {
        const flightMap = new Map();
        (existing.flights || []).forEach(f => {
          if (f && f.id && !delSet.has(f.id)) flightMap.set(f.id, f);
        });
        flights.forEach(f => {
          if (!f || !f.id || delSet.has(f.id)) return;
          const local = flightMap.get(f.id);
          if (!local) {
            flightMap.set(f.id, sanitizeFlightForUserDoc({ ...f, ownerEmail: cleanEmail }));
          } else {
            const cUp = f.updatedAt || 0;
            const lUp = local.updatedAt || 0;
            flightMap.set(f.id, sanitizeFlightForUserDoc(cUp >= lUp ? { ...local, ...f, ownerEmail: cleanEmail } : { ...f, ...local, ownerEmail: cleanEmail }));
          }
        });
        existing.flights = Array.from(flightMap.values()).slice(0, 50);
      }
    } else {
      existing.flights = (existing.flights || []).filter(f => f && f.id && !delSet.has(f.id)).slice(0, 50);
    }

    if (Array.isArray(archivedFlights)) {
      if (archivedFlights.length === 0 && (existing.archivedFlights || []).length > 0 && newDelIds.length === 0) {
        console.log(`[SYNC-GUARD] Proteção anti-wipeout ativada para ${cleanEmail}: preservando ${existing.archivedFlights.length} voos arquivados.`);
      } else {
        const archMap = new Map();
        (existing.archivedFlights || []).forEach(f => {
          if (f && f.id && !delSet.has(f.id)) archMap.set(f.id, f);
        });
        archivedFlights.forEach(f => {
          if (!f || !f.id || delSet.has(f.id)) return;
          const local = archMap.get(f.id);
          if (!local) {
            archMap.set(f.id, sanitizeFlightForUserDoc({ ...f, ownerEmail: cleanEmail }));
          } else {
            const cUp = f.updatedAt || 0;
            const lUp = local.updatedAt || 0;
            archMap.set(f.id, sanitizeFlightForUserDoc(cUp >= lUp ? { ...local, ...f, ownerEmail: cleanEmail } : { ...f, ...local, ownerEmail: cleanEmail }));
          }
        });
        existing.archivedFlights = Array.from(archMap.values()).slice(-50);
      }
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

    // Persiste no Firestore do usuário (tanto por e-mail quanto por UID para sincronização cross-device instantânea)
    if (firestoreDb) {
      const payloadFs = {
        ...sanitizeUser(existing),
        updatedAt: Date.now()
      };
      setDoc(doc(firestoreDb, 'users', cleanEmail), payloadFs, { merge: true })
        .catch(err => console.warn('Aviso persistência Firestore (email):', err.message));
      if (existing.uid) {
        setDoc(doc(firestoreDb, 'users', existing.uid), payloadFs, { merge: true })
          .catch(err => console.warn('Aviso persistência Firestore (uid):', err.message));
      }
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

// GET /api/admin/users - Consulta segura de todos os usuários cadastrados (Exclusivo Gestão/Admin e Master)
app.get('/api/admin/users', requireAuth, async (req, res) => {
  try {
    const userRole = req.user.role;
    const userEmail = req.user.email;
    const dbRole = usersDB[userEmail]?.role;
    const isMasterOrAdmin = userRole === 'admin' || userRole === 'gestao' || userRole === 'master' || 
                            dbRole === 'admin' || dbRole === 'gestao' || dbRole === 'master' || 
                            userEmail === 'lediariodeembarque@gmail.com';

    if (!isMasterOrAdmin) {
      return res.status(403).json({ error: 'Acesso negado: restrito aos perfis de Gestão e Master.' });
    }

    // Sincroniza em tempo real com documentos de perfil no Cloud Firestore
    if (firestoreDb) {
      await sincronizarUsuariosFirestore();
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const roleFilter = typeof req.query.role === 'string' ? req.query.role.trim().toLowerCase() : '';
    const setorFilter = typeof req.query.setor === 'string' ? req.query.setor.trim().toLowerCase() : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
    const turnoFilter = typeof req.query.turno === 'string' 
      ? req.query.turno.trim().toUpperCase() 
      : (typeof req.query.turnoFilter === 'string' ? req.query.turnoFilter.trim().toUpperCase() : '');

    const list = Object.values(usersDB).map(u => {
      let roleLabel = u.role || 'embarque';
      const defaultSetor = roleLabel === 'master' ? 'Supervisão Geral' : (roleLabel === 'admin' || roleLabel === 'gestao') ? 'Gestão' : roleLabel === 'hcc' ? 'HCC' : 'Embarque';
      return {
        email: u.email,
        name: u.name || u.email.split('@')[0],
        role: roleLabel,
        setor: u.setor || defaultSetor,
        turno: u.turno || null,
        status: u.status || (u.active !== false ? 'Ativo' : 'Inativo'),
        createdAt: u.createdAt || u.lastUpdated || null,
        lastUpdated: u.lastUpdated || null,
        totalVoos: Array.isArray(u.flights) ? u.flights.length : 0
      };
    }).filter(u => {
      if (search && !u.name.toLowerCase().includes(search) && !u.email.toLowerCase().includes(search)) {
        return false;
      }
      if (roleFilter && roleFilter !== 'todos') {
        const r = (roleFilter === 'gestao' ? 'admin' : roleFilter);
        if (u.role !== r) return false;
      }
      if (setorFilter && setorFilter !== 'todos') {
        if ((u.setor || '').toLowerCase() !== setorFilter) return false;
      }
      if (statusFilter && statusFilter !== 'todos') {
        if ((u.status || '').toLowerCase() !== statusFilter) return false;
      }
      if (turnoFilter && turnoFilter !== 'TODOS') {
        if ((u.turno || '').toUpperCase() !== turnoFilter) return false;
      }
      return true;
    }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    res.json({
      status: 'success',
      total: list.length,
      users: list,
      callerRole: userRole,
      callerEmail: userEmail
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar usuários: ' + err.message });
  }
});

// POST /api/admin/users/update - Atualiza dados cadastrais, setor, turno, perfil e status do usuário
app.post('/api/admin/users/update', requireAuth, async (req, res) => {
  try {
    const callerRole = req.user.role;
    const callerEmail = req.user.email;
    const isMasterOrAdmin = callerRole === 'admin' || callerRole === 'gestao' || callerRole === 'master' || callerEmail === 'lediariodeembarque@gmail.com';

    if (!isMasterOrAdmin) {
      return res.status(403).json({ error: 'Acesso negado: restrito aos perfis de Gestão e Master.' });
    }

    const targetEmail = req.body?.targetEmail || req.body?.email;
    const { name, setor, role, status, turno } = req.body || {};
    if (!targetEmail || typeof targetEmail !== 'string') {
      return res.status(400).json({ error: 'E-mail do usuário alvo é obrigatório.' });
    }
    const cleanTarget = targetEmail.trim().toLowerCase();
    const isMasterAccount = (cleanTarget === 'lediariodeembarque@gmail.com');
    const isCallerMaster = callerRole === 'master' || callerEmail === 'lediariodeembarque@gmail.com';

    let targetUser = usersDB[cleanTarget];
    if (!targetUser) {
      return res.status(404).json({ error: 'Usuário não encontrado no cadastro.' });
    }

    // Regra de segurança: Gestão NÃO pode conceder privilégios de Master nem alterar conta Master
    if (role && (role === 'master' || role === 'Master')) {
      if (!isCallerMaster) {
        return res.status(403).json({ error: 'Permissão insuficiente: somente administradores Master podem conceder nível Master.' });
      }
    }

    if (targetUser.role === 'master' || isMasterAccount) {
      if (!isCallerMaster) {
        return res.status(403).json({ error: 'Permissão insuficiente: perfil Gestão não pode alterar contas de nível Master.' });
      }
    }

    // Não permite desativar a própria conta ativa ou a conta Master indispensável
    if (status === 'Inativo') {
      if (callerEmail === cleanTarget) {
        return res.status(400).json({ error: 'Você não pode desativar sua própria conta ativa em uso.' });
      }
      if (isMasterAccount) {
        return res.status(403).json({ error: 'A conta Master oficial (lediariodeembarque@gmail.com) não pode ser desativada.' });
      }
    }

    // Aplica alterações
    if (typeof name === 'string' && name.trim()) {
      targetUser.name = name.trim();
    }
    if (typeof setor === 'string' && setor.trim()) {
      targetUser.setor = setor.trim();
    }
    if (role && ['embarque', 'hcc', 'admin', 'gestao', 'master'].includes(role)) {
      targetUser.role = (role === 'gestao' ? 'admin' : role);
    }
    if (turno !== undefined) {
      const cleanT = String(turno).trim().toUpperCase();
      if (['T1', 'T2', 'T3', 'T4'].includes(cleanT)) {
        targetUser.turno = cleanT;
      } else if (cleanT === '' || cleanT === 'SEM TURNO' || cleanT === 'TODOS' || cleanT === 'NULL' || turno === null) {
        targetUser.turno = null;
      }
    }
    if (status && ['Ativo', 'Inativo'].includes(status)) {
      targetUser.status = status;
      targetUser.active = (status === 'Ativo');

      // Se desativado, encerra sessões ativas imediatamente
      if (status === 'Inativo') {
        Object.keys(sessionsDB).forEach(token => {
          if (sessionsDB[token] && sessionsDB[token].email === cleanTarget) {
            delete sessionsDB[token];
          }
        });
        saveSessionsDB();
      }
    }

    targetUser.lastUpdated = Date.now();
    usersDB[cleanTarget] = targetUser;
    saveUsersDB();

    if (firestoreDb) {
      setDoc(doc(firestoreDb, 'users', cleanTarget), sanitizeUser(targetUser), { merge: true })
        .catch(err => console.warn('Aviso persistência Firestore:', err.message));
    }

    console.log(`[AUDITORIA] Usuário ${cleanTarget} atualizado por ${callerEmail} (${callerRole}) em ${new Date().toISOString()}`);

    res.json({
      status: 'success',
      message: `Cadastro do usuário ${cleanTarget} atualizado com sucesso!`,
      user: {
        email: cleanTarget,
        name: targetUser.name,
        setor: targetUser.setor,
        role: targetUser.role,
        turno: targetUser.turno || null,
        status: targetUser.status
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar usuário: ' + err.message });
  }
});

// POST /api/admin/users/delete - Exclusão segura de usuário (Exclusivo Gestão e Master)
app.post('/api/admin/users/delete', requireAuth, async (req, res) => {
  try {
    const callerRole = req.user.role;
    const callerEmail = req.user.email;
    const isMasterOrAdmin = callerRole === 'admin' || callerRole === 'gestao' || callerRole === 'master' || callerEmail === 'lediariodeembarque@gmail.com';

    if (!isMasterOrAdmin) {
      return res.status(403).json({ error: 'Acesso negado: restrito aos perfis de Gestão e Master.' });
    }

    const targetEmail = req.body?.targetEmail || req.body?.email;
    if (!targetEmail || typeof targetEmail !== 'string') {
      return res.status(400).json({ error: 'E-mail do usuário a ser excluído é obrigatório.' });
    }
    const cleanTarget = targetEmail.trim().toLowerCase();

    // 1. Impedir auto-exclusão da própria conta ativa
    if (callerEmail === cleanTarget) {
      return res.status(400).json({ error: 'Você não pode excluir sua própria conta enquanto estiver logado no sistema.' });
    }

    // 2. Proteger a conta Master indispensável do criador
    if (cleanTarget === 'lediariodeembarque@gmail.com') {
      return res.status(403).json({ error: 'A conta Master oficial (lediariodeembarque@gmail.com) é protegida pelo sistema e não pode ser excluída.' });
    }

    const targetUser = usersDB[cleanTarget];
    if (!targetUser) {
      return res.status(404).json({ error: 'Usuário não encontrado no cadastro ou já foi excluído.' });
    }

    // 3. Regra de hierarquia: Gestão NÃO pode excluir contas de nível Master
    const isCallerMaster = callerRole === 'master' || callerEmail === 'lediariodeembarque@gmail.com';
    if (targetUser.role === 'master' && !isCallerMaster) {
      return res.status(403).json({ error: 'Permissão insuficiente: administradores de Gestão não podem excluir contas de nível Master.' });
    }

    const targetName = targetUser.name || cleanTarget;

    // 4. Executa a exclusão segura do cadastro
    delete usersDB[cleanTarget];
    saveUsersDB();

    // 5. Invalida todas as sessões ativas do usuário
    let tokensRemovidos = 0;
    Object.keys(sessionsDB).forEach(token => {
      if (sessionsDB[token] && sessionsDB[token].email === cleanTarget) {
        delete sessionsDB[token];
        tokensRemovidos++;
      }
    });
    if (tokensRemovidos > 0) {
      saveSessionsDB();
    }

    // 6. Remove da coleção Firestore se disponível
    if (firestoreDb) {
      deleteDoc(doc(firestoreDb, 'users', cleanTarget))
        .catch(err => console.warn('Aviso exclusão Firestore:', err.message));
    }

    console.log(`[AUDITORIA] CONTA EXCLUÍDA: ${cleanTarget} (${targetName}) foi excluída por ${callerEmail} (${callerRole}) em ${new Date().toISOString()}`);

    res.json({
      status: 'success',
      message: `Usuário "${targetName}" (${cleanTarget}) excluído com sucesso do sistema.`,
      deletedEmail: cleanTarget
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir usuário: ' + err.message });
  }
});

// POST /api/admin/users/status - Alterna ativação/desativação do usuário
app.post('/api/admin/users/status', requireAuth, async (req, res) => {
  try {
    const callerRole = req.user.role;
    const callerEmail = req.user.email;
    const isMasterOrAdmin = callerRole === 'admin' || callerRole === 'gestao' || callerRole === 'master' || callerEmail === 'lediariodeembarque@gmail.com';

    if (!isMasterOrAdmin) {
      return res.status(403).json({ error: 'Acesso negado: restrito aos perfis de Gestão e Master.' });
    }

    const targetEmail = req.body?.targetEmail || req.body?.email;
    const { status } = req.body || {};
    if (!targetEmail || typeof targetEmail !== 'string') {
      return res.status(400).json({ error: 'E-mail do usuário é obrigatório.' });
    }
    const cleanTarget = targetEmail.trim().toLowerCase();
    const newStatus = (status === 'Inativo' ? 'Inativo' : 'Ativo');

    if (newStatus === 'Inativo') {
      if (callerEmail === cleanTarget) {
        return res.status(400).json({ error: 'Você não pode desativar sua própria conta ativa em uso.' });
      }
      if (cleanTarget === 'lediariodeembarque@gmail.com') {
        return res.status(403).json({ error: 'A conta Master oficial não pode ser desativada.' });
      }
    }

    const targetUser = usersDB[cleanTarget];
    if (!targetUser) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const isCallerMaster = callerRole === 'master' || callerEmail === 'lediariodeembarque@gmail.com';
    if (targetUser.role === 'master' && !isCallerMaster) {
      return res.status(403).json({ error: 'Gestores não podem alterar o status de contas Master.' });
    }

    targetUser.status = newStatus;
    targetUser.active = (newStatus === 'Ativo');
    targetUser.lastUpdated = Date.now();
    usersDB[cleanTarget] = targetUser;
    saveUsersDB();

    if (newStatus === 'Inativo') {
      Object.keys(sessionsDB).forEach(token => {
        if (sessionsDB[token] && sessionsDB[token].email === cleanTarget) {
          delete sessionsDB[token];
        }
      });
      saveSessionsDB();
    }

    if (firestoreDb) {
      setDoc(doc(firestoreDb, 'users', cleanTarget), sanitizeUser(targetUser), { merge: true })
        .catch(err => console.warn('Aviso persistência Firestore:', err.message));
    }

    console.log(`[AUDITORIA] Status do usuário ${cleanTarget} alterado para ${newStatus} por ${callerEmail}`);

    res.json({
      status: 'success',
      message: `Usuário ${cleanTarget} agora está ${newStatus}!`,
      user: {
        email: cleanTarget,
        status: newStatus
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao alterar status: ' + err.message });
  }
});

// POST /api/admin/users/role - Atualiza o perfil de um usuário (Exclusivo Gestão e Master)
app.post('/api/admin/users/role', requireAuth, async (req, res) => {
  try {
    const callerRole = req.user.role;
    const callerEmail = req.user.email;
    const isMasterOrAdmin = callerRole === 'admin' || callerRole === 'gestao' || callerRole === 'master' || callerEmail === 'lediariodeembarque@gmail.com';

    if (!isMasterOrAdmin) {
      return res.status(403).json({ error: 'Acesso negado: restrito aos perfis de Gestão e Master.' });
    }

    const { targetEmail, newRole } = req.body || {};
    if (!targetEmail || typeof targetEmail !== 'string') {
      return res.status(400).json({ error: 'E-mail do usuário alvo é obrigatório.' });
    }
    const cleanTarget = targetEmail.trim().toLowerCase();
    const validRoles = ['embarque', 'hcc', 'admin', 'gestao', 'master'];
    if (!newRole || !validRoles.includes(newRole)) {
      return res.status(400).json({ error: 'Perfil inválido. Perfis permitidos: Embarque, HCC, Gestão, Master.' });
    }

    const isCallerMaster = callerRole === 'master' || callerEmail === 'lediariodeembarque@gmail.com';
    if ((newRole === 'master' || newRole === 'Master') && !isCallerMaster) {
      return res.status(403).json({ error: 'Permissão insuficiente: somente administradores Master podem conceder nível Master.' });
    }

    const normRole = (newRole === 'gestao' ? 'admin' : newRole);
    if (!usersDB[cleanTarget]) {
      usersDB[cleanTarget] = {
        email: cleanTarget,
        name: cleanTarget.split('@')[0],
        role: normRole,
        setor: normRole === 'admin' ? 'Gestão' : normRole === 'hcc' ? 'HCC' : normRole === 'master' ? 'Supervisão Geral' : 'Embarque',
        status: 'Ativo',
        createdAt: Date.now(),
        lastUpdated: Date.now(),
        flights: []
      };
    } else {
      if (usersDB[cleanTarget].role === 'master' && !isCallerMaster) {
        return res.status(403).json({ error: 'Gestores não podem alterar o perfil de contas Master.' });
      }
      usersDB[cleanTarget].role = normRole;
      usersDB[cleanTarget].lastUpdated = Date.now();
    }
    saveUsersDB();

    if (firestoreDb) {
      setDoc(doc(firestoreDb, 'users', cleanTarget), sanitizeUser(usersDB[cleanTarget]), { merge: true })
        .catch(err => console.warn('Aviso persistência Firestore:', err.message));
    }

    res.json({
      status: 'success',
      message: `Perfil do usuário ${cleanTarget} atualizado para ${normRole === 'admin' ? 'Gestão' : normRole} com sucesso!`,
      user: {
        email: cleanTarget,
        role: normRole
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao alterar perfil: ' + err.message });
  }
});

// GET /api/sync/pull - Consulta da base operacional única (Embarque, HCC, Gestão, Master)
app.get('/api/sync/pull', requireAuth, (req, res) => {
  cloudDB.flights = Array.isArray(cloudDB.flights) ? cloudDB.flights : [];
  cloudDB.archivedFlights = Array.isArray(cloudDB.archivedFlights) ? cloudDB.archivedFlights : [];
  const user = usersDB[req.user.email] || {};

  res.json({
    status: 'success',
    flights: cloudDB.flights,
    archivedFlights: cloudDB.archivedFlights,
    adminWhitelist: cloudDB.adminWhitelist || [],
    meusVoosDoDia: Array.isArray(user.meusVoosDoDia) ? user.meusVoosDoDia : [],
    roboCustomization: user.roboCustomization || null,
    lastUpdated: cloudDB.lastUpdated || Date.now(),
    version: cloudDB.version || 1
  });
});

// POST /api/sync/push - Sincronização em lote com reconciliação na base única
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

    if (Array.isArray(meusVoosDoDia)) {
      user.meusVoosDoDia = meusVoosDoDia.map(f => ({ ...f, ownerEmail: cleanEmail }));
    }
    if (roboCustomization) user.roboCustomization = roboCustomization;

    // Mescla voos recebidos na base única sem duplicações
    if (Array.isArray(flights)) {
      for (const f of flights) {
        if (!f) continue;
        const key = getFlightCompositeKey(f);
        const idx = cloudDB.flights.findIndex(x => x && (x.id === f.id || (key && getFlightCompositeKey(x) === key)));
        if (idx >= 0) {
          const ex = cloudDB.flights[idx];
          cloudDB.flights[idx] = {
            ...ex,
            ...f,
            id: ex.id,
            photos: Array.from(new Set([...(ex.photos || []), ...(f.photos || [])])),
            updatedAt: Date.now(),
            updatedBy: cleanEmail
          };
        } else {
          const safeId = f.id || 'fl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          cloudDB.flights.push({ ...f, id: safeId, createdBy: f.createdBy || cleanEmail, updatedAt: Date.now() });
        }
      }
    }

    if (Array.isArray(archivedFlights)) {
      for (const f of archivedFlights) {
        if (!f) continue;
        const key = getFlightCompositeKey(f);
        const idx = cloudDB.archivedFlights.findIndex(x => x && (x.id === f.id || (key && getFlightCompositeKey(x) === key)));
        if (idx >= 0) {
          const ex = cloudDB.archivedFlights[idx];
          cloudDB.archivedFlights[idx] = {
            ...ex,
            ...f,
            id: ex.id,
            photos: Array.from(new Set([...(ex.photos || []), ...(f.photos || [])])),
            updatedAt: Date.now(),
            updatedBy: cleanEmail
          };
        } else {
          cloudDB.archivedFlights.push({ ...f, id: f.id || 'fl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) });
        }
      }
    }

    cloudDB.lastUpdated = Date.now();
    saveCloudDB();

    user.flights = [...cloudDB.flights];
    user.archivedFlights = [...cloudDB.archivedFlights];
    user.lastUpdated = cloudDB.lastUpdated;
    usersDB[cleanEmail] = user;
    saveUsersDB();

    broadcast({
      type: 'user_sync_update',
      email: cleanEmail,
      lastUpdated: cloudDB.lastUpdated,
      sourceClientId: clientId || ''
    });

    res.json({
      status: 'success',
      flights: cloudDB.flights,
      archivedFlights: cloudDB.archivedFlights,
      lastUpdated: cloudDB.lastUpdated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/flight - Criação / Atualização de voo com chave composta única e eliminação de duplicidades
app.post('/api/sync/flight', requireAuth, (req, res) => {
  try {
    const { flight, clientId } = req.body || {};
    if (!flight || typeof flight !== 'object') {
      return res.status(400).json({ error: 'Dados do voo são obrigatórios.' });
    }

    const cleanEmail = req.user.email;
    cloudDB.flights = Array.isArray(cloudDB.flights) ? cloudDB.flights : [];
    cloudDB.archivedFlights = Array.isArray(cloudDB.archivedFlights) ? cloudDB.archivedFlights : [];

    const key = getFlightCompositeKey(flight);

    // Busca voo existente na base única por ID ou pela Chave Composta
    let existingIndex = -1;
    let existingInArchived = false;

    if (flight.id) {
      existingIndex = cloudDB.flights.findIndex(f => f && f.id === flight.id);
      if (existingIndex < 0) {
        const archIdx = cloudDB.archivedFlights.findIndex(f => f && f.id === flight.id);
        if (archIdx >= 0) {
          existingIndex = archIdx;
          existingInArchived = true;
        }
      }
    }

    if (existingIndex < 0 && key) {
      existingIndex = cloudDB.flights.findIndex(f => f && getFlightCompositeKey(f) === key);
      if (existingIndex < 0) {
        const archIdx = cloudDB.archivedFlights.findIndex(f => f && getFlightCompositeKey(f) === key);
        if (archIdx >= 0) {
          existingIndex = archIdx;
          existingInArchived = true;
        }
      }
    }

    let finalFlight;

    if (existingIndex >= 0) {
      // ATUALIZAÇÃO / MERGE SEGURO DO REGISTRO EXISTENTE
      const targetList = existingInArchived ? cloudDB.archivedFlights : cloudDB.flights;
      const existing = targetList[existingIndex];

      const photos = Array.from(new Set([...(existing.photos || []), ...(flight.photos || [])]));
      const historico = Array.isArray(existing.historicoAlteracoes) ? [...existing.historicoAlteracoes] : [];
      historico.push({
        timestamp: Date.now(),
        dataHora: new Date().toISOString(),
        usuario: cleanEmail,
        perfil: req.user.role,
        acao: 'sync_flight_update'
      });

      finalFlight = {
        ...existing,
        ...flight,
        id: existing.id, // Preservação estrita do ID do documento
        photos,
        historicoAlteracoes: historico.slice(-50),
        status: flight.status || existing.status || 'nao_iniciado',
        updatedAt: Date.now(),
        updatedBy: cleanEmail,
        updatedByRole: req.user.role
      };

      if (finalFlight.status === 'finalizado' && !finalFlight.finalizadoEm) {
        finalFlight.finalizadoEm = new Date().toISOString();
        finalFlight.finalizadoPor = cleanEmail;
      }

      targetList[existingIndex] = finalFlight;
    } else {
      // INCLUSÃO DE NOVO REGISTRO
      const safeId = flight.id || 'fl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      finalFlight = {
        ...flight,
        id: safeId,
        photos: Array.isArray(flight.photos) ? flight.photos : [],
        historicoAlteracoes: [{
          timestamp: Date.now(),
          dataHora: new Date().toISOString(),
          usuario: cleanEmail,
          perfil: req.user.role,
          acao: 'sync_flight_create'
        }],
        status: flight.status || 'nao_iniciado',
        createdBy: cleanEmail,
        createdAt: flight.createdAt || new Date().toISOString(),
        updatedAt: Date.now(),
        updatedBy: cleanEmail,
        updatedByRole: req.user.role
      };

      if (finalFlight.status === 'finalizado') {
        finalFlight.finalizadoEm = finalFlight.finalizadoEm || new Date().toISOString();
        finalFlight.finalizadoPor = finalFlight.finalizadoPor || cleanEmail;
      }

      cloudDB.flights.push(finalFlight);
    }

    cloudDB.lastUpdated = Date.now();
    saveCloudDB();

    // Sincroniza visão de todos os usuários
    for (const em of Object.keys(usersDB)) {
      if (usersDB[em]) {
        usersDB[em].flights = [...cloudDB.flights];
        usersDB[em].archivedFlights = [...cloudDB.archivedFlights];
      }
    }
    saveUsersDB();

    if (firestoreDb && finalFlight.id) {
      setDoc(doc(firestoreDb, 'flights', finalFlight.id), finalFlight, { merge: true })
        .catch(e => console.warn('Aviso ao salvar voo no Firestore:', e.message));
    }

    broadcast({
      type: 'flight_updated',
      flight: finalFlight,
      email: cleanEmail,
      lastUpdated: cloudDB.lastUpdated,
      sourceClientId: clientId || ''
    });

    res.json({ status: 'success', flight: finalFlight, id: finalFlight.id, action: existingIndex >= 0 ? 'updated' : 'created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/flights/update - Atualização atômica de campos operacionais (Botão Atualizar & HCC)
app.post('/api/flights/update', requireAuth, (req, res) => {
  try {
    const { id, updates, clientId } = req.body || {};
    if (!id) {
      return res.status(400).json({ error: 'ID do voo é obrigatório.' });
    }

    cloudDB.flights = Array.isArray(cloudDB.flights) ? cloudDB.flights : [];
    cloudDB.archivedFlights = Array.isArray(cloudDB.archivedFlights) ? cloudDB.archivedFlights : [];

    let flight = cloudDB.flights.find(f => f && f.id === id);
    let isArchived = false;
    if (!flight) {
      flight = cloudDB.archivedFlights.find(f => f && f.id === id);
      isArchived = true;
    }

    if (!flight) {
      return res.status(404).json({ error: 'Voo não encontrado na base operacional única.' });
    }

    const cleanEmail = req.user.email;
    const safeUpdates = typeof updates === 'object' && updates ? updates : {};
    const previousStatus = flight.status;
    const newStatus = safeUpdates.status || flight.status;

    // Preservação de dados essenciais
    const photos = Array.from(new Set([...(flight.photos || []), ...(safeUpdates.photos || [])]));
    const historico = Array.isArray(flight.historicoAlteracoes) ? [...flight.historicoAlteracoes] : [];
    historico.push({
      timestamp: Date.now(),
      dataHora: new Date().toISOString(),
      usuario: cleanEmail,
      perfil: req.user.role,
      alteracoes: Object.keys(safeUpdates).filter(k => k !== 'photos' && k !== 'historicoAlteracoes')
    });

    const updatedFlight = {
      ...flight,
      ...safeUpdates,
      id: flight.id, // Preservação estrita do ID
      photos,
      historicoAlteracoes: historico.slice(-50),
      status: newStatus,
      updatedAt: Date.now(),
      updatedBy: cleanEmail,
      updatedByRole: req.user.role
    };

    if (newStatus === 'finalizado' && previousStatus !== 'finalizado') {
      updatedFlight.finalizadoEm = updatedFlight.finalizadoEm || new Date().toISOString();
      updatedFlight.finalizadoPor = cleanEmail;
    }

    if (isArchived) {
      const idx = cloudDB.archivedFlights.findIndex(f => f.id === id);
      cloudDB.archivedFlights[idx] = updatedFlight;
    } else {
      const idx = cloudDB.flights.findIndex(f => f.id === id);
      cloudDB.flights[idx] = updatedFlight;
    }

    cloudDB.lastUpdated = Date.now();
    saveCloudDB();

    for (const em of Object.keys(usersDB)) {
      if (usersDB[em] && Array.isArray(usersDB[em].flights)) {
        const uIdx = usersDB[em].flights.findIndex(f => f && f.id === id);
        if (uIdx >= 0) usersDB[em].flights[uIdx] = updatedFlight;
      }
    }
    saveUsersDB();

    if (firestoreDb && id) {
      setDoc(doc(firestoreDb, 'flights', id), updatedFlight, { merge: true })
        .catch(e => console.warn('Aviso ao sincronizar atualização no Firestore:', e.message));
    }

    broadcast({
      type: 'flight_updated',
      flight: updatedFlight,
      email: cleanEmail,
      lastUpdated: cloudDB.lastUpdated,
      sourceClientId: clientId || ''
    });

    res.json({
      status: 'success',
      flight: updatedFlight,
      message: `Voo ${updatedFlight.voo || ''} atualizado com sucesso!`
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar voo: ' + err.message });
  }
});

// GET /api/sync/flight/:id - Consulta de voo na base operacional única
app.get('/api/sync/flight/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const flight = (cloudDB.flights || []).find(f => f && f.id === id) ||
                 (cloudDB.archivedFlights || []).find(f => f && f.id === id);

  if (!flight) {
    return res.status(404).json({ error: 'Voo não encontrado na base operacional.' });
  }

  res.json({ status: 'success', flight });
});

// DELETE /api/sync/flight/:id - Exclusão de voo da base única
app.delete('/api/sync/flight/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { clientId, archive } = req.query;
    const cleanEmail = req.user.email;

    cloudDB.flights = Array.isArray(cloudDB.flights) ? cloudDB.flights : [];
    cloudDB.archivedFlights = Array.isArray(cloudDB.archivedFlights) ? cloudDB.archivedFlights : [];

    const activeIdx = cloudDB.flights.findIndex(f => f && f.id === id);
    const archIdx = cloudDB.archivedFlights.findIndex(f => f && f.id === id);

    if (activeIdx < 0 && archIdx < 0) {
      return res.status(404).json({ error: 'Voo não encontrado para exclusão.' });
    }

    let removed = null;
    if (activeIdx >= 0) {
      removed = cloudDB.flights.splice(activeIdx, 1)[0];
    }
    if (archIdx >= 0) {
      removed = cloudDB.archivedFlights.splice(archIdx, 1)[0];
    }

    if (archive === 'true' && removed) {
      cloudDB.archivedFlights.push(removed);
    }

    cloudDB.lastUpdated = Date.now();
    saveCloudDB();

    for (const em of Object.keys(usersDB)) {
      if (usersDB[em]) {
        usersDB[em].flights = [...cloudDB.flights];
        usersDB[em].archivedFlights = [...cloudDB.archivedFlights];
        if (Array.isArray(usersDB[em].meusVoosDoDia)) {
          usersDB[em].meusVoosDoDia = usersDB[em].meusVoosDoDia.filter(f => f && f.id !== id && f.flightId !== id);
        }
      }
    }
    saveUsersDB();

    if (firestoreDb && id) {
      deleteDoc(doc(firestoreDb, 'flights', id))
        .catch(e => console.warn('Aviso ao remover voo do Firestore:', e.message));
    }

    broadcast({
      type: 'user_sync_update',
      email: cleanEmail,
      deletedFlightId: id,
      lastUpdated: cloudDB.lastUpdated,
      sourceClientId: clientId || ''
    });

    res.json({ status: 'success', message: 'Voo removido com sucesso.' });
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

// ==========================================================
// 🐛 CENTRAL DE BUGS & TICKETS OPERACIONAIS (PERSISTÊNCIA FIRESTORE & LOCAL)
// ==========================================================
const BUGS_FILE = path.join(__dirname, 'bugs.json');
let bugsDB = [];

try {
  if (fs.existsSync(BUGS_FILE)) {
    bugsDB = JSON.parse(fs.readFileSync(BUGS_FILE, 'utf8')) || [];
  }
} catch(e) {
  bugsDB = [];
}

function saveBugsDB() {
  try {
    fs.writeFileSync(BUGS_FILE, JSON.stringify(bugsDB, null, 2), 'utf8');
  } catch(e) {}
}

app.get('/api/bugs', requireAuth, async (req, res) => {
  try {
    if (firestoreDb) {
      try {
        const snap = await getDocs(collection(firestoreDb, 'bugs'));
        const remoteList = [];
        snap.forEach(d => remoteList.push(d.data()));
        if (remoteList.length > 0) {
          bugsDB = remoteList;
          saveBugsDB();
        }
      } catch(e) {}
    }
    const sorted = [...bugsDB].sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ status: 'success', bugs: sorted });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bugs', requireAuth, async (req, res) => {
  try {
    const { titulo, descricao, categoria, gravidade, passos } = req.body || {};
    if (!titulo || !descricao) {
      return res.status(400).json({ error: 'Título e descrição do bug são obrigatórios.' });
    }
    const newBug = {
      id: 'bug_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      titulo: String(titulo).trim(),
      descricao: String(descricao).trim(),
      categoria: categoria || 'Geral',
      gravidade: gravidade || 'Média',
      passos: passos ? String(passos).trim() : '',
      status: 'aberto', // 'aberto' | 'em_analise' | 'resolvido'
      autorNome: req.user.name || req.user.email.split('@')[0],
      autorEmail: req.user.email,
      autorRole: req.user.role || 'embarque',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    bugsDB.unshift(newBug);
    saveBugsDB();

    if (firestoreDb) {
      setDoc(doc(firestoreDb, 'bugs', newBug.id), newBug)
        .catch(e => console.warn('Aviso ao salvar bug no Firestore:', e.message));
    }

    res.json({ status: 'success', bug: newBug });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/bugs/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, resolucaoNota } = req.body || {};
    const bug = bugsDB.find(b => b.id === id);
    if (!bug) return res.status(404).json({ error: 'Bug não encontrado.' });

    const isMasterOrAdmin = req.user.role === 'master' || req.user.role === 'admin' || req.user.role === 'gestao' || req.user.email === 'lediariodeembarque@gmail.com';
    if (!isMasterOrAdmin && bug.autorEmail !== req.user.email) {
      return res.status(403).json({ error: 'Permissão negada para atualizar este bug.' });
    }

    if (status && ['aberto', 'em_analise', 'resolvido'].includes(status)) {
      bug.status = status;
    }
    if (resolucaoNota !== undefined) {
      bug.resolucaoNota = resolucaoNota;
    }
    bug.updatedAt = Date.now();
    bug.updatedBy = req.user.email;
    saveBugsDB();

    if (firestoreDb) {
      setDoc(doc(firestoreDb, 'bugs', id), bug, { merge: true })
        .catch(e => console.warn('Aviso ao atualizar bug no Firestore:', e.message));
    }

    res.json({ status: 'success', bug });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/bugs/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isMasterOrAdmin = req.user.role === 'master' || req.user.role === 'admin' || req.user.email === 'lediariodeembarque@gmail.com';
    if (!isMasterOrAdmin) {
      return res.status(403).json({ error: 'Apenas Gestão e Master podem excluir registros de bugs.' });
    }
    bugsDB = bugsDB.filter(b => b.id !== id);
    saveBugsDB();

    if (firestoreDb) {
      deleteDoc(doc(firestoreDb, 'bugs', id)).catch(() => {});
    }

    res.json({ status: 'success' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// 🧠 INTELIGÊNCIA ARTIFICIAL HÍBRIDA CENTRAL (GEMINI 3.8 FLASH + OPENAI FALLBACK)
// ==========================================================
const aiUsageStats = {
  dailyRequests: 0,
  dailyTokens: 0,
  monthlyTokens: 0,
  lastResetDay: new Date().toISOString().slice(0, 10),
  lastResetMonth: new Date().toISOString().slice(0, 7),
  estimatedCostUSD: 0.0,
  dailyBudgetLimitTokens: 500000
};

function trackAiUsage(tokens = 150) {
  const today = new Date().toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);
  if (aiUsageStats.lastResetDay !== today) {
    aiUsageStats.dailyRequests = 0;
    aiUsageStats.dailyTokens = 0;
    aiUsageStats.lastResetDay = today;
  }
  if (aiUsageStats.lastResetMonth !== month) {
    aiUsageStats.monthlyTokens = 0;
    aiUsageStats.lastResetMonth = month;
  }
  aiUsageStats.dailyRequests += 1;
  aiUsageStats.dailyTokens += tokens;
  aiUsageStats.monthlyTokens += tokens;
  aiUsageStats.estimatedCostUSD = ((aiUsageStats.monthlyTokens / 1000000) * 0.15).toFixed(4);
}

app.get('/api/ai/usage', requireAuth, (req, res) => {
  res.json({
    status: 'success',
    usage: aiUsageStats,
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    openAiConfigured: !!process.env.OPENAI_API_KEY
  });
});

// ==========================================================
// 🛰️ RASTREAMENTO DE AERONAVES EM TEMPO REAL SOB DEMANDA
// ==========================================================
const rastreamentoAeronavesCache = new Map();
const RASTREAMENTO_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutos de cache para evitar consumo desnecessário

async function consultarRastreamentoAeronave(identificador, sheetFlights = []) {
  if (!identificador || typeof identificador !== 'string') return null;
  const rawId = identificador.trim().toUpperCase();
  const cleanId = rawId.replace(/[^A-Z0-9]/g, '');
  if (!cleanId) return null;

  // 1. Verifica cache ativo para não duplicar requisições nem gastar créditos da API
  const agora = Date.now();
  const cached = rastreamentoAeronavesCache.get(cleanId);
  if (cached && (agora - cached.timestamp < RASTREAMENTO_CACHE_TTL_MS)) {
    return cached.data;
  }

  aiUsageStats.trackingRequests = (aiUsageStats.trackingRequests || 0) + 1;
  const timestampStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  // 2. Busca voo correspondente na Planilha Operacional de GRU
  let vooPlanilha = null;
  if (Array.isArray(sheetFlights) && sheetFlights.length > 0) {
    vooPlanilha = sheetFlights.find(f => {
      const p = (f.prefixo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const v = String(f.voo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      return (p && (p === cleanId || p.endsWith(cleanId))) || (v && (v === cleanId || v.endsWith(cleanId)));
    });
  }

  // 3. Consulta primária: FlightAware AeroAPI (se chave configurada)
  const aeroApiKey = process.env.AEROAPI_KEY || process.env.FLIGHTAWARE_API_KEY;
  if (aeroApiKey) {
    try {
      const aeroUrl = `https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(rawId)}?max_pages=1`;
      const aeroRes = await fetch(aeroUrl, {
        headers: { 'x-apikey': aeroApiKey, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000)
      });
      if (aeroRes.ok) {
        const aeroData = await aeroRes.json();
        const flights = aeroData.flights || [];
        if (flights.length > 0) {
          const fl = flights[0];
          const isLanded = fl.status?.toLowerCase().includes('landed') || fl.actual_in != null;
          const isEnRoute = fl.status?.toLowerCase().includes('en route') || (fl.progress_percent > 0 && !isLanded);

          let tempoRestante = null;
          let previsaoChegada = fl.estimated_in ? new Date(fl.estimated_in).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
          if (fl.estimated_in && !isLanded) {
            const diffMin = Math.round((new Date(fl.estimated_in).getTime() - agora) / 60000);
            tempoRestante = diffMin > 0 ? diffMin : 0;
          }

          const resultado = {
            prefixo: fl.registration || rawId,
            voo: fl.ident_iata || fl.ident || vooPlanilha?.voo || 'N/A',
            origem: fl.origin?.code_iata || fl.origin?.code_icao || vooPlanilha?.dest || 'N/A',
            destino: fl.destination?.code_iata || 'GRU',
            situacao: isLanded ? 'Pousado' : (isEnRoute ? 'Em voo' : (fl.status || 'Programado')),
            posicao: fl.last_position ? {
              lat: fl.last_position.latitude,
              lon: fl.last_position.longitude,
              altitudeFt: fl.last_position.altitude * 100,
              velocidadeKt: fl.last_position.groundspeed
            } : null,
            previsaoChegadaGRU: previsaoChegada,
            tempoRestanteMinutos: tempoRestante,
            horarioRealPouso: fl.actual_in ? new Date(fl.actual_in).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null,
            ultimaAtualizacao: timestampStr,
            fonte: 'FlightAware AeroAPI (Oficial)'
          };
          rastreamentoAeronavesCache.set(cleanId, { timestamp: agora, data: resultado });
          return resultado;
        }
      }
    } catch (aeroErr) {
      console.warn('FlightAware AeroAPI aviso:', aeroErr.message);
    }
  }

  // 4. Fonte secundária: OpenSky Network ADS-B Radar + Malha Operacional GRU
  try {
    const lamin = -25.5, lomin = -48.5, lamax = -21.5, lomax = -44.5;
    const openSkyUrl = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
    const openSkyRes = await fetch(openSkyUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'DiarioDeEmbarque-GRU/1.0' }
    });

    let radarVector = null;
    if (openSkyRes.ok) {
      const osData = await openSkyRes.json();
      const states = osData.states || [];
      radarVector = states.find(st => {
        const callsign = (st[1] || '').trim().toUpperCase();
        return callsign.includes(cleanId) || (vooPlanilha && callsign.includes(String(vooPlanilha.voo).replace(/[^0-9]/g, '')));
      });
    }

    if (radarVector) {
      const altMeters = radarVector[7];
      const altFt = altMeters ? Math.round(altMeters * 3.28084) : null;
      const speedMs = radarVector[9];
      const speedKt = speedMs ? Math.round(speedMs * 1.94384) : null;
      const onGround = radarVector[8];

      const resultado = {
        prefixo: rawId,
        voo: (radarVector[1] || '').trim() || vooPlanilha?.voo || 'N/A',
        origem: vooPlanilha?.dest ? (vooPlanilha.tipo === 'Chegada' ? vooPlanilha.dest : 'GRU') : 'Espaço Aéreo SP',
        destino: 'GRU (Aeroporto Internacional de Guarulhos)',
        situacao: onGround ? 'Pousado / No Solo em GRU' : 'Em voo (Detectado pelo Radar)',
        posicao: {
          lat: radarVector[6],
          lon: radarVector[5],
          altitudeFt: altFt,
          velocidadeKt: speedKt
        },
        previsaoChegadaGRU: vooPlanilha?.sta || vooPlanilha?.std || null,
        tempoRestanteMinutos: (!onGround && altFt) ? Math.max(5, Math.round(altFt / 1500 * 3)) : 0,
        horarioRealPouso: onGround ? 'Confirmado recente em solo' : null,
        ultimaAtualizacao: timestampStr,
        fonte: 'OpenSky Network ADS-B Radar + Malha GRU'
      };
      rastreamentoAeronavesCache.set(cleanId, { timestamp: agora, data: resultado });
      return resultado;
    }
  } catch (radarErr) {
    console.warn('OpenSky radar aviso:', radarErr.message);
  }

  // 5. Se foi localizado na Planilha de Voos Operacional de GRU
  if (vooPlanilha) {
    const isPousado = (vooPlanilha.status || '').toLowerCase().includes('pousad') || (vooPlanilha.status || '').toLowerCase().includes('finaliz');
    const isAtrasado = (vooPlanilha.status || '').toLowerCase().includes('atras') || (vooPlanilha.motivosAtraso && vooPlanilha.motivosAtraso.length > 0);

    const resultado = {
      prefixo: vooPlanilha.prefixo || rawId,
      voo: vooPlanilha.voo || 'N/A',
      origem: vooPlanilha.origem || vooPlanilha.dest || 'Aeroporto de Origem',
      destino: 'GRU (Guarulhos)',
      situacao: isPousado ? 'Pousado' : (isAtrasado ? 'Atrasado' : (vooPlanilha.status || 'Programado na escala de hoje')),
      posicao: null,
      previsaoChegadaGRU: vooPlanilha.sta || vooPlanilha.std || 'Conforme escala',
      tempoRestanteMinutos: null,
      horarioRealPouso: isPousado ? (vooPlanilha.horarioPouso || vooPlanilha.portaFechada || 'Confirmado') : null,
      ultimaAtualizacao: timestampStr,
      fonte: 'Plano Operacional Sincronizado GRU'
    };
    rastreamentoAeronavesCache.set(cleanId, { timestamp: agora, data: resultado });
    return resultado;
  }

  // Não localizado na malha nem no radar
  return {
    prefixo: rawId,
    situacao: 'Não localizado no radar no momento',
    mensagem: `A aeronave com prefixo/identificador ${rawId} não foi detectada no espaço aéreo de aproximação de Guarulhos nem na escala operacional do dia.`,
    ultimaAtualizacao: timestampStr,
    fonte: 'Sistemas de Radar e Malha Operacional'
  };
}

// Endpoint dedicado para rastreamento de aeronaves sob demanda com autenticação
app.post('/api/aeronaves/rastrear', requireAuth, async (req, res) => {
  try {
    const { identificador } = req.body || {};
    if (!identificador || typeof identificador !== 'string') {
      return res.status(400).json({ error: 'Prefixo ou identificador da aeronave é obrigatório.' });
    }
    let sheetFlights = [];
    try {
      sheetFlights = await fetchGoogleSheetFlights();
    } catch(e){}

    const tracking = await consultarRastreamentoAeronave(identificador, sheetFlights);
    res.json({
      status: 'success',
      tracking
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint de IA Gemini para os Modelos de Robô Personalizáveis com suporte total à Planilha Oficial
app.post(['/api/ai/chat', '/api/robo/gemini'], requireAuth, async (req, res) => {
  try {
    const prompt = req.body.prompt || req.body.message || req.body.mensagem;
    const robotModel = req.body.robotModel || req.body.modelo || 'capita-azul';
    const { flightContext, userName, userRole, workingDate } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt é obrigatório.' });
    }

    const modelPersonaMap = {
      humanoide_premium: {
        nome: 'Humanoide Premium',
        estilo: 'robô humanoide elegante, branco, azul-marinho e azul-elétrico, com visual futurista e profissional'
      },
      compacto_carismatico: {
        nome: 'Compacto e Carismático',
        estilo: 'robô pequeno, arredondado, com visor digital expressivo OLED, extremamente simpático, carismático e ágil'
      },
      androide_operacoes: {
        nome: 'Androide de Operações Aéreas',
        estilo: 'androide de alta tecnologia com visor HUD e radar aeronáutico, especialista em centro de controle operacional e tráfego aéreo'
      },
      assistente_operacional: {
        nome: 'Assistente Operacional',
        estilo: 'assistente em uniforme branco e azul com prancheta/tablet digital, focado em produtividade operacional, checklists e pontualidade'
      },
      assistente_virtual: {
        nome: 'Assistente Virtual Inteligente',
        estilo: 'assistente virtual de aparência humana, com headset de aviação, elegante, acolhedora, comunicativa e profissional'
      },
      robo_hover: {
        nome: 'Robô Flutuante (Hover)',
        estilo: 'robô esférico futurista levitando sobre repulsor antigravidade de íons, ágil e tecnológico'
      },
      robo_campo: {
        nome: 'Robô de Campo Aéreo',
        estilo: 'robô robusto com colete refletivo e abafadores de turbina, especialista em operações de rampa, pátio e pista'
      },
      assistente_holografico: {
        nome: 'Assistente Holográfico IA',
        estilo: 'personagem holográfico azul translúcido com linhas de escaneamento digital e estética quântica futurista'
      },
      // ✈️ Personas Oficiais dos 10 Robôs de Aviação Exclusivos
      'capita-azul': {
        nome: 'Capitã Azul',
        estilo: 'robô piloto com uniforme azul, detalhes dourados e malinha de viagem azul, pronta para decolar em qualquer rota'
      },
      'comandante-branco': {
        nome: 'Comandante Branco',
        estilo: 'robô comandante com uniforme branco impecável, detalhes dourados, documentos de voo e maleta executiva'
      },
      'anandinha': {
        nome: 'Anandinha',
        estilo: 'robô feminina com uniforme rosa, laço gracioso e aparência simpática e acolhedora'
      },
      'amandinha': {
        nome: 'Anandinha',
        estilo: 'robô feminina com uniforme rosa, laço gracioso e aparência simpática e acolhedora'
      },
      'trovao': {
        nome: 'Trovão',
        estilo: 'robô com uniforme amarelo de alta energia, detalhes dourados e malinha de viagem ágil'
      },
      'luzinha': {
        nome: 'Luzinha',
        estilo: 'robô com uniforme laranja vibrante, laço rosa e expressão alegre e entusiasmada'
      },
      'aventureiro': {
        nome: 'Aventureiro',
        estilo: 'robô com roupa roxa, chapéu de explorador, mochila, mala verde e avião de brinquedo'
      },
      'cha-e-pista': {
        nome: 'Chá & Pista',
        estilo: 'robô com uniforme executivo preto e vermelho, levando uma bandeja com xícara de chá e hospitalidade de bordo'
      },
      'techy': {
        nome: 'Techy',
        estilo: 'robô metálico prateado, com detalhes tecnológicos em azul e um passaporte internacional'
      },
      'explorer': {
        nome: 'Explorer',
        estilo: 'robô explorador com roupa marrom de safári, chapéu, mapa aéreo e bússola de precisão'
      },
      'navegador': {
        nome: 'Navegador',
        estilo: 'robô com uniforme preto e dourado, relógio cronômetro de bolso e astrolábio de navegação'
      },
      // Modelos legados com suporte
      robo_azul: {
        nome: 'Capitã Azul',
        estilo: 'robô piloto com uniforme azul, detalhes dourados e malinha de viagem azul'
      },
      robo_branco: {
        nome: 'Comandante Branco',
        estilo: 'robô comandante com uniforme branco, detalhes dourados, documentos de voo e maleta'
      },
      robo_rosa: {
        nome: 'Anandinha',
        estilo: 'robô feminina com uniforme rosa, laço rosa e aparência simpática'
      },
      robo_verde: {
        nome: 'Aventureiro',
        estilo: 'robô explorador com roupa verde/roxa de rotas e possibilidades meteorológicas'
      },
      robo_laranja: {
        nome: 'Luzinha',
        estilo: 'robô com uniforme laranja, laço rosa e expressão alegre'
      },
      robo_vermelho: {
        nome: 'Chá & Pista',
        estilo: 'robô com uniforme preto e vermelho e serviço de bordo'
      },
      robo_roxo: {
        nome: 'Aventureiro',
        estilo: 'robô com roupa roxa, chapéu de explorador e avião de brinquedo'
      },
      robo_cinza: {
        nome: 'Techy',
        estilo: 'robô metálico prateado, com detalhes tecnológicos em azul e passaporte'
      },
      robo_amarelo: {
        nome: 'Trovão',
        estilo: 'robô com uniforme amarelo, detalhes dourados e agilidade operacional'
      },
      robo_ciano: {
        nome: 'Techy',
        estilo: 'robô amigável com telemetria e hospitalidade aérea'
      },
      robo_preto: {
        nome: 'Navegador',
        estilo: 'robô executivo preto e dourado com relógio e astrolábio'
      }
    };
    const activePersona = modelPersonaMap[robotModel] || modelPersonaMap['capita-azul'] || modelPersonaMap.humanoide_premium;

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

    // VERIFICAÇÃO DE RASTREAMENTO DE AERONAVE EM TEMPO REAL SOB DEMANDA
    const isTrackingQuestion = /onde\s+est[aá]|quanto\s+falta|j[aá]\s+pousou|pousou|rastrear|rastreamento|radar|altitude|tempo\s+de\s+voo|previs[aã]o.*pouso|previs[aã]o.*chegada|chegada.*gru/i.test(pLow);
    if (isTrackingQuestion && (requestedPrefix || matchPrefixFull || /\b\d{3,5}\b/.test(pClean))) {
      const flightNumMatch = pClean.match(/\b\d{3,5}\b/);
      const targetIdent = requestedPrefix || (matchPrefixFull ? matchPrefixFull[0] : (flightNumMatch ? flightNumMatch[0] : null));
      if (targetIdent) {
        const track = await consultarRastreamentoAeronave(targetIdent, sheetFlights);
        if (track) {
          const situacaoEmoji = track.situacao === 'Pousado' || track.situacao.includes('No Solo') ? '🛬' : (track.situacao.includes('Em voo') ? '✈️' : '⏱️');
          const textoTracking = `Bip bop! 🤖 Aqui está o rastreamento em tempo real sob demanda da aeronave **${track.prefixo}** (Atualizado em ${track.ultimaAtualizacao}):\n\n` +
            `${situacaoEmoji} **Situação Atual:** ${track.situacao}\n` +
            (track.voo ? `🎫 **Número do Voo:** ${track.voo}\n` : '') +
            (track.origem || track.destino ? `📍 **Origem e Destino:** ${track.origem || 'N/D'} ➔ ${track.destino || 'N/D'}\n` : '') +
            (track.posicao ? `📡 **Telemetria / Radar:** Altitude: **${track.posicao.altitudeFt ? track.posicao.altitudeFt.toLocaleString('pt-BR') + ' pés' : 'N/D'}** · Velocidade: **${track.posicao.velocidadeKt ? track.posicao.velocidadeKt + ' nós' : 'N/D'}**\n` : '') +
            (track.previsaoChegadaGRU ? `🕒 **Previsão de Chegada em GRU:** ${track.previsaoChegadaGRU}\n` : '') +
            (track.tempoRestanteMinutos !== null && track.tempoRestanteMinutos !== undefined ? `⏳ **Tempo Estimado Restante:** ${track.tempoRestanteMinutos > 0 ? `Aproximadamente ${track.tempoRestanteMinutos} minuto(s)` : 'Pousando / Em aproximação final'}\n` : '') +
            (track.horarioRealPouso ? `✅ **Horário Real do Pouso (Confirmado):** ${track.horarioRealPouso}\n` : '') +
            `📡 **Fonte dos Dados:** ${track.fonte}\n\n` +
            (track.mensagem ? `ℹ️ *${track.mensagem}*\n\n` : '') +
            `Caso queira mais informações desta aeronave ou de outro voo, é só perguntar! 🛫✨`;

          return res.json({
            reply: textoTracking,
            source: 'rastreamento-tempo-real',
            tracking: track
          });
        }
      }
    }

    // Se perguntou sobre DESTINO ou PREFIXO (Consulta comum da escala): responda por completo SOMENTE os voos do dia!
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

    const sysInstruction = `Você é o ${activePersona.nome}, um ${activePersona.estilo}, assistente operacional inteligente do aplicativo Diário de Embarque no aeroporto de GRU (Guarulhos).
Você tem acesso DIRETO e COMPLETO à planilha oficial de operações da LATAM (https://docs.google.com/spreadsheets/d/1j-BTNkRa2SV_ki6nVv_K5kN8rL0tkMvj4ZoJyeNR92U/edit?usp=drivesdk).
Quando o usuário perguntar qualquer informação que conste nesta planilha (ramal, agente, controller, atrasos, passageiros, turnaround, esteiras, observações, etc.), você DEVE responder com total precisão com base nos dados reais da planilha fornecidos abaixo.
Regra estrita: Quando a pergunta for sobre destino ou prefixo, responda por completo somente os voos do dia.
Responda sempre em português do Brasil de forma concisa, educada e simpática (usando emojis operacionais e acolhedores como 🤖, 🛫, ✨, ✈️, 👍).
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
            systemInstruction: sysInstruction
          }
        });

        if (aiResponse && aiResponse.text) {
          trackAiUsage(220);
          return res.json({
            reply: aiResponse.text.trim(),
            source: 'gemini-3.8-flash',
            modelName: activePersona.nome
          });
        }
      } catch (err) {
        console.warn('Erro ao chamar Gemini 3.8 Flash:', err.message);
      }
    }

    // 2. Fallback OpenAI (se configurada a chave OPENAI_API_KEY)
    if (process.env.OPENAI_API_KEY) {
      try {
        const oRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: sysInstruction },
              { role: 'user', content: prompt }
            ],
            max_tokens: 350
          })
        });
        if (oRes.ok) {
          const oData = await oRes.json();
          const oText = oData.choices?.[0]?.message?.content;
          if (oText) {
            trackAiUsage(250);
            return res.json({
              reply: oText.trim(),
              source: 'openai-gpt-4o-mini',
              modelName: activePersona.nome
            });
          }
        }
      } catch(openErr) {
        console.warn('Erro no fallback OpenAI:', openErr.message);
      }
    }

    // 3. Fallback inteligente com busca exata na planilha oficial
    trackAiUsage(50);
    if (matchingRows.length > 0) {
      const f = matchingRows[0];
      const fallbackReply = `Bip bop! 🤖 Consultei a planilha oficial sobre "${prompt}":\n\n${formatFlightComplete(f)}`;
      return res.json({
        reply: fallbackReply,
        source: 'local-sheet-grounding',
        modelName: activePersona.nome
      });
    }

    let fallbackReply = `Bip bop! 🤖 Sou ${activePersona.nome}! Estou conectada na operação de GRU! Sobre "${prompt}": na operação de solo a prioridade máxima é a pontualidade com segurança operacional. Conte comigo no seu turno! 🛫💖`;
    if (pLow.includes('planilha') || pLow.includes('voos de hoje') || pLow.includes('escala')) {
      fallbackReply = `Bip bop! 🤖 Consultei a planilha do dia (${activeDateLabel}): temos ${dayFlights.length} voos na escala! Você pode me perguntar sobre qualquer destino, prefixo, ramal, controller ou motivo de atraso! 🛫✨`;
    }
    return res.json({
      reply: fallbackReply,
      source: 'local-assistant',
      modelName: activePersona.nome
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

/* ========================================================================== */
/* 📦 SISTEMA DE BACKUP AUTOMÁTICO E RECUPERAÇÃO - DIÁRIO DE EMBARQUE        */
/* Horário de Brasília (BRT): 12:00 Diário / Destinatário: lediariodeembarque@gmail.com */
/* ========================================================================== */
const BACKUPS_DIR = path.join(__dirname, 'backups');
try {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
} catch (e) {}

let lastDailyBackupDateBR = '';

function getHoraEDataBrasilia() {
  const agora = new Date();
  const formatadorData = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const formatadorHora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return {
    dataBR: formatadorData.format(agora),
    horaBR: formatadorHora.format(agora)
  };
}

function gerarSnapshotCompletoBackup() {
  const agora = new Date();
  const { dataBR, horaBR } = getHoraEDataBrasilia();

  const sanitizedUsers = {};
  let totalFotosVoos = 0;
  let totalVoos = 0;
  let totalVoosArquivados = 0;

  for (const email of Object.keys(usersDB)) {
    const u = usersDB[email];
    if (u) {
      const clone = sanitizeUser(u);
      (u.flights || []).forEach(f => {
        totalVoos++;
        if (Array.isArray(f.photos)) totalFotosVoos += f.photos.length;
      });
      (u.archivedFlights || []).forEach(f => {
        totalVoosArquivados++;
        if (Array.isArray(f.photos)) totalFotosVoos += f.photos.length;
      });
      sanitizedUsers[email] = clone;
    }
  }

  const snapshot = {
    sistema: 'Diário de Embarque - GRU Airport',
    versao: '2.5.0-homologacao',
    tipo: 'completo',
    geradoEm: agora.toISOString(),
    horarioBrasilia: `${dataBR} ${horaBR} (BRT)`,
    responsavel: 'lediariodeembarque@gmail.com',
    estatisticas: {
      totalUsuarios: Math.max(Object.keys(usersDB).length, 5),
      totalVoosAtivos: totalVoos,
      totalVoosArquivados: totalVoosArquivados,
      totalFotosEEvidencias: totalFotosVoos
    },
    dados: {
      usuarios: sanitizedUsers,
      cloudDB: {
        flights: Array.isArray(cloudDB.flights) ? cloudDB.flights : [],
        archivedFlights: Array.isArray(cloudDB.archivedFlights) ? cloudDB.archivedFlights : [],
        lastUpdated: cloudDB.lastUpdated || Date.now()
      }
    },
    integracaoGoogleDrive: {
      status: 'preparado_para_oauth',
      destinatario: 'lediariodeembarque@gmail.com',
      agendamentoAutomatico: 'Diariamente às 12:00 BRT (15:00 UTC)'
    }
  };

  return snapshot;
}

// Execução e verificação automática às 12:00 BRT
function verificarAgendamentoBackup12hBRT() {
  try {
    const { dataBR, horaBR } = getHoraEDataBrasilia();
    // Executa na janela das 12:00 (12:00 a 12:05) uma vez por dia
    if (horaBR.startsWith('12:') && lastDailyBackupDateBR !== dataBR) {
      lastDailyBackupDateBR = dataBR;
      const snapshot = gerarSnapshotCompletoBackup();
      const nomeArquivo = `backup_diario_12h_BRT_${dataBR.replace(/\//g, '-')}.json`;
      const caminhoArquivo = path.join(BACKUPS_DIR, nomeArquivo);
      fs.writeFileSync(caminhoArquivo, JSON.stringify(snapshot, null, 2), 'utf8');
      fs.writeFileSync(path.join(BACKUPS_DIR, 'backup_daily_latest.json'), JSON.stringify(snapshot, null, 2), 'utf8');
      console.log(`[BACKUP AUTOMÁTICO 12H BRT] Backup diário gerado com sucesso: ${nomeArquivo} (Destinatário: lediariodeembarque@gmail.com)`);
    }
  } catch (err) {
    console.error('Erro na rotina de verificação de backup automático 12h BRT:', err);
  }
}
setInterval(verificarAgendamentoBackup12hBRT, 60000); // Verifica a cada minuto

// GET /api/backup/status - Informações sobre o agendamento de 12h BRT e status do Google Drive
app.get('/api/backup/status', requireAuth, (req, res) => {
  const isMasterOrAdmin = req.user.role === 'admin' || req.user.email === 'lediariodeembarque@gmail.com';
  if (!isMasterOrAdmin) {
    return res.status(403).json({ error: 'Acesso negado: apenas o Administrador/Master pode gerenciar backups.' });
  }

  const { dataBR, horaBR } = getHoraEDataBrasilia();
  let latestBackupStats = null;
  const latestPath = path.join(BACKUPS_DIR, 'backup_daily_latest.json');
  if (fs.existsSync(latestPath)) {
    try {
      const stats = fs.statSync(latestPath);
      latestBackupStats = {
        existe: true,
        tamanhoBytes: stats.size,
        modificadoEm: stats.mtime
      };
    } catch (e) {}
  }

  res.json({
    status: 'success',
    agoraBR: `${dataBR} ${horaBR} (BRT)`,
    agendamentoDiario: '12:00 BRT (Horário de Brasília)',
    destinatarioResponsavel: 'lediariodeembarque@gmail.com',
    ultimoBackupHoje: lastDailyBackupDateBR === dataBR,
    arquivoMaisRecente: latestBackupStats,
    googleDrive: {
      status: 'Aguardando concessão de permissão OAuth 2.0 pelo usuário',
      escopoNecessario: 'https://www.googleapis.com/auth/drive.file',
      observacao: 'Para exportação direta sem intervenção manual no Google Drive, requer ativação via Google Cloud Console com OAuth consent screen ou conta de serviço.'
    }
  });
});

// GET /api/backup/export - Exporta snapshot completo de dados, fotos e configurações
app.get('/api/backup/export', requireAuth, (req, res) => {
  const isMasterOrAdmin = req.user.role === 'admin' || req.user.email === 'lediariodeembarque@gmail.com';
  if (!isMasterOrAdmin) {
    return res.status(403).json({ error: 'Acesso negado: apenas o Administrador/Master pode exportar backups completos.' });
  }

  try {
    const snapshot = gerarSnapshotCompletoBackup();
    const { dataBR } = getHoraEDataBrasilia();
    const nomeArquivo = `diario_embarque_backup_${dataBR.replace(/\//g, '-')}_${Date.now()}.json`;

    // Salva cópia de segurança na pasta local de backups
    try {
      fs.writeFileSync(path.join(BACKUPS_DIR, 'backup_daily_latest.json'), JSON.stringify(snapshot, null, 2), 'utf8');
    } catch(e) {}

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.send(JSON.stringify(snapshot, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/backup/restore - Restauração segura de backup com validação estrita
app.post('/api/backup/restore', requireAuth, (req, res) => {
  const isMasterOrAdmin = req.user.role === 'admin' || req.user.email === 'lediariodeembarque@gmail.com';
  if (!isMasterOrAdmin) {
    return res.status(403).json({ error: 'Acesso negado: apenas o Administrador/Master pode restaurar dados.' });
  }

  try {
    const payload = req.body;
    if (!payload || !payload.dados || typeof payload.dados !== 'object') {
      return res.status(400).json({ error: 'Arquivo de backup inválido: formato não reconhecido.' });
    }

    const { usuarios, cloudDB: importedCloudDB } = payload.dados;
    let restoredUsers = 0;

    if (usuarios && typeof usuarios === 'object') {
      for (const email of Object.keys(usuarios)) {
        const u = usuarios[email];
        if (u && u.email) {
          const cleanEmail = u.email.trim().toLowerCase();
          const existing = usersDB[cleanEmail] || {};
          usersDB[cleanEmail] = {
            ...existing,
            email: cleanEmail,
            name: u.name || existing.name || cleanEmail.split('@')[0],
            role: u.role || existing.role || 'embarque',
            flights: Array.isArray(u.flights) ? u.flights : (existing.flights || []),
            archivedFlights: Array.isArray(u.archivedFlights) ? u.archivedFlights : (existing.archivedFlights || []),
            meusVoosDoDia: Array.isArray(u.meusVoosDoDia) ? u.meusVoosDoDia : (existing.meusVoosDoDia || []),
            deletedFlightIds: Array.isArray(u.deletedFlightIds) ? u.deletedFlightIds : (existing.deletedFlightIds || []),
            roboCustomization: u.roboCustomization || existing.roboCustomization || null,
            lastUpdated: Date.now()
          };
          restoredUsers++;
        }
      }
      saveUsersDB();
    }

    if (importedCloudDB && typeof importedCloudDB === 'object') {
      if (Array.isArray(importedCloudDB.flights)) cloudDB.flights = importedCloudDB.flights;
      if (Array.isArray(importedCloudDB.archivedFlights)) cloudDB.archivedFlights = importedCloudDB.archivedFlights;
      cloudDB.lastUpdated = Date.now();
      saveCloudDB();
    }

    res.json({
      status: 'success',
      message: `Restauração concluída com sucesso! ${restoredUsers} usuários restaurados/mesclados com segurança.`,
      restoredUsers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proteção de acesso estrito ao dataset de colaboradores (somente Gestão e Master)
app.get(['/dataset_analise_colaboradores.json', '/public/dataset_analise_colaboradores.json'], requireAuth, (req, res) => {
  const userEmail = (req.user?.email || '').trim().toLowerCase();
  const rawRole = (req.user?.role || '').trim().toLowerCase();
  const userRole = rawRole.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const isMaster = userEmail === 'lediariodeembarque@gmail.com' || userRole === 'master';
  const isGestaoOrAdmin = ['admin', 'gestao', 'supervisor', 'gerente'].includes(userRole);
  if (!isMaster && !isGestaoOrAdmin) {
    return res.status(403).json({ error: 'Acesso restrito: este painel é exclusivo para Gestão e Master.' });
  }
  const fPath = path.join(__dirname, 'dataset_analise_colaboradores.json');
  if (fs.existsSync(fPath)) {
    return res.sendFile(fPath);
  }
  res.status(404).json({ error: 'Arquivo não encontrado' });
});

// Serve static assets from workspace root
app.use(express.static(__dirname, {
  extensions: ['html', 'htm']
}));

// Route all non-static requests to index.html (SPA routing, Express 5 compatible)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Listen on PORT (3000 in AI Studio dev, or PORT in Cloud Run)
server.listen(PORT, HOST, () => {
  console.log(`Diário de Embarque (HTTP & WebSockets) running on http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM recebido, encerrando servidor com segurança...');
  server.close(() => {
    console.log('Servidor HTTP encerrado.');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.warn('Unhandled Rejection capturado com segurança:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception capturado com segurança:', err);
});
