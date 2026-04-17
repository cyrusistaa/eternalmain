import {
  ActivityType,
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits
} from "discord.js";
import { ENV } from "./env.js";
import {
  buildVerifyPanel,
  buildDmConfirmRow,
  CUSTOM_IDS,
  formatUserTempRoles,
  resolveGuildConfig,
  upsertGuildConfigPartial
} from "./commands.js";
import { registerCommands } from "./registerCommands.js";
import { isDmOptedOut, setDmOptOut, upsertTempRole } from "./db.js";
import { startTempRoleSweeper } from "./tempRoleSweeper.js";
import { joinConfiguredVoiceChannel } from "./voice.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

let voiceConnection = null;
const pendingDm = new Map(); // key: `${guildId}:${userId}` -> { token, roleId, message, targetIds, createdAt }

const DM_MAX_TARGETS = Number.parseInt(process.env.DM_MAX_TARGETS ?? "200", 10) || 200;
const VERIFY_COOLDOWN_MS = 10_000;
const verifyCooldown = new Map(); // key: `${guildId}:${userId}` -> lastMs

function pickWelcomeChannel(guild, channelId) {
  if (channelId) return guild.channels.cache.get(channelId) ?? null;
  if (guild.systemChannelId) return guild.channels.cache.get(guild.systemChannelId) ?? null;
  return null;
}

async function sendWelcome(guild, member) {
  const cfg = resolveGuildConfig(guild.id);
  const channel = pickWelcomeChannel(guild, cfg.welcome_channel_id);
  const text = `Hos geldin ${member}!`;

  if (channel && channel.isTextBased() && "guild" in channel) {
    await channel.send({ content: text }).catch(() => {});
  }

  await member
    .send(
      `Hos geldin! Sunucuya girisin basarili.\nGerekirse panel butonundan gecici erisim alabilirsin.`
    )
    .catch(() => {});
}

async function sendLeave(guild, user) {
  const cfg = resolveGuildConfig(guild.id);
  const channel = pickWelcomeChannel(guild, cfg.welcome_channel_id);
  const label = user?.tag ?? (user?.id ? `<@${user.id}>` : "Bir uye");
  const text = `${label} ayrildi.`;
  if (channel && channel.isTextBased() && "guild" in channel) {
    await channel.send({ content: text }).catch(() => {});
  }
}

async function handleVerifyButton(interaction) {
  const guild = interaction.guild;
  if (!guild) return;
  const member = interaction.member;
  if (!member || !("roles" in member)) return;

  const key = `${guild.id}:${interaction.user.id}`;
  const last = verifyCooldown.get(key) ?? 0;
  if (Date.now() - last < VERIFY_COOLDOWN_MS) {
    await interaction.reply({ content: "Biraz bekle ve tekrar dene.", ephemeral: true });
    return;
  }
  verifyCooldown.set(key, Date.now());

  const cfg = resolveGuildConfig(guild.id);
  if (!cfg.verify_role_id) {
    await interaction.reply({
      content: "Panel rolu ayarlanmis degil. `/kurulum panel_rol:` ile ayarla.",
      ephemeral: true
    });
    return;
  }

  const durationSec = cfg.verify_duration_seconds ?? ENV.VERIFY_DURATION_SECONDS;
  const expiresAtMs = Date.now() + durationSec * 1000;

  await member.roles.add(cfg.verify_role_id).catch(() => null);
  upsertTempRole({
    guildId: guild.id,
    userId: member.user.id,
    roleId: cfg.verify_role_id,
    expiresAtMs
  });

  await interaction.reply({
    content: `Rol verildi: <@&${cfg.verify_role_id}> (bitis: <t:${Math.floor(
      expiresAtMs / 1000
    )}:R>)`,
    ephemeral: true
  });
}

