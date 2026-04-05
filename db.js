import Database from 'better-sqlite3';
import { existsSync } from 'fs';

const DB_PATH = process.env.DB_PATH || './bot_memory.db';

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    channel_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
  );
`);

/**
 * Load a channel's conversation history.
 * Returns array of { role, content } sorted by order.
 */
export function loadConversation(channelId) {
  const rows = db
    .prepare('SELECT role, content FROM conversations WHERE channel_id = ? ORDER BY sort_order ASC')
    .all(channelId);
  return rows;
}

/**
 * Load all conversations from DB into a Map structure like `conversations`.
 */
export function loadAllConversations() {
  const rows = db.prepare('SELECT channel_id, role, content FROM conversations ORDER BY sort_order ASC').all();
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.channel_id)) map.set(row.channel_id, []);
    map.get(row.channel_id).push({ role: row.role, content: row.content });
  }
  return map;
}

/**
 * Append a single message to DB.
 * Uses last sort_order + 1 for the channel.
 */
const _insert = db.prepare(
  'INSERT INTO conversations (channel_id, role, content, sort_order) VALUES (?, ?, ?, COALESCE((SELECT MAX(sort_order) FROM conversations WHERE channel_id = ?), 0) + 1)'
);

export function appendMessage(channelId, role, content) {
  _insert.run(channelId, role, content, channelId);
}

/**
 * Append multiple messages in a single transaction.
 */
const _appendMany = db.transaction((channelId, messages) => {
  const base = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS base FROM conversations WHERE channel_id = ?').get(channelId).base;
  const stmt = db.prepare(
    'INSERT INTO conversations (channel_id, role, content, sort_order) VALUES (?, ?, ?, ?)'
  );
  messages.forEach((msg, i) => {
    stmt.run(channelId, msg.role, msg.content, base + i + 1);
  });
});

export function appendMany(channelId, messages) {
  if (messages.length) _appendMany(channelId, messages);
}

/**
 * Delete all messages for a channel.
 */
export function deleteConversation(channelId) {
  db.prepare('DELETE FROM conversations WHERE channel_id = ?').run(channelId);
}

/**
 * Trim a channel's history to the last N messages.
 */
export function trimConversation(channelId, keep) {
  db.prepare(`
    DELETE FROM conversations
    WHERE channel_id = ?
      AND sort_order NOT IN (
        SELECT sort_order FROM conversations
        WHERE channel_id = ?
        ORDER BY sort_order DESC
        LIMIT ?
      )
  `).run(channelId, channelId, keep);
}

export default db;
