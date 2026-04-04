import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import ytSearch from 'yt-search';
import { EmbedBuilder } from 'discord.js';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';

// yt-dlp path (forward slashes for spawn compatibility)
const ytDlpPath = process.env.YTDLP_PATH
  || 'C:/Users/harry/AppData/Local/Packages/PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0/LocalCache/local-packages/Python313/Scripts/yt-dlp.exe';

// Fix backslash paths from ffmpeg-static for Windows
const ffmpegExe = ffmpegPath.split('\\').join('/');

class MusicBot {
  constructor() {
    this.queues = new Map();
    this.players = new Map();
    this.connections = new Map();
  }

  initGuild(guildId) {
    if (!this.queues.has(guildId)) this.queues.set(guildId, []);
    if (!this.players.has(guildId)) {
      this.players.set(guildId, createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play },
      }));
      this.setupPlayer(guildId, this.players.get(guildId));
    }
  }

  setupPlayer(guildId, player) {
    player.on(AudioPlayerStatus.Idle, () => {
      this.cleanup(player.state.resource);
      const queue = this.queues.get(guildId);
      const next = queue?.shift();
      if (next) this.playTrack(guildId, next);
    });
    player.on('error', (err) => {
      console.error(`[Player ${guildId}] Error:`, err.message);
      this.cleanup(player.state.resource);
      const queue = this.queues.get(guildId);
      const next = queue?.shift();
      if (next) this.playTrack(guildId, next);
    });
  }

  async joinChannel(guild, channel) {
    this.initGuild(guild.id);
    const existing = this.connections.get(guild.id);
    if (existing) return existing;

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    this.connections.set(guild.id, connection);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20000);
      const player = this.players.get(guild.id);
      connection.subscribe(player);
      console.log(`[joinChannel] Connected & subscribed player for guild ${guild.id}`);
      return connection;
    } catch (err) {
      connection.destroy();
      this.connections.delete(guild.id);
      throw err;
    }
  }

  isConnected(guildId) {
    return this.connections.has(guildId);
  }

  async addTrack(guildId, trackInfo) {
    this.initGuild(guildId);
    const queue = this.queues.get(guildId);
    queue.push(trackInfo);

    const player = this.players.get(guildId);
    if (player.state.status === AudioPlayerStatus.Playing || player.state.status === AudioPlayerStatus.Buffering) {
      return { queued: true, position: queue.length, track: trackInfo };
    }

    const item = queue.shift();
    await this.playTrack(guildId, item);
    return { playing: true, track: item };
  }

  /** Get track metadata (duration) via yt-dlp JSON dump */
  async getTrackMetadata(url) {
    try {
      const proc = spawn(ytDlpPath, [
        '--no-playlist',
        '-J',
        url,
      ]);
      let json = '';
      proc.stdout.on('data', (d) => { json += d.toString(); });
      return new Promise((resolve) => {
        proc.on('close', () => {
          try {
            const data = JSON.parse(json);
            resolve({
              duration: data.duration ? data.duration * 1000 : 0,
              title: data.title || '',
              artist: data.channel || data.uploader || '',
            });
          } catch {
            resolve({ duration: 0, title: '', artist: '' });
          }
        });
      });
    } catch {
      return { duration: 0, title: '', artist: '' };
    }
  }

  /** Download audio with yt-dlp to temp webm file */
  downloadAudio(url) {
    const tmpPath = `${tmpdir()}/dmusic-${randomUUID()}.webm`;
    return new Promise((resolve, reject) => {
      const proc = spawn(ytDlpPath, [
        '--no-playlist',
        '-f', 'bestaudio[ext=webm]/bestaudio/best',
        '--no-warnings',
        '-o', tmpPath,
        url,
      ]);
      proc.stderr.on('data', (d) => {
        const m = d.toString().trim();
        if (m && !m.includes('ETA') && !m.includes('MiB') && !m.includes('KiB') && !m.includes('Unknown')) {
          console.log('[yt-dlp]', m);
        }
      });
      proc.on('error', (e) => reject(e));
      proc.on('close', (c) => c === 0 ? resolve(tmpPath) : reject(new Error(`yt-dlp exit ${c}`)));
    });
  }

  async playTrack(guildId, trackInfo) {
    const player = this.players.get(guildId);

    // Helper to play next on failure
    const tryNext = () => {
      const queue = this.queues.get(guildId);
      const next = queue?.shift();
      if (next) this.playTrack(guildId, next);
    };

    try {
      console.log(`[playTrack] Downloading: ${trackInfo.title}`);

      // Get metadata first (duration for lyrics sync)
      const metadata = await this.getTrackMetadata(trackInfo.url);
      trackInfo.duration = metadata.duration;

      const tmpPath = await this.downloadAudio(trackInfo.url);
      console.log(`[playTrack] Downloaded: ${tmpPath}`);

      // FFmpeg decodes .webm -> Raw PCM (s16le, 48kHz, stereo)
      // Then @discordjs/opus encodes PCM->Opus for Discord voice
      // This is the ONLY working approach with the available opus binaries
      const ff = spawn(ffmpegExe, [
        '-i', tmpPath,
        '-ar', '48000',
        '-ac', '2',
        '-f', 's16le',
        'pipe:1',
      ]);

      ff.stderr.on('data', (d) => {
        const m = d.toString().trim();
        if (m.includes('Error') || m.includes('error')) console.error('[FFmpeg]', m);
      });
      ff.on('error', (e) => console.error('[FFmpeg spawn]', e.message));
      ff.on('close', (c) => {
        if (c !== 0) console.error(`[FFmpeg] exited with code ${c}`);
      });

      const resource = createAudioResource(ff.stdout, {
        inputType: StreamType.Raw,
        inlineVolume: true,
        metadata: { ...trackInfo, tmpPath },
      });

      if (resource.volume) resource.volume.setVolume((trackInfo.volume || 50) / 100);

      // Track start time for lyrics sync
      player.play(resource);
      trackInfo.trackStartedAt = Date.now();
      trackInfo.totalPausedMs = 0;

      console.log(`[playTrack] Playing: ${trackInfo.title}`);
    } catch (e) {
      console.error(`[playTrack ${guildId}] Error:`, e.message);
      tryNext();
    }
  }

  /** Get the current elapsed position of the playing track (ms), accounting for pauses */
  getElapsedMs(guildId) {
    const player = this.players.get(guildId);
    const meta = player?.state?.resource?.metadata;
    if (!meta?.trackStartedAt) return 0;
    const paused = player?.state?.status === AudioPlayerStatus.Paused;
    const elapsed = Date.now() - meta.trackStartedAt - (meta.totalPausedMs || 0);
    return paused ? elapsed : Math.min(elapsed, meta.duration || Infinity);
  }

  async cleanup(resource) {
    if (resource?.metadata?.tmpPath) {
      try { await unlink(resource.metadata.tmpPath); } catch {}
    }
  }

  getPlayer(guildId) { return this.players.get(guildId); }
  getQueue(guildId) { return this.queues.get(guildId) || []; }

  getQueueEmbed(guildId) {
    const queue = this.queues.get(guildId) || [];
    const player = this.players.get(guildId);
    const playing = player?.state?.status === AudioPlayerStatus.Playing;
    const current = playing ? player.state.resource?.metadata : null;

    const lines = [];
    if (current) {
      lines.push(`🎵 **現在播放：** ${current.title}`);
      if (current.artist) lines.push(`   └ ${current.artist}`);
    }
    if (queue.length > 0) {
      lines.push(`\n**佇列 (${queue.length} 首)：**`);
      queue.slice(0, 10).forEach((t, i) => {
        lines.push(`${i + 1}. ${t.title}`);
      });
      if (queue.length > 10) lines.push(`... 還有 ${queue.length - 10} 首`);
    }
    if (lines.length === 0) lines.push('佇列為空');

    return new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('📜 播放佇列')
      .setDescription(lines.join('\n'))
      .setTimestamp();
  }

  clearQueue(guildId) { this.queues.set(guildId, []); }

  /**
   * Remove a track from the queue by index
   * Returns the removed track info, or false if not found
   */
  removeTrack(guildId, index) {
    const queue = this.queues.get(guildId);
    if (!queue || index < 0 || index >= queue.length) return false;
    const removed = queue.splice(index, 1)[0];
    return removed;
  }

  skip(guildId) {
    const p = this.players.get(guildId);
    if (p) p.stop();
  }

  pause(guildId) {
    const p = this.players.get(guildId);
    if (p?.state?.status === AudioPlayerStatus.Playing) {
      // Record pause start time for sync accuracy
      const meta = p.state.resource?.metadata;
      if (meta) {
        meta.pauseStartedAt = Date.now();
      }
      p.pause();
    }
  }

  resume(guildId) {
    const p = this.players.get(guildId);
    if (p?.state?.status === AudioPlayerStatus.Paused) {
      // Accumulate paused time
      const meta = p.state.resource?.metadata;
      if (meta?.pauseStartedAt) {
        meta.totalPausedMs = (meta.totalPausedMs || 0) + (Date.now() - meta.pauseStartedAt);
        delete meta.pauseStartedAt;
      }
      p.unpause();
    }
  }

  setVolume(guildId, percent) {
    const p = this.players.get(guildId);
    if (p?.state?.status === AudioPlayerStatus.Playing) {
      const v = p.state.resource?.volume;
      if (v) v.setVolume(Math.max(0, Math.min(100, percent)) / 100);
    }
  }

  async disconnect(guildId) {
    const p = this.players.get(guildId);
    if (p) { p.stop(); this.cleanup(p.state.resource); }
    const c = this.connections.get(guildId);
    if (c) { c.destroy(); this.connections.delete(guildId); }
    this.queues.set(guildId, []);
  }

  onVoiceStateUpdate(_, ns) {
    const ch = this.connections.get(ns.guild.id);
    if (!ch) return;
    const channel = ns.channel;
    if (channel && channel.members.filter(m => !m.user.bot).size === 0) {
      this.disconnect(ns.guild.id);
      return 'left';
    }
  }
}

export const musicBot = new MusicBot();

export async function searchTracks(query, limit = 5) {
  const result = await ytSearch(query);
  if (!result.videos.length) return [];
  return result.videos.slice(0, limit).map((v) => {
    let durationMs = 0;
    if (typeof v.seconds === 'number') durationMs = v.seconds * 1000;
    else if (v.timestamp) {
      const p = v.timestamp.split(':').map(Number);
      if (p.length === 3) durationMs = (p[0] * 3600 + p[1] * 60 + p[2]) * 1000;
      else if (p.length === 2) durationMs = (p[0] * 60 + p[1]) * 1000;
    }
    return { title: v.title, artist: v.author.name, url: v.url, duration: durationMs };
  });
}
