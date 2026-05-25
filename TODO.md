# TODO / Design Notes

このドキュメントは、この雛形アプリを RAG chatbot に育てるまでの途中設計メモです。

## 現状

- `frontend`: Angular で単一画面を表示
- `backend`: NestJS で `GET /api/message` を返す
- `docker-compose.yml`: frontend と backend をまとめて起動
- 現在は固定メッセージを返すだけで、LLM 呼び出しや RAG は未実装

## 開発方針

いきなり RAG を実装せず、段階的に進める。

1. 固定レスポンスをやめて、LLM に問い合わせた結果を画面表示する
2. フロントから質問を送れるようにする
3. バックエンドで会話 API を受けて、LLM API を呼ぶ
4. 動作確認後に、外部知識を渡す RAG 構成へ進む

## 次のステップ

最初に実装する対象は「AI に質問して返答を表示する最小チャット」。

### 画面側

- 入力欄を追加する
- 送信ボタンを追加する
- ユーザー質問と AI 応答を表示する
- まずは 1 問 1 答でもよい

### API 側

- `POST /api/chat` を追加する
- リクエスト例:

```json
{
  "message": "RAG とは何ですか?"
}
```

- レスポンス例:

```json
{
  "message": "RAG は Retrieval-Augmented Generation の略です。"
}
```

### バックエンド実装方針

- LLM 呼び出しは backend のみで行う
- API キーや接続先情報は frontend に置かない
- provider 固有処理を controller に直書きせず、service に分離する

## 推奨構成

NestJS 側で LLM クライアントを 1 つ持ち、環境変数で接続先を切り替えられるようにする。

候補:

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

この構成にしておくと、OpenAI 本番 API と LM Studio ローカル API を同じコードで切り替えやすい。

## LM Studio 利用案

LM Studio はローカルで LLM API サーバーを立てられ、OpenAI-compatible endpoints を提供している。

公式ドキュメント:

- Local server overview: https://lmstudio.ai/docs/developer/core/server
- OpenAI-compatible endpoints: https://lmstudio.ai/docs/developer/openai-compat/
- API overview: https://lmstudio.ai/docs/api

### 実現イメージ

バックエンドから OpenAI SDK 互換の呼び出しを行い、接続先だけ LM Studio に切り替える。

- OpenAI 本番:
  - `OPENAI_BASE_URL=https://api.openai.com/v1`
- LM Studio:
  - `OPENAI_BASE_URL=http://host.docker.internal:1234/v1`

補足:

- backend は Docker コンテナ内で動くため、`localhost:1234` を見るとコンテナ自身を指す
- Windows + Docker Desktop + WSL 環境では、ホスト側の LM Studio に到達するには `host.docker.internal` を使う構成が有力
- LM Studio 側で API server を起動し、対象モデルをロードしておく必要がある

### LM Studio を使う利点

- OpenAI API 課金なしで試せる
- オフライン寄りの検証ができる
- OpenAI 互換 API のため、フロントとバックの配線を先に作りやすい

### 注意点

- モデル品質は OpenAI API と一致しない
- 応答速度や日本語性能は利用モデル依存
- 利用するモデル名は LM Studio 側でロードした識別子に合わせる必要がある
- 一部の OpenAI API 機能は完全互換でない可能性があるため、最初は単純なテキスト応答に限定する

## 推奨する実装順

1. `POST /api/chat` を追加する
2. backend で LLM service を作る
3. 環境変数で `baseUrl` と `model` を切り替えられるようにする
4. frontend に入力欄と応答表示を追加する
5. まず LM Studio 接続で動作確認する
6. 必要に応じて OpenAI API に切り替える
7. その後に RAG を追加する

## RAG 追加前の完了条件

以下が通れば、RAG の前段階は完了とみなせる。

- ブラウザから質問を送れる
- backend が LLM API を呼べる
- 応答を画面に表示できる
- 接続先を環境変数で切り替えられる

## RAG 設計(前段階の整理)

LLM 単体チャットの次の段階。既存の `POST /api/chat` を壊さず、RAG レイヤを「追加」する方針で設計する。
基本原則は現状を踏襲する: モデル API 呼び出しは backend のみ / provider は env で切り替え / 単発・履歴なし・streaming なし。

### 全体像(2 フェーズ)

