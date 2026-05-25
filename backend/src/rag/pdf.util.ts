/**
 * PDF からテキストを抽出する。
 * pdf-parse の index には debug 用コードがあるため、lib 実体を直接読み込む。
 * 型は最小限を自前で定義する。
 */
type PdfParseResult = { text: string };
type PdfParseOptions = { version?: string };
type PdfParseFn = (
  data: Buffer,
  options?: PdfParseOptions,
) => Promise<PdfParseResult>;

const pdfParse: PdfParseFn = require('pdf-parse/lib/pdf-parse.js');

// pdf-parse の既定 pdfjs(v1.10.100)は古く、新しめの PDF で "bad XRef entry" になる。
// 同梱されている新しめのビルドを指定する。
const PDFJS_VERSION = 'v2.0.550';

/** 抽出できなかった(画像 PDF など)場合は空文字を返す。 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer, { version: PDFJS_VERSION });
  return result.text?.trim() ?? '';
}
