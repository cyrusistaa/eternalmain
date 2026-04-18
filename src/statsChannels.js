import { GatewayIntentBits } from "discord.js";
import { ENV } from "./env.js";
import { resolveGuildConfig } from "./commands.js";

function formatDateTR(now = new Date()) {
  const parts = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.day}.${map.month}.${map.year}`;
}

function countVoiceActive(guild) {
  let count = 0;
  for (const ch of guild.channels.cache.values()) {
    if (!ch.isVoiceBased?.()) continue;
    for (const m of ch.members?.values?.() ?? []) {
      if (!m.user?.bot) count++;
    }
  }
  return count;
}

async function countPresenceActive(guild) {
  // Requires GuildPresences intent + Developer Portal toggle to be meaningful.
  const members = await guild.members.fetch({ withPresences: true }).catch(() => null);
  if (!members) return null;
  let count = 0;
  for (const m of members.values()) {
    if (m.user.bot) continue;
    const status = m.presence?.status;
    if (status && status !== "offline") count++;
  }
  return count;
}

async function setNameIfChanged(client, channelId, name) {
  if (!channelId) return;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) return;
  if (!("setName" in ch)) return;
  if (ch.name === name) return;
  await ch.setName(name).catch(() => {});
}

export function startStatsChannelUpdater(client) {
  const intervalMs = Math.max(60, ENV.STATS_UPDATE_SECONDS) * 1000;

  async function tick() {
    for (const guild of client.guilds.cache.values()) {
      const g = await client.guilds.fetch(guild.id).catch(() => null);
      if (!g) continue;

      const cfg = resolveGuildConfig(g.id);
      const dateName = `Tarih: ${formatDateTR()}`;
      const totalName = `Toplam: ${g.memberCount}`;

      let active = null;
      const mode = (ENV.STATS_ACTIVE_MODE || "voice").toLowerCase();
      const hasPresenceIntent = client.options.intents?.has?.(GatewayIntentBits.GuildPresences);

      if (mode === "presence" && hasPresenceIntent) {
        active = await countPresenceActive(g);
      }
      if (active === null) {
        active = countVoiceActive(g);
      }

      const activeLabel =
        active === null
          ? "Aktif: ?"
          : mode === "voice"
            ? `Seste: ${active}`
            : `Aktif: ${active}`;

      await setNameIfChanged(client, cfg.stats_date_channel_id, dateName);
      await setNameIfChanged(client, cfg.stats_total_channel_id, totalName);
      await setNameIfChanged(client, cfg.stats_active_channel_id, activeLabel);
    }
  }

  tick();
  return setInterval(tick, intervalMs);
}
