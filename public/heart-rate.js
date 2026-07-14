/**
 * @typedef {Object} HeartRateData
 * @property {number} bpm 心拍数
 * @property {string} measuredAt デバイスまたはAPI上の測定時刻（ISO 8601）
 * @property {string} receivedAt システムが値を受け取った時刻（ISO 8601）
 * @property {'bluetooth'|'cloud-api'} source 取得元
 */

export const BLUETOOTH_FRESH_MS = 5_000;

/** @param {HeartRateData|null} bluetooth @param {boolean} bluetoothConnected @param {HeartRateData|null} cloud @param {number} now */
export function selectHeartRate(bluetooth, bluetoothConnected, cloud, now = Date.now()) {
  const received = bluetooth ? Date.parse(bluetooth.receivedAt) : Number.NaN;
  if (bluetoothConnected && bluetooth && Number.isFinite(received) && now - received <= BLUETOOTH_FRESH_MS) {
    return bluetooth;
  }
  return cloud ?? null;
}

export function isValidHeartRate(value) {
  return Number.isInteger(value) && value >= 1 && value <= 300;
}
