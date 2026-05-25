import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { SearchResult, VectorStoreService } from './vector-store.service';

/**
 * クエリ時の検索（retrieval）を担う。質問をベクトル化し、
 * 関連チャンクを取得して、プロンプトに差し込む「参考情報」文字列を組み立てる。
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly topK: number;

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStore: VectorStoreService,
  ) {
    this.topK = Number(process.env.RAG_TOP_K ?? '4');
  }

  /** インデックスにチャンクがあり、検索可能な状態か。 */
  isReady(): boolean {
    return this.embeddingService.isEnabled() && this.vectorStore.size > 0;
  }

  async retrieve(query: string): Promise<SearchResult[]> {
    if (!this.isReady()) {
      return [];
    }
    try {
      const queryVector = await this.embeddingService.embedOne(query);
      const results = await this.vectorStore.search(queryVector, this.topK);
      this.logger.log(
        `retrieve: "${query}" -> ${results
          .map((r) => `${r.chunk.source}#${r.chunk.chunkIndex}(${r.score.toFixed(3)})`)
          .join(', ')}`,
      );
      return results;
    } catch (error) {
      this.logger.error('検索に失敗しました。RAG なしで回答します。', error as Error);
      return [];
    }
  }

  /** 取得チャンクを LLM へ渡す参考情報テキストに整形する。 */
  buildContext(results: SearchResult[]): string {
    return results
      .map(
        (result, i) =>
          `[参考${i + 1}] (出典: ${result.chunk.source})\n${result.chunk.text}`,
      )
      .join('\n\n');
  }
}
