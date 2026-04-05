import {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { AudioPlayerStatus } from '@discordjs/voice';
import OpenAI from 'openai';
import { musicBot, searchTracks as searchYouTube } from './music_queue.js';
import dotenv from 'dotenv';

dotenv.config();

// ====== Discord Client ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// ====== Express health endpoint ======
import express from 'express';
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.status(200).json({ status: 'ok', uptime: client.uptime }));
app.listen(PORT, () => console.log(`🌐 Health check on port ${PORT}`));

// ====== OpenRouter ======
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/discord-bot',
    'X-Title': 'Discord Bot',
  },
});

const BOT_PREFIX = '!';
const AUTO_DELETE_MS = 10000; // 10s, set to 0 to disable
const MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4';
const conversations = new Map();

// ====== Ready ======
client.on('clientReady', () => {
  console.log(`✅ Bot ready as ${client.user.tag}`);
});

// ====== Voice state: auto-leave when bot is alone ======
client.on('voiceStateUpdate', (_, newState) => {
  if (newState.channelId === newState.guild.members.me.voice.channelId) {
    const result = musicBot.onVoiceStateUpdate(null, newState);
    if (result === 'left') {
      console.log(`[Voice] Leaving ${newState.guild.name} — bot is alone`);
    }
  }
});

// ====== Message handler ======
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith(BOT_PREFIX)) {
    await handleCommand(message);
    return;
  }
  if (message.channel.type === 'dm' || message.mentions.has(client.user) || message.reference) {
    await handleUserMessage(message);
  }
});

// ====== AI Chat handler ======
async function handleUserMessage(message) {
  if (!conversations.has(message.channel.id)) {
    conversations.set(message.channel.id, []);
  }
  const chat = conversations.get(message.channel.id);
  chat.push({ role: 'user', content: message.content });

  try {
    await message.channel.sendTyping();
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: chat.slice(-20), // Keep last 20 messages as context
    });
    const reply = response.choices[0]?.message?.content || '(no response)';
    chat.push({ role: 'assistant', content: reply });
    await message.reply(reply);
  } catch (err) {
    console.error('[AI Error]', err);
    await message.reply('❌ AI 回覆出錯');
  }
}

// ====== Button & Select menu interactions ======
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    await handleButton(interaction);
  }

  if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
  }
});

