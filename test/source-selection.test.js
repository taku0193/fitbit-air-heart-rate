import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHeartRate } from '../public/heart-rate.js';

const now = Date.parse('2026-07-14T14:00:00.000Z');
const data = (source, ageMs = 0, bpm = 80) => ({ bpm, measuredAt: new Date(now - ageMs).toISOString(), receivedAt: new Date(now - ageMs).toISOString(), source });

test('接続中で5秒以内のBluetoothを最優先する', () => {
  assert.equal(selectHeartRate(data('bluetooth', 4_999, 100), true, data('cloud-api', 0, 90), now).source, 'bluetooth');
});

test('Bluetoothが5秒を超えるとクラウドへ切り替える', () => {
  assert.equal(selectHeartRate(data('bluetooth', 5_001), true, data('cloud-api'), now).source, 'cloud-api');
});

test('Bluetooth切断時は新しいBluetooth値を使わない', () => {
  assert.equal(selectHeartRate(data('bluetooth'), false, data('cloud-api'), now).source, 'cloud-api');
});

test('クラウドデータがなければnullを返す', () => {
  assert.equal(selectHeartRate(null, false, null, now), null);
});

test('Bluetooth再接続後にBluetoothへ戻る', () => {
  assert.equal(selectHeartRate(data('bluetooth'), true, data('cloud-api'), now).source, 'bluetooth');
});

test('すべて利用できなければnullを返す', () => {
  assert.equal(selectHeartRate(null, false, null, now), null);
});
