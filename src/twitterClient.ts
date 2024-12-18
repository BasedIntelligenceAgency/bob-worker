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

  constructor(accessToken: string, bearerToken?: string) {
    if (!accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = accessToken;
    this.bearerToken = bearerToken;
  }

  private async request<T>(path: string, init: RequestInit = {}, retryCount = 0): Promise<T> {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second

    try {
      // Always use access token for user context endpoints
      const useAccessToken = path.includes('/users/me') || path.includes('/tweets');
      const token = useAccessToken ? this.accessToken : (this.bearerToken || this.accessToken);

      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...init.headers,
        },
      });

      const contentType = response.headers.get('content-type');
      
      // Handle rate limiting
      if (response.status === 429) {
        const resetTime = response.headers.get('x-rate-limit-reset');
        const retryAfter = response.headers.get('retry-after');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : baseDelay * Math.pow(2, retryCount);
        
        console.warn('Rate limit exceeded:', {
          path,
          resetTime,
          retryAfter,
          waitTime,
          retryCount,
          usingAccessToken: useAccessToken
        });

        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return this.request<T>(path, init, retryCount + 1);
        }
      }

      if (!response.ok) {
        let errorMessage: string;
        try {
          if (contentType?.includes('application/json')) {
            const errorData = await response.json() as TwitterError;
            errorMessage = errorData.error_description || 
                          errorData.error || 
                          errorData.errors?.[0]?.message ||
                          'Unknown Twitter API error';
          } else {
            errorMessage = await response.text();
          }
        } catch (e) {
          errorMessage = `Failed to parse error response: ${e instanceof Error ? e.message : 'Unknown error'}`;
        }
        throw new Error(`Twitter API error (${response.status}): ${errorMessage}`);
      }

      if (!contentType?.includes('application/json')) {
        throw new Error('Expected JSON response from Twitter API');
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof Error && error.message.includes('rate limit') && retryCount < maxRetries) {
        const waitTime = baseDelay * Math.pow(2, retryCount);
        console.warn('Retrying after error:', {
          error: error.message,
          waitTime,
          retryCount
        });
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.request<T>(path, init, retryCount + 1);
      }
      throw error;
    }
  }

  async me(): Promise<{ data: TwitterUser }> {
    try {
      return await this.request<{ data: TwitterUser }>('/users/me');
    } catch (error) {
      throw new Error(`Failed to get user info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async userTimeline(userId: string, maxResults: number = 30): Promise<Tweet[]> {
    try {
      const response = await this.request<{ data: Tweet[] }>(`/users/${userId}/tweets?max_results=${maxResults}&exclude=retweets,replies`);
      
      if (!response.data || !Array.isArray(response.data)) {
        throw new Error('Invalid response format');
      }
      return response.data;
    } catch (error) {
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

    const contentType = response.headers.get('content-type');
    if (!response.ok) {
      let errorMessage: string;
      try {
        if (contentType?.includes('application/json')) {
          const errorData = await response.json() as TwitterError;
          errorMessage = errorData.error_description || 
                        errorData.error || 
                        errorData.errors?.[0]?.message ||
                        'Unknown Twitter API error';
        } else {
          errorMessage = await response.text();
        }
      } catch (e) {
        errorMessage = `Failed to parse error response: ${e instanceof Error ? e.message : 'Unknown error'}`;
      }
      throw new Error(`Twitter OAuth error (${response.status}): ${errorMessage}`);
    }

    if (!contentType?.includes('application/json')) {
      throw new Error('Expected JSON response from Twitter API');
    }

    const data = await response.json() as TwitterTokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }
} 