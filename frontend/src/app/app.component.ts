import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Component, signal } from '@angular/core';

type ChatResponse = {
  message: string;
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  readonly answer = signal(
    'LM Studio または OpenAI-compatible API に質問を送る準備ができています。',
  );
  readonly error = signal('');
  readonly isLoading = signal(false);
  prompt = 'RAG とは何ですか?';

  constructor(private readonly http: HttpClient) {}

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
}
