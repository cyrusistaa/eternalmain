import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  SlashCommandBuilder
} from "discord.js";
import { ENV } from "./env.js";
import { getGuildConfig, setGuildConfig } from "./db.js";
import { safeJsonParse, uniqStrings } from "./jsonUtil.js";

export const CUSTOM_IDS = {
  VERIFY_BUTTON: "verify:claim",
  DM_CONFIRM_PREFIX: "dm:confirm:",
  DM_CANCEL_PREFIX: "dm:cancel:"
};

export function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName("kurulum")
      .setDescription("Bot ayarlari (hosgeldin kanali, ping kanali, oto rol, ses kanali).")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
      .addChannelOption((opt) =>
        opt
          .setName("hosgeldin_kanal")
          .setDescription("Giris/cikis mesajlarinin atilacagi kanal")
          .setRequired(false)
      )
      .addRoleOption((opt) =>
        opt
          .setName("kayit_gorevli_rol")
          .setDescription("Panel butonuna basinca pinglenecek kayit gorevlisi rolu")
          .setRequired(false)
      )
      .addChannelOption((opt) =>
        opt
          .setName("kayit_ping_kanal")
          .setDescription("Kayit gorevlisi ping mesaji hangi kanala atilsin?")
          .setRequired(false)
      )
      .addRoleOption((opt) =>
        opt
          .setName("oto_rol")
          .setDescription("Sunucuya giren herkese otomatik verilecek rol")
          .setRequired(false)
      )
      .addChannelOption((opt) =>
        opt
          .setName("istatistik_tarih_kanal")
          .setDescription("Tarih yazacak ses kanali")
          .setRequired(false)
      )
      .addChannelOption((opt) =>
        opt
          .setName("istatistik_toplam_kanal")
          .setDescription("Toplam uye sayisi yazacak ses kanali")
          .setRequired(false)
      )
      .addChannelOption((opt) =>
        opt
          .setName("istatistik_aktif_kanal")
          .setDescription("Aktif uye sayisi yazacak ses kanali")
          .setRequired(false)
      )
      .addChannelOption((opt) =>
        opt
          .setName("ses_kanal")
          .setDescription("Bot acilinca girecegi ses kanali")
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("guvenlik-kur")
      .setDescription("Anti-raid, ticket ve otomod ayarlari.")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
      .addIntegerOption((opt) =>
        opt
          .setName("karantina_saniye")
          .setDescription("Karantina kac saniye sursun? (or: 60)")
          .setRequired(false)
          .setMinValue(10)
          .setMaxValue(86400)
      )
      .addChannelOption((opt) =>
        opt
          .setName("ticket_kanal")
          .setDescription("Kayit icin private thread acilacak yazi kanali")
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName("link_engel_kanallar")
          .setDescription("Link engeli kanallari (virgullu kanal ID listesi)")
          .setRequired(false)
          .setMaxLength(1800)
      )
      .addStringOption((opt) =>
        opt
          .setName("yasakli_kelimeler")
          .setDescription("Yasakli kelimeler (virgulle ayir)")
          .setRequired(false)
          .setMaxLength(1800)
      )
      .addIntegerOption((opt) =>
        opt
          .setName("timeout_saniye")
          .setDescription("Otomod timeout suresi (0=kapali)")
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(604800)
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
  ];
}

