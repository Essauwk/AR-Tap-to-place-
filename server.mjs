import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.pdf': 'application/pdf',
};

http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const queryParams = new URLSearchParams(req.url.split('?')[1] || '');

  // Proxy /api/ routes to emulate Vercel Serverless Functions
  if (urlPath.startsWith('/api/')) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    const reqBody = body ? JSON.parse(body) : {};

    try {
      if (urlPath === '/api/gemini') {
        const model = queryParams.get('model') || 'gemini-2.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const fetchRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody)
        });
        const data = await fetchRes.json();
        res.writeHead(fetchRes.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(data));
      } 
      else if (urlPath === '/api/elevenlabs') {
        const voiceId = queryParams.get('voiceId') || 'ErXwobaYiN019PkySvjV';
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
        const fetchRes = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': process.env.ELEVENLABS_API_KEY,
            'Accept': 'application/json'
          },
          body: JSON.stringify(reqBody)
        });
        const data = await fetchRes.json();
        res.writeHead(fetchRes.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(data));
      }
      else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      console.error('[Local API Error]', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: error.message }));
    }
  }

  // Serve Static Files
  const filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] http://localhost:${PORT}`);
  console.log(`[Server] API Proxy ready (reads from .env)`);
});
