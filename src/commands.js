import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  SlashCommandBuilder
} from "discord.js";
import { ENV } from "./env.js";
import { getGuildConfig, setGuildConfig, listUserTempRoles } from "./db.js";

export const CUSTOM_IDS = {
  VERIFY_BUTTON: "verify:claim",
  DM_CONFIRM_PREFIX: "dm:confirm:",
  DM_CANCEL_PREFIX: "dm:cancel:"
};

export function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName("kurulum")
      .setDescription("Bot ayarlari (hosgeldin kanali, panel rolu, sure, ses kanali).")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
      .addChannelOption((opt) =>
        opt
          .setName("hosgeldin_kanal")
          .setDescription("Giris/cikis mesajlarinin atilacagi kanal")
          .setRequired(false)
      )
      .addRoleOption((opt) =>
        opt.setName("panel_rol").setDescription("Panelin verecegi rol").setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt
          .setName("sure_saniye")
          .setDescription("Panel rolu kac saniye verilsin? (or: 604800=7 gun)")
          .setRequired(false)
          .setMinValue(60)
      )
      .addChannelOption((opt) =>
        opt
          .setName("ses_kanal")
          .setDescription("Bot acilinca girecegi ses kanali")
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("panel-kur")
      .setDescription("Butonlu kayitsiz duyuru paneli gonderir.")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
      .addChannelOption((opt) =>
        opt.setName("kanal").setDescription("Panelin atilacagi kanal").setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName("baslik")
          .setDescription("Panel basligi")
          .setRequired(false)
          .setMaxLength(100)
      )
      .addStringOption((opt) =>
        opt
          .setName("aciklama")
          .setDescription("Panel aciklamasi")
          .setRequired(false)
          .setMaxLength(1000)
      ),

    new SlashCommandBuilder()
      .setName("dm")
      .setDescription("Secilen role sahip herkese DM yayini yapar.")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
      .addRoleOption((opt) => opt.setName("rol").setDescription("Hedef rol").setRequired(true))
      .addStringOption((opt) =>
        opt.setName("mesaj").setDescription("Gonderilecek mesaj").setRequired(true).setMaxLength(1900)
      ),

    new SlashCommandBuilder()
      .setName("dm-optout")
      .setDescription("Sunucudan gelen toplu DM'leri ac/kapat.")
      .addStringOption((opt) =>
        opt
          .setName("durum")
          .setDescription("DM almak ister misin?")
          .setRequired(true)
          .addChoices({ name: "Ac", value: "ac" }, { name: "Kapat", value: "kapat" })
      ),

    new SlashCommandBuilder()
      .setName("surem")
      .setDescription("Uzerindeki sureli rolleri ve bitis zamanini gosterir.")
  ];
}

export function buildVerifyPanel({ title, description }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.VERIFY_BUTTON)
      .setLabel("Erişim Al")
      .setStyle(ButtonStyle.Success)
  );

  return {
    content: null,
    embeds: [
      {
        title: title || "Kayitsiz Duyuru",
        description:
          description ||
          "Butona basarak gecici erisim alabilirsin. Sure bitince rol otomatik kaldirilir.",
        color: 0x2b2d31,
        footer: { text: "Developed By Cyrus" }
      }
    ],
    components: [row]
  };
}

export function buildDmConfirmRow(token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_IDS.DM_CONFIRM_PREFIX}${token}`)
      .setLabel("Gonder")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_IDS.DM_CANCEL_PREFIX}${token}`)
      .setLabel("Iptal")
      .setStyle(ButtonStyle.Secondary)
  );
}

export function resolveGuildConfig(guildId) {
  const dbCfg = getGuildConfig(guildId);
  return {
    guild_id: guildId,
    welcome_channel_id: dbCfg?.welcome_channel_id ?? ENV.WELCOME_CHANNEL_ID ?? null,
    verify_role_id: dbCfg?.verify_role_id ?? ENV.VERIFY_ROLE_ID ?? null,
    verify_duration_seconds:
      dbCfg?.verify_duration_seconds ?? ENV.VERIFY_DURATION_SECONDS ?? 7 * 24 * 60 * 60,
    voice_channel_id: dbCfg?.voice_channel_id ?? ENV.VOICE_CHANNEL_ID ?? null
  };
}

export function upsertGuildConfigPartial(guildId, partial) {
  const current = resolveGuildConfig(guildId);
  setGuildConfig({
    guild_id: guildId,
    welcome_channel_id: partial.welcome_channel_id ?? current.welcome_channel_id,
    verify_role_id: partial.verify_role_id ?? current.verify_role_id,
    verify_duration_seconds: partial.verify_duration_seconds ?? current.verify_duration_seconds,
    voice_channel_id: partial.voice_channel_id ?? current.voice_channel_id
  });
}

export function formatUserTempRoles(guildId, userId) {
  const rows = listUserTempRoles({ guildId, userId });
  if (!rows.length) return "Uzerinde aktif sureli rol yok.";
  const now = Date.now();
  const lines = rows.map((r) => {
    const leftMs = r.expires_at_ms - now;
    const leftSec = Math.max(0, Math.floor(leftMs / 1000));
    const endUnix = Math.floor(r.expires_at_ms / 1000);
    return `- <@&${r.role_id}>: ${leftSec}s (bitis: <t:${endUnix}:R>)`;
  });
  return lines.join("\n");
}
