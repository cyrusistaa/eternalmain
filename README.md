# Cyrus Discord Bot

Odak:
- Butonlu panel: butona basan kullaniciya sureli rol
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
- `VERIFY_ROLE_ID` (panelin verecegi rol)
- `VERIFY_DURATION_SECONDS` (varsayilan: 604800 = 7 gun)
- `VOICE_CHANNEL_ID` (bot acilinca bu kanala girer)
- `STREAM_URL` (varsayilan: `https://twitch.tv/cyrus`)
- `DM_MAX_TARGETS` (varsayilan: 200)

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
- Panel butonu -> gecici rol verir (sure bitince otomatik alinir)
- `/dm rol mesaj` (yoneticiler) -> once preview+onay, sonra role sahip herkese DM
- `/dm-optout durum:kapat` -> toplu DM almak istemeyen kullanici
