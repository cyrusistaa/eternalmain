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

function optInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export const ENV = {
  DISCORD_TOKEN: must("DISCORD_TOKEN"),
  CLIENT_ID: must("CLIENT_ID"),
  GUILD_ID: opt("GUILD_ID"),

  WELCOME_CHANNEL_ID: opt("WELCOME_CHANNEL_ID"),
  VERIFY_ROLE_ID: opt("VERIFY_ROLE_ID"),
  VERIFY_DURATION_SECONDS: optInt("VERIFY_DURATION_SECONDS", 7 * 24 * 60 * 60),

  VOICE_CHANNEL_ID: opt("VOICE_CHANNEL_ID"),
  STREAM_URL: opt("STREAM_URL", "https://twitch.tv/cyrus")
};

