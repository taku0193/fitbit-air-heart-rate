import { isValidHeartRate } from './heart-rate.js';

export const HEART_RATE_SERVICE = 'heart_rate';
export const HEART_RATE_MEASUREMENT = 'heart_rate_measurement';

/** Bluetooth Heart Rate Measurement（8bit/16bit）を解析します。 */
export function parseHeartRateMeasurement(value) {
  if (!(value instanceof DataView) || value.byteLength < 2) {
    throw new Error('心拍数データが空、または短すぎます。');
  }
  const flags = value.getUint8(0);
  const is16Bit = (flags & 0x01) !== 0;
  if (is16Bit && value.byteLength < 3) {
    throw new Error('16bit心拍数データが途中で切れています。');
  }
  const bpm = is16Bit ? value.getUint16(1, true) : value.getUint8(1);
  if (!isValidHeartRate(bpm)) {
    throw new Error(`想定範囲外の心拍数です: ${bpm} bpm`);
  }
  return bpm;
}

export class HeartRateBluetooth extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.characteristic = null;
    this.onMeasurement = this.onMeasurement.bind(this);
    this.onDisconnected = this.onDisconnected.bind(this);
  }

  get supported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  get connected() {
    return Boolean(this.device?.gatt?.connected);
  }

  async connect() {
    if (!this.supported) throw new Error('このブラウザはWeb Bluetoothに対応していません。Chrome系ブラウザをlocalhostまたはHTTPSで使用してください。');
    this.dispatchEvent(new CustomEvent('status', { detail: 'connecting' }));
    try {
      if (!this.device) {
        // requestDeviceは必ず画面のクリックハンドラーから直接呼び出されます。
        this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [HEART_RATE_SERVICE] }] });
        this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
      }
      const server = await this.device.gatt.connect();
      const service = await server.getPrimaryService(HEART_RATE_SERVICE);
      this.characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
      this.characteristic.addEventListener('characteristicvaluechanged', this.onMeasurement);
      await this.characteristic.startNotifications();
      this.dispatchEvent(new CustomEvent('status', { detail: 'connected' }));
    } catch (error) {
      this.dispatchEvent(new CustomEvent('status', { detail: 'disconnected' }));
      throw new Error(this.friendlyError(error), { cause: error });
    }
  }

  disconnect() {
    if (this.characteristic) this.characteristic.removeEventListener('characteristicvaluechanged', this.onMeasurement);
    this.characteristic = null;
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    else this.dispatchEvent(new CustomEvent('status', { detail: 'disconnected' }));
  }

  onMeasurement(event) {
    try {
      const bpm = parseHeartRateMeasurement(event.target.value);
      const now = new Date().toISOString();
      this.dispatchEvent(new CustomEvent('measurement', {
        detail: { bpm, measuredAt: now, receivedAt: now, source: 'bluetooth' }
      }));
    } catch (error) {
      this.dispatchEvent(new CustomEvent('error', { detail: error.message }));
    }
  }

  onDisconnected() {
    if (this.characteristic) this.characteristic.removeEventListener('characteristicvaluechanged', this.onMeasurement);
    this.characteristic = null;
    this.dispatchEvent(new CustomEvent('status', { detail: 'disconnected' }));
  }

  friendlyError(error) {
    if (error?.name === 'NotFoundError') return 'デバイスが選択されませんでした。心拍数共有を有効にして、もう一度お試しください。';
    if (error?.name === 'SecurityError') return 'BluetoothはlocalhostまたはHTTPSでのみ利用できます。';
    if (error?.name === 'NetworkError') return 'Bluetooth接続に失敗しました。他の機器との接続を解除し、心拍数共有を再度有効にしてください。';
    return `Bluetooth接続に失敗しました: ${error?.message ?? '不明なエラー'}`;
  }
}
