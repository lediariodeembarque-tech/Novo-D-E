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
  // Strip quotes if any
  n = n.replace(/^["']+|["']+$/g, '').trim();
  if (!n || n === '-' || n === '.' || n.toLowerCase() === 'null' || n.toLowerCase() === 'undefined') return '';
  return n;
}

const content = fs.readFileSync('public/assets/aistudio/02._Prog_ed5b29e7._Visualiza__o_HCC___2026', 'utf-8');
const lines = content.split('\n').filter(l => l.trim().length > 0);

console.log('Total non-empty lines in CSV:', lines.length);
const header = parseCSVLine(lines[1]);
console.log('Col 49 header:', header[49]);
console.log('Col 50 header:', header[50]);
console.log('Col 51 header:', header[51]);

const a1Set = new Set();
const a2Set = new Set();
const a3Set = new Set();
const allAgentsSet = new Set();

let flightRows = 0;

for (let i = 2; i < lines.length; i++) {
  const row = parseCSVLine(lines[i]);
  flightRows++;
  const a1 = normalizeName(row[49]);
  const a2 = normalizeName(row[50]);
  const a3 = normalizeName(row[51]);

  if (a1) { a1Set.add(a1); allAgentsSet.add(a1); }
  if (a2) { a2Set.add(a2); allAgentsSet.add(a2); }
  if (a3) { a3Set.add(a3); allAgentsSet.add(a3); }
}

console.log('Flight rows analyzed:', flightRows);
console.log('Distinct Agente 1:', a1Set.size);
console.log('Distinct Agente 2:', a2Set.size);
console.log('Distinct Agente 3:', a3Set.size);
console.log('Total Unique Agents (Consolidated A1 + A2 + A3):', allAgentsSet.size);

const sortedAgents = Array.from(allAgentsSet).sort((a, b) => a.localeCompare(b));
console.log('First 10 agents:', sortedAgents.slice(0, 10));
console.log('Includes Mayara?', sortedAgents.find(n => n.includes('MAYARA')));
console.log('Includes Leandro?', sortedAgents.find(n => n.includes('LEANDRO')));
