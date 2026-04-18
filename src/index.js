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
  resolveGuildConfig,
  upsertGuildConfigPartial
} from "./commands.js";
import { registerCommands } from "./registerCommands.js";
import { isDmOptedOut, setDmOptOut } from "./db.js";
import { joinConfiguredVoiceChannel } from "./voice.js";
import { startStatsChannelUpdater } from "./statsChannels.js";
import { messageHasBadWord, messageHasLink } from "./automod.js";

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

const THEME = {
  accent: 0x0ea5e9,
  ok: 0x22c55e,
  warn: 0xf59e0b,
  err: 0xef4444
};

function pickWelcomeChannel(guild, channelId) {
  if (channelId) return guild.channels.cache.get(channelId) ?? null;
  if (guild.systemChannelId) return guild.channels.cache.get(guild.systemChannelId) ?? null;
  return null;
}

async function sendWelcome(guild, member) {
  const cfg = resolveGuildConfig(guild.id);
  const channel = pickWelcomeChannel(guild, cfg.welcome_channel_id);
  const text = `Sunucuya hos geldin ${member}!`;

  if (channel && channel.isTextBased() && "guild" in channel) {
    await channel
      .send({
        embeds: [
          {
            color: THEME.accent,
            title: "Yeni Uye",
            description: text,
            footer: { text: "Developed By Cyrus" },
            timestamp: new Date().toISOString()
          }
        ]
      })
      .catch(() => {});
  }

  await member
    .send({
      embeds: [
        {
          color: THEME.accent,
          title: `Hos geldin, ${member.user.username}!`,
          description:
            `Sunucuya girisin basarili.\n\n` +
            `Kayit olmak icin kayit paneline gidip **"Kayit Talebi Gonder"** butonuna basabilirsin.\n` +
            `Toplu DM'leri kapatmak istersen: \`/dm-optout durum:Kapat\``,
          fields: [
            { name: "Sunucu", value: `${guild.name}`, inline: true },
            { name: "Durum", value: "Aktif", inline: true }
          ],
          footer: { text: "Developed By Cyrus" },
          timestamp: new Date().toISOString()
        }
      ]
    })
    .catch(() => {});
}