// ====== Command handler ======
async function handleCommand(message) {
  const args = message.content.slice(BOT_PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  switch (cmd) {
    case 'help': {
      await ephemeralReply(message, `**🤖 AI 聊天：** @提及 Bot 或 DM 即可

**🎵 音樂指令（需加入語音頻道）：**
${BOT_PREFIX}play <歌名/YouTube連結> — 搜尋並播放
${BOT_PREFIX}search <歌名>          — 搜尋並選擇
${BOT_PREFIX}join                   — 加入你的語音頻道
${BOT_PREFIX}leave                  — 離開語音頻道
${BOT_PREFIX}skip                   — 跳至下一首
${BOT_PREFIX}pause                  — 暫停播放
${BOT_PREFIX}resume                 — 繼續播放
${BOT_PREFIX}queue                  — 查看播放佇列
${BOT_PREFIX}np                     — 現在播放
${BOT_PREFIX}volume <0-100>         — 調整音量
${BOT_PREFIX}clear_queue            — 清空播放佇列
${BOT_PREFIX}remove <編號>            — 從佇列移除
${BOT_PREFIX}invite                 — 邀請 Bot 到伺服器
${BOT_PREFIX}clear                  — 清除 AI 對話記錄`);
      break;
    }

    case 'join': {
      const vc = message.member?.voice?.channel;
      if (!vc) { await ephemeralReply(message, '❌ 請先加入語音頻道'); break; }
      try {
        await musicBot.joinChannel(message.guild, vc);
        await ephemeralReply(message, '✅ 已加入語音頻道');
      } catch (e) {
        await ephemeralReply(message, `加入頻道失敗：${e.message}`);
      }
      break;
    }

    case 'leave': {
      await musicBot.disconnect(message.guild.id);
      await ephemeralReply(message, '👋 已離開語音頻道');
      break;
    }

    case 'play': {
      const query = args.join(' ');
      if (!query) { await ephemeralReply(message, '❌ 請輸入歌名或 YouTube 連結'); break; }

      await message.channel.sendTyping();

      let track;
      if (isYouTubeUrl(query)) {
        track = { title: query, artist: 'YouTube', url: query, duration: 0 };
      } else {
        const results = await searchYouTube(query, 1);
        if (!results.length) { await ephemeralReply(message, '❌ 找不到歌曲'); break; }
        track = results[0];
      }

      await ensureJoined(message);

      const result = await musicBot.addTrack(message.guild.id, track);
      if (result.playing) {
        await ephemeralReply(message, { content: `🎵 開始播放：**${track.title}**`, components: [makePlayerButtons()] });
      } else {
        await ephemeralReply(message, `已加入佇列 #${result.position}：**${track.title}**`);
      }
      break;
    }

    case 'search': {
      const query = args.join(' ');
      if (!query) { await ephemeralReply(message, '❌ 請輸入歌名'); break; }

      await message.channel.sendTyping();
      const results = await searchYouTube(query, 6);
      if (!results.length) { await ephemeralReply(message, '❌ 找不到歌曲'); break; }

      const select = new StringSelectMenuBuilder()
        .setCustomId('search_select')
        .setPlaceholder('選擇一首音樂')
        .addOptions(
          results.map((r, i) => ({
            label: r.title.length > 100 ? r.title.slice(0, 97) + '...' : r.title,
            description: `${r.artist} • ${formatDuration(r.duration)}`,
            value: `search_${i}`,
          }))
        );

      const msg = await message.channel.send({
        content: `🔍 搜尋 **「${query}」**：`,
        components: [new ActionRowBuilder().addComponents(select)],
      });
      // Store results for select handler
      message.channel._searchResults = results;
      message.channel._searchMsgId = msg.id;
      break;
    }

    case 'skip': {
      musicBot.skip(message.guild.id);
      const queue = musicBot.getQueue(message.guild.id);
      const msg = queue.length > 0
        ? `⏭️ 已跳至下一首：**${queue[0].title}**`
        : '⏭️ 已跳過（佇列為空）';
      await ephemeralReply(message, msg);
      break;
    }

    case 'pause': {
      musicBot.pause(message.guild.id);
      await ephemeralReply(message, '⏸️ 已暫停');
      break;
    }

    case 'resume': {
      musicBot.resume(message.guild.id);
      await ephemeralReply(message, '▶️ 已繼續');
      break;
    }

    case 'np': {
      const player = musicBot.getPlayer(message.guild.id);
      const current = player?.state.status === AudioPlayerStatus.Playing
        ? player.state.resource?.metadata : null;
      await ephemeralReply(message, { embeds: [nowPlayingEmbed(current, player?.state.status)] });
      break;
    }

    case 'queue': {
      const embed = musicBot.getQueueEmbed(message.guild.id);
      await ephemeralReply(message, { embeds: [embed] });
      break;
    }

    case 'volume': {
      const vol = parseInt(args[0]);
      if (isNaN(vol) || vol < 0 || vol > 100) { await ephemeralReply(message, '❌ 請輸入有效數字 (0-100)'); break; }
      musicBot.setVolume(message.guild.id, vol);
      await ephemeralReply(message, `🔊 音量設為 ${vol}%`);
      break;
    }

    case 'clear_queue': {
      musicBot.clearQueue(message.guild.id);
      await ephemeralReply(message, '🧹 佇列已清空');
      break;
    }

    case 'remove': {
      const idx = parseInt(args[0]) - 1;
      if (isNaN(idx)) { await ephemeralReply(message, '❌ 用法：`!remove <編號>`'); break; }
      if (!musicBot.isConnected(message.guild.id)) { await ephemeralReply(message, '❌ Bot 不在語音頻道'); break; }
      const removed = musicBot.removeTrack(message.guild.id, idx);
      if (removed === false) { await ephemeralReply(message, `❌ 佇列中沒有編號 ${idx + 1}`); break; }
      await ephemeralReply(message, `🗑️ 已移除：**${removed.title}**`);
      break;
    }

    case 'invite': {
      const clientId = process.env.DISCORD_CLIENT_ID || client.user.id;
      const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=315783301120&scope=bot%20applications.commands`;
      await message.reply(`🔗 **邀請連結：**\n${inviteUrl}`);
      break;
    }

    case 'clear': {
      conversations.delete(message.channel.id);
      await ephemeralReply(message, '🧹 對話記錄已清除');
      break;
    }

    default: {
      await ephemeralReply(message, `❓ 未知指令。輸入 ${BOT_PREFIX}help 查看。`);
    }
  }
}

async function handleButton(interaction) {
  const { customId, guild } = interaction;
  if (!customId.startsWith('sp_')) return;

  await interaction.deferReply({ ephemeral: true });

  const action = customId.replace('sp_', '');
  switch (action) {
    case 'pause':    musicBot.pause(guild.id); break;
    case 'resume':   musicBot.resume(guild.id); break;
    case 'skip':     musicBot.skip(guild.id); break;
    case 'np': {
      const player = musicBot.getPlayer(guild.id);
      const current = player?.state.status === AudioPlayerStatus.Playing
        ? player.state.resource?.metadata : null;
      await interaction.editReply({ embeds: [nowPlayingEmbed(current, player?.state.status)] });
      return;
    }
    default:
      return interaction.editReply({ content: '未知操作' });
  }
  await interaction.editReply({ content: '✅ 操作成功' });
}

async function handleSelectMenu(interaction) {
  if (interaction.customId !== 'search_select') return;

  const { guild, member, values, channel } = interaction;
  const selectedIdx = parseInt(values[0].replace('search_', ''));

  const results = channel._searchResults;
  if (!results || !results[selectedIdx]) {
    return interaction.reply({ ephemeral: true, content: '❌ 搜尋結果已過期' });
  }

  const track = results[selectedIdx];
  delete channel._searchResults;

  // Auto-join if needed
  const vc = member?.voice?.channel;
  if (vc && !musicBot.isConnected(guild.id)) {
    try {
      await musicBot.joinChannel(guild, vc);
    } catch (e) {
      return interaction.reply({ ephemeral: true, content: `加入頻道失敗：${e.message}` });
    }
  } else if (!vc) {
    return interaction.reply({ ephemeral: true, content: '❌ 請先加入語音頻道' });
  }

  try {
    await interaction.deferUpdate();
    const result = await musicBot.addTrack(guild.id, track);
    if (result.playing) {
      await interaction.followUp({ content: `🎵 開始播放：**${track.title}**`, components: [makePlayerButtons()] });
    } else {
      await interaction.followUp({ ephemeral: true, content: `已加入佇列 #${result.position}：**${track.title}**` });
    }
  } catch (e) {
    await interaction.followUp({ ephemeral: true, content: `加入失敗：${e.message}` });
  }
}

// ====== Helpers ======

async function ensureJoined(message) {
  const { guild, member } = message;
  const vc = member?.voice?.channel;
  if (vc && !musicBot.isConnected(guild.id)) {
    try {
      await musicBot.joinChannel(guild, vc);
    } catch (e) {
      await ephemeralReply(message, `加入頻道失敗：${e.message}`);
      return false;
    }
  } else if (!vc) {
    await ephemeralReply(message, '❌ 請先加入語音頻道');
    return false;
  }
  return true;
}

// Reply and auto-delete to simulate ephemeral behaviour
async function ephemeralReply(message, options) {
  if (!AUTO_DELETE_MS) return await message.reply(options);
  const res = await message.reply(options);
  setTimeout(() => res.delete().catch(() => {}), AUTO_DELETE_MS);
  return res;
}

function formatDuration(ms) {
  if (!ms) return '??:??';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function isYouTubeUrl(str) {
  return str.includes('youtube.com') || str.includes('youtu.be');
}

function nowPlayingEmbed(track, status) {
  if (!track) {
    return new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('🎵 目前沒有播放');
  }
  const isPlaying = status === AudioPlayerStatus.Playing;
  return new EmbedBuilder()
    .setColor(isPlaying ? 0x1DB954 : 0xFFA500)
    .setTitle(isPlaying ? '🎵 正在播放' : '⏸️ 已暫停')
    .addFields(
      { name: '歌曲', value: track.title },
      { name: '來源', value: track.artist || 'Unknown' }
    )
    .setTimestamp();
}

function makePlayerButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sp_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sp_resume').setEmoji('▶️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sp_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sp_np').setLabel('📻 現在播放').setStyle(ButtonStyle.Primary)
  );
}

// ====== Login ======
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ 請設定 DISCORD_TOKEN');
  process.exit(1);
}
client.login(token);
