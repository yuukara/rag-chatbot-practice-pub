import { Injectable, Logger } from '@nestjs/common';

type EmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
    index?: number;
  }>;
};

/**
 * OpenAI 互換の `/v1/embeddings` を呼び、テキストをベクトル化する。
 * chat と同じ provider 切り替え方針（OPENAI_BASE_URL 経由）に乗る。
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY ?? 'lm-studio';
    this.baseURL = process.env.OPENAI_BASE_URL ?? 'http://host.docker.internal:1234/v1';
    this.model = process.env.OPENAI_EMBEDDING_MODEL ?? '';
    this.timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? '120000');
  }

  /** 埋め込みモデルが設定されているか。未設定なら RAG は無効になる。 */
  isEnabled(): boolean {
    return this.model.trim().length > 0;
  }

  /** 複数テキストをまとめてベクトル化する。返り値は入力と同じ順序。 */
  async embed(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) {
      return [];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseURL}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: inputs }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Embedding request failed with status ${response.status}: ${errorBody}`,
        );
      }

      const data = (await response.json()) as EmbeddingResponse;
      const items = [...(data.data ?? [])].sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0),
      );
      if (items.length !== inputs.length) {
        throw new Error(
          `Embedding count mismatch: expected ${inputs.length}, got ${items.length}`,
        );
      }
      return items.map((item) => item.embedding ?? []);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** 単一テキストをベクトル化する。 */
  async embedOne(input: string): Promise<number[]> {
    const [vector] = await this.embed([input]);
    return vector ?? [];
  }
}
