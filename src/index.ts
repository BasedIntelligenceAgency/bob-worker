export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return handleCORS(request, new Response(null, { status: 204 }));
		}

		const url = new URL(request.url);
		const path = url.pathname;

		let response: Response;

		if (request.method === 'GET') {
			response = new Response('Not Found', { status: 404 });
		} else if (path === '/grok') {
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

async function callXApi(env: Env): Promise<Response> {
	const url = 'https://api.x.ai/v1/chat/completions';
	const apiKey = env.XAI_API_KEY;

	const requestBody = {
		messages: [
			{
				role: "system",
				content: "You are a test assistant."
			},
			{
				role: "user",
				content: "Testing. Just say hi and hello world and nothing else."
			}
		],
		model: "grok-2-mini-public",
		stream: false,
		temperature: 0
	};

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			},
			body: JSON.stringify(requestBody)
		});
		const data = await response.json();
		console.log(data);
		return new Response(JSON.stringify(data), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('Error:', error);
		return new Response(JSON.stringify({ error: 'An error occurred' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}

async function callOpenAIApi(env: Env): Promise<Response> {
	const url = 'https://api.openai.com/v1/chat/completions';
	const apiKey = env.OPENAI_API_KEY;

	const requestBody = {
		messages: [
			{
				role: "system",
				content: "You are a test assistant."
			},
			{
				role: "user",
				content: "Testing. Just say hi and hello world and nothing else."
			}
		],
		model: "gpt-4",
		temperature: 0
	};

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			},
			body: JSON.stringify(requestBody)
		});
		const data = await response.json();
		console.log(data);
		return new Response(JSON.stringify(data), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('Error:', error);
		return new Response(JSON.stringify({ error: 'An error occurred' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}

async function processHandler(request: Request, env: Env): Promise<Response> {
	if (env.FAKE_API) {
		// wait 2 seconds
		await new Promise(resolve => setTimeout(resolve, 3000));
		return new Response(JSON.stringify({
			score: 89
		}), {
			headers: { 'Content-Type': 'application/json' },
		});
	}
	try {
		const requestBody = await request.json() as { userId: string };
		let twitterUserId = requestBody.userId;

		if (!twitterUserId) {
			// Fetch the authenticated user's ID
			const meResponse = await fetch('https://api.twitter.com/2/users/me', {
				headers: {
					'Authorization': `Bearer ${env.TWITTER_BEARER_TOKEN}`,
				},
			});
			const meData = await meResponse.json();
			twitterUserId = (meData as any).data.id;
		}

		const userTimelineUrl = `https://api.twitter.com/2/users/${twitterUserId}/tweets?max_results=100&tweet.fields=created_at,author_id,conversation_id,in_reply_to_user_id&exclude=retweets,replies`;

		const response = await fetch(userTimelineUrl, {
			headers: {
				'Authorization': `Bearer ${env.TWITTER_BEARER_TOKEN}`,
			},
		});

		const data = await response.json();
		const tweets = data || [];

		return new Response(JSON.stringify({
			score: 89,
			tweets: tweets
		}), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		console.error(err);
		return new Response(
			JSON.stringify({ error: err instanceof Error ? err.message : "An unknown error occurred" }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}