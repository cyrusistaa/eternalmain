import { REST, Routes } from "discord.js";
import { ENV } from "./env.js";
import { buildCommands } from "./commands.js";

export async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(ENV.DISCORD_TOKEN);
  const json = buildCommands().map((c) => c.toJSON());

  if (ENV.GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(ENV.CLIENT_ID, ENV.GUILD_ID), { body: json });
    return { scope: "guild", id: ENV.GUILD_ID, count: json.length };
  }

  await rest.put(Routes.applicationCommands(ENV.CLIENT_ID), { body: json });
  return { scope: "global", count: json.length };
}

