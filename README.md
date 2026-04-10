# Discord Claude Bot

Discord 聊天 + 音樂機器人，透過 OpenRouter 整合 Claude API。

## 功能

- AI 對話（支援多輪上下文）
- 聊天記錄持久化（重啟不遺失，SQLite）
- YouTube 音樂播放（搜尋、佇列、音量控制）
- 健康檢查端點（`/`）

## 環境變數

| 變數 | 必填 | 說明 |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Discord Bot Token |
| `OPENROUTER_API_KEY` | Yes | OpenRouter API Key |
| `OPENROUTER_MODEL` | No | 預設 `anthropic/claude-sonnet-4` |
| `DB_PATH` | No | SQLite 路徑，預設 `./bot_memory.db` |
| `PORT` | No | 健康檢查端口，預設 `3000` |

## 部署

### 方法一：Docker 本機執行

```bash
docker build -t discord-bot .

docker run -d \
  --name discord-bot \
  --restart unless-stopped \
  -e DISCORD_TOKEN=your-token \
  -e OPENROUTER_API_KEY=your-key \
  -v bot-data:/app/data \
  discord-bot
```

> **重要**：`-v bot-data:/app/data` 將 SQLite 資料庫掛載為 Docker volume，容器重啟或重建後對話記錄不會遺失。

### 方法二：GCP Compute Engine（e2-micro）

```bash
./deploy.sh your-gcp-project-id us-central1-a
```

此腳本會自動：
1. 建立 Docker 映像
2. 推送到 Google Container Registry
3. 建立或更新 e2-micro VM

**持久化 SQLite 資料** — SSH 進入 VM 後執行：

```bash
gcloud compute instances update-container discord-bot \
  --zone=us-central1-a \
  --container-mount-host-path=host-path=/home/discord-bot/data,mount-path=/app/data,mode=rw
```

## 使用方式

- **AI 聊天**：@提及 Bot 或私訊發送訊息
- **音樂**：加入語音頻道後使用 `!play <關鍵字/YouTube URL>`

### 指令列表

| 指令 | 說明 |
| --- | --- |
| `!help` | 顯示指令列表 |
| `!play <關鍵字/URL>` | 搜尋並播放音樂 |
| `!search <關鍵字>` | 搜尋音樂（選單選擇） |
| `!join` | 加入你的語音頻道 |
| `!leave` | 離開語音頻道 |
| `!skip` | 跳至下一首 |
| `!pause` | 暫停播放 |
| `!resume` | 繼續播放 |
| `!queue` | 查看播放佇列 |
| `!np` | 現在播放 |
| `!clear_queue` | 清空播放佇列 |
| `!remove <編號>` | 從佇列移除 |
| `!invite` | 邀請 Bot 到伺服器 |
| `!clear` | 清除 AI 對話記錄 |

## 注意事項

- 播放音樂需宿主機或容器內有 `yt-dlp`
- 健康檢查端點在 `:3000/`，可用於 GCP 健康探針
