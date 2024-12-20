/// <reference types="@cloudflare/workers-types" />

declare global {
  interface Env {
    TWITTER_CLIENT_SECRET: string;
    VITE_TWITTER_CLIENT_ID: string;
    VITE_FRONTEND_URL: string;
    VITE_SUPABASE_URL: string;
    VITE_SUPABASE_KEY: string;
    XAI_API_KEY: string;
  }
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

export interface ProcessRequest {
  accessToken: string;
}

export {}; 