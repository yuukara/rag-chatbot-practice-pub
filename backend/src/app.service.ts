import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { RagService } from './rag/rag.service';

type LlmChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

const BASE_SYSTEM_PROMPT =
  'あなたは日本語で回答するアシスタントです。思考過程や下書きは出力せず、最終回答だけを自然な日本語で返してください。箇条書きは使わず、必要最小限の長さで簡潔に答えてください。';

@Injectable()
export class AppService {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(private readonly ragService: RagService) {
    this.apiKey = process.env.OPENAI_API_KEY ?? 'lm-studio';
    this.baseURL = process.env.OPENAI_BASE_URL ?? 'http://host.docker.internal:1234/v1';
    this.model = process.env.OPENAI_MODEL ?? 'local-model';
    this.maxTokens = Number(process.env.OPENAI_MAX_TOKENS ?? '128');
    this.timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? '120000');
  }

  getMessage(): { message: string } {
    return {
      message:
        'このアプリケーションはrag-chatbotを開発するための雛形アプリです。',
    };
  }

  async chat(message: string): Promise<{ message: string }> {
    const systemPrompt = await this.buildSystemPrompt(message);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: message,
            },
          ],
          max_tokens: this.maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `LLM request failed with status ${response.status}: ${errorBody}`,
        );
      }

      const data = (await response.json()) as LlmChatCompletionResponse;
      const assistantMessage = data.choices?.[0]?.message;
      const content = this.normalizeAssistantMessage(
        assistantMessage?.content,
      );
      if (!content) {
        throw new Error('LLM response was empty.');
      }

      return { message: content };
    } catch (error) {
      console.error('Failed to fetch chat response', error);
      throw new InternalServerErrorException(
        'AI からの応答を取得できませんでした。',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * RAG が利用可能なら関連文書を検索し、参考情報を加えた system prompt を作る。
   * 検索結果が無い・RAG 無効のときは従来どおりの prompt を返す（後方互換）。
   */
  private async buildSystemPrompt(message: string): Promise<string> {
    const results = await this.ragService.retrieve(message);
    if (results.length === 0) {
      return BASE_SYSTEM_PROMPT;
    }

    const context = this.ragService.buildContext(results);
    return [
      BASE_SYSTEM_PROMPT,
      '次の参考情報をもとに回答してください。参考情報に答えが無い場合は、推測せず「分かりません」と答えてください。',
      '--- 参考情報 ---',
      context,
      '--- 参考情報ここまで ---',
    ].join('\n');
  }

  private normalizeAssistantMessage(content?: string | null): string {
    return content?.trim().replace(/\s+/g, ' ') ?? '';
  }
}