async function sendLeave(guild, user) {
  const cfg = resolveGuildConfig(guild.id);
  const channel = pickWelcomeChannel(guild, cfg.welcome_channel_id);
  const label = user?.tag ?? (user?.id ? `<@${user.id}>` : "Bir uye");
  const text = `${label} sunucudan ayrildi.`;
  if (channel && channel.isTextBased() && "guild" in channel) {
    await channel
      .send({
        embeds: [
          {
            color: THEME.warn,
            title: "Uye Ayrildi",
            description: text,
            footer: { text: "Developed By Cyrus" },
            timestamp: new Date().toISOString()
          }
        ]
      })
      .catch(() => {});
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
    await interaction.reply({
      embeds: [
        {
          color: THEME.warn,
          title: "Lutfen Bekle",
          description: "Cok hizli denedin. Bir kac saniye sonra tekrar deneyebilirsin.",
          footer: { text: "Developed By Cyrus" },
          timestamp: new Date().toISOString()
        }
      ],
      ephemeral: true
    });
    return;
  }
  verifyCooldown.set(key, Date.now());

  const cfg = resolveGuildConfig(guild.id);

  // Ticket/private thread (optional): creates a private place for staff + user.
  if (cfg.ticket_parent_channel_id) {
    const parent = await guild.channels.fetch(cfg.ticket_parent_channel_id).catch(() => null);
    if (parent && parent.isTextBased && parent.isTextBased() && "send" in parent && "threads" in parent) {
      const base = `kayit-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const suffix = interaction.user.id.slice(-4);
      const threadName = `${base}-${suffix}`.slice(0, 90);

      const seed = await parent
        .send({
          embeds: [
            {
              color: THEME.accent,
              title: "Kayit Ticket",
              description: `Kullanici: ${interaction.user}\nYetkililer buradan ilgilenebilir.`,
              footer: { text: "Developed By Cyrus" },
              timestamp: new Date().toISOString()
            }
          ]
        })
        .catch(() => null);

      if (seed) {
        const thread = await seed
          .startThread({
            name: threadName,
            autoArchiveDuration: 1440, // 24h
            reason: "Kayit ticket"
          })
          .catch(() => null);

        if (thread) {
          await thread.members.add(interaction.user.id).catch(() => {});
          if (cfg.reg_staff_role_id) {
            await thread
              .send({
                content: `<@&${cfg.reg_staff_role_id}> Kayit talebi: ${interaction.user}`,
                allowedMentions: { roles: [cfg.reg_staff_role_id] }
              })
              .catch(() => {});
          }
        }
      }
    }
  }

  // "Kayitta biri var" gibi gorunmesi icin: butona basinca kanala @everyone pingli talep mesaji at.
  {
    const pingChannelId = cfg.staff_ping_channel_id ?? cfg.welcome_channel_id;
    const ch = pingChannelId ? await guild.channels.fetch(pingChannelId).catch(() => null) : null;
    if (ch && ch.isTextBased && ch.isTextBased() && "send" in ch) {
      await ch
        .send({
          content: `@everyone Kayit talebi var: ${interaction.user} panelden istek gonderdi.`,
          allowedMentions: { parse: ["everyone"] }
        })
        .catch(() => {});
    }
  }

  await interaction.reply({
    embeds: [
      {
        color: THEME.ok,
        title: "Kayit Talebi Gonderildi",
        description: "Talebin iletildi. Yetkililer seninle kisa sure icinde ilgilenecek.",
        footer: { text: "Developed By Cyrus" },
        timestamp: new Date().toISOString()
      }
    ],
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
    await interaction.editReply({
      embeds: [
        {
          color: THEME.err,
          title: "Yetki Eksik",
          description: "Bu komut icin botta `Manage Server` izni gerekli.",
          footer: { text: "Developed By Cyrus" },
          timestamp: new Date().toISOString()
        }
      ]
    });
    return;
  }

  const members = await guild.members.fetch();
  const targets = members
    .filter((m) => !m.user.bot && m.roles.cache.has(role.id))
    .map((m) => m.user.id)
    .filter((userId) => !isDmOptedOut({ guildId: guild.id, userId }));

  if (targets.length === 0) {
    await interaction.editReply({
      embeds: [
        {
          color: THEME.warn,
          title: "Hedef Bulunamadi",
          description: "Bu rolde kullanici yok ya da herkes opt-out yapmis olabilir.",
          footer: { text: "Developed By Cyrus" },
          timestamp: new Date().toISOString()
        }
      ]
    });
    return;
  }

  if (targets.length > DM_MAX_TARGETS) {
    await interaction.editReply({
      embeds: [
        {
          color: THEME.warn,
          title: "Hedef Limiti Asildi",
          description: `Hedef: ${targets.length}\nLimit: ${DM_MAX_TARGETS}\n\nLimit icin Railway'de \`DM_MAX_TARGETS\` ayarlayabilirsin.`,
          footer: { text: "Developed By Cyrus" },
          timestamp: new Date().toISOString()
        }
      ]
    });
    return;
  }

  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const key = `${guild.id}:${interaction.user.id}`;
  pendingDm.set(key, { token, roleId: role.id, message, targetIds: targets, createdAt: Date.now() });

  await interaction.editReply({
    embeds: [
      {
        color: THEME.warn,
        title: "DM Yayini Onayi",
        description: "Asagidakileri kontrol et. Eminsen **Gonder**'e bas.",
        fields: [
          { name: "Rol", value: `<@&${role.id}>`, inline: true },
          { name: "Hedef", value: `${targets.length}`, inline: true },
          { name: "Mesaj", value: message.slice(0, 1024), inline: false }
        ],
        footer: { text: "Developed By Cyrus" },
        timestamp: new Date().toISOString()
      }
    ],
    components: [buildDmConfirmRow(token)]
  });
}

async function handleDmConfirm(interaction, token, action) {
  const guild = interaction.guild;
  if (!guild) return;
  const key = `${guild.id}:${interaction.user.id}`;
  const pending = pendingDm.get(key);
  if (!pending || pending.token !== token) {
    await interaction.reply({
      embeds: [
        {
          color: THEME.warn,
          title: "Istek Bulunamadi",
          description: "Bu DM istegi bulunamadi ya da suresi doldu. `/dm` komutunu tekrar calistir.",
          footer: { text: "Developed By Cyrus" },
          timestamp: new Date().toISOString()
        }
      ],
      ephemeral: true
    });
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
    embeds: [
      {
        color: THEME.ok,
        title: "DM Yayini Tamamlandi",
        fields: [
          { name: "Basarili", value: `${ok}`, inline: true },
          { name: "Basarisiz", value: `${fail}`, inline: true },
          { name: "Atlandi", value: `${skipped}`, inline: true },
          { name: "Toplam", value: `${pending.targetIds.length}`, inline: true }
        ],
        footer: { text: "Developed By Cyrus" },
        timestamp: new Date().toISOString()
      }
    ],
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

  if (ENV.VOICE_CHANNEL_ID) {
    voiceConnection = await joinConfiguredVoiceChannel(client, ENV.VOICE_CHANNEL_ID).catch(() => null);
  }

  startStatsChannelUpdater(client);

  // Guild config voice channel override (if set via /kurulum) will be picked up
  // on next restart; keeping startup simple.
});

