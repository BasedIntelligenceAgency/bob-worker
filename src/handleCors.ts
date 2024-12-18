// CORS handler

export function handleCors(request: Request, env: Env): Response {
	const origin = request.headers.get('Origin') || '';
	const allowedOrigins = [
		'http://localhost:5173',
		'http://localhost:8787',
		'https://bob-worker.affaan.workers.dev',
		'https://bob.affaanltd.com'
	];

	const corsHeaders = {
		'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : '',
		'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
		'Access-Control-Allow-Credentials': 'true'
	};

	// Handle CORS preflight
	if (request.method === 'OPTIONS') {
		return new Response(null, {
			headers: corsHeaders
		});
	}

	return new Response(null, { headers: corsHeaders });
}

// Helper to get just the CORS headers
export function getCorsHeaders(request: Request, env: Env): HeadersInit {
	const origin = request.headers.get('Origin') || '';
	const allowedOrigins = [
		'http://localhost:5173',
		'http://localhost:8787',
		'https://bob-worker.affaan.workers.dev',
		'https://bob.affaanltd.com'
	];

	return {
		'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : '',
		'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
		'Access-Control-Allow-Credentials': 'true'
	};
}
