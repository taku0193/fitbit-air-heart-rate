import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHeartRateMeasurement } from '../public/bluetooth.js';

const view = bytes => new DataView(Uint8Array.from(bytes).buffer);

test('8bit心拍数を解析する', () => {
  assert.equal(parseHeartRateMeasurement(view([0x00, 128])), 128);
});

test('16bit心拍数をリトルエンディアンで解析する', () => {
  assert.equal(parseHeartRateMeasurement(view([0x01, 0x04, 0x01])), 260);
});

test('空データを拒否する', () => {
  assert.throws(() => parseHeartRateMeasurement(view([])), /空、または短すぎ/);
});

test('途中で切れた16bitデータを拒否する', () => {
  assert.throws(() => parseHeartRateMeasurement(view([0x01, 100])), /途中で切れ/);
});

test('DataView以外を拒否する', () => {
  assert.throws(() => parseHeartRateMeasurement(new Uint8Array([0, 70])), /空、または短すぎ/);
});

test('0および想定外の値を拒否する', () => {
  assert.throws(() => parseHeartRateMeasurement(view([0x00, 0])), /想定範囲外/);
  assert.throws(() => parseHeartRateMeasurement(view([0x01, 0x2d, 0x01])), /想定範囲外/);
});
