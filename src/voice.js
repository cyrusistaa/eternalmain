import { joinVoiceChannel } from "@discordjs/voice";

export async function joinConfiguredVoiceChannel(client, channelId) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  if (!("guild" in channel)) return null;
  if (!channel.isVoiceBased()) return null;

  return joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false
  });
}

