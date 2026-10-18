declare module 'qrcode' {
  export interface QRCodeToDataURLOptions {
    readonly type?: 'image/png' | 'image/jpeg' | 'image/webp';
    readonly quality?: number;
    readonly margin?: number;
    readonly width?: number;
    readonly color?: { readonly dark?: string; readonly light?: string };
    readonly errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  }

  export function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
  export function toString(text: string, options?: { readonly type?: 'svg' | 'terminal'; readonly margin?: number }): Promise<string>;
  export function toBuffer(text: string, options?: QRCodeToDataURLOptions): Promise<Buffer>;
}