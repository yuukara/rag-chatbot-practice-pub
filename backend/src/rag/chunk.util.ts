/**
 * 文字数ベースの単純なチャンク分割。
 * 日本語はトークナイザ依存が大きいため、まずは文字数 + オーバーラップで区切る。
 */
export function chunkText(
  text: string,
  size: number,
  overlap: number,
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) {
    return [];
  }

  const step = Math.max(1, size - overlap);
  const chunks: string[] = [];
  for (let start = 0; start < normalized.length; start += step) {
    const chunk = normalized.slice(start, start + size).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (start + size >= normalized.length) {
      break;
    }
  }
  return chunks;
}
