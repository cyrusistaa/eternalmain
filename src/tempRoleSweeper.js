import { deleteTempRole, listExpiredTempRoles } from "./db.js";

export function startTempRoleSweeper(client) {
  async function tick() {
    try {
      const nowMs = Date.now();
      for (const guild of client.guilds.cache.values()) {
        const expired = listExpiredTempRoles({ guildId: guild.id, nowMs });
        if (!expired.length) continue;

        const g = await client.guilds.fetch(guild.id);
        for (const row of expired) {
          try {
            const member = await g.members.fetch(row.user_id).catch(() => null);
            if (member) {
              await member.roles.remove(row.role_id).catch(() => {});
            }
          } finally {
            deleteTempRole({ guildId: row.guild_id, userId: row.user_id, roleId: row.role_id });
          }
        }
      }
    } catch {
      // best-effort
    }
  }

  tick();
  return setInterval(tick, 30_000);
}