client.on("guildMemberAdd", async (member) => {
  // Auto-role for everyone who joins (best-effort).
  const cfg = resolveGuildConfig(member.guild.id);

  // Anti-raid quarantine (optional).
  if (!member.user.bot && cfg.quarantine_seconds && cfg.quarantine_seconds > 0) {
    if (member.moderatable) {
      await member
        .timeout(cfg.quarantine_seconds * 1000, "Anti-raid quarantine")
        .catch(() => {});
    }
  }

  const candidates = [];
  if (cfg.auto_role_id) candidates.push(cfg.auto_role_id);
  for (const id of ENV.AUTO_ROLE_IDS ?? []) candidates.push(id);
  const uniq = Array.from(new Set(candidates));
  if (uniq.length) {
    const roleId = uniq[Math.floor(Math.random() * uniq.length)];
    await member.roles.add(roleId).catch(() => {});
  }
  await sendWelcome(member.guild, member);
});

client.on("guildMemberRemove", async (member) => {
  const user = member.user ?? null;
  await sendLeave(member.guild, user);
});

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author?.bot) return;

    const cfg = resolveGuildConfig(message.guild.id);
    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) return;

    // Allow admins/mods to bypass automod.
    if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return;
    }

    const channelId = message.channelId;
    const linkBlocked = (cfg.link_block_channel_ids ?? []).includes(channelId);
    const hasLink = linkBlocked && messageHasLink(message.content);
    const hasBadWord = messageHasBadWord(message.content, cfg.bad_words);

    if (!hasLink && !hasBadWord) return;

    await message.delete().catch(() => {});

    const reason = hasBadWord ? "Yasakli kelime" : "Link engeli";
    const warn = await message.channel
      .send({
        embeds: [
          {
            color: THEME.warn,
            title: "Mesaj Kaldirildi",
            description: `${message.author} mesajin otomatik kaldirildi.\nSebep: ${reason}`,
            footer: { text: "Developed By Cyrus" },
            timestamp: new Date().toISOString()
          }
        ]
      })
      .catch(() => null);

    if (warn) {
      setTimeout(() => warn.delete().catch(() => {}), 10_000);
    }

    const timeoutSeconds = cfg.automod_timeout_seconds ?? 0;
    if (timeoutSeconds > 0 && member.moderatable) {
      await member
        .timeout(timeoutSeconds * 1000, `AutoMod: ${reason}`)
        .catch(() => {});
    }
  } catch {
    // best-effort
  }
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
      const regStaffRole = interaction.options.getRole("kayit_gorevli_rol");
      const regPingChannel = interaction.options.getChannel("kayit_ping_kanal");
      const autoRole = interaction.options.getRole("oto_rol");
      const statsDateCh = interaction.options.getChannel("istatistik_tarih_kanal");
      const statsTotalCh = interaction.options.getChannel("istatistik_toplam_kanal");
      const statsActiveCh = interaction.options.getChannel("istatistik_aktif_kanal");
      const voiceChannel = interaction.options.getChannel("ses_kanal");

      upsertGuildConfigPartial(guild.id, {
        welcome_channel_id: welcomeChannel?.id,
        reg_staff_role_id: regStaffRole?.id,
        staff_ping_channel_id: regPingChannel?.id,
        auto_role_id: autoRole?.id,
        stats_date_channel_id: statsDateCh?.id,
        stats_total_channel_id: statsTotalCh?.id,
        stats_active_channel_id: statsActiveCh?.id,
        voice_channel_id: voiceChannel?.id
      });

      const cfg = resolveGuildConfig(guild.id);
      await interaction.reply({
        embeds: [
          {
            color: THEME.accent,
            title: "Kurulum Guncellendi",
            fields: [
              {
                name: "Hos geldin kanali",
                value: cfg.welcome_channel_id ? `<#${cfg.welcome_channel_id}>` : "Yok",
                inline: true
              },
              {
                name: "Kayit ping kanali",
                value: cfg.staff_ping_channel_id ? `<#${cfg.staff_ping_channel_id}>` : "Yok",
                inline: true
              },
              {
                name: "Oto rol (tek)",
                value: cfg.auto_role_id ? `<@&${cfg.auto_role_id}>` : "Yok",
                inline: true
              },
              {
                name: "Ses kanali",
                value: cfg.voice_channel_id ? `<#${cfg.voice_channel_id}>` : "Yok",
                inline: true
              },
              {
                name: "Istatistik: Tarih",
                value: cfg.stats_date_channel_id ? `<#${cfg.stats_date_channel_id}>` : "Yok",
                inline: true
              },
              {
                name: "Istatistik: Toplam",
                value: cfg.stats_total_channel_id ? `<#${cfg.stats_total_channel_id}>` : "Yok",
                inline: true
              },
              {
                name: "Istatistik: Aktif",
                value: cfg.stats_active_channel_id ? `<#${cfg.stats_active_channel_id}>` : "Yok",
                inline: true
              }
            ],
            footer: { text: "Developed By Cyrus" },
            timestamp: new Date().toISOString()
          }
        ],
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

    if (interaction.commandName === "guvenlik-kur") {
      const guild = interaction.guild;
      if (!guild) return;

      const quarantineSeconds = interaction.options.getInteger("karantina_saniye");
      const ticketChannel = interaction.options.getChannel("ticket_kanal");
      const linkBlockRaw = interaction.options.getString("link_engel_kanallar");
      const badWordsRaw = interaction.options.getString("yasakli_kelimeler");
      const timeoutSeconds = interaction.options.getInteger("timeout_saniye");

      const linkIds = (linkBlockRaw ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const badWords = (badWordsRaw ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.toLowerCase());

      upsertGuildConfigPartial(guild.id, {
        quarantine_seconds: quarantineSeconds ?? undefined,
        ticket_parent_channel_id: ticketChannel?.id,
        link_block_channel_ids_json: linkBlockRaw === null ? undefined : JSON.stringify(linkIds),
        bad_words_json: badWordsRaw === null ? undefined : JSON.stringify(badWords),
        automod_timeout_seconds: timeoutSeconds ?? undefined
      });

      const cfg = resolveGuildConfig(guild.id);
      await interaction.reply({
        embeds: [
          {
            color: THEME.accent,
            title: "Guvenlik Guncellendi",
            fields: [
              {
                name: "Karantina sure",
                value: cfg.quarantine_seconds ? `${cfg.quarantine_seconds}s` : "Yok",
                inline: true
              },
              {
                name: "Ticket kanal",
                value: cfg.ticket_parent_channel_id ? `<#${cfg.ticket_parent_channel_id}>` : "Yok",
                inline: true
              },
              {
                name: "Link engel kanallar",
                value: cfg.link_block_channel_ids?.length ? `${cfg.link_block_channel_ids.length}` : "0",
                inline: true
              },
              {
                name: "Yasakli kelimeler",
                value: cfg.bad_words?.length ? `${cfg.bad_words.length}` : "0",
                inline: true
              },
              {
                name: "Timeout",
                value: cfg.automod_timeout_seconds ? `${cfg.automod_timeout_seconds}s` : "Kapali",
                inline: true
              }
            ],
            footer: { text: "Developed By Cyrus" },
            timestamp: new Date().toISOString()
          }
        ],
        ephemeral: true
      });
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
        await interaction.reply({
          embeds: [
            {
              color: THEME.warn,
              title: "Kanal Secimi",
              description: "Panel icin bir yazi kanali secmelisin.",
              footer: { text: "Developed By Cyrus" },
              timestamp: new Date().toISOString()
            }
          ],
          ephemeral: true
        });
        return;
      }

      await channel.send(buildVerifyPanel({ title, description: desc }));
      await interaction.reply({
        embeds: [
          {
            color: THEME.ok,
            title: "Panel Gonderildi",
            description: `Panel kanala gonderildi: <#${channel.id}>`,
            footer: { text: "Developed By Cyrus" },
            timestamp: new Date().toISOString()
          }
        ],
        ephemeral: true
      });
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
        embeds: [
          optedOut
            ? {
                color: THEME.warn,
                title: "DM Tercihi Guncellendi",
                description: "Toplu DM'ler kapatildi. (Opt-out aktif)",
                footer: { text: "Developed By Cyrus" },
                timestamp: new Date().toISOString()
              }
            : {
                color: THEME.ok,
                title: "DM Tercihi Guncellendi",
                description: "Toplu DM'ler acildi. (Opt-out kapali)",
                footer: { text: "Developed By Cyrus" },
                timestamp: new Date().toISOString()
              }
        ],
        ephemeral: true
      });
      return;
    }
  } catch {
    if (interaction.isRepliable()) {
      await interaction
        .reply({
          embeds: [
            {
              color: THEME.err,
              title: "Bir Hata Olustu",
              description: "Islem tamamlanamadi. Biraz sonra tekrar dene.",
              footer: { text: "Developed By Cyrus" },
              timestamp: new Date().toISOString()
            }
          ],
          ephemeral: true
        })
        .catch(() => {});
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
