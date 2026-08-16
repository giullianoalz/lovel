# Incident records

Small, permanent records of data that was lost or removed in production, kept
so a later "what happened to X?" has an answer. These are metadata only — never
the lost content itself, and never anything personal.

## 2026-08-15-lost-marketing-photos.json

35 `MarketingPhoto` rows deleted from production on 2026-08-15, one JSON object
each, including the submission and teacher they belonged to.

**What happened.** Marketing photo uploads were configured to archive to Google
Drive through a service account. A service account owns whatever it uploads, and
one on a personal (non-Workspace) Google account has a storage quota of exactly
zero — `about.get` reports `limit: "0"`. Being granted `canAddChildren` on the
shared folder did not help: a folder's owner only supplies space for files they
own. So every upload failed, permanently, and `driveFileId` stayed null on all
35 rows.

It went unnoticed because `uploadPhotos` caught the Drive error and created the
row anyway, leaving it pointing only at Render's local disk — which is wiped on
every restart. Teachers saw a successful upload; the images 404'd days later.

**Why the rows were deleted.** The bytes are gone and cannot be recovered: not
in Drive, not on any disk. The rows only rendered as broken images. They were
removed with `scripts/purge-lost-marketing-photos.mjs`, which deletes only rows
that have no `driveFileId` **and** no local file, and backs up everything it
touches — this file is that backup.

**The photos themselves are not recoverable.** If the originals are ever needed,
the teachers listed here still had them on their own phones at the time
(filenames like `IMG_5778.jpeg` are straight off a camera roll).

**Fixed in** `13f053f` — Drive now authenticates as the account owner via OAuth,
and no row is written unless something durable actually holds the file. Chat
attachments had the identical bug, fixed in `f443dee`; those three messages were
deliberately left in place, since editing a moderated conversation to hide our
own bug is worse than showing an unavailable file.
