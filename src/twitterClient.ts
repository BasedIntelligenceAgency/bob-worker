interface TwitterUser {
  id: string;
  username: string;
}

interface Tweet {
  id: string;
  text: string;
}

interface TwitterTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface TwitterError {
  error: string;
  error_description?: string;
  errors?: Array<{
    message: string;
    code: number;
  }>;
  title?: string;
  detail?: string;
  type?: string;
  status?: number;
}

interface TwitterTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class TwitterClient {
  private baseUrl = 'https://api.twitter.com/2';
  private accessToken: string;
  private bearerToken?: string;
  private static rateLimitCache = new Map<string, { reset: number, remaining: number }>();

  constructor(accessToken: string, bearerToken?: string) {
    if (!accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = accessToken;
    this.bearerToken = bearerToken;
  }

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getRateLimitInfo(endpoint: string) {
    const now = Date.now();
    const info = TwitterClient.rateLimitCache.get(endpoint);
    if (!info || now >= info.reset) {
      return { remaining: 50, reset: now + 15 * 60 * 1000 };
    }
    return info;
  }

  private updateRateLimitInfo(endpoint: string, headers: Headers) {
    const remaining = parseInt(headers.get('x-rate-limit-remaining') || '0');
    const reset = parseInt(headers.get('x-rate-limit-reset') || '0') * 1000;
    TwitterClient.rateLimitCache.set(endpoint, { remaining, reset });
  }

  private static getHeadersObject(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  private getHeadersObject(headers: Headers): Record<string, string> {
    return TwitterClient.getHeadersObject(headers);
  }

  private async request<T>(path: string, init: RequestInit = {}, retryCount = 0): Promise<T> {
    const maxRetries = 3;
    const baseDelay = 2000; // 2 seconds

    try {
      // Check rate limits before making request
      const endpoint = path.split('?')[0];
      const rateLimitInfo = this.getRateLimitInfo(endpoint);
      
      if (rateLimitInfo.remaining <= 0) {
        const waitTime = Math.max(0, rateLimitInfo.reset - Date.now());
        console.warn('Rate limit reached, waiting:', {
          endpoint,
          waitTime,
          reset: new Date(rateLimitInfo.reset).toISOString()
        });
        await this.sleep(waitTime);
      }

      // Always use access token for user context endpoints
      const useAccessToken = path.includes('/users/me') || path.includes('/tweets');
      const token = useAccessToken ? this.accessToken : (this.bearerToken || this.accessToken);

      console.log('Making request:', {
        path,
        useAccessToken,
        retryCount,
        token: token.slice(0, 10) + '...' // Log part of token for debugging
      });

      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...init.headers,
        },
      });

      // Update rate limit info from response headers
      this.updateRateLimitInfo(endpoint, response.headers);

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '60');
        const waitTime = (retryAfter * 1000) || baseDelay * Math.pow(2, retryCount);
        
        console.warn('Rate limit exceeded:', {
          path,
          retryAfter,
          waitTime,
          retryCount
        });

        if (retryCount < maxRetries) {
          await this.sleep(waitTime);
          return this.request<T>(path, init, retryCount + 1);
        }
      }

      if (!response.ok) {
        let errorData: TwitterError;
        try {
          errorData = await response.json();
          console.error('Twitter API error details:', {
            status: response.status,
            headers: this.getHeadersObject(response.headers),
            error: errorData
          });
        } catch {
          const text = await response.text();
          console.error('Twitter API error (non-JSON):', {
            status: response.status,
            headers: this.getHeadersObject(response.headers),
            body: text
          });
          errorData = { error: text };
        }

        const errorMessage = errorData.detail || 
                           errorData.error_description || 
                           errorData.error ||
                           errorData.errors?.[0]?.message ||
                           'Unknown Twitter API error';

        throw new Error(`Twitter API error (${response.status}): ${errorMessage}`);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (retryCount < maxRetries && (
        error instanceof Error && (
          error.message.includes('rate limit') ||
          error.message.includes('429') ||
          error.message.includes('timeout')
        )
      )) {
        const waitTime = baseDelay * Math.pow(2, retryCount);
        console.warn('Retrying after error:', {
          error: error.message,
          waitTime,
          retryCount
        });
        await this.sleep(waitTime);
        return this.request<T>(path, init, retryCount + 1);
      }
      throw error;
    }
  }

  async me(): Promise<{ data: TwitterUser }> {
    try {
      return await this.request<{ data: TwitterUser }>('/users/me');
    } catch (error) {
      console.error('Failed to get user info:', error);
      throw new Error(`Failed to get user info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async userTimeline(userId: string, maxResults: number = 30): Promise<Tweet[]> {
    try {
      console.log('Fetching user timeline:', { userId, maxResults });
      const response = await this.request<{ data: Tweet[] }>(
        `/users/${userId}/tweets?max_results=${maxResults}&exclude=retweets,replies&tweet.fields=text,created_at`
      );
      
      if (!response.data || !Array.isArray(response.data)) {
        console.error('Invalid timeline response:', response);
        throw new Error('Invalid response format');
      }

      console.log('Got tweets:', { count: response.data.length });
      return response.data;
    } catch (error) {
      console.error('Failed to get user timeline:', error);
      throw new Error(`Failed to get user timeline: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static async getAccessToken(params: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<TwitterTokens> {
    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${btoa(`${params.clientId}:${params.clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: params.code,
        redirect_uri: params.redirectUri,
        code_verifier: params.codeVerifier,
      }),
    });

    if (!response.ok) {
      let errorData: TwitterError;
      try {
        errorData = await response.json();
        console.error('OAuth error details:', {
          status: response.status,
          headers: TwitterClient.getHeadersObject(response.headers),
          error: errorData
        });
      } catch {
        const text = await response.text();
        console.error('OAuth error (non-JSON):', {
          status: response.status,
          headers: TwitterClient.getHeadersObject(response.headers),
          body: text
        });
        errorData = { error: text };
      }

      const errorMessage = errorData.detail || 
                         errorData.error_description || 
                         errorData.error ||
                         errorData.errors?.[0]?.message ||
                         'Unknown Twitter API error';

      throw new Error(`Twitter OAuth error (${response.status}): ${errorMessage}`);
    }

    const data = await response.json() as TwitterTokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }
} 