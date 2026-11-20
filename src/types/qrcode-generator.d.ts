declare module 'qrcode-generator' {
  type TypeNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

  interface QRCode {
    addData(data: string, mode?: 'Numeric' | 'Alphanumeric' | 'Byte' | 'Kanji'): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
    createSvgTag(cellSize?: number, margin?: number): string;
  }

  function qrcode(
    typeNumber: TypeNumber,
    errorCorrectionLevel: ErrorCorrectionLevel
  ): QRCode;

  export = qrcode;
}
