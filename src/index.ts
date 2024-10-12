export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (request.method === 'GET') {
			return new Response('Not Found', { status: 404 });
		}

		if (path === '/grok') {
			return callXApi(env);
		} else if (path === '/openai') {
			return callOpenAIApi(env);
		} else if (path === '/process') {
			return processHandler(request, env as Env);
		} else if (path === '/') {
			return new Response('Hello World');
		} else {
			return new Response('Not Found', { status: 404 });
		}
	},
};

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