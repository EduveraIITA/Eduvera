declare module 'qrcode/lib/core/qrcode' {
  import type { QRCode, QRCodeOptions } from 'qrcode';
  export function create(text: string, options?: QRCodeOptions): QRCode;
}
