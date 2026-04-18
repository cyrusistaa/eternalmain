import dotenv from "dotenv";

dotenv.config();

function must(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function opt(name, fallback = undefined) {
  const value = process.env[name];
  return value ?? fallback;
}

function optCsv(name) {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const ENV = {
  DISCORD_TOKEN: must("DISCORD_TOKEN"),
  CLIENT_ID: must("CLIENT_ID"),
  GUILD_ID: opt("GUILD_ID"),

  WELCOME_CHANNEL_ID: opt("WELCOME_CHANNEL_ID"),
  REG_STAFF_ROLE_ID: opt("REG_STAFF_ROLE_ID"),
  STAFF_PING_CHANNEL_ID: opt("STAFF_PING_CHANNEL_ID"),
  AUTO_ROLE_ID: opt("AUTO_ROLE_ID"),
  AUTO_ROLE_IDS: optCsv("AUTO_ROLE_IDS"),

  STATS_DATE_CHANNEL_ID: opt("STATS_DATE_CHANNEL_ID"),
  STATS_TOTAL_CHANNEL_ID: opt("STATS_TOTAL_CHANNEL_ID"),
  STATS_ACTIVE_CHANNEL_ID: opt("STATS_ACTIVE_CHANNEL_ID"),
  STATS_UPDATE_SECONDS: Number.parseInt(opt("STATS_UPDATE_SECONDS", "300"), 10) || 300,
  STATS_ACTIVE_MODE: opt("STATS_ACTIVE_MODE", "voice"), // presence | voice

  QUARANTINE_SECONDS: Number.parseInt(opt("QUARANTINE_SECONDS", "0"), 10) || 0,
  TICKET_PARENT_CHANNEL_ID: opt("TICKET_PARENT_CHANNEL_ID"),
  LINK_BLOCK_CHANNEL_IDS: optCsv("LINK_BLOCK_CHANNEL_IDS"),
  BAD_WORDS: optCsv("BAD_WORDS").map((w) => w.toLowerCase()),
  AUTOMOD_TIMEOUT_SECONDS: Number.parseInt(opt("AUTOMOD_TIMEOUT_SECONDS", "0"), 10) || 0,

  VOICE_CHANNEL_ID: opt("VOICE_CHANNEL_ID"),
  STREAM_URL: opt("STREAM_URL", "https://twitch.tv/cyrus")
};
