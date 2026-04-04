import {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
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

// ====== Express health endpoint for Render ======
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
const MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4';
const conversations = new Map();

// ====== Ready ======
client.on('ready', () => {
  console.log(`✅ Bot ready as ${client.user.tag}`);
});

// ====== Voice state: auto-leave when bot is alone ======
client.on('voiceStateUpdate', (_, newState) => {
  if (newState.channelId === newState.guild.members.me.voice.channelId) {
    // Someone left, check if bot is alone
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

// ====== Button interactions ======
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const { customId, guild } = interaction;
  if (!customId.startsWith('sp_') || !guild) return;

  await interaction.deferReply({ ephemeral: true });

  const action = customId.replace('sp_', '');
  switch (action) {
    case 'pause':  musicBot.pause(guild.id); break;
    case 'resume': musicBot.resume(guild.id); break;
    case 'skip':   musicBot.skip(guild.id); break;
    case 'np': {
      const player = musicBot.getPlayer(guild.id);
      const current = player.state.status === AudioPlayerStatus.Playing
        ? player.state.resource?.metadata : null;
      await interaction.editReply({
        embeds: [nowPlayingEmbed(current, player.state.status)],
      });
      return;
    }
    default:
      await interaction.editReply({ content: '未知操作' });
      return;
  }
  await interaction.editReply({ content: '✅ 操作成功' });
});

// ====== Command handler ======
async function handleCommand(message) {
  const args = message.content.slice(BOT_PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  if (cmd === 'clear') {
    conversations.delete(message.channel.id);
    await message.reply('🧹 對話記錄已清除');
    return;
  }

  if (cmd === 'help') {
    await message.reply({ content: `
**🤖 AI 聊天：** 直接 @Bot 或 DM 即可聊天

**🎵 音樂指令（需加入語音頻道）：**
${BOT_PREFIX}join                   — 加入你的語音頻道
${BOT_PREFIX}leave                  — 離開語音頻道
${BOT_PREFIX}play <歌名/YouTube連結> — 搜尋並播放
${BOT_PREFIX}skip                   — 跳至下一首
${BOT_PREFIX}pause                  — 暫停播放
${BOT_PREFIX}resume                 — 繼續播放
${BOT_PREFIX}queue                  — 查看播放佇列
${BOT_PREFIX}np                     — 現在播放
${BOT_PREFIX}volume <0-100>         — 調整音量
${BOT_PREFIX}clear_queue            — 清空佇列
` });
    return;
  }

  const musicCmds = ['join', 'leave', 'play', 'skip', 'pause', 'resume', 'queue', 'np', 'volume', 'clear_queue'];
  if (musicCmds.includes(cmd)) {
    await handleMusicCommand(message, cmd, args);
    return;
  }

  await message.reply(`❓ 未知指令。輸入 ${BOT_PREFIX}help 查看。`);
}

// ====== Music commands ======
async function handleMusicCommand(message, cmd, args) {
  const { guild, member } = message;
  if (!guild) return;

  const vc = member?.voice?.channel;

  // Auto-join for play/spotify commands
  const autoJoinCmds = ['play'];
  if (autoJoinCmds.includes(cmd)) {
    if (!vc) {
      await message.reply('❌ 請先加入語音頻道再使用此指令');
      return;
    }
    if (musicBot.isConnected(guild.id)) {
      // already connected, continue
    } else {
      try {
        await musicBot.joinChannel(guild, vc);
      } catch (e) {
        await message.reply(`加入頻道失敗：${e.message}`);
        return;
      }
    }
  }

  switch (cmd) {
    case 'join': {
      if (!vc) { await message.reply('❌ 請先加入語音頻道'); return; }
      await message.reply('✅ 已加入語音頻道');
      break;
    }

    case 'leave': {
      await musicBot.disconnect(guild.id);
      await message.reply('👋 已離開語音頻道');
      break;
    }

    case 'play': {
      const query = args.join(' ');
      if (!query) { await message.reply('❌ 請輸入歌名或 YouTube 連結'); return; }

      await message.channel.sendTyping();

      let track;
      if (isYouTubeUrl(query)) {
        track = { title: query, artist: 'YouTube', url: query, duration: 0 };
      } else {
        const results = await searchYouTube(query, 1);
        if (!results.length) { await message.reply('❌ 找不到歌曲'); return; }
        track = results[0];
      }

      if (!track) { await message.reply('❌ 找不到歌曲'); return; }

      const result = await musicBot.addTrack(guild.id, track);
      if (result.playing) {
        await message.reply({ content: `🎵 開始播放：**${track.title}**`, components: [makePlayerButtons()] });
      } else {
        await message.reply(`已加入佇列 #${result.position}：**${track.title}**`);
      }
      break;
    }

    case 'skip': {
      musicBot.skip(guild.id);
      const queue = musicBot.getQueue(guild.id);
      if (queue.length > 0) {
        await message.reply(`⏭️ 已跳至下一首：**${queue[0].title}**`);
      } else {
        await message.reply('⏭️ 已跳過（佇列為空）');
      }
      break;
    }

    case 'pause': {
      musicBot.pause(guild.id);
      await message.reply('⏸️ 已暫停');
      break;
    }

    case 'resume': {
      musicBot.resume(guild.id);
      await message.reply('▶️ 已繼續');
      break;
    }

    case 'np': {
      const player = musicBot.getPlayer(guild.id);
      const current = player.state.status === AudioPlayerStatus.Playing
        ? player.state.resource?.metadata : null;
      await message.reply({ embeds: [nowPlayingEmbed(current, player.state.status)] });
      break;
    }

    case 'queue': {
      const embed = musicBot.getQueueEmbed(guild.id);
      await message.reply({ embeds: [embed] });
      break;
    }

    case 'volume': {
      const vol = parseInt(args[0]);
      if (isNaN(vol) || vol < 0 || vol > 100) { await message.reply('❌ 請輸入有效數字 (0-100)'); return; }
      musicBot.setVolume(guild.id, vol);
      await message.reply(`🔊 音量設為 ${vol}%`);
      break;
    }

    case 'clear_queue': {
      musicBot.clearQueue(guild.id);
      await message.reply('🧹 佇列已清空');
      break;
    }
  }
}

// ====== AI Chat ======
async function handleUserMessage(message) {
  let userMessage = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
  if (!userMessage) return;

  const loadingMsg = await message.channel.send('🤔 思考中...');

  try {
    const key = message.channel.id;
    if (!conversations.has(key)) conversations.set(key, []);
    const history = conversations.get(key);
    history.push({ role: 'user', content: userMessage });

    const response = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: '你是一個友善的 AI 助手，整合於 Discord。用繁體中文回答。' },
        ...history,
      ],
      max_tokens: 2048,
      model: MODEL,
    });

    const assistantMessage = response.choices[0].message.content;
    history.push({ role: 'assistant', content: assistantMessage });
    if (history.length > 20) conversations.set(key, history.slice(-20));

    if (loadingMsg.deletable) await loadingMsg.delete().catch(() => {});
    if (assistantMessage.length > 2000) {
      for (let i = 0; i < assistantMessage.length; i += 2000) {
        await message.channel.send(assistantMessage.slice(i, i + 2000));
      }
    } else {
      await message.channel.send(assistantMessage);
    }
  } catch (e) {
    console.error('AI Error:', e);
    await loadingMsg.edit('❌ 發生錯誤').catch(() => {});
  }
}

// ====== Helpers ======
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
