import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "bot.sqlite");
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    welcome_channel_id TEXT,
    verify_role_id TEXT,
    verify_duration_seconds INTEGER,
    voice_channel_id TEXT,
    reg_staff_role_id TEXT,
    staff_ping_channel_id TEXT,
    auto_role_id TEXT,
    stats_date_channel_id TEXT,
    stats_total_channel_id TEXT,
    stats_active_channel_id TEXT,
    quarantine_role_id TEXT,
    quarantine_seconds INTEGER,
    ticket_parent_channel_id TEXT,
    link_block_channel_ids TEXT,
    bad_words TEXT,
    automod_timeout_seconds INTEGER
  );

  CREATE TABLE IF NOT EXISTS dm_optout (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS temp_roles (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, role_id)
  );

  CREATE INDEX IF NOT EXISTS idx_temp_roles_expires
    ON temp_roles (guild_id, expires_at_ms);
`);

// Lightweight migration for older DBs (safe to run every boot).
for (const col of [
  "reg_staff_role_id TEXT",
  "staff_ping_channel_id TEXT",
  "auto_role_id TEXT",
  "stats_date_channel_id TEXT",
  "stats_total_channel_id TEXT",
  "stats_active_channel_id TEXT",
  "quarantine_role_id TEXT",
  "quarantine_seconds INTEGER",
  "ticket_parent_channel_id TEXT",
  "link_block_channel_ids TEXT",
  "bad_words TEXT",
  "automod_timeout_seconds INTEGER"
]) {
  try {
    db.exec(`ALTER TABLE guild_config ADD COLUMN ${col};`);
  } catch {
    // column already exists
  }
}

const stmtGetGuild = db.prepare(
  "SELECT guild_id, welcome_channel_id, verify_role_id, verify_duration_seconds, voice_channel_id, reg_staff_role_id, staff_ping_channel_id, auto_role_id, stats_date_channel_id, stats_total_channel_id, stats_active_channel_id, quarantine_role_id, quarantine_seconds, ticket_parent_channel_id, link_block_channel_ids, bad_words, automod_timeout_seconds FROM guild_config WHERE guild_id = ?"
);
const stmtUpsertGuild = db.prepare(`
  INSERT INTO guild_config (guild_id, welcome_channel_id, verify_role_id, verify_duration_seconds, voice_channel_id, reg_staff_role_id, staff_ping_channel_id, auto_role_id, stats_date_channel_id, stats_total_channel_id, stats_active_channel_id, quarantine_role_id, quarantine_seconds, ticket_parent_channel_id, link_block_channel_ids, bad_words, automod_timeout_seconds)
  VALUES (@guild_id, @welcome_channel_id, @verify_role_id, @verify_duration_seconds, @voice_channel_id, @reg_staff_role_id, @staff_ping_channel_id, @auto_role_id, @stats_date_channel_id, @stats_total_channel_id, @stats_active_channel_id, @quarantine_role_id, @quarantine_seconds, @ticket_parent_channel_id, @link_block_channel_ids, @bad_words, @automod_timeout_seconds)
  ON CONFLICT(guild_id) DO UPDATE SET
    welcome_channel_id = excluded.welcome_channel_id,
    verify_role_id = excluded.verify_role_id,
    verify_duration_seconds = excluded.verify_duration_seconds,
    voice_channel_id = excluded.voice_channel_id,
    reg_staff_role_id = excluded.reg_staff_role_id,
    staff_ping_channel_id = excluded.staff_ping_channel_id,
    auto_role_id = excluded.auto_role_id,
    stats_date_channel_id = excluded.stats_date_channel_id,
    stats_total_channel_id = excluded.stats_total_channel_id,
    stats_active_channel_id = excluded.stats_active_channel_id,
    quarantine_role_id = excluded.quarantine_role_id,
    quarantine_seconds = excluded.quarantine_seconds,
    ticket_parent_channel_id = excluded.ticket_parent_channel_id,
    link_block_channel_ids = excluded.link_block_channel_ids,
    bad_words = excluded.bad_words,
    automod_timeout_seconds = excluded.automod_timeout_seconds
`);

export function getGuildConfig(guildId) {
  return stmtGetGuild.get(guildId) ?? null;
}

export function setGuildConfig(cfg) {
  stmtUpsertGuild.run(cfg);
}

const stmtUpsertTempRole = db.prepare(`
  INSERT INTO temp_roles (guild_id, user_id, role_id, expires_at_ms)
  VALUES (@guild_id, @user_id, @role_id, @expires_at_ms)
  ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET
    expires_at_ms = excluded.expires_at_ms
`);
const stmtDeleteTempRole = db.prepare(
  "DELETE FROM temp_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?"
);
const stmtListExpired = db.prepare(
  "SELECT guild_id, user_id, role_id, expires_at_ms FROM temp_roles WHERE guild_id = ? AND expires_at_ms <= ? ORDER BY expires_at_ms ASC LIMIT 100"
);
const stmtListUser = db.prepare(
  "SELECT role_id, expires_at_ms FROM temp_roles WHERE guild_id = ? AND user_id = ? ORDER BY expires_at_ms ASC"
);

export function upsertTempRole({ guildId, userId, roleId, expiresAtMs }) {
  stmtUpsertTempRole.run({
    guild_id: guildId,
    user_id: userId,
    role_id: roleId,
    expires_at_ms: expiresAtMs
  });
}

export function deleteTempRole({ guildId, userId, roleId }) {
  stmtDeleteTempRole.run(guildId, userId, roleId);
}

export function listExpiredTempRoles({ guildId, nowMs }) {
  return stmtListExpired.all(guildId, nowMs);
}

export function listUserTempRoles({ guildId, userId }) {
  return stmtListUser.all(guildId, userId);
}

const stmtIsOptedOut = db.prepare("SELECT 1 AS v FROM dm_optout WHERE guild_id = ? AND user_id = ? LIMIT 1");
const stmtSetOptOut = db.prepare(
  "INSERT OR IGNORE INTO dm_optout (guild_id, user_id) VALUES (?, ?)"
);
const stmtClearOptOut = db.prepare("DELETE FROM dm_optout WHERE guild_id = ? AND user_id = ?");

export function isDmOptedOut({ guildId, userId }) {
  return Boolean(stmtIsOptedOut.get(guildId, userId)?.v);
}

export function setDmOptOut({ guildId, userId, optedOut }) {
  if (optedOut) stmtSetOptOut.run(guildId, userId);
  else stmtClearOptOut.run(guildId, userId);
}
