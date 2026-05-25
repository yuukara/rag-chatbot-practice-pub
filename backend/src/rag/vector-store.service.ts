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

export type SourceSummary = {
  source: string;
  chunks: number;
};

const UNDEFINED_TABLE = '42P01';

/**
 * pgvector(PostgreSQL 拡張)を使うベクトルストア。
 * チャンクを `chunks` テーブルに保存し、コサイン距離(`<=>`)で類似検索する。
 * テーブルは起動時に消さず、source 単位の追加・削除で運用する。
 */
@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);
  private readonly pool: Pool;

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

  /** 拡張・テーブル・インデックスを用意する(存在すれば何もしない)。 */
  async ensureSchema(dimensions: number): Promise<void> {
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS chunks (
         id serial PRIMARY KEY,
         source text NOT NULL,
         chunk_index int NOT NULL,
         content text NOT NULL,
         embedding vector(${dimensions}) NOT NULL
       )`,
    );
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops)',
    );
  }

  /** テーブルを破棄する(モデル/次元変更時の作り直し用)。 */
  async dropTable(): Promise<void> {
    await this.pool.query('DROP TABLE IF EXISTS chunks');
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
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 指定 source のチャンクを削除し、削除件数を返す。 */
  async deleteBySource(source: string): Promise<number> {
    try {
      const result = await this.pool.query(
        'DELETE FROM chunks WHERE source = $1',
        [source],
      );
      return result.rowCount ?? 0;
    } catch (error) {
      if (isUndefinedTable(error)) {
        return 0;
      }
      throw error;
    }
  }

  /** 取り込み済みの source とチャンク数の一覧。 */
  async listSources(): Promise<SourceSummary[]> {
    try {
      const result = await this.pool.query(
        `SELECT source, count(*)::int AS chunks
         FROM chunks GROUP BY source ORDER BY source`,
      );
      return result.rows.map((row) => ({
        source: row.source,
        chunks: row.chunks,
      }));
    } catch (error) {
      if (isUndefinedTable(error)) {
        return [];
      }
      throw error;
    }
  }

  /** queryVector に近いチャンクを上位 topK 件返す(score はコサイン類似度)。 */
  async search(queryVector: number[], topK: number): Promise<SearchResult[]> {
    if (queryVector.length === 0) {
      return [];
    }
    try {
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
    } catch (error) {
      if (isUndefinedTable(error)) {
        return [];
      }
      throw error;
    }
  }
}

/** number[] を pgvector のテキスト表現 `[v1,v2,...]` に変換する。 */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/** まだ ingest 前でテーブルが無いケースを判定する。 */
function isUndefinedTable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === UNDEFINED_TABLE
  );
}