async function handleDmRole(interaction) {
  const guild = interaction.guild;
  if (!guild) return;
  const role = interaction.options.getRole("rol", true);
  const message = interaction.options.getString("mesaj", true);

  await interaction.deferReply({ ephemeral: true });

  const me = await guild.members.fetchMe();
  const can = me.permissions.has(PermissionFlagsBits.ManageGuild);
  if (!can) {
    await interaction.editReply("Bu komut icin botta `Manage Server` izni lazim.");
    return;
  }

  const members = await guild.members.fetch();
  const targets = members
    .filter((m) => !m.user.bot && m.roles.cache.has(role.id))
    .map((m) => m.user.id)
    .filter((userId) => !isDmOptedOut({ guildId: guild.id, userId }));

  if (targets.length === 0) {
    await interaction.editReply("Hedef bulunamadi (ya rol yok ya da herkes opt-out).");
    return;
  }

  if (targets.length > DM_MAX_TARGETS) {
    await interaction.editReply(
      `Hedef cok fazla: ${targets.length}. Limit: ${DM_MAX_TARGETS}. (DM_MAX_TARGETS env ile degisebilir)`
    );
    return;
  }

  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const key = `${guild.id}:${interaction.user.id}`;
  pendingDm.set(key, { token, roleId: role.id, message, targetIds: targets, createdAt: Date.now() });

  await interaction.editReply({
    content:
      `DM yayini onayi:\n` +
      `- rol: <@&${role.id}>\n` +
      `- hedef: ${targets.length}\n` +
      `- mesaj:\n${message}\n\n` +
      `Gondermek icin butona bas.`,
    components: [buildDmConfirmRow(token)]
  });
}

async function handleDmConfirm(interaction, token, action) {
  const guild = interaction.guild;
  if (!guild) return;
  const key = `${guild.id}:${interaction.user.id}`;
  const pending = pendingDm.get(key);
  if (!pending || pending.token !== token) {
    await interaction.reply({ content: "Bu DM istegi bulunamadi ya da suresi doldu.", ephemeral: true });
    return;
  }

  if (action === "cancel") {
    pendingDm.delete(key);
    await interaction.update({ content: "Iptal edildi.", components: [] }).catch(async () => {
      await interaction.reply({ content: "Iptal edildi.", ephemeral: true });
    });
    return;
  }

  await interaction.update({ content: "Gonderiliyor... (bu islem biraz surebilir)", components: [] });

  let ok = 0;
  let fail = 0;
  let skipped = 0;

  for (const userId of pending.targetIds) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      fail++;
      continue;
    }
    if (!member.roles.cache.has(pending.roleId)) {
      skipped++;
      continue;
    }
    if (isDmOptedOut({ guildId: guild.id, userId })) {
      skipped++;
      continue;
    }

    const sent = await member.send(pending.message).then(
      () => true,
      () => false
    );
    if (sent) ok++;
    else fail++;
    await new Promise((r) => setTimeout(r, 1100));
  }

  pendingDm.delete(key);
  await interaction.followUp({
    content: `DM yayini bitti. Basarili: ${ok}, Basarisiz: ${fail}, Atlandi: ${skipped}, Hedef: ${pending.targetIds.length}`,
    ephemeral: true
  });
}

client.once("ready", async () => {
  client.user.setPresence({
    activities: [
      {
        name: "Developed By Cyrus",
        type: ActivityType.Streaming,
        url: ENV.STREAM_URL
      }
    ],
    status: "online"
  });

  startTempRoleSweeper(client);

  if (ENV.VOICE_CHANNEL_ID) {
    voiceConnection = await joinConfiguredVoiceChannel(client, ENV.VOICE_CHANNEL_ID).catch(() => null);
  }

  // Guild config voice channel override (if set via /kurulum) will be picked up
  // on next restart; keeping startup simple.
});

client.on("guildMemberAdd", async (member) => {
  await sendWelcome(member.guild, member);
});

