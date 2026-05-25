import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { chunkText } from './chunk.util';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';

/**
 * 文書の取り込み(ingest)を担う。
 * - 起動時: `docs/` の各ファイルを source 単位で置き換え取り込み(編集を反映、他 source は保持)
 * - 実行時: `ingestText()` をアップロード API からも再利用
 *
 * 埋め込みモデル未設定・docs 無し・失敗時は RAG を無効のままにし、
 * 既存の単発チャットはそのまま動く(後方互換)。
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
        'OPENAI_EMBEDDING_MODEL が未設定のため RAG を無効化します(チャットは通常動作)。',
      );
      return;
    }

    try {
      if (process.env.RAG_RESET === 'true') {
        await this.vectorStore.dropTable();
        this.logger.warn('RAG_RESET=true: chunks テーブルを作り直します。');
      }
      await this.ingestDocsDir();
    } catch (error) {
      this.logger.error(
        'ドキュメントの取り込みに失敗しました。RAG なしでチャットを継続します。',
        error as Error,
      );
    }
  }

  /** 1 文書を取り込む(同名 source は置き換え)。取り込んだチャンク数を返す。 */
  async ingestText(source: string, content: string): Promise<number> {
    const texts = chunkText(content, this.chunkSize, this.chunkOverlap);
    if (texts.length === 0) {
      await this.vectorStore.deleteBySource(source);
      return 0;
    }

    const vectors = await this.embeddingService.embed(texts);
    const dimensions = vectors[0]?.length ?? 0;
    if (dimensions === 0) {
      throw new Error('埋め込みベクトルが空です。');
    }

    await this.vectorStore.ensureSchema(dimensions);
    await this.vectorStore.deleteBySource(source);
    await this.vectorStore.add(
      texts.map((text, chunkIndex) => ({
        source,
        chunkIndex,
        text,
        vector: vectors[chunkIndex],
      })),
    );
    return texts.length;
  }

  private async ingestDocsDir(): Promise<void> {
    const files = await this.listDocumentFiles();
    if (files.length === 0) {
      this.logger.warn(`取り込み対象のドキュメントがありません: ${this.docsDir}`);
      return;
    }

    let total = 0;
    for (const file of files) {
      const content = await readFile(join(this.docsDir, file), 'utf-8');
      total += await this.ingestText(file, content);
    }
    this.logger.log(
      `RAG インデックス作成完了: ${files.length} ファイル / ${total} チャンク (pgvector)`,
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
