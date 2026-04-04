# Discord Claude Bot

透過 OpenRouter 整合 Claude API 的 Discord 機器人

## 設定步驟

### 1. 建立 Discord Bot

1. 前往 https://discord.com/developers/applications
2. 建立新應用程式
3. 前往 "Bot" 頁面，複製 Token
4. 前往 "OAuth2 > URL Generator"，勾選 `bot` 和 `applications.commands`
5. 在权限中勾選：
   - Send Messages
   - Read Message History
   - Embed Links
6. 用產生的邀請連結邀請 Bot 到伺服器

### 2. 取得 OpenRouter API Key

1. 前往 https://openrouter.ai/
2. 登入後取得 API Key
3. 可選擇任何模型，預設使用 `anthropic/claude-4.5-sonnet:free`

### 3. 設定環境變數

```bash
cp .env.example .env
```

編輯 `.env`，填入你的 Token：

```
DISCORD_TOKEN=你的-discord-bot-token
OPENROUTER_API_KEY=你的-openrouter-api-key
OPENROUTER_MODEL=anthropic/claude-4.5-sonnet:free
```

> 可選的 `OPENROUTER_MODEL` 設定：
> - `anthropic/claude-4.5-sonnet:free`（免費）
> - `anthropic/claude-sonnet-4`
> - `anthropic/claude-opus-4`
> - `google/gemini-2.5-pro`
> - 更多模型見 https://openrouter.ai/models

### 4. 執行 Bot

```bash
npm start
```

## 使用方式

- **伺服器中**：@提及 Bot 或回覆 Bot 的訊息即可對話
- **私人訊息**：直接發送訊息即可對話

## 指令

| 指令 | 說明 |
|------|------|
| `!clear` | 清除對話記錄 |
| `!help` | 顯示指令列表 |
