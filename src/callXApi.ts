
export async function callXApi(env: Env, input: string = "Testing. Just say hi and hello world and nothing else."): Promise<Response> {
	const url = 'https://api.x.ai/v1/chat/completions';
	const apiKey = env.XAI_API_KEY;

	const requestBody = {
		messages: [
			{
				role: "user",
				content: input
			}
		],
		model: "grok-2",
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
