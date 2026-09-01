/**
 * Wave accounting API configuration.
 *
 * All Wave-specific constants live here so endpoint/scope tweaks (Wave's API is
 * partly in beta) are a one-line change. The OAuth client id/secret and redirect
 * URI come from the environment — the admin registers an app at
 * https://developer.waveapps.com, and those secrets are set in the backend host
 * (Render), never handled in the app UI.
 */

export const WAVE = {
  authorizeUrl: 'https://api.waveapps.com/oauth2/authorize/',
  tokenUrl: 'https://api.waveapps.com/oauth2/token/',
  graphqlUrl: process.env.WAVE_GRAPHQL_URL || 'https://gql.waveapps.com/graphql/public',

  clientId: process.env.WAVE_CLIENT_ID || '',
  clientSecret: process.env.WAVE_CLIENT_SECRET || '',
  // Must exactly match a Redirect URI registered on the Wave app, e.g.
  // https://<backend-host>/api/integrations/wave/callback
  redirectUri: process.env.WAVE_REDIRECT_URI || '',

  // Scopes: list businesses/accounts, create money transactions (payment sync),
  // and match/create customers + products + invoices (invoice sync — see
  // syncInvoiceToWave). Names must match
  // https://developer.waveapps.com/hc/en-us/articles/360032818132 exactly —
  // Wave has no accounting:*, transactions:read/write (plural), or
  // offline_access scope; requesting any of those 400s with invalid_scope.
  // Wave issues a refresh_token on every code exchange without needing a scope
  // for it. Widening this after a business already authorized the app requires
  // that admin to reconnect — the old token doesn't carry the new grants.
  scopes: (process.env.WAVE_SCOPES ||
    'business:read account:read transaction:write user:read customer:read customer:write product:read product:write invoice:write'),
};

// True only when the host has the OAuth app credentials configured. The UI uses
// this to explain what's missing instead of bouncing the admin to a broken Wave
// authorize page.
export const isWaveConfigured = () =>
  Boolean(WAVE.clientId && WAVE.clientSecret && WAVE.redirectUri);
