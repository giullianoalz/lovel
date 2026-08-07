import { google } from 'googleapis';
import fs from 'fs';
import { Readable } from 'stream';

// Parse Google Drive credentials from environment variables
const getDriveAuth = () => {
  try {
    const clientEmail = process.env.DRIVE_CLIENT_EMAIL;
    const privateKey = process.env.DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!clientEmail || !privateKey) {
      console.warn('[Drive Config] Google Drive credentials not fully provided in .env');
      return null;
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      // Full `drive` rather than `drive.file`: the narrower scope only reaches
      // files the app itself created, so a folder shared with this service
      // account stays invisible to it and every upload into one 404s. For a
      // service account with no domain-wide delegation this still reaches
      // nothing beyond what has been explicitly shared with it.
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    return auth;
  } catch (error) {
    console.error('[Drive Config] Error initializing Google Auth:', error);
    return null;
  }
};

const auth = getDriveAuth();
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
    });

    return file.data;
  } catch (error) {
    console.error(`[Drive Config] Error uploading buffer ${name} to Drive:`, error);
    throw error;
  }
};
