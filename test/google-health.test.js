import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleHealthClient, GoogleHealthError, GOOGLE_TOKEN_URL } from '../server/google-health.js';

const config = { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost/callback', refreshToken: 'refresh' };
const response = (status, body = {}, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const heartRatePayload = { dataPoints: [{ heartRate: { beatsPerMinute: '121', sampleTime: { physicalTime: '2026-07-14T13:58:10Z' } } }] };

test('正常な最新心拍数を共通形式へ変換する', async () => {
  const fetch = async url => url === GOOGLE_TOKEN_URL ? response(200, { access_token: 'access', expires_in: 3600 }) : response(200, heartRatePayload);
  const result = await new GoogleHealthClient(config, fetch).latestHeartRate(new Date('2026-07-14T14:00:00Z'));
  assert.deepEqual({ bpm: result.bpm, measuredAt: result.measuredAt, source: result.source }, { bpm: 121, measuredAt: '2026-07-14T13:58:10Z', source: 'cloud-api' });
});

test('心拍数データなしはnullを返す', async () => {
  const fetch = async url => url === GOOGLE_TOKEN_URL ? response(200, { access_token: 'a' }) : response(200, { dataPoints: [] });
  assert.equal(await new GoogleHealthClient(config, fetch).latestHeartRate(), null);
});

test('OAuthエラーを秘匿した一般メッセージへ変換する', async () => {
  const client = new GoogleHealthClient(config, async () => response(400, { error: 'invalid_grant', secret_detail: 'do-not-expose' }));
  await assert.rejects(client.refreshAccessToken(), error => error instanceof GoogleHealthError && error.code === 'oauth_error' && !error.message.includes('do-not-expose'));
});

test('アクセストークン期限切れ時にrefresh tokenで更新する', async () => {
  let tokenCalls = 0;
  const fetch = async url => {
    if (url === GOOGLE_TOKEN_URL) { tokenCalls += 1; return response(200, { access_token: `new-${tokenCalls}`, expires_in: 3600 }); }
    return response(200, heartRatePayload);
  };
  const client = new GoogleHealthClient(config, fetch);
  client.accessToken = 'expired';
  client.accessTokenExpiresAt = Date.now() - 1;
  await client.latestHeartRate();
  assert.equal(tokenCalls, 1);
  assert.equal(client.accessToken, 'new-1');
});

test('APIが401なら一度だけトークンを更新して再試行する', async () => {
  let apiCalls = 0;
  let tokenCalls = 0;
  const fetch = async url => {
    if (url === GOOGLE_TOKEN_URL) { tokenCalls += 1; return response(200, { access_token: `token-${tokenCalls}`, expires_in: 3600 }); }
    apiCalls += 1;
    return apiCalls === 1 ? response(401) : response(200, heartRatePayload);
  };
  const client = new GoogleHealthClient(config, fetch);
  client.accessToken = 'old';
  client.accessTokenExpiresAt = Date.now() + 60_000;
  assert.equal((await client.latestHeartRate()).bpm, 121);
  assert.equal(tokenCalls, 1);
  assert.equal(apiCalls, 2);
});

test('API通信失敗を扱う', async () => {
  const client = new GoogleHealthClient(config, async url => {
    if (url === GOOGLE_TOKEN_URL) return response(200, { access_token: 'a' });
    throw new TypeError('network detail');
  });
  await assert.rejects(client.latestHeartRate(), error => error.code === 'api_network_error');
});

test('レート制限とRetry-Afterを扱う', async () => {
  const fetch = async url => url === GOOGLE_TOKEN_URL ? response(200, { access_token: 'a' }) : response(429, {}, { 'retry-after': '30' });
  await assert.rejects(new GoogleHealthClient(config, fetch).latestHeartRate(), error => error.code === 'rate_limited' && error.retryAfter === '30');
});
