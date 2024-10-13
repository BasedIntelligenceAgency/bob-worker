// CORS handler

export function handleCors(request: Request, env: Env): Response {
	const allowedOrigins = ['localhost:5173', 'basedorbiased.com', 'http://localhost:5173', 'https://basedorbiased.com'];
	const origin = request.headers.get('Origin');
	const corsHeaders = {
		'Access-Control-Allow-Origin': allowedOrigins.includes(origin!) ? origin! : allowedOrigins[0],
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
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
