import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { chunkText } from './chunk.util';
import { EmbeddingService } from './embedding.service';
import { StoredChunk, VectorStoreService } from './vector-store.service';

/**
 * 起動時に docs/ を読み込み、チャンク分割 → 埋め込み → ベクトルストアへ保存する。
 * 埋め込みモデル未設定や docs 無し・失敗時は RAG を無効のままにし、
 * 既存の単発チャットはそのまま動く（後方互換）。
 */
@Injectable()
export class IngestService implements OnModuleInit {
  private readonly logger = new Logger(IngestService.name);
  private readonly docsDir: string;
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStore: VectorStoreService,
  ) {
    this.docsDir = resolve(
      process.env.RAG_DOCS_DIR ?? join(process.cwd(), 'docs'),
    );
    this.chunkSize = Number(process.env.RAG_CHUNK_SIZE ?? '300');
    this.chunkOverlap = Number(process.env.RAG_CHUNK_OVERLAP ?? '60');
  }

  async onModuleInit(): Promise<void> {
    if (!this.embeddingService.isEnabled()) {
      this.logger.warn(
        'OPENAI_EMBEDDING_MODEL が未設定のため RAG を無効化します（チャットは通常動作）。',
      );
      return;
    }

    try {
      await this.ingest();
    } catch (error) {
      this.logger.error(
        'ドキュメントの取り込みに失敗しました。RAG なしでチャットを継続します。',
        error as Error,
      );
    }
  }

  private async ingest(): Promise<void> {
    const files = await this.listDocumentFiles();
    if (files.length === 0) {
      this.logger.warn(`取り込み対象のドキュメントがありません: ${this.docsDir}`);
      return;
    }

    const pending: Array<Omit<StoredChunk, 'vector'>> = [];
    for (const file of files) {
      const content = await readFile(join(this.docsDir, file), 'utf-8');
      chunkText(content, this.chunkSize, this.chunkOverlap).forEach(
        (text, chunkIndex) => {
          pending.push({ source: file, chunkIndex, text });
        },
      );
    }

    if (pending.length === 0) {
      this.logger.warn('チャンクが生成されませんでした。');
      return;
    }

    const vectors = await this.embeddingService.embed(
      pending.map((chunk) => chunk.text),
    );
    const dimensions = vectors[0]?.length ?? 0;
    if (dimensions === 0) {
      this.logger.warn('埋め込みベクトルが空のため取り込みを中止します。');
      return;
    }

    await this.vectorStore.reset(dimensions);
    await this.vectorStore.add(
      pending.map((chunk, i) => ({ ...chunk, vector: vectors[i] })),
    );
    this.logger.log(
      `RAG インデックス作成完了: ${files.length} ファイル / ${pending.length} チャンク (${dimensions} 次元, pgvector)`,
    );
  }

  private async listDocumentFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this.docsDir);
      return entries.filter((name) => /\.(md|txt)$/i.test(name)).sort();
    } catch {
      this.logger.warn(`docs ディレクトリを開けません: ${this.docsDir}`);
      return [];
    }
  }
}
