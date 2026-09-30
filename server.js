import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.use(express.json());

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

// Serve static assets from workspace root
app.use(express.static(__dirname, {
  extensions: ['html', 'htm']
}));

// Route / to index.html explicitly
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Diário de Embarque running on http://${HOST}:${PORT}`);
});
