import { getCorsHeaders } from './handleCors';
import { createClient } from '@supabase/supabase-js';
import type { OAuthCallbackRequest } from './types';

interface TwitterTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface TwitterUserResponse {
  data: {
    id: string;
    username: string;
  };
}

interface TwitterErrorResponse {
  error: string;
  error_description?: string;
}

export async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
  try {
    // Get code and state from request
    const body = await request.json() as OAuthCallbackRequest;
    if (!body.code || !body.state) {
      return new Response(JSON.stringify({
        error: 'Missing parameters',
        details: 'Both code and state parameters are required'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request, env)
        }
      });
    }

    // Get code verifier from Supabase
    const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY);
    const { data: stateData, error: stateError } = await supabase
      .from('oauth_verifiers')
      .select('code_verifier')
      .eq('state', body.state)
      .single();

    if (stateError || !stateData) {
      return new Response(JSON.stringify({
        error: 'Invalid state',
        details: 'Please try logging in again'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request, env)
        }
      });
    }

    // Exchange code for token
    const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${btoa(`${env.VITE_TWITTER_CLIENT_ID}:${env.TWITTER_CLIENT_SECRET}`)}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: body.code,
        redirect_uri: `${env.VITE_FRONTEND_URL}/callback`,
        code_verifier: stateData.code_verifier,
        client_id: env.VITE_TWITTER_CLIENT_ID
      }),
    });

    if (!tokenResponse.ok) {
      let errorDetails: string;
      try {
        const errorData = await tokenResponse.json() as TwitterErrorResponse;
        errorDetails = errorData.error_description || errorData.error;
      } catch {
        errorDetails = await tokenResponse.text();
      }
      console.error('Token exchange error:', {
        status: tokenResponse.status,
        details: errorDetails,
        clientId: env.VITE_TWITTER_CLIENT_ID,
        redirectUri: `${env.VITE_FRONTEND_URL}/callback`
      });
      return new Response(JSON.stringify({
        error: 'Token exchange failed',
        details: errorDetails
      }), {
        status: tokenResponse.status,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request, env)
        }
      });
    }

    const tokenData = await tokenResponse.json() as TwitterTokenResponse;
    const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = tokenData;

    // Get user info
    const userResponse = await fetch('https://api.twitter.com/2/users/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!userResponse.ok) {
      let errorDetails: string;
      try {
        const errorData = await userResponse.json() as TwitterErrorResponse;
        errorDetails = errorData.error_description || errorData.error;
      } catch {
        errorDetails = await userResponse.text();
      }
      console.error('User info error:', {
        status: userResponse.status,
        details: errorDetails
      });
      return new Response(JSON.stringify({
        error: 'Failed to get user info',
        details: errorDetails
      }), {
        status: userResponse.status,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request, env)
        }
      });
    }

    const userData = await userResponse.json() as TwitterUserResponse;
    const user = userData.data;

    // Clean up verifier
    await supabase
      .from('oauth_verifiers')
      .delete()
      .eq('state', body.state);

    return new Response(JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      user_id: user.id,
      username: user.username
    }), {
      headers: { 
        'Content-Type': 'application/json',
        ...getCorsHeaders(request, env)
      }
    });

  } catch (error) {
    console.error('OAuth error:', error);
    return new Response(JSON.stringify({
      error: 'Authentication failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...getCorsHeaders(request, env)
      }
    });
  }
}

export async function handleOAuthInit(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.VITE_TWITTER_CLIENT_ID) {
      throw new Error('Twitter client ID is not configured');
    }

    // Generate state and verifier
    const state = crypto.randomUUID();
    const codeVerifier = crypto.randomUUID();
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashBase64 = btoa(String.fromCharCode(...hashArray))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Store state and verifier
    const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY);
    const { error } = await supabase
      .from('oauth_verifiers')
      .insert({
        state,
        code_verifier: codeVerifier,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes
      });

    if (error) {
      throw new Error('Failed to store OAuth state');
    }

    // Build Twitter OAuth URL
    const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', env.VITE_TWITTER_CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', `${env.VITE_FRONTEND_URL}/callback`);
    authUrl.searchParams.append('scope', 'tweet.read users.read offline.access');
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('code_challenge', hashBase64);
    authUrl.searchParams.append('code_challenge_method', 'S256');

    console.log('Generated OAuth URL:', {
      clientId: env.VITE_TWITTER_CLIENT_ID,
      redirectUri: `${env.VITE_FRONTEND_URL}/callback`,
      state
    });

    return new Response(JSON.stringify({ 
      url: authUrl.toString(),
      state,
      expires_in: 600 // 10 minutes
    }), {
      headers: {
        'Content-Type': 'application/json',
        ...getCorsHeaders(request, env)
      }
    });

  } catch (error) {
    console.error('OAuth init error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to start authentication',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...getCorsHeaders(request, env)
      }
    });
  }
} 