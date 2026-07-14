import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { GoogleHealthClient, GoogleHealthError } from './google-health.js';

loadEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT || 3217);
const health = new GoogleHealthClient({
  clientId: process.env.GOOGLE_HEALTH_CLIENT_ID,
  clientSecret: process.env.GOOGLE_HEALTH_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_HEALTH_REDIRECT_URI || `http://localhost:${port}/oauth2/callback`,
  refreshToken: process.env.GOOGLE_HEALTH_REFRESH_TOKEN
});

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(pair => {
    const [key, ...value] = pair.trim().split('=');
    return [key, decodeURIComponent(value.join('='))];
  }));
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filename = path.resolve(publicDir, relative);
  if (!filename.startsWith(`${publicDir}${path.sep}`)) return false;
  try {
    const content = await fs.readFile(filename);
    res.writeHead(200, { 'content-type': mime[path.extname(filename)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    res.end(content);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, { cloudConfigured: health.configured, cloudAuthorized: health.authorized });
    }
    if (req.method === 'GET' && url.pathname === '/auth/google') {
      const state = crypto.randomBytes(24).toString('base64url');
      res.writeHead(302, {
        location: health.authorizationUrl(state),
        'set-cookie': `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`
      });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/oauth2/callback') {
      const state = cookies(req).oauth_state;
      const returnedState = url.searchParams.get('state');
      const stateMatches = state && returnedState && state.length === returnedState.length && crypto.timingSafeEqual(Buffer.from(state), Buffer.from(returnedState));
      if (!stateMatches) {
        return json(res, 400, { error: 'OAuth stateが一致しません。認証をやり直してください。' });
      }
      if (url.searchParams.get('error')) return json(res, 400, { error: 'Google Health APIへのアクセスが許可されませんでした。' });
      const code = url.searchParams.get('code');
      if (!code) return json(res, 400, { error: 'OAuth認可コードがありません。' });
      await health.exchangeCode(code);
      res.writeHead(302, { location: '/?authorized=1', 'set-cookie': 'oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      health.clearTokens();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/heart-rate/latest') {
      if (!health.configured) return json(res, 503, { error: 'Google Health APIが未設定です。', code: 'not_configured' });
      if (!health.authorized) return json(res, 401, { error: 'Google Health APIの認証が必要です。', code: 'not_authorized' });
      const data = await health.latestHeartRate();
      return json(res, 200, data);
    }
    if (req.method === 'GET' && await serveStatic(req, res, url.pathname)) return;
    json(res, 404, { error: '見つかりません。' });
  } catch (error) {
    // トークンやAPI生レスポンスはログへ出しません。
    const known = error instanceof GoogleHealthError;
    console.error(`[${new Date().toISOString()}] ${known ? error.code : 'server_error'}: ${error.message}`);
    json(res, known ? error.status : 500, { error: known ? error.message : 'サーバーでエラーが発生しました。', code: known ? error.code : 'server_error' },
      error.retryAfter ? { 'retry-after': error.retryAfter } : {});
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Google Fitbit Air Heart Rate: http://localhost:${port}`);
  console.log(`Google Health API: ${health.configured ? 'configured' : 'not configured'}`);
});
