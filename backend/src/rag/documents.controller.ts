import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EmbeddingService } from './embedding.service';
import { IngestService } from './ingest.service';
import { extractPdfText } from './pdf.util';
import { SourceSummary, VectorStoreService } from './vector-store.service';

const MAX_UPLOAD_BYTES = 10_000_000;

/**
 * 文書管理 API。RAG の知識ソースを実行時に追加・確認・削除する。
 * 取り込みは `IngestService.ingestText()` を再利用し、起動時 ingest と同じ経路を通る。
 */
@Controller('api/documents')
export class DocumentsController {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly ingestService: IngestService,
    private readonly vectorStore: VectorStoreService,
  ) {}

  @Get()
  list(): Promise<SourceSummary[]> {
    return this.vectorStore.listSources();
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async upload(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ source: string; chunks: number }> {
    if (!this.embeddingService.isEnabled()) {
      throw new BadRequestException(
        'RAG が無効です(OPENAI_EMBEDDING_MODEL 未設定)。',
      );
    }
    if (!file) {
      throw new BadRequestException('file が見つかりません。');
    }
    if (!/\.(md|txt|pdf)$/i.test(file.originalname)) {
      throw new BadRequestException('対応形式は .md / .txt / .pdf のみです。');
    }

    const content = await this.extractContent(file);
    const chunks = await this.ingestService.ingestText(
      file.originalname,
      content,
    );
    return { source: file.originalname, chunks };
  }

  private async extractContent(file: Express.Multer.File): Promise<string> {
    if (/\.pdf$/i.test(file.originalname)) {
      const text = await extractPdfText(file.buffer);
      if (!text) {
        throw new BadRequestException(
          'PDF からテキストを抽出できませんでした（画像 PDF の可能性）。',
        );
      }
      return text;
    }
    return file.buffer.toString('utf-8');
  }

  @Delete(':source')
  async remove(
    @Param('source') source: string,
  ): Promise<{ source: string; deleted: number }> {
    const deleted = await this.vectorStore.deleteBySource(source);
    return { source, deleted };
  }
}