1. インデックス作成(ingest): 文書 → 読み込み → チャンク分割 → embedding 化 → ベクトルストアへ保存
2. クエリ時(retrieve + generate): 質問 → embedding 化 → 類似検索(top-k)→ 取得チャンクをプロンプトに差し込み → 既存 `chat()` で生成

### 構成要素ごとの決定

1. 文書投入(ingestion)
   - ソース: backend 配下に `docs/` を置き、`.txt` / `.md` を読み込む(最小構成)
   - タイミング: まずは「起動時に一括ロード」で十分。必要なら後で明示的な再取り込みエンドポイントを足す
   - 後回し: アップロード API、URL 取り込み、PDF など

2. チャンク分割(chunking)
   - 方式: 文字数ベースの固定長 + オーバーラップ(目安 500–800 文字, overlap 100–150)
   - 理由: 日本語はトークナイザ依存が大きいので、まずは文字数で単純化する。見出し/段落境界を尊重する改良は後で
   - 各チャンクに source(ファイル名)と chunk index のメタ情報を持たせる

3. embeddings
   - 方式: OpenAI 互換 `/v1/embeddings` を既存 `OPENAI_BASE_URL` 経由で呼ぶ(chat と同じ provider 切り替え方針に乗る)
   - 追加 env: `OPENAI_EMBEDDING_MODEL`(LM Studio にロードした埋め込みモデル名)
   - 注意: chat モデルと埋め込みモデルは別物。LM Studio 側で埋め込みモデルを別途ロードしておく必要がある

4. ベクトルストア / 検索
   - 最小: インメモリ配列 + コサイン類似度(外部 DB 不要 = Docker 構成を変えない)
   - 検索: top-k(目安 k=3–4)、必要なら類似度しきい値
   - 移行先(必要になったら): JSON ファイル永続化 → さらに本格化で pgvector / Qdrant / Chroma

5. プロンプト構築(context injection)
   - 取得チャンクを「参考情報」として system もしくは user プロンプトに差し込む
   - 「参考情報に無い場合は分からないと答える」旨を足し、hallucination を抑える
   - 既存の日本語・簡潔指示の system prompt を踏襲する

### 既存コードへの統合方針(壊さない)

- 既存 `POST /api/chat` と `AppService.chat()` はそのまま温存する
- RAG は別レイヤとして追加する想定:
  - `EmbeddingService`(`/v1/embeddings` 呼び出し)
  - `VectorStoreService`(チャンク保持 + 類似検索)
  - `IngestService`(docs ロード → chunk → embed → store)
  - retrieval ステップを chat の前段に置く(`RagService`、または chat に分岐を足す)
- 後方互換: RAG 無効時(docs 無し / env 未設定)は現行どおり単発チャットとして動く

### 追加環境変数(案)

- `OPENAI_EMBEDDING_MODEL`
- `RAG_DOCS_DIR`(default `./docs`)
- `RAG_CHUNK_SIZE` / `RAG_CHUNK_OVERLAP`
- `RAG_TOP_K`

### RAG 前段階の完了条件(受け入れ基準)

- docs をロードして chunk + embedding 化できる
- 質問に対し top-k チャンクを取得できる
- 取得結果をプロンプトに差し込んで回答が返る
- RAG 無効でも既存 `POST /api/chat` がそのまま動く(回帰なし)

### 実装順(案)

1. ✅ `OPENAI_EMBEDDING_MODEL` を足し、`/v1/embeddings` を 1 件呼べることを確認
   - 確定: 埋め込みモデル ID = `text-embedding-nomic-embed-text-v1.5`(LM Studio にロード済み)
   - ベクトル次元 = 768。本番経路(backend → `host.docker.internal:1234/v1/embeddings`)で疎通確認済み
2. ✅ `docs/` ロード + チャンク分割(`backend/src/rag/chunk.util.ts`、文字数ベース)
3. ✅ インメモリのベクトルストア + コサイン類似度検索(`vector-store.service.ts`)
4. ✅ ingest(起動時 `OnModuleInit`)で全チャンクを embedding 化して保持(`ingest.service.ts`)
5. ✅ chat の前段に retrieval を足し、参考情報をプロンプトへ差し込み(`rag.service.ts` + `app.service.ts`)
6. ✅ 動作確認済み。既存単発チャット(一般質問)も回帰なしで動作

### 実装済みの構成(2026-05-25)

