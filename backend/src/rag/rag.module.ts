import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { EmbeddingService } from './embedding.service';
import { IngestService } from './ingest.service';
import { RagService } from './rag.service';
import { VectorStoreService } from './vector-store.service';

@Module({
  controllers: [DocumentsController],
  providers: [
    EmbeddingService,
    VectorStoreService,
    IngestService,
    RagService,
  ],
  exports: [RagService],
})
export class RagModule {}
