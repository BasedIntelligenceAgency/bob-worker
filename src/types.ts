export interface ProcessRequest {
  accessToken: string;
}

export interface TweetAnalysis {
  tribe: string;
  score: number;
  explanation: string;
}

export interface OAuthCallbackRequest {
  code: string;
  state: string;
}

declare global {
  interface Env {
    BOB_KV: KVNamespace;
    ENVIRONMENT: string;
    VITE_SUPABASE_URL: string;
    VITE_SUPABASE_KEY: string;
    VITE_FRONTEND_URL: string;
    VITE_TWITTER_CLIENT_ID: string;
    TWITTER_BEARER_TOKEN: string;
    TWITTER_CLIENT_SECRET: string;
    XAI_API_KEY: string;
    VITE_SERVER_URL: string;
  }
} 