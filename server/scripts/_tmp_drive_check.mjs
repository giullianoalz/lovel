// Throwaway read-only check: can the new OAuth token reach the folders the
// existing config already points at?
import 'dotenv/config';
import { drive } from '../src/config/drive.js';

const ids = {
  DRIVE_CHAT_FOLDER_ID: process.env.DRIVE_CHAT_FOLDER_ID,
  DRIVE_WAIVERS_FOLDER_ID: process.env.DRIVE_WAIVERS_FOLDER_ID,
};

for (const [key, id] of Object.entries(ids)) {
  if (!id) { console.log(`${key}: unset`); continue; }
  try {
    const r = await drive.files.get({
      fileId: id,
      fields: 'id,name,mimeType,ownedByMe,capabilities(canAddChildren)',
      supportsAllDrives: true,
    });
    const d = r.data;
    console.log(`${key}: OK "${d.name}" ownedByMe=${d.ownedByMe} canAddChildren=${d.capabilities?.canAddChildren}`);
  } catch (e) {
    console.log(`${key}: UNREACHABLE (${id}) -> ${e.message}`);
  }
}
