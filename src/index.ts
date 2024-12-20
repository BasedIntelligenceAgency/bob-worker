import { handleOAuthCallback, handleOAuthInit } from './oauthHandler';
import { processHandler } from './processHandler';
import { handleCors, getCorsHeaders } from './handleCors';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Log request details
    const url = new URL(request.url);
    console.log('Incoming request:', {
      method: request.method,
      path: url.pathname,
      origin: request.headers.get('Origin'),
      contentType: request.headers.get('Content-Type')
    });

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors(request, env);
    }

    try {
      // Route the request
      switch (url.pathname) {
        case '/oauth/init':
          return await handleOAuthInit(request, env);
        case '/oauth/callback':
          return await handleOAuthCallback(request, env);
        case '/process':
          return await processHandler(request, env);
        default:
          console.log('Path not found:', url.pathname);
          return new Response(JSON.stringify({
            error: 'Not Found',
            details: `Path ${url.pathname} not found`
          }), { 
            status: 404,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(request, env)
            }
          });
      }
    } catch (error) {
      console.error('Worker error:', {
        path: url.pathname,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      return new Response(JSON.stringify({
        error: 'Internal error',
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
};