export function buildVerifyPanel({ title, description }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.VERIFY_BUTTON)
      .setLabel("Kayit Talebi Gonder")
      .setStyle(ButtonStyle.Success)
  );

  return {
    content: null,
    embeds: [
      {
        title: title || "Kayit Paneli",
        description:
          description ||
          'Kayit olmak icin asagidaki butona bas.\nYetkililere otomatik bildirim gider.',
        color: 0x0ea5e9,
        footer: { text: "Developed By Cyrus • Kayit Sistemi" }
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
  const linkBlockChannelIds = uniqStrings(
    safeJsonParse(dbCfg?.link_block_channel_ids, null) ??
      (dbCfg?.link_block_channel_ids ? String(dbCfg.link_block_channel_ids).split(",") : [])
  );
  const badWords = uniqStrings(
    safeJsonParse(dbCfg?.bad_words, null) ??
      (dbCfg?.bad_words ? String(dbCfg.bad_words).split(",") : [])
  ).map((w) => w.toLowerCase());
  return {
    guild_id: guildId,
    welcome_channel_id: dbCfg?.welcome_channel_id ?? ENV.WELCOME_CHANNEL_ID ?? null,
    // Kept for backward compatibility with existing DB schema (not used by the panel anymore).
    verify_role_id: dbCfg?.verify_role_id ?? null,
    verify_duration_seconds: dbCfg?.verify_duration_seconds ?? null,
    voice_channel_id: dbCfg?.voice_channel_id ?? ENV.VOICE_CHANNEL_ID ?? null,
    reg_staff_role_id: dbCfg?.reg_staff_role_id ?? ENV.REG_STAFF_ROLE_ID ?? null,
    staff_ping_channel_id: dbCfg?.staff_ping_channel_id ?? ENV.STAFF_PING_CHANNEL_ID ?? null,
    auto_role_id: dbCfg?.auto_role_id ?? ENV.AUTO_ROLE_ID ?? null,
    stats_date_channel_id: dbCfg?.stats_date_channel_id ?? ENV.STATS_DATE_CHANNEL_ID ?? null,
    stats_total_channel_id: dbCfg?.stats_total_channel_id ?? ENV.STATS_TOTAL_CHANNEL_ID ?? null,
    stats_active_channel_id: dbCfg?.stats_active_channel_id ?? ENV.STATS_ACTIVE_CHANNEL_ID ?? null,

    quarantine_role_id: dbCfg?.quarantine_role_id ?? null,
    quarantine_seconds: Number.isFinite(dbCfg?.quarantine_seconds)
      ? dbCfg.quarantine_seconds
      : ENV.QUARANTINE_SECONDS || null,
    ticket_parent_channel_id: dbCfg?.ticket_parent_channel_id ?? ENV.TICKET_PARENT_CHANNEL_ID ?? null,
    link_block_channel_ids: linkBlockChannelIds.length ? linkBlockChannelIds : ENV.LINK_BLOCK_CHANNEL_IDS,
    bad_words: badWords.length ? badWords : ENV.BAD_WORDS,
    automod_timeout_seconds: Number.isFinite(dbCfg?.automod_timeout_seconds)
      ? dbCfg.automod_timeout_seconds
      : ENV.AUTOMOD_TIMEOUT_SECONDS || 0
  };
}

export function upsertGuildConfigPartial(guildId, partial) {
  const current = resolveGuildConfig(guildId);
  setGuildConfig({
    guild_id: guildId,
    welcome_channel_id: partial.welcome_channel_id ?? current.welcome_channel_id,
    verify_role_id: current.verify_role_id,
    verify_duration_seconds: current.verify_duration_seconds,
    voice_channel_id: partial.voice_channel_id ?? current.voice_channel_id,
    reg_staff_role_id: partial.reg_staff_role_id ?? current.reg_staff_role_id,
    staff_ping_channel_id: partial.staff_ping_channel_id ?? current.staff_ping_channel_id,
    auto_role_id: partial.auto_role_id ?? current.auto_role_id,
    stats_date_channel_id: partial.stats_date_channel_id ?? current.stats_date_channel_id,
    stats_total_channel_id: partial.stats_total_channel_id ?? current.stats_total_channel_id,
    stats_active_channel_id: partial.stats_active_channel_id ?? current.stats_active_channel_id,

    quarantine_role_id: partial.quarantine_role_id ?? current.quarantine_role_id,
    quarantine_seconds: partial.quarantine_seconds ?? current.quarantine_seconds,
    ticket_parent_channel_id: partial.ticket_parent_channel_id ?? current.ticket_parent_channel_id,
    link_block_channel_ids:
      partial.link_block_channel_ids_json ?? JSON.stringify(current.link_block_channel_ids ?? []),
    bad_words: partial.bad_words_json ?? JSON.stringify(current.bad_words ?? []),
    automod_timeout_seconds: partial.automod_timeout_seconds ?? current.automod_timeout_seconds
  });
}
