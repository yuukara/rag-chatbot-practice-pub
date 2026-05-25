import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import {
  Component,
  ElementRef,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';

type ChatResponse = {
  message: string;
};

type DocumentSummary = {
  source: string;
  chunks: number;
};

type UploadResponse = {
  source: string;
  chunks: number;
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  readonly answer = signal(
    'LM Studio または OpenAI-compatible API に質問を送る準備ができています。',
  );
  readonly error = signal('');
  readonly isLoading = signal(false);
  prompt = 'RAG とは何ですか?';

  readonly documents = signal<DocumentSummary[]>([]);
  readonly uploadStatus = signal('');
  readonly isUploading = signal(false);
  private selectedFile: File | null = null;

  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    this.loadDocuments();
  }

  submit(): void {
    const message = this.prompt.trim();
    if (!message) {
      this.error.set('質問を入力してください。');
      return;
    }

    this.isLoading.set(true);
    this.error.set('');

    this.http.post<ChatResponse>('/api/chat', { message }).subscribe({
      next: (response) => {
        this.answer.set(response.message);
        this.isLoading.set(false);
      },
      error: () => {
        this.error.set('バックエンド経由で AI の応答を取得できませんでした。');
        this.isLoading.set(false);
      },
    });
  }

  loadDocuments(): void {
    this.http.get<DocumentSummary[]>('/api/documents').subscribe({
      next: (documents) => this.documents.set(documents),
      // 一覧の取得失敗は致命的ではないので画面では黙殺する。
      error: () => this.documents.set([]),
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    this.uploadStatus.set('');
  }

  upload(): void {
    const file = this.selectedFile;
    if (!file) {
      this.uploadStatus.set('ファイルを選択してください。');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    this.isUploading.set(true);
    this.uploadStatus.set('');

    this.http.post<UploadResponse>('/api/documents', formData).subscribe({
      next: (response) => {
        this.uploadStatus.set(
          `「${response.source}」を取り込みました（${response.chunks} チャンク）。`,
        );
        this.isUploading.set(false);
        this.resetFileInput();
        this.loadDocuments();
      },
      error: () => {
        this.uploadStatus.set(
          'アップロードに失敗しました（.md / .txt / .pdf、最大 10MB。画像 PDF は不可）。',
        );
        this.isUploading.set(false);
      },
    });
  }

  removeDocument(source: string): void {
    this.http
      .delete(`/api/documents/${encodeURIComponent(source)}`)
      .subscribe({
        next: () => this.loadDocuments(),
        error: () => this.uploadStatus.set('削除に失敗しました。'),
      });
  }

  private resetFileInput(): void {
    this.selectedFile = null;
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }
}