- backend に `src/rag/` を追加: `EmbeddingService` / `VectorStoreService` / `IngestService` / `RagService` を `RagModule` で束ね、`AppModule` から利用
- `AppService.chat()` は検索結果があれば「参考情報」を system prompt に差し込み、無ければ従来どおり。**RAG 無効時(埋め込みモデル未設定・docs 無し・検索失敗)は既存チャットがそのまま動く**
- `backend/docs/` にサンプル 3 本(`rag.md` / `this-app.md` / `lm-studio.md`)。`Dockerfile` の runner で `docs/` を同梱
- 追加 env(`docker-compose.yml` 既定): `OPENAI_EMBEDDING_MODEL` / `RAG_TOP_K=4` / `RAG_CHUNK_SIZE=300` / `RAG_CHUNK_OVERLAP=60`
- `RagService.retrieve()` はヒットした出典とスコアを LOG 出力(検索品質の観察用)

### 検証で分かった課題（重要）

- 配線は正しく、エンドツーエンドで動作する(例: 「フロントエンドは何で作られているか」→ docs から「Angular」と回答)
- ただし **`text-embedding-nomic-embed-text-v1.5` は日本語の識別性能が弱い**。無関係なチャンクまで類似度が 0.60〜0.72 に密集し、答えを含むチャンク(例: 768 を含む `lm-studio.md#1`、NestJS を含む `this-app.md#1`)が上位に来ず、`topK` を 6 まで上げても拾えない
- これはチャンク分割や `topK` の調整では解決しない。**埋め込みモデルの差し替え**が本質的な対策

### 解決: bge-m3 へ差し替え（2026-05-25）

- `OPENAI_EMBEDDING_MODEL` を `text-embedding-bge-m3`（BAAI/bge-m3, 1024 次元, プレフィックス不要）に変更し、LM Studio にロードして再評価
- 結果、日本語の識別が大幅改善:
  - 「次元数は?」→ 答えを含む `lm-studio.md#1` が **1位(0.541)** に。回答も正しく取得できるようになった
  - 「バックエンドのフレームワークは?」→ `this-app.md#1`(NestJS) が **2位(0.569)** で取得され正答
  - 無関係な一般質問はスコアが 0.26〜0.29 と明確に低く、関連/無関連をきちんと区別できている（nomic は全て 0.60〜0.72 に密集していた）
- サンプル文書 `lm-studio.md` の記述も実態（bge-m3 / 1024）に更新済み
- 結論: **日本語 RAG には bge-m3 が有効**。コードは変更不要で、モデルのロードと env 差し替えだけで切替できた（provider 抽象の狙いどおり）

### pgvector へ移行（2026-05-25）

インメモリのベクトルストアを pgvector(PostgreSQL 拡張)に置き換えた。

- `docker-compose.yml` に `db` サービス追加: `pgvector/pgvector:pg16`、`pgdata` ボリューム、healthcheck(`pg_isready`)。backend は `depends_on: db (service_healthy)`
- `VectorStoreService` を `pg`(node-postgres, ORM なし)で再実装。`chunks(source, chunk_index, content, embedding vector(N))` + HNSW(`vector_cosine_ops`)。検索はコサイン距離 `<=>`、`score = 1 - 距離`
- 埋め込み次元はベクトルから自動検出してテーブルを作り直す(768↔1024 を吸収)。起動時に再 ingest するので常に現在の docs/モデルに一致
- 接続は `DATABASE_URL`(既定 `postgres://rag:ragpass@db:5432/ragdb`)。DB 未接続時は ingest/retrieve が失敗しても RAG 無効でチャット継続
- インターフェイスを保ったため `IngestService` / `RagService` の変更は最小(search が async 化した程度)
- 確認済み: 拡張 vector 0.8.2 / `chunks` 9 行 / `vector(1024)` / HNSW、(A)1024・(B)NestJS・(C)一般質問とも正常

## 文書アップロード機能の設計（バックエンド実装済み / フロント UI は次）

ブラウザからファイルをアップロードして RAG の知識を増やせるようにする。
現状は `docs/` をイメージ同梱・起動時一括 ingest のみなので、「ビルド時固定 → 実行時取り込み」へ広げる。
**バックエンドは実装・検証済み**（下記）。次はフロントの UI。

### バックエンド実装状況（2026-05-25 完了）

