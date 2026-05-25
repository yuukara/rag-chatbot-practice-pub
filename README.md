# rag-chatbot-practice-pub

Angular と NestJS を Docker Compose で起動する、RAG chatbot 開発用の練習アプリです。
OpenAI 互換 API（ローカルの LM Studio を想定）に質問を送り、回答を画面に表示します。
さらに `backend/docs/` に置いたドキュメントを検索して回答に反映する、最小構成の **RAG（検索拡張生成）** を実装しています。

## 構成

- `frontend`: Angular アプリ。質問を送って回答を表示する単一画面。ビルド後は nginx で配信し、`/api/` をバックエンドにプロキシします。
- `backend`: NestJS API サーバー。`POST /api/chat` を受け、OpenAI 互換 API を呼んで回答を返します。RAG 処理は `backend/src/rag/` にあります。
- `backend/docs/`: RAG の知識ソース（`.md` / `.txt`）。起動時に読み込まれます。
- `db`: pgvector 拡張入りの PostgreSQL（`pgvector/pgvector:pg16`）。チャンクのベクトルを保存・検索します。
- `docker-compose.yml`: フロントエンド・バックエンド・DB をまとめて起動します。

モデル API の呼び出しはバックエンドだけが行い、API キーや接続先はフロントエンドに置きません。

## 前提条件

- Git
- Docker Desktop など、Docker Compose が使える Docker 環境
- [LM Studio](https://lmstudio.ai/)（または他の OpenAI 互換 API サーバー）
  - **チャット用モデル**（例: `openai/gpt-oss-20b`）をロード
  - **埋め込み用モデル**（例: `text-embedding-bge-m3`）をロード ※RAG を使う場合
  - LM Studio の API サーバーを起動（標準ポート `1234`）

> チャット用と埋め込み用は別のモデルです。RAG を使うには両方をロードしてください。
> 日本語の検索精度には埋め込みモデルの選択が大きく影響します（`text-embedding-bge-m3` を推奨）。

## セットアップと起動

### 1. リポジトリをクローンする

```bash
git clone https://github.com/actiom-inc/rag-chatbot-practice-pub.git
cd rag-chatbot-practice-pub
```

### 2. `.env` を用意する

リポジトリ直下に `.env` を作成し、接続先とモデル名を設定します（`.env` は Git 管理外です）。

```dotenv
OPENAI_BASE_URL=http://host.docker.internal:1234/v1
OPENAI_API_KEY=lm-studio
OPENAI_MODEL=openai/gpt-oss-20b
OPENAI_MAX_TOKENS=384
OPENAI_EMBEDDING_MODEL=text-embedding-bge-m3
```

`OPENAI_EMBEDDING_MODEL` を空にすると RAG は無効になり、ドキュメント検索なしの単発チャットとして動作します。

### 3. LM Studio を準備する

LM Studio でチャット用モデルと埋め込み用モデルをロードし、API サーバーを起動します。
バックエンドは Docker コンテナ内で動くため、ホスト上の LM Studio へは `host.docker.internal` 経由で接続します（`localhost` ではコンテナ自身を指します）。

### 4. Docker Compose で起動する

```bash
docker compose up --build
```

初回はビルドと依存インストールで数分かかる場合があります。

### 5. ブラウザで確認する

```text
http://localhost:8080
```

入力欄に質問を入力して送信すると、バックエンド経由で回答が表示されます。
`backend/docs/` の内容に関する質問（例:「このアプリのバックエンドは何で作られていますか?」）をすると、検索結果に基づいて回答します。

API だけ確認する場合:

```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"RAG とは何ですか?"}'
```

### 6. 停止する

起動中のターミナルで `Ctrl + C`、またはバックグラウンド起動時は以下を実行します。

```bash
docker compose down
```

## 環境変数

`docker-compose.yml` に既定値を持ち、`.env` で上書きできます。

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `OPENAI_BASE_URL` | `http://host.docker.internal:1234/v1` | OpenAI 互換 API の接続先 |
| `OPENAI_API_KEY` | `lm-studio` | API キー（LM Studio では任意の文字列で可） |
| `OPENAI_MODEL` | `local-model` | チャット用モデル名 |
| `OPENAI_MAX_TOKENS` | `128` | 回答の最大トークン数 |
| `OPENAI_EMBEDDING_MODEL` | （空） | 埋め込み用モデル名。空なら RAG 無効 |
| `RAG_TOP_K` | `4` | 検索で取得するチャンク数 |
| `RAG_CHUNK_SIZE` | `300` | チャンクの文字数 |
| `RAG_CHUNK_OVERLAP` | `60` | チャンク間のオーバーラップ文字数 |
| `DATABASE_URL` | `postgres://rag:ragpass@db:5432/ragdb` | pgvector(PostgreSQL)の接続先 |
| `RAG_RESET` | `false` | `true` で起動時に `chunks` テーブルを作り直す（埋め込みモデル/次元を変えたとき用） |

DB の認証情報は `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`（既定: `rag` / `ragpass` / `ragdb`）で変更できます。変更時は `DATABASE_URL` も合わせてください。PostgreSQL はコンテナとして自動起動するので、別途インストールは不要です。

## API

### `GET /api/message`

固定メッセージを返す疎通確認用エンドポイント。

### `POST /api/chat`

質問を送ると回答が返ります。

リクエスト:

```json
{ "message": "RAG とは何ですか?" }
```

レスポンス:

```json
{ "message": "RAG は Retrieval-Augmented Generation の略です。" }
```

### 文書管理 API

RAG の知識ソースを実行時に追加・確認・削除できます（`.md` / `.txt`、最大 1MB）。

```bash
# 一覧（source とチャンク数）
curl http://localhost:8080/api/documents

# アップロード（その場で取り込み）
curl -X POST http://localhost:8080/api/documents -F "file=@./note.md"
#=> {"source":"note.md","chunks":2}

# 削除
curl -X DELETE http://localhost:8080/api/documents/note.md
#=> {"source":"note.md","deleted":2}
```

アップロードした文書は pgvector に保存され、**再起動をまたいで残ります**。同名で再アップロードすると置き換えられます。

## RAG の仕組み

1. **起動時（ingest）**: `backend/docs/` の `.md` / `.txt` を読み込み、文字数ベースでチャンク分割し、埋め込みモデルでベクトル化して **pgvector の `chunks` テーブル**に保存します（埋め込み次元はモデルから自動検出し、HNSW インデックスを作成）。
2. **質問時（retrieve）**: 質問をベクトル化し、pgvector のコサイン距離（`<=>`）で関連チャンクを `RAG_TOP_K` 件取得します。
3. **生成**: 取得したチャンクを「参考情報」としてプロンプトに差し込み、チャットモデルに回答させます。

ベクトルの保存・検索は pgvector（PostgreSQL 拡張）で行います。起動時はテーブルを丸ごと消さず、**同梱の `docs/` 各ファイルだけを source 単位で取り込み直し**ます。そのため `docs/` の編集を反映するには再ビルド・再起動が必要ですが（`docs/` はイメージ同梱）、アップロードした文書は別 source として `pgdata` ボリュームに残ります。埋め込みモデル（次元）を変えたときは `RAG_RESET=true` で起動して作り直してください。

埋め込みモデルが未設定、`docs/` が空、検索に失敗した場合は、RAG なしの単発チャットとして動作します。
