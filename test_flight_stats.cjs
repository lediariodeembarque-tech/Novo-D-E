const fs = require('fs');

function parseCSVLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

function normalizeName(raw) {
  if (!raw) return '';
  let n = raw.replace(/\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/^["']+|["']+$/g, '').trim();
  if (!n || n === '-' || n === '.' || n.toLowerCase() === 'null' || n.toLowerCase() === 'undefined') return '';
  return n;
}

function timeToMinutes(t) {
  if (!t || typeof t !== 'string' || !t.includes(':')) return null;
  const parts = t.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToTime(mins) {
  if (mins === null || isNaN(mins)) return '--:--';
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

const content = fs.readFileSync('public/assets/aistudio/02._Prog_ed5b29e7._Visualiza__o_HCC___2026', 'utf-8');
const lines = content.split('\n').filter(l => l.trim().length > 0);

// We parse all flights
const flights = [];
for (let i = 2; i < lines.length; i++) {
  const row = parseCSVLine(lines[i]);
  const vooDep = row[22] || '';
  const des = row[23] || '';
  const std = row[24] || '';
  const porta = row[25] || '';
  const a1 = normalizeName(row[49]);
  const a2 = normalizeName(row[50]);
  const a3 = normalizeName(row[51]);
  const otpRaw = (row[59] || '').toUpperCase();
  const cod1 = (row[60] || '').trim();
  const descAtraso = (row[63] || '').trim();
  const posRaw = (row[69] || '').toUpperCase();

  if (!vooDep && !a1 && !a2 && !a3) continue;

  const isNoHorario = otpRaw === 'NH' || otpRaw.includes('HOR') || (otpRaw === '' && !cod1);
  const isFinger = posRaw.includes('FINGER') || (!posRaw.includes('REMOTA') && posRaw !== '');

  flights.push({
    id: 'V_' + i,
    data: row[0] || '24/10',
    voo: vooDep,
    des,
    std,
    porta,
    stdMin: timeToMinutes(std),
    portaMin: timeToMinutes(porta),
    a1,
    a2,
    a3,
    isNoHorario,
    otpRaw,
    cod1,
    descAtraso,
    isFinger,
    pos: isFinger ? 'FINGER' : 'REMOTA'
  });
}

console.log('Total valid flight rows parsed:', flights.length);

// Check agent participations
const agentStats = {};

flights.forEach(f => {
  const flightAgents = [
    { name: f.a1, role: 'a1' },
    { name: f.a2, role: 'a2' },
    { name: f.a3, role: 'a3' }
  ];

  // Unique agents in this flight
  const seenInFlight = new Set();

  flightAgents.forEach(({ name, role }) => {
    if (!name) return;
    if (!agentStats[name]) {
      agentStats[name] = {
        name,
        uniqueFlights: 0,
        participations: { a1: 0, a2: 0, a3: 0 },
        stdMins: [],
        portaMins: [],
        a2Partners: {},
        positions: { finger: 0, remota: 0 },
        otp: { noHorario: 0, atrasados: 0 },
        destinos: {},
        codigosAtraso: {},
        flightList: []
      };
    }

    agentStats[name].participations[role]++;

    if (!seenInFlight.has(name)) {
      seenInFlight.add(name);
      agentStats[name].uniqueFlights++;
      if (f.stdMin !== null) agentStats[name].stdMins.push(f.stdMin);
      if (f.portaMin !== null) agentStats[name].portaMins.push(f.portaMin);

      if (f.isFinger) agentStats[name].positions.finger++;
      else agentStats[name].positions.remota++;

      if (f.isNoHorario) agentStats[name].otp.noHorario++;
      else agentStats[name].otp.atrasados++;

      const destKey = `Voo ${f.voo} • ${f.des}`;
      agentStats[name].destinos[destKey] = (agentStats[name].destinos[destKey] || 0) + 1;

      if (f.cod1) {
        if (!agentStats[name].codigosAtraso[f.cod1]) {
          agentStats[name].codigosAtraso[f.cod1] = {
            codigo: f.cod1,
            descricao: f.descAtraso || 'Atraso Operacional',
            qtd: 0
          };
        }
        agentStats[name].codigosAtraso[f.cod1].qtd++;
      }

      agentStats[name].flightList.push(f);
    }

    // Partner A2
    if (role === 'a1' && f.a2) {
      agentStats[name].a2Partners[f.a2] = (agentStats[name].a2Partners[f.a2] || 0) + 1;
    }
  });
});

console.log('Total agents computed:', Object.keys(agentStats).length);

const topAgentsByFlights = Object.values(agentStats).sort((a, b) => b.uniqueFlights - a.uniqueFlights);
console.log('Top 5 agents by unique flights:');
topAgentsByFlights.slice(0, 5).forEach(a => {
  console.log(`- ${a.name}: ${a.uniqueFlights} voos (A1: ${a.participations.a1}, A2: ${a.participations.a2}, A3: ${a.participations.a3})`);
});
