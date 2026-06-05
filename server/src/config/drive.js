import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

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
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    return auth;
  } catch (error) {
    console.error('[Drive Config] Error initializing Google Auth:', error);
    return null;
  }
};

const auth = getDriveAuth();
export const drive = auth ? google.drive({ version: 'v3', auth }) : null;

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
