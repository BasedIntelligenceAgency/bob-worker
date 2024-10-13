import { callOpenAIApi } from "./callOpenAIApi";
import { callXApi } from "./callXApi";
import { processHandler } from "./processHandler";

// CLOUDFLARE WORKER CODE
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return handleCORS(request, new Response(null, { status: 204 }));
		}

		const url = new URL(request.url);
		const path = url.pathname;

		let response: Response;

		if (path === '/grok') {
			response = await callXApi(env);
		} else if (path === '/openai') {
			response = await callOpenAIApi(env);
		} else if (path === '/process') {
			response = await processHandler(request, env as Env);
		} else if (path === '/') {
			response = new Response('Hello World');
		} else {
			response = new Response('Not Found', { status: 404 });
		}

		// Add CORS headers to the response
		return handleCORS(request, response);
	},
};

function handleCORS(request: Request, response: Response): Response {
	const origin = request.headers.get('Origin');
	const allowedOrigins = ['http://localhost:3000', 'https://basedorbiased.com', 'https://www.basedorbiased.com', 'http://localhost:5173']; // Add your allowed origins here

	if (origin && allowedOrigins.includes(origin)) {
		response.headers.set('Access-Control-Allow-Origin', origin);
		response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
		response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
		response.headers.set('Access-Control-Max-Age', '86400'); // 24 hours cache for preflight requests
	}

	return response;
}

