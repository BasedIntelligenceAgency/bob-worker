import { createHash, randomBytes } from 'crypto';

// OAuth utility functions
function generateRandomString(length: number = 32): string {
  return randomBytes(length / 2).toString('hex');
}

async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = createHash('sha256').update(codeVerifier).digest();
  const base64Url = digest.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return base64Url;
}

// OAuth state storage
const oauthStates = new Map<string, { codeVerifier: string; expiresAt: number }>();

function storeOAuthState(state: string, codeVerifier: string): void {
  const expiresAt = Date.now() + 600000; // 10 minutes expiration
  oauthStates.set(state, { codeVerifier, expiresAt });
}

function getOAuthCodeVerifier(state: string): string | undefined {
  const oauthState = oauthStates.get(state);
  if (oauthState && oauthState.expiresAt > Date.now()) {
    return oauthState.codeVerifier;
  }
  return undefined;
}

// Access token storage
let accessToken = '';
let refreshToken = '';
let accessTokenExpiresAt = 0;

function storeAccessToken(token: string, refresh: string, expiresIn: number): void {
  accessToken = token;
  refreshToken = refresh;
  accessTokenExpiresAt = Date.now() + expiresIn * 1000;
}

function getRefreshToken(): string {
  return refreshToken;
}

function updateAccessToken(token: string, refresh: string, expiresIn: number): void {
  accessToken = token;
  refreshToken = refresh;
  accessTokenExpiresAt = Date.now() + expiresIn * 1000;
}

function revokeAccessToken(): void {
  accessToken = '';
  refreshToken = '';
  accessTokenExpiresAt = 0;
}

// OAuth request token handler
async function handleOauthRequestToken(request: Request, env: Env): Promise<Response> {
  const clientId = env.TWITTER_CLIENT_ID;
  const redirectUri = `${env.FRONTEND_URL}/callback`;

  const state = generateRandomString();
  const codeVerifier = generateRandomString();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'tweet.read users.read follows.read offline.access',
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  storeOAuthState(state, codeVerifier);

  const authorizationUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;

  return Response.redirect(authorizationUrl, 302);
}

// OAuth callback handler
async function handleOauthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return new Response('Missing code or state', { status: 400 });
  }

  const codeVerifier = getOAuthCodeVerifier(state);

  if (!codeVerifier) {
    return new Response('Invalid state or expired', { status: 400 });
  }

  const clientId = env.TWITTER_CLIENT_ID;
  const clientSecret = env.TWITTER_CONSUMER_SECRET;
  const redirectUri = `${env.FRONTEND_URL}/callback`;

  const params = new URLSearchParams({
    code: code,
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  try {
    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error exchanging authorization code:', errorText);
      return new Response(`Error exchanging authorization code: ${errorText}`, { status: 500 });
    }

    const data = await response.json() as any;
    const accessToken = data.access_token;
    const refreshToken = data.refresh_token;
    const expiresIn = data.expires_in;

    storeAccessToken(accessToken, refreshToken, expiresIn);

    const frontendUrl = `${env.FRONTEND_URL}/callback?access_token=${accessToken}`;
    return Response.redirect(frontendUrl, 302);
  } catch (error) {
    console.error('Error exchanging authorization code:', error);
    return new Response('Error exchanging authorization code', { status: 500 });
  }
}

// OAuth token refresh handler
async function handleOauthRefresh(request: Request, env: Env): Promise<Response> {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    return new Response('Refresh token not found', { status: 400 });
  }

  const clientId = env.TWITTER_CLIENT_ID;
  const clientSecret = env.TWITTER_CONSUMER_SECRET;

  const params = new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    client_id: clientId,
  });

  try {
    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error refreshing access token:', errorText);
      return new Response(`Error refreshing access token: ${errorText}`, { status: 500 });
    }

    const data = await response.json() as any;
    const newAccessToken = data.access_token;
    const newRefreshToken = data.refresh_token;
    const expiresIn = data.expires_in;

    updateAccessToken(newAccessToken, newRefreshToken, expiresIn);

    return new Response(JSON.stringify({ access_token: newAccessToken }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error refreshing access token:', error);
    return new Response('Error refreshing access token', { status: 500 });
  }
}

// OAuth token revocation handler
async function handleOauthRevoke(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response('Token not provided', { status: 400 });
  }

  const clientId = env.TWITTER_CLIENT_ID;

  const params = new URLSearchParams({
    token: token,
    client_id: clientId,
  });

  try {
    const response = await fetch('https://api.twitter.com/2/oauth2/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error revoking token:', errorText);
      return new Response(`Error revoking token: ${errorText}`, { status: 500 });
    }

    revokeAccessToken();

    return new Response('Token revoked successfully', { status: 200 });
  } catch (error) {
    console.error('Error revoking token:', error);
    return new Response('Error revoking token', { status: 500 });
  }
}

// Cloudflare Worker fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/oauth/request_token') {
      return handleOauthRequestToken(request, env);
    } else if (path === '/oauth/callback') {
      return handleOauthCallback(request, env);
    } else if (path === '/oauth/refresh') {
      return handleOauthRefresh(request, env);
    } else if (path === '/oauth/revoke') {
      return handleOauthRevoke(request, env);
    } else {
      return new Response('Not Found', { status: 404 });
    }
  },
};