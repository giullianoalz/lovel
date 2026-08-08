/**
 * One-time helper: mints the Gmail refresh token the API transport needs.
 *
 *   npm run gmail:auth
 *
 * Why a refresh token and not the service-account key Drive already uses: a
 * service account can only send as a person through domain-wide delegation,
 * which is a Google Workspace feature. On a free @gmail.com account the only
 * way to authorise sending is for the account owner to consent once, in a
 * browser, and hand back a long-lived refresh token.
 *
 * Runs a throwaway localhost server purely to catch Google's redirect — the
 * out-of-band (copy-the-code) flow was switched off by Google in 2022.
 */
import 'dotenv/config';
import http from 'http';
import { google } from 'googleapis';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const PORT = 5555;
const REDIRECT_URI = `http://localhost:${PORT}`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
Missing GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET in server/.env

Get them once, from https://console.cloud.google.com:
  1. Create (or pick) a project.
  2. APIs & Services -> Library -> enable "Gmail API".
  3. APIs & Services -> OAuth consent screen -> External -> fill the required
     fields -> add ${'lovelearningexplorers@gmail.com'} as a Test user.
  4. Credentials -> Create credentials -> OAuth client ID -> Web application.
     Add this exact Authorised redirect URI:  ${REDIRECT_URI}
  5. Copy the client ID and secret into server/.env, then run this again.
`);
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  // Without offline access Google returns only an access token, which dies in
  // an hour — the server needs one that outlives the browser session.
  access_type: 'offline',
  // Google only re-issues a refresh token on a fresh consent, so force it:
  // re-running this after an earlier grant would otherwise return nothing.
  prompt: 'consent',
  // Send-only. This token can never read the academy's inbox.
  scope: ['https://www.googleapis.com/auth/gmail.send'],
});

console.log(`
Open this URL, sign in as the academy's Gmail account, and approve:

${authUrl}

Waiting for the redirect on ${REDIRECT_URI} ...
`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.end(`Authorisation refused: ${error}. You can close this tab.`);
    console.error(`\nAuthorisation refused: ${error}`);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.end('Waiting for the authorisation redirect…');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.end('Done. You can close this tab and go back to the terminal.');

    if (!tokens.refresh_token) {
      console.error('\nGoogle returned no refresh token. Revoke the app at https://myaccount.google.com/permissions and run this again.');
      server.close();
      process.exit(1);
    }

    console.log(`
Add this to server/.env AND to Render -> Environment:

GMAIL_REFRESH_TOKEN=${tokens.refresh_token}

Treat it like a password: it lets the holder send mail as this account.
`);
  } catch (err) {
    console.error('\nCould not exchange the code:', err.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(PORT);
