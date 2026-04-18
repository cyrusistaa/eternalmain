# Cyrus Discord Bot

Odak:
- Butonlu panel: butona basinca kayit talebi ping'i
- `/dm`: secilen role sahip herkese DM yayini
- `/dm-optout`: kullanici toplu DM almayi kapatir
- Giris/cikis mesaji + DM'den karsilama
- Railway env var'lariyla calisma (TOKEN/ID'ler)
- Opsiyonel: ses kanalina otomatik girip durma

## Railway Environment Variables

Zorunlu:
- `DISCORD_TOKEN`
- `CLIENT_ID`

Opsiyonel (onerilen):
- `GUILD_ID` (guild komutlari aninda guncellensin diye)
- `WELCOME_CHANNEL_ID` (yoksa system channel denenir)
- `VOICE_CHANNEL_ID` (bot acilinca bu kanala girer)
- `STREAM_URL` (varsayilan: `https://twitch.tv/cyrus`)
- `DM_MAX_TARGETS` (varsayilan: 200)
- `AUTO_ROLE_ID` (tek rol)
- `AUTO_ROLE_IDS` (virgullu liste: `rol1,rol2,rol3` -> giren herkese rastgele birini verir)
- `STAFF_PING_CHANNEL_ID` (panel butonuna basinca `@everyone` ping mesaji bu kanala atilir; yoksa hosgeldin kanalina dener)
- `STATS_DATE_CHANNEL_ID` (tarih yazacak ses kanali)
- `STATS_TOTAL_CHANNEL_ID` (toplam uye yazacak ses kanali)
- `STATS_ACTIVE_CHANNEL_ID` (aktif/seste uye yazacak ses kanali)
- `STATS_UPDATE_SECONDS` (varsayilan: 300)
- `STATS_ACTIVE_MODE` (`voice` varsayilan; `presence` icin Developer Portal'da presence intent gerekir)
- `QUARANTINE_SECONDS` (karantina suresi saniye)
- `TICKET_PARENT_CHANNEL_ID` (panel butonuna basinca private thread acilacak yazi kanali)
- `LINK_BLOCK_CHANNEL_IDS` (virgullu kanal ID listesi)
- `BAD_WORDS` (virgulle ayir: `kelime1,kelime2`)
- `AUTOMOD_TIMEOUT_SECONDS` (0=kapali; or: 60)

## Discord Developer Portal

`/dm` icin (role sahip uyeleri cekmek) ve hosgeldin sistemi icin:
- Privileged Gateway Intents > `SERVER MEMBERS INTENT` acik olsun.

## Calistirma (lokal)

1. `DISCORD_TOKEN` ve `CLIENT_ID` ayarla (Railway'de env var olarak).
2. `npm install`
3. `npm start`

Not: Slash komutlari bot acilisinda otomatik register edilir.

## Kullanim

- `/panel-kur` (yoneticiler) -> butonlu panel atar
- Panel butonu -> ayrica kanala `@everyone Kayit talebi: ...` mesaji atar
- `/dm rol mesaj` (yoneticiler) -> once preview+onay, sonra role sahip herkese DM
- `/dm-optout durum:kapat` -> toplu DM almak istemeyen kullanici
- `/kurulum istatistik_tarih_kanal / istatistik_toplam_kanal / istatistik_aktif_kanal` -> 3 farkli ses kanalinin adini otomatik gunceller
- `/guvenlik-kur` -> karantina, ticket ve otomod ayarlari
