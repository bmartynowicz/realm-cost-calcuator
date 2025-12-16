const http = require('node:http');
const { URL } = require('node:url');
const { exec } = require('node:child_process');

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET ?? '';
const REDIRECT_URI = 'http://localhost:3000/auth/linkedin/callback';
const DEFAULT_SCOPES = [
  'openid',
  'profile',
  'email',
  'r_ads_reporting',
  'r_organization_social',
  'rw_organization_admin',
  'w_member_social',
  'r_ads',
  'w_organization_social',
  'rw_ads',
  'r_basicprofile',
  'r_organization_admin',
  'r_1st_connections_size',
];
const COMMUNITY_SCOPES = [
  'r_member_postAnalytics',
  'r_organization_followers',
  'r_organization_social',
  'rw_organization_admin',
  'r_organization_social_feed',
  'w_member_social',
  'r_member_profileAnalytics',
  'w_organization_social',
  'r_basicprofile',
  'w_organization_social_feed',
  'w_member_social_feed',
  'r_1st_connections_size',
];
const scopeSet = process.env.LINKEDIN_SCOPE === 'community' ? COMMUNITY_SCOPES : DEFAULT_SCOPES;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    'Missing LinkedIn OAuth env vars. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET before running.',
  );
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (requestUrl.pathname !== '/auth/linkedin/callback') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  if (error) {
    console.error('LinkedIn OAuth error:', error, requestUrl.searchParams.get('error_description'));
    res.writeHead(400);
    res.end('LinkedIn OAuth failed. Check your terminal.');
    shutdown();
    return;
  }

  if (!code) {
    res.writeHead(400);
    res.end('Missing code parameter.');
    shutdown();
    return;
  }

  try {
    const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });

    const json = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(json, null, 2));
    }

    console.log('\nLinkedIn access token response:\n', json);
    res.writeHead(200);
    res.end('Success! Check your terminal for the token. You can close this tab.');
  } catch (err) {
    console.error('Token exchange failed:', err);
    res.writeHead(500);
    res.end('Token exchange failed. Check your terminal.');
  } finally {
    shutdown();
  }
});

const shutdown = () => {
  server.close(() => {
    process.exit(0);
  });
};

server.listen(3000, () => {
  const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', scopeSet.join(' '));
  authUrl.searchParams.set('state', 'latitude-local');

  console.log('Opening browser for LinkedIn consent:\n', authUrl.toString());
  exec(`start "" "${authUrl.toString()}"`);
});
