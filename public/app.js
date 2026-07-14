import { HeartRateBluetooth } from './bluetooth.js';
import { selectHeartRate } from './heart-rate.js';

const $ = id => document.getElementById(id);
const bluetooth = new HeartRateBluetooth();
const state = {
  bluetooth: null,
  bluetoothStatus: 'disconnected',
  cloud: null,
  cloudConfigured: false,
  cloudAuthorized: false,
  lastCloudMeasuredAt: null,
  cloudRetryAt: 0
};

const sourceNames = { bluetooth: 'Bluetooth Live', 'cloud-api': 'Google Health' };
const statusNames = { disconnected: '未接続', connecting: '接続中…', connected: '接続済み' };

function setError(message = '') {
  $('error').textContent = message;
  $('error').classList.toggle('hidden', !message);
}

function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}

function elapsed(iso, now = Date.now()) {
  if (!iso) return '—';
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 5) return 'たった今';
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

function render() {
  const now = Date.now();
  const selected = selectHeartRate(state.bluetooth, state.bluetoothStatus === 'connected', state.cloud, now);
  $('bpm').textContent = selected?.bpm ?? '--';
  $('source').textContent = selected ? sourceNames[selected.source] : '—';
  $('source-badge').textContent = selected ? sourceNames[selected.source] : 'データなし';
  $('source-badge').classList.toggle('neutral', !selected);
  $('monitor').classList.toggle('is-live', selected?.source === 'bluetooth');
  $('monitor').classList.toggle('is-empty', !selected);
  $('connection').textContent = statusNames[state.bluetoothStatus];
  $('measured-at').textContent = formatDate(selected?.measuredAt);
  $('received-at').textContent = formatDate(selected?.receivedAt);
  $('elapsed').textContent = elapsed(selected?.receivedAt, now);
  const isCloud = selected?.source === 'cloud-api';
  const isStale = isCloud && now - Date.parse(selected.measuredAt) >= 15 * 60 * 1000;
  $('cloud-note').classList.toggle('hidden', !isCloud);
  $('stale-note').classList.toggle('hidden', !isStale);
  $('stale-badge').classList.toggle('hidden', !isStale);
  $('connect-label').textContent = bluetooth.device && state.bluetoothStatus !== 'connected' ? '心拍計に再接続' : '心拍計に接続';
  $('connect').disabled = state.bluetoothStatus === 'connecting' || state.bluetoothStatus === 'connected' || !bluetooth.supported;
  $('disconnect').disabled = state.bluetoothStatus !== 'connected';
  $('refresh').disabled = !state.cloudConfigured || !state.cloudAuthorized;
  $('authorize').classList.toggle('hidden', !state.cloudConfigured || state.cloudAuthorized);
  $('live-dot').classList.toggle('active', state.bluetoothStatus === 'connected');
}

async function refreshCloud({ manual = false } = {}) {
  if (!state.cloudConfigured || !state.cloudAuthorized) return;
  if (!manual && Date.now() < state.cloudRetryAt) return;
  try {
    const response = await fetch('/api/heart-rate/latest', { cache: 'no-store' });
    if (response.status === 401) {
      state.cloudAuthorized = false;
      render();
      if (manual) setError('Google Health APIの再認証が必要です。');
      return;
    }
    if (response.status === 429) {
      const retrySeconds = Math.max(60, Number(response.headers.get('retry-after')) || 60);
      state.cloudRetryAt = Date.now() + retrySeconds * 1000;
      throw new Error(`クラウドAPIのレート制限中です。約${retrySeconds}秒後に再試行します。`);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'クラウドAPIの取得に失敗しました。');
    }
    const data = await response.json();
    if (data && data.measuredAt !== state.lastCloudMeasuredAt) {
      state.cloud = data;
      state.lastCloudMeasuredAt = data.measuredAt;
    } else if (data === null) {
      state.cloud = null;
      state.lastCloudMeasuredAt = null;
    }
    if (manual) setError('');
  } catch (error) {
    if (manual) setError(error.message);
  } finally {
    render();
  }
}

bluetooth.addEventListener('status', event => {
  state.bluetoothStatus = event.detail;
  render();
});
bluetooth.addEventListener('measurement', event => {
  state.bluetooth = event.detail;
  setError('');
  render();
});
bluetooth.addEventListener('error', event => setError(event.detail));

$('connect').addEventListener('click', async () => {
  setError('');
  try { await bluetooth.connect(); } catch (error) { setError(error.message); }
});
$('disconnect').addEventListener('click', () => bluetooth.disconnect());
$('refresh').addEventListener('click', () => refreshCloud({ manual: true }));

async function initialize() {
  if (!bluetooth.supported) {
    $('support-message').textContent = 'Web Bluetooth非対応です。デスクトップ版Chromeなどの対応ブラウザを、localhostまたはHTTPSで使用してください。';
    $('support-message').classList.remove('hidden');
  }
  try {
    const config = await fetch('/api/config', { cache: 'no-store' }).then(response => response.json());
    Object.assign(state, config);
  } catch {
    setError('サーバー設定を読み込めませんでした。');
  }
  if (new URLSearchParams(location.search).has('authorized')) history.replaceState({}, '', '/');
  await refreshCloud();
  render();
  setInterval(render, 1_000);
  setInterval(refreshCloud, 60_000);
}

initialize();