- `POST/GET/DELETE /api/documents` を実装（`DocumentsController`）
- `VectorStoreService` を `ensureSchema`/`add`/`deleteBySource`/`listSources`/`search`/`dropTable` に再構成。テーブル未作成でも検索は空配列を返す
- `IngestService.ingestText(source, content)` を共通化し、起動時 ingest とアップロードで再利用
- 起動時は DROP せず `docs/` を source 単位で置き換え取り込み → アップロード文書は再起動後も残る（検証済み）
- `RAG_RESET=true` で起動時にテーブルを作り直す（次元変更時）
- 検証: アップロード→質問で回答／再起動後も保持／DELETE で削除→以後は回答不可／一般質問の回帰OK

### 方針の要点

- 既存の `POST /api/chat` と単発チャットは壊さない。RAG 無効時の後方互換も維持
- pgvector の `chunks` テーブルを**起動時に DROP しない**運用へ変更（アップロード分が再起動で消えないように）
- ingest 処理を再利用可能にして、起動時の `docs/` 取り込みとアップロードの両方で使う

### テーブルのライフサイクル変更

- `reset()`（DROP+CREATE）→ `ensureSchema(dim)`（`CREATE TABLE/INDEX IF NOT EXISTS`）へ。起動のたびに消さない
- 起動時は **`docs/` の各ファイルだけ「source 単位で delete → 再 ingest」**（同名は置き換え）。`docs/` の編集は反映され、アップロード由来の source は触らないので残る
- モデル変更で埋め込み次元が変わった場合の作り直し用に `RAG_RESET=true` を用意（起動時に一度だけ DROP）

### API（バックエンド）

- `POST /api/documents`（multipart, フィールド `file`）: `.md` / `.txt` を受け取り chunk → embed → 該当 source を置き換えで保存。応答 `{ source, chunks }`
- `GET /api/documents`: 取り込み済み source 一覧（`{ source, chunks }[]`）。後続の UI 用
- `DELETE /api/documents/:source`: 指定 source のチャンクを削除。応答 `{ source, deleted }`
- 検証: 拡張子 `.md`/`.txt` のみ、埋め込みモデル未設定なら 400、サイズ上限を設定

### サービス構成（`backend/src/rag/`）

- `VectorStoreService`: `ensureSchema(dim)` / `add` / `deleteBySource` / `listSources` / `search`（テーブル未作成時は空配列で耐える）/ `dropTable`
- `IngestService`: 共通の `ingestText(source, content)` を持ち、起動時ループとアップロードの両方から呼ぶ
- `DocumentsController`: 上記 API を担当（`RagModule` に登録）

### スコープ外（この回はやらない）

- フロントのアップロード UI（次の回）
- PDF / docx などのパーサ（まずは `.md`/`.txt`）
- 原本ファイルの保持（今はベクトルのみ保存。再 embedding 用に原本を持つのは後続）
- 内容ハッシュによる差分判定（今は起動時に `docs/` を毎回置き換え。コストは同梱数本のみで許容）

### 既存の改善候補（任意・継続）

- 一般質問でも低スコアのチャンクが毎回プロンプトに差し込まれている。**類似度しきい値**で上位スコアが低いときは注入しない
- 起動時の `docs/` 再 ingest を内容ハッシュで差分化（毎回 re-embedding しない）
- チャンク境界を見出し/段落で尊重する分割への改良

### 未決事項 / 確認したいこと

- サンプル文書(`docs/` の中身)は誰が用意するか
- LM Studio 側に埋め込みモデルをロードできるか(できなければ埋め込み手段を別途決める)
- ingest を起動時固定にするか、明示エンドポイント化するか

## 実装時の補足

最初から複雑にしない。

- 会話履歴は後回しでよい
- streaming も後回しでよい
- まずは単発の質問応答を通す
- provider 切り替え可能な形にしておく

## 現在の到達点

- `POST /api/chat` は実装済み
- LM Studio の `openai/gpt-oss-20b` で安定して応答できている
- backend は `chat/completions` を直接呼び、重い後処理は入れていない
- `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_MAX_TOKENS` は `.env` で切り替えられる

## 直近の結論

- ローカル LM Studio 利用なので、クラウド API のようなレート制限は基本気にしなくてよい
- RAG の最小構成を実装し、エンドツーエンドで動作することを確認済み(既存チャットの回帰なし)
- 埋め込みモデルを `text-embedding-bge-m3` に差し替え、日本語の検索品質が実用レベルに改善(768 / NestJS とも正答)
- 動作する RAG ベースラインが完成。次の改善候補は「類似度しきい値の導入」「再 ingest 手段」「分割の改良」(いずれも任意・後回し可)
