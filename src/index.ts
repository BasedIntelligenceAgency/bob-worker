import { createHash, randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { callXApi } from './callXApi';
import { callOpenAIApi } from './callOpenAIApi';
import { processHandler } from './processHandler';

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

// CORS handler
function handleCors(request: Request, env: Env): Response {
	const allowedOrigins = ['http://localhost:5173', 'https://basedorbiased.com', '*'];
	const origin = request.headers.get('Origin');
	const corsHeaders = {
	  'Access-Control-Allow-Origin': allowedOrigins.includes(origin!) ? origin! : allowedOrigins[0],
	  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	  'Access-Control-Allow-Headers': 'Content-Type',
	  'Access-Control-Allow-Credentials': 'true',
	};
  
	if (request.method === 'OPTIONS') {
	  return new Response(null, {
		headers: {
		  ...corsHeaders,
		  'Access-Control-Max-Age': '86400',
		},
	  });
	}
  
	return new Response(null, {
	  headers: corsHeaders,
	});
  }

// Cloudflare Worker fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

    // OAuth state storage
    async function storeOAuthState(state: string, codeVerifier: string): Promise<void> {
      const expiresAt = new Date(Date.now() + 600000); // 10 minutes expiration
      await supabase.from('oauth_verifiers').insert({ state, code_verifier: codeVerifier, expires_at: expiresAt });
    }

	async function getOAuthState(state: string): Promise<{ codeVerifier: string; expiresAt: Date } | null> {
		let data, error;
	  
		try {
		  ({ data, error } = await supabase
			.from('oauth_verifiers')
			.select('code_verifier, expires_at')
			.eq('state', state)
			.single());
		} catch (err) {
		  console.error('Error retrieving OAuth state:', err);
		  return null;
		}
	  
		if (error) {
		  console.error('Error retrieving OAuth state:', error);
		  return null;
		}

		console.log("Data", data)
	  
		return data ? { codeVerifier: data.code_verifier, expiresAt: new Date(data.expires_at) } : null;
	}

    // Access token storage
    async function storeAccessToken(token: string, refresh: string, expiresIn: number): Promise<void> {
      const expiresAt = new Date(Date.now() + expiresIn * 1000);
      await supabase.from('access_tokens').upsert({ access_token: token, refresh_token: refresh, expires_at: expiresAt });
    }

    async function getRefreshToken(): Promise<string | null> {
      let data, error;
	  
	  try {
		({ data, error } = await supabase.from('access_tokens').select('refresh_token').single());
      } catch (err) {
        console.error('Error retrieving refresh token:', err);
        return null;
      }

      if (error) {
        console.error('Error retrieving refresh token:', error);
        return null;
      }

      return data ? data.refresh_token : null;
    }

    async function updateAccessToken(token: string, refresh: string, expiresIn: number): Promise<void> {
      const expiresAt = new Date(Date.now() + expiresIn * 1000);
      await supabase.from('access_tokens').update({ access_token: token, refresh_token: refresh, expires_at: expiresAt });
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

      await storeOAuthState(state, codeVerifier);

      const authorizationUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;

      return Response.redirect(authorizationUrl, 302);
    }

	async function handleOauthCallback(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');
	  
		console.log('Handling oauth callback');
		console.log('Code:', code);
		console.log('State:', state);
	  
		if (!code || !state) {
		  return new Response('Missing code or state', {
			status: 400,
			headers: handleCors(request, env).headers,
		  });
		}
	  
		const storedState = await getOAuthState(state);
	  
		if (!storedState) {
		  return new Response('Invalid state or expired', {
			status: 400,
			headers: handleCors(request, env).headers,
		  });
		}
	  
		const codeVerifier = storedState.codeVerifier;
	  
		console.log('Stored state:', storedState);
		console.log('Code verifier:', codeVerifier);
	  
		const clientId = env.TWITTER_CLIENT_ID;
		const redirectUri = `${env.FRONTEND_URL}/callback`;
	  
		console.log('Client ID:', clientId);
		console.log('Redirect URI:', redirectUri);
	  
		const params = new URLSearchParams({
		  code: code,
		  grant_type: 'authorization_code',
		  client_id: clientId,
		  redirect_uri: redirectUri,
		  code_verifier: codeVerifier,
		});
	  
		console.log('Params:', params);
	  
		try {
		  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
			method: 'POST',
			headers: {
			  'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: params.toString(),
		  });
	  
		  if (!response.ok) {
			const errorText = await response.text();
			console.error('Error exchanging authorization code:', errorText);
			return new Response(`Error exchanging authorization code: ${errorText}`, {
			  status: 500,
			  headers: handleCors(request, env).headers,
			});
		  }
	  
		  const data = await response.json() as { access_token: string, refresh_token: string, expires_in: number };
		  console.log('Token response:', data);
	  
		  const accessToken = data.access_token;
		  const refreshToken = data.refresh_token;
		  const expiresIn = data.expires_in;
	  
		  await storeAccessToken(accessToken, refreshToken, expiresIn);
	  
		  console.log("Access token", accessToken)
		  console.log("Refresh token", refreshToken)
		  console.log("Expires in", expiresIn)

		  console.log("Sending response ro frontend")

		  const callbackResponse = new Response(JSON.stringify({
			access_token: accessToken,
			refresh_token: refreshToken,
			expires_in: expiresIn,
		  }), {
			headers: handleCors(request, env).headers, // Add the CORS headers to the response
		  });

		  console.log("Callback response", callbackResponse)
		  
		  return callbackResponse;
		} catch (error) {
		  console.error('Error exchanging authorization code:', error);
		  return new Response('Error exchanging authorization code', {
			status: 500,
			headers: handleCors(request, env).headers,
		  });
		}
	  }

    // OAuth token refresh handler
    async function handleOauthRefresh(request: Request, env: Env): Promise<Response> {
      const refreshToken = await getRefreshToken();

      if (!refreshToken) {
        return new Response('Refresh token not found', { status: 400 });
      }

      const clientId = env.TWITTER_CLIENT_ID;

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
          },
          body: params.toString(),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Error refreshing access token:', errorText);
          return new Response(`Error refreshing access token: ${errorText}`, { status: 500 });
        }

        const data = await response.json() as { access_token: string, refresh_token: string, expires_in: number };
        const newAccessToken = data.access_token;
        const newRefreshToken = data.refresh_token;
        const expiresIn = data.expires_in;

        await updateAccessToken(newAccessToken, newRefreshToken, expiresIn);

        return new Response(JSON.stringify({ access_token: newAccessToken }), {
          headers: {
            'Content-Type': 'application/json',
            ...handleCors(request, env).headers,
          },
        });
      } catch (error) {
        console.error('Error refreshing access token:', error);
        return new Response('Error refreshing access token', { status: 500 });
      }
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path.includes('/oauth/request_token')) {
      return handleOauthRequestToken(request, env);
    } else if (path.includes('/oauth/callback')) {
      return handleOauthCallback(request, env);
    } else if (path.includes('/oauth/refresh')) {
      return handleOauthRefresh(request, env);
	} else if (path === '/grok') {
		return await callXApi(env);
	} else if (path === '/openai') {
		return await callOpenAIApi(env);
	} else if (path === '/process') {
		return await processHandler(request, env as Env);
	} else if (path === '/') {
    } else {
      return new Response('Not Found', { status: 404 });
    }
  },
};