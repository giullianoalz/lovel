import { google } from 'googleapis';
import fs from 'fs';
import { Readable } from 'stream';

// ── Why this is OAuth and not a service account ─────────────────────────────
// A service account owns whatever it uploads, and a service account on a
// personal (non-Workspace) Google account has a hard storage quota of ZERO —
// `about.get` reports limit "0". Being granted canAddChildren on a shared
// folder does not help: the folder's owner supplies the space only for files
// they own, so every create still fails with storageQuotaExceeded. Shared
// Drives would sidestep this by owning the files themselves, but those need
// Workspace, and this academy runs on a plain @gmail.com account.
//
// That silent, unfixable failure is what lost 35 marketing photos: uploads
// never reached Drive, the rows were written anyway, and Render wiped the
// local disk they pointed at.
//
// So we act as the *user* instead. Files land in their My Drive and consume
// their 15GB. The refresh token comes from the same Google OAuth client
// already used for Gmail — re-consented to include a Drive scope.
const getOAuthClient = () => {
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  // Deliberately NOT falling back to GMAIL_REFRESH_TOKEN. That token is
  // normally consented for gmail.send alone, so reusing it would report a
  // healthy "oauth" mode while every Drive call fails on scope — the same
  // looks-configured-but-isn't trap that lost the photos in the first place.
  // Requiring its own variable makes an unconfigured Drive obvious instead.
  const refreshToken = process.env.DRIVE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) return null;

  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
};

// Legacy service-account path. Kept only so an existing deployment does not
// change behaviour the moment this ships; it cannot actually store anything
// (see above) and should be removed once OAuth is configured everywhere.
const getServiceAccountAuth = () => {
  const clientEmail = process.env.DRIVE_CLIENT_EMAIL;
  const privateKey = process.env.DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) return null;

  try {
    return new google.auth.GoogleAuth({
      credentials: { client_email: clientEmail, private_key: privateKey },
      // Full `drive` rather than `drive.file`: the narrower scope only reaches
      // files the app itself created, so a folder shared with this account
      // stays invisible to it and every upload into one 404s.
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  } catch (error) {
    console.error('[Drive Config] Error initializing service-account auth:', error);
    return null;
  }
};

const oauthClient = getOAuthClient();
const auth = oauthClient || getServiceAccountAuth();

// Which credentials won, so callers and startup logs can tell a real outage
// from "never configured", and so the quota trap above is visible in the logs.
export const driveAuthMode = oauthClient ? 'oauth' : (auth ? 'service-account' : 'none');

if (driveAuthMode === 'none') {
  console.warn('[Drive Config] Google Drive is not configured — uploads will be rejected.');
} else if (driveAuthMode === 'service-account') {
  console.warn('[Drive Config] ─────────────────────────────────────────────');
  console.warn('[Drive Config] Using a SERVICE ACCOUNT for Drive.');
  console.warn('[Drive Config] It has no storage quota, so every upload will');
  console.warn('[Drive Config] fail. Set DRIVE_REFRESH_TOKEN to use OAuth.');
  console.warn('[Drive Config] ─────────────────────────────────────────────');
}

export const drive = auth ? google.drive({ version: 'v3', auth }) : null;

// Streams a Drive file's bytes back out — used to serve attachments/photos
// without ever making the Drive file itself publicly shared.
export const downloadFileFromDrive = async (fileId) => {
  if (!drive) return null;
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  return response.data; // readable stream
};

// An alt=media download comes back with no Content-Type header at all — the
// bytes arrive bare — so the type has to be read from the file's metadata.
// A Drive file's mime type cannot change (a new picture is a new file), so the
// answer is memoised and the extra round trip is paid once per file per boot.
const mimeTypeCache = new Map();

export const getFileMimeType = async (fileId) => {
  if (!drive) return null;
  if (mimeTypeCache.has(fileId)) return mimeTypeCache.get(fileId);
  const meta = await drive.files.get({ fileId, fields: 'mimeType' });
  const mimeType = meta.data.mimeType || null;
  mimeTypeCache.set(fileId, mimeType);
  return mimeType;
};

// Drive renders its own thumbnail for every image it stores, and the trailing
// "=s220" on the link is a size the caller picks. The snack cabinet shows these
// as tiles in a grid, so pulling the 5 MB original the phone took to paint a
// 220px square is about a hundred times more bytes than the screen can use.
//
// The link is short-lived and tied to this account, so it is fetched here and
// the bytes are streamed on — it is never handed to the browser.
// Unlike a mime type, a thumbnail link expires, so this cache has to forget.
// Ten minutes is well inside Drive's own expiry and still spares the metadata
// round trip for everyone who opens the cabinet in the same sitting — that call
// was costing more than the 38 KB of image it was there to find.
const thumbLinkCache = new Map();
const THUMB_LINK_TTL_MS = 10 * 60 * 1000;

const thumbnailLinkFor = async (fileId) => {
  const hit = thumbLinkCache.get(fileId);
  if (hit && hit.expires > Date.now()) return hit.link;
  const meta = await drive.files.get({ fileId, fields: 'thumbnailLink' });
  const link = meta.data.thumbnailLink || null;
  if (link) thumbLinkCache.set(fileId, { link, expires: Date.now() + THUMB_LINK_TTL_MS });
  return link;
};

export const downloadThumbnail = async (fileId, size = 400) => {
  if (!drive) return null;
  const link = await thumbnailLinkFor(fileId);
  // Drive has not generated one yet (it is asynchronous after upload), so the
  // caller falls back to the original rather than showing a hole.
  if (!link) return null;

  const response = await fetch(link.replace(/=s\d+$/, '=s' + size));
  if (!response.ok || !response.body) return null;
  return {
    stream: Readable.fromWeb(response.body),
    mimeType: response.headers.get('content-type') || 'image/jpeg',
  };
};

// Download plus the type needed to render it. Without a Content-Type, helmet's
// nosniff makes the browser refuse to display a perfectly good image.
export const downloadFileWithType = async (fileId) => {
  if (!drive) return null;
  const [mimeType, response] = await Promise.all([
    getFileMimeType(fileId),
    drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' }),
  ]);
  return { stream: response.data, mimeType };
};

export const uploadFileToDrive = async (filePath, originalName, mimeType, folderId) => {
  if (!drive) {
    console.warn('[Drive Config] Google Drive not configured, skipping upload.');
    return null;
  }

  try {
    const fileMetadata = {
      name: originalName,
      parents: folderId ? [folderId] : undefined,
    };
    
    const media = {
      mimeType: mimeType,
      body: fs.createReadStream(filePath),
    };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink',
      supportsAllDrives: true,
    });

    return file.data;
  } catch (error) {
    console.error(`[Drive Config] Error uploading file ${originalName} to Drive:`, error);
    throw error;
  }
};

// Same as uploadFileToDrive but for content that only ever exists in memory —
// a generated PDF has no path on disk to read from, so this takes the bytes
// directly instead of forcing the caller to write a temp file first.
export const uploadBufferToDrive = async (buffer, name, mimeType, folderId) => {
  if (!drive) {
    console.warn('[Drive Config] Google Drive not configured, skipping upload.');
    return null;
  }

  try {
    const file = await drive.files.create({
      resource: { name, parents: folderId ? [folderId] : undefined },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id, webViewLink, webContentLink',
      supportsAllDrives: true,
    });

    return file.data;
  } catch (error) {
    console.error(`[Drive Config] Error uploading buffer ${name} to Drive:`, error);
    throw error;
  }
};
