import { getCorsHeaders } from "./handleCors";
import { TwitterClient } from "./twitterClient";
import type { ProcessRequest, TweetAnalysis } from "./types";

interface GrokResponse {
	choices: Array<{ message: { content: string } }>;
}

export async function processHandler(request: Request, env: Env): Promise<Response> {
	console.log("Processing request...", {
		method: request.method,
		url: request.url
	});

	if (request.method !== 'POST') {
		return new Response(JSON.stringify({
			error: 'Method Not Allowed',
			details: `Expected POST but got ${request.method}`
		}), { 
			status: 405,
			headers: {
				'Content-Type': 'application/json',
				'Allow': 'POST',
				...getCorsHeaders(request, env)
			}
		});
	}

	try {
		const body = await request.json() as ProcessRequest;
		if (!body.accessToken) {
			return new Response(JSON.stringify({
				error: 'Missing access token',
				details: 'The accessToken field is required'
			}), {
				status: 400,
				headers: {
					'Content-Type': 'application/json',
					...getCorsHeaders(request, env)
				}
			});
		}

		// Create Twitter client with user's access token and bearer token
		const client = new TwitterClient(body.accessToken, env.TWITTER_BEARER_TOKEN);

		// Get user info
		const { data: user } = await client.me();
		console.log("Got user info:", { username: user.username });

		// Get tweets
		const tweets = await client.userTimeline(user.id);
		console.log("Got tweets:", { count: tweets.length });

		if (tweets.length === 0) {
			return new Response(JSON.stringify({
				error: 'No tweets found',
				details: 'User has no recent tweets to analyze'
			}), {
				status: 400,
				headers: {
					'Content-Type': 'application/json',
					...getCorsHeaders(request, env)
				}
			});
		}

		// Analyze tweets with Grok
		const analysis = await analyzeWithGrok(tweets.map(t => t.text).join('\n\n'), user.username, env);
		console.log("Analysis complete:", {
			username: user.username,
			tribe: analysis.tribe,
			score: analysis.score
		});

		return new Response(JSON.stringify({
			username: user.username,
			tribe: analysis.tribe,
			basedScore: analysis.score,
			explanation: analysis.explanation
		}), {
			headers: {
				'Content-Type': 'application/json',
				...getCorsHeaders(request, env)
			}
		});

	} catch (error) {
		console.error('Process handler error:', {
			error: error instanceof Error ? error.message : 'Unknown error',
			stack: error instanceof Error ? error.stack : undefined
		});
		
		return new Response(JSON.stringify({
			error: 'Processing failed',
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

async function analyzeWithGrok(tweets: string, username: string, env: Env): Promise<TweetAnalysis> {
	if (!env.XAI_API_KEY) {
		throw new Error('XAI_API_KEY environment variable is not set');
	}

	const prompt = `Analyze these tweets from user ${username}:\n\n${tweets}\n\nProvide a tribal affiliation analysis and a based score (0-100) with explanation.`;

	console.log("Sending request to OpenRouter...");
	const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: { 
			"Content-Type": "application/json",
			"Authorization": `Bearer ${env.XAI_API_KEY}`,
			"HTTP-Referer": env.VITE_SERVER_URL,
			"X-Title": "Bob - Based or Bluepilled"
		},
		body: JSON.stringify({
			model: "x-ai/grok-2-1212",
			messages: [{ role: "user", content: prompt }],
			temperature: 0
		})
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.error("OpenRouter API error:", {
			status: response.status,
			statusText: response.statusText,
			error: errorText
		});
		throw new Error(`Grok API error (${response.status}): ${errorText}`);
	}

	const data = await response.json() as GrokResponse;
	if (!data.choices?.[0]?.message?.content) {
		throw new Error('Invalid response from Grok API');
	}

	const analysis = data.choices[0].message.content;

	// Extract tribe and score
	const tribeMatch = analysis.match(/tribe[:\s]+([^\.|\n]+)/i);
	const scoreMatch = analysis.match(/based score[:\s]+(\d+)/i);

	return {
		tribe: tribeMatch ? tribeMatch[1].trim() : 'Free Thinker',
		score: scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1]))) : 69,
		explanation: analysis
	};
}