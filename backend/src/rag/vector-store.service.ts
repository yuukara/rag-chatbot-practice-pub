import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';

export type StoredChunk = {
  source: string;
  chunkIndex: number;
  text: string;
  vector: number[];
};

export type ChunkRef = {
  source: string;
  chunkIndex: number;
  text: string;
};

export type SearchResult = {
  chunk: ChunkRef;
  score: number;
};

/**
 * pgvector(PostgreSQL 拡張)を使うベクトルストア。
 * チャンクを `chunks` テーブルに保存し、コサイン距離(`<=>`)で類似検索する。
 * size はメモリ上のカウントで保持し、isReady の同期判定に使う。
 */
@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);
  private readonly pool: Pool;
  private count = 0;

  constructor() {
    this.pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? 'postgres://rag:ragpass@db:5432/ragdb',
    });
    // アイドル接続のエラーでプロセスが落ちないようにする。
    this.pool.on('error', (err) =>
      this.logger.error('PostgreSQL pool error', err),
    );
  }

  get size(): number {
    return this.count;
  }

  /**
   * 拡張とテーブルを用意し直す。埋め込み次元をモデルに合わせて受け取り、
   * 毎起動で作り直して docs / モデル変更に追従する。
   */
  async reset(dimensions: number): Promise<void> {
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await this.pool.query('DROP TABLE IF EXISTS chunks');
    await this.pool.query(
      `CREATE TABLE chunks (
         id serial PRIMARY KEY,
         source text NOT NULL,
         chunk_index int NOT NULL,
         content text NOT NULL,
         embedding vector(${dimensions}) NOT NULL
       )`,
    );
    await this.pool.query(
      'CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops)',
    );
    this.count = 0;
  }

  async add(chunks: StoredChunk[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO chunks (source, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4::vector)`,
          [chunk.source, chunk.chunkIndex, chunk.text, toVectorLiteral(chunk.vector)],
        );
      }
      await client.query('COMMIT');
      this.count += chunks.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** queryVector に近いチャンクを上位 topK 件返す(score はコサイン類似度)。 */
  async search(queryVector: number[], topK: number): Promise<SearchResult[]> {
    if (this.count === 0 || queryVector.length === 0) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT source, chunk_index, content, 1 - (embedding <=> $1::vector) AS score
       FROM chunks
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [toVectorLiteral(queryVector), topK],
    );
    return result.rows.map((row) => ({
      chunk: {
        source: row.source,
        chunkIndex: row.chunk_index,
        text: row.content,
      },
      score: Number(row.score),
    }));
  }
}

/** number[] を pgvector のテキスト表現 `[v1,v2,...]` に変換する。 */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