client.on("guildMemberRemove", async (member) => {
  const user = member.user ?? null;
  await sendLeave(member.guild, user);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === CUSTOM_IDS.VERIFY_BUTTON) {
        await handleVerifyButton(interaction);
        return;
      }

      if (interaction.customId.startsWith(CUSTOM_IDS.DM_CONFIRM_PREFIX)) {
        const token = interaction.customId.slice(CUSTOM_IDS.DM_CONFIRM_PREFIX.length);
        await handleDmConfirm(interaction, token, "confirm");
        return;
      }

      if (interaction.customId.startsWith(CUSTOM_IDS.DM_CANCEL_PREFIX)) {
        const token = interaction.customId.slice(CUSTOM_IDS.DM_CANCEL_PREFIX.length);
        await handleDmConfirm(interaction, token, "cancel");
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "kurulum") {
      const guild = interaction.guild;
      if (!guild) return;

      const welcomeChannel = interaction.options.getChannel("hosgeldin_kanal");
      const verifyRole = interaction.options.getRole("panel_rol");
      const duration = interaction.options.getInteger("sure_saniye");
      const voiceChannel = interaction.options.getChannel("ses_kanal");

      upsertGuildConfigPartial(guild.id, {
        welcome_channel_id: welcomeChannel?.id,
        verify_role_id: verifyRole?.id,
        verify_duration_seconds: duration ?? undefined,
        voice_channel_id: voiceChannel?.id
      });

      const cfg = resolveGuildConfig(guild.id);
      await interaction.reply({
        content:
          `Ayarlar guncellendi.\n` +
          `- hosgeldin kanal: ${cfg.welcome_channel_id ? `<#${cfg.welcome_channel_id}>` : "yok"}\n` +
          `- panel rol: ${cfg.verify_role_id ? `<@&${cfg.verify_role_id}>` : "yok"}\n` +
          `- sure: ${cfg.verify_duration_seconds}s\n` +
          `- ses kanal: ${cfg.voice_channel_id ? `<#${cfg.voice_channel_id}>` : "yok"}`,
        ephemeral: true
      });

      if (voiceChannel?.isVoiceBased?.()) {
        try {
          voiceConnection?.destroy?.();
        } catch {}
        voiceConnection = await joinConfiguredVoiceChannel(client, voiceChannel.id).catch(() => null);
      }
      return;
    }

    if (interaction.commandName === "panel-kur") {
      const guild = interaction.guild;
      if (!guild) return;

      const channel =
        interaction.options.getChannel("kanal") ??
        pickWelcomeChannel(guild, resolveGuildConfig(guild.id).welcome_channel_id);
      const title = interaction.options.getString("baslik") ?? undefined;
      const desc = interaction.options.getString("aciklama") ?? undefined;

      if (!channel || !channel.isTextBased() || !("guild" in channel)) {
        await interaction.reply({ content: "Panel icin bir yazi kanali sec.", ephemeral: true });
        return;
      }

      await channel.send(buildVerifyPanel({ title, description: desc }));
      await interaction.reply({ content: `Panel gonderildi: <#${channel.id}>`, ephemeral: true });
      return;
    }

    if (interaction.commandName === "dm") {
      await handleDmRole(interaction);
      return;
    }

    if (interaction.commandName === "dm-optout") {
      const guild = interaction.guild;
      if (!guild) return;
      const durum = interaction.options.getString("durum", true);
      const optedOut = durum === "kapat";
      setDmOptOut({ guildId: guild.id, userId: interaction.user.id, optedOut });
      await interaction.reply({
        content: optedOut
          ? "Toplu DM'ler kapatildi. (Opt-out aktif)"
          : "Toplu DM'ler acildi. (Opt-out kapali)",
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "surem") {
      const guild = interaction.guild;
      if (!guild) return;
      const text = formatUserTempRoles(guild.id, interaction.user.id);
      await interaction.reply({ content: text, ephemeral: true });
      return;
    }
  } catch {
    if (interaction.isRepliable()) {
      await interaction.reply({ content: "Bir hata oldu.", ephemeral: true }).catch(() => {});
    }
  }
});

const main = async () => {
  await registerCommands();
  await client.login(ENV.DISCORD_TOKEN);
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
