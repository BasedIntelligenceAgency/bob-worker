import { createHash, randomBytes } from 'crypto';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import createInstructorClient from '@instructor-ai/instructor';
import { z } from 'zod';
import { IdeologyClassifier } from './services/IdeologyClassifier';
import categoriesData from './data/categories.json';

/**
 * ------------------------------------------------------------------
 * Custom Error Types
 * ------------------------------------------------------------------
 */
class TwitterAPIError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TwitterAPIError';
	}
}

class LLMError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LLMError';
	}
}

/**
 * ------------------------------------------------------------------
 * Zod Schemas
 * ------------------------------------------------------------------
 */
const TwitterMessageSchema = z.object({
	created_at: z.string(),
	conversation_id: z.string(),
	id: z.string(),
	text: z.string(),
	edit_history_tweet_ids: z.array(z.string()),
	author_id: z.string(),
});
type TwitterMessage = z.infer<typeof TwitterMessageSchema>;

const PoliticalBeliefSchema = z.object({
	belief: z.string().describe("Short, punchy statement of the user's political or social belief"),
	justification: z.string().describe('Short, punchy justification for the belief'),
	confidence: z.number(),
	importance: z.number().describe("How important this belief is to the user's identity. Should be between 0 and 1."),
});

const BasedScoreSchema = z.object({
	tribal_affiliation: z.enum([
		'far right whack job',
		'constitution creationist',
		'soulless NPC',
		'techno-optimist & e/acc',
		'pirate party',
		'megachurch bible thumper',
		'the mainstream media',
		'actually racist',
		'Reagan nostalgic',
		'MAGA forever',
		'dark MAGA',
		'trust fund poverty poseur',
		'pragmatic progressive',
		'blue haired non binary',
		'bernie Bros',
		'cat lady',
		'elon tribe',
		'jingoistic imperialist',
		'war pig',
		'conspiracy theorist',
		'closet Trump supporter',
		'marxist meme lord',
		'antifa antagonist',
		'tech bro',
		'who is john galt',
	]),
	justification_for_basedness: z.string(),
	contrarian_beliefs: z.array(PoliticalBeliefSchema).describe("Beliefs that contradict the user's identified tribe"),
	mainstream_beliefs: z.array(PoliticalBeliefSchema).describe("Beliefs that match the user's identified tribe"),
	based_score: z.number().describe('A score from 0 to 100'),
	sincerity_score: z.number().describe('Between 0 and 100'),
	truthfulness_score: z.number().describe('Between 0 and 100'),
	conspiracy_score: z.number().describe('Between 0 and 100'),
});
type BasedScore = z.infer<typeof BasedScoreSchema>;

/**
 * ------------------------------------------------------------------
 * Score Validation
 * ------------------------------------------------------------------
 */
function validateScore(score: number, fieldName: string): number {
	if (typeof score !== 'number' || isNaN(score) || score < 0 || score > 100) {
		console.warn(`Invalid ${fieldName}: ${score}, defaulting to 50`);
		return 50;
	}
	return score;
}

/**
 * ------------------------------------------------------------------
 * Instructor Client Setup (Memoized)
 * ------------------------------------------------------------------
 */
let instructorClient: ReturnType<typeof createInstructorClient> | null = null;

function buildOpenAIClient(env: Env) {
	return {
		apiKey: env.GROK_API_KEY,
		baseURL: env.GROK_BASE_URL,
		maxRetries: 3,
		timeout: 30000,
		defaultQuery: {},
		defaultHeaders: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${env.GROK_API_KEY}`,
		},
		fetch: fetch.bind(globalThis),
		// Add required OpenAI client methods
		completions: {
			create: async (params: any) => {
				const response = await fetch(`${env.GROK_BASE_URL}/completions`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${env.GROK_API_KEY}`,
					},
					body: JSON.stringify(params),
				});
				return response.json();
			},
		},
		chat: {
			completions: {
				create: async (params: any) => {
					const response = await fetch(`${env.GROK_BASE_URL}/chat/completions`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${env.GROK_API_KEY}`,
						},
						body: JSON.stringify(params),
					});
					return response.json();
				},
			},
		},
	};
}

function getInstructorClient(env: Env) {
	if (!instructorClient) {
		const openAIClient = buildOpenAIClient(env);

		type InstructorOptions = {
			client: ReturnType<typeof buildOpenAIClient>;
			mode: 'TOOLS' | 'FUNCTIONS' | 'JSON' | 'MD_JSON' | 'JSON_SCHEMA';
			debug?: boolean;
		};

		instructorClient = createInstructorClient({
			client: openAIClient,
			mode: 'TOOLS',
			debug: false,
		} as InstructorOptions);
	}
	return instructorClient;
}

/**
 * ------------------------------------------------------------------
 * Helper: Retry LLM Calls
 * ------------------------------------------------------------------
 */
async function completeWithRetry<T>(prompt: string, schema: z.ZodSchema<T>, client: ReturnType<typeof createInstructorClient>): Promise<T> {
	const maxRetries = 5;
	const baseDelay = 1000;
	let attempt = 0;

	while (true) {
		try {
			const response = await client.chat.completions.create({
				messages: [{ role: 'user', content: prompt }],
				model: 'grok-beta',
				response_model: {
					schema: schema as unknown as z.ZodObject<any, any, any>,
					name: 'BasedScoreAnalysis',
				},
				max_retries: 3,
				temperature: 0.7,
			});

			return response as unknown as T;
		} catch (err) {
			attempt++;
			console.error(`Attempt ${attempt} failed:`, err);

			if (attempt >= maxRetries) {
				throw new LLMError(`Failed after ${maxRetries} attempts: ${err instanceof Error ? err.message : 'Unknown error'}`);
			}

			const jitter = Math.random() * 0.3 + 0.85;
			const delayMs = Math.min(baseDelay * Math.pow(2, attempt - 1) * jitter, 32000);

			console.log(`Retrying in ${Math.round(delayMs)}ms...`);
			await new Promise((res) => setTimeout(res, delayMs));
		}
	}
}

/**
 * ------------------------------------------------------------------
 * Core "Get Based Score" Logic
 * ------------------------------------------------------------------
 */
async function getBasedScore(twitterMessages: TwitterMessage[], env: Env): Promise<BasedScore> {
	// Validate input format
	const messagesValidation = z.array(TwitterMessageSchema).safeParse(twitterMessages);
	if (!messagesValidation.success) {
		throw new Error('Invalid tweet format');
	}

	if (twitterMessages.length === 0) {
		throw new Error('Empty tweets array');
	}

	const formattedMessages = twitterMessages
		.map((m) => ({
			text: m.text,
			timestamp: new Date(m.created_at).toISOString(),
		}))
		.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
		.map((m) => m.text)
		.join('\n\n');

	const prompt = `
SYSTEM: You are an expert at analyzing social media posts to determine political and social beliefs.
Analyze the following tweets carefully and provide a detailed assessment.

USER MESSAGES:
${formattedMessages}

ANALYSIS REQUIREMENTS:
1. Score how "based" the user is (0-100) based on originality and independence of thought
2. Identify their tribal affiliation from the provided list
3. Extract both mainstream and contrarian beliefs
4. Assess sincerity (0-100) and truthfulness (0-100)
5. Determine conspiracy thinking level (0-100)

Remember:
- Extract abstract, high-level beliefs
- Contrarian beliefs must directly contradict their tribal affiliation
- Generate at least 10 total beliefs
- Be specific but avoid personal criticism
`.trim();

	const client = getInstructorClient(env);
	let result = await completeWithRetry<BasedScore>(prompt, BasedScoreSchema, client);

	// Validate all scores
	result.based_score = validateScore(result.based_score, 'based_score');
	result.sincerity_score = validateScore(result.sincerity_score, 'sincerity_score');
	result.truthfulness_score = validateScore(result.truthfulness_score, 'truthfulness_score');
	result.conspiracy_score = validateScore(result.conspiracy_score, 'conspiracy_score');

	return result;
}

/**
 * ------------------------------------------------------------------
 * OAuth Utilities
 * ------------------------------------------------------------------
 */
function generateRandomString(length: number = 32): string {
	return randomBytes(length / 2).toString('hex');
}

async function generateCodeChallenge(codeVerifier: string): Promise<string> {
	const digest = createHash('sha256').update(codeVerifier).digest();
	return digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * ------------------------------------------------------------------
 * CORS Handler
 * ------------------------------------------------------------------
 */
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
	return new Response(null, { headers: corsHeaders });
}

async function fetchUserTweets(userId: string, accessToken: string): Promise<TwitterMessage[]> {
	const userTimelineUrl = `https://api.twitter.com/2/users/${userId}/tweets?max_results=100&tweet.fields=created_at,author_id,conversation_id,in_reply_to_user_id&exclude=retweets,replies`;

	const twitterResponse = await fetch(userTimelineUrl, {
		headers: {
			Authorization: `Bearer ${accessToken}`, // Using user's access token
		},
	});

	if (!twitterResponse.ok) {
		throw new TwitterAPIError(`Failed to fetch tweets: ${await twitterResponse.text()}`);
	}

	const timelineData = (await twitterResponse.json()) as { data: TwitterMessage[] };
	const tweets = timelineData.data || [];

	if (tweets.length === 0) {
		throw new TwitterAPIError('No tweets found');
	}

	return tweets.map((tweet) => ({
		created_at: tweet.created_at,
		conversation_id: tweet.conversation_id,
		id: tweet.id,
		text: tweet.text,
		edit_history_tweet_ids: tweet.edit_history_tweet_ids || [],
		author_id: tweet.author_id,
	}));
}

async function fetchTwitterUser(userId: string, accessToken: string): Promise<string> {
	console.log('Fetching user info for:', userId);

	// If no userId provided, get the authenticated user
	if (!userId) {
		const meResponse = await fetch('https://api.twitter.com/2/users/me', {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});

		if (!meResponse.ok) {
			throw new TwitterAPIError(`Failed to fetch user data: ${await meResponse.text()}`);
		}

		const meData = (await meResponse.json()) as { data: { id: string } };
		console.log('Retrieved authenticated user ID:', meData.data.id);
		return meData.data.id;
	}

	// If userId is not a number, treat it as a username
	if (isNaN(Number(userId))) {
		const username = userId;
		const userLookupUrl = `https://api.twitter.com/2/users/by/username/${username}`;
		console.log('Looking up user by username:', username);

		const userLookupResponse = await fetch(userLookupUrl, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});

		if (!userLookupResponse.ok) {
			const errorText = await userLookupResponse.text();
			console.error('User lookup failed:', errorText);
			throw new TwitterAPIError(`Failed to lookup user: ${errorText}`);
		}

		const userLookupData = (await userLookupResponse.json()) as { data: { id: string } };
		console.log('Retrieved user ID for username:', userLookupData.data.id);
		return userLookupData.data.id;
	}

	// If userId is already a number, use it directly
	console.log('Using provided numeric user ID:', userId);
	return userId;
}

/**
 * ------------------------------------------------------------------
 * Main Process Handler
 * ------------------------------------------------------------------
 */
export async function processHandler(request: Request, env: Env): Promise<Response> {
	console.log('Incoming process request');

	// Get CORS headers
	const corsHeaders = {
		'Access-Control-Allow-Origin': request.headers.get('Origin') || 'http://localhost:5173',
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
		'Access-Control-Allow-Credentials': 'true',
		'Access-Control-Max-Age': '86400',
	};

	const baseHeaders = {
		'Content-Type': 'application/json',
		...corsHeaders,
	};

	if (request.method !== 'POST') {
		return new Response('Method Not Allowed', { status: 405, headers: baseHeaders });
	}

	try {
		// Extract the access token from the Authorization header
		const authHeader = request.headers.get('Authorization');
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			throw new Error('Missing or invalid authorization header');
		}
		const accessToken = authHeader.split(' ')[1];

		console.log('accessToken', accessToken);

		const requestBody = (await request.json()) as { userId: string };
		const twitterUserId = await fetchTwitterUser(requestBody.userId, accessToken);
		const tweets = await fetchUserTweets(twitterUserId, accessToken);

		// Get the existing based score analysis
		const basedScoreResult: any = await getBasedScore(tweets, env);

		// Load categories and create classifier

		const classifier = new IdeologyClassifier(categoriesData);
		const classifierResult = await classifier.classifyUser(tweets);

		// Combine the results
		const combinedResult = {
			...basedScoreResult,
			ideology_analysis: {
				category: classifierResult.category,
				confidence: classifierResult.confidence,
				key_indicators: classifierResult.key_indicators,
				secondary_influences: classifierResult.secondary_influences,
				language_patterns: classifierResult.language_patterns,
			},
			based_score: (basedScoreResult.based_score + classifierResult.based_score) / 2,
			score_components: {
				...basedScoreResult.score_components,
				intellectual_depth: classifierResult.score_components.intellectual_rigor,
				authenticity: classifierResult.score_components.authenticity,
			},
		};

		return new Response(JSON.stringify(combinedResult), {
			status: 200,
			headers: baseHeaders,
		});
	} catch (err) {
		console.error('Error in /process handler:', err);

		let errorMessage = 'An unknown error occurred';
		let statusCode = 500;

		if (err instanceof TwitterAPIError) {
			statusCode = 404;
			errorMessage = err.message;
		} else if (err instanceof LLMError) {
			statusCode = 500;
			errorMessage = err.message;
		} else if (err instanceof Error) {
			errorMessage = err.message;
		}

		return new Response(JSON.stringify({ error: errorMessage }), {
			status: statusCode,
			headers: baseHeaders,
		});
	}
}

/**
 * ------------------------------------------------------------------
 * Environment Interface
 * ------------------------------------------------------------------
 */
export interface Env {
	SUPABASE_URL: string;
	SUPABASE_KEY: string;
	TWITTER_BEARER_TOKEN: string;
	TWITTER_CLIENT_ID: string;
	FRONTEND_URL: string;
	FAKE_API: string;
	GROK_API_KEY: string;
	GROK_BASE_URL: string;
}

/**
 * ------------------------------------------------------------------
 * Main Worker Export
 * ------------------------------------------------------------------
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		// Create Supabase client
		const supabase = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_KEY);

		/**
		 * ------------------------------------------------------------------
		 * OAuth State Management
		 * ------------------------------------------------------------------
		 */
		async function storeOAuthState(state: string, codeVerifier: string): Promise<void> {
			const expiresAt = new Date(Date.now() + 600_000); // 10 minutes
			const { error } = await supabase.from('oauth_verifiers').insert({ state, code_verifier: codeVerifier, expires_at: expiresAt });

			if (error) {
				throw new Error(`Failed to store OAuth state: ${error.message}`);
			}
		}

		async function getOAuthState(state: string): Promise<{ codeVerifier: string; expiresAt: Date } | null> {
			try {
				const { data, error } = await supabase.from('oauth_verifiers').select('code_verifier, expires_at').eq('state', state).single();

				if (error) {
					console.error('Error retrieving OAuth state:', error);
					return null;
				}
				if (!data) return null;

				return {
					codeVerifier: data.code_verifier,
					expiresAt: new Date(data.expires_at),
				};
			} catch (err) {
				console.error('Error retrieving OAuth state:', err);
				return null;
			}
		}

		/**
		 * ------------------------------------------------------------------
		 * Token Management
		 * ------------------------------------------------------------------
		 */
		async function storeAccessToken(token: string, refresh: string, expiresIn: number): Promise<void> {
			const expiresAt = new Date(Date.now() + expiresIn * 1000);
			const { error } = await supabase.from('access_tokens').upsert({
				access_token: token,
				refresh_token: refresh,
				expires_at: expiresAt,
			});

			if (error) {
				throw new Error(`Failed to store access token: ${error.message}`);
			}
		}

		async function getRefreshToken(): Promise<string | null> {
			try {
				const { data, error } = await supabase.from('access_tokens').select('refresh_token').single();

				if (error) {
					console.error('Error retrieving refresh token:', error);
					return null;
				}
				return data?.refresh_token || null;
			} catch (err) {
				console.error('Error retrieving refresh token:', err);
				return null;
			}
		}

		async function updateAccessToken(token: string, refresh: string, expiresIn: number): Promise<void> {
			const expiresAt = new Date(Date.now() + expiresIn * 1000);
			const { error } = await supabase.from('access_tokens').update({
				access_token: token,
				refresh_token: refresh,
				expires_at: expiresAt,
			});

			if (error) {
				throw new Error(`Failed to update access token: ${error.message}`);
			}
		}

		/**
		 * ------------------------------------------------------------------
		 * OAuth Route Handlers
		 * ------------------------------------------------------------------
		 */
		async function handleOauthRequestToken(request: Request, env: Env): Promise<Response> {
			const clientId = env.TWITTER_CLIENT_ID;
			const redirectUri = `${env.FRONTEND_URL}/callback`;

			const state = generateRandomString();
			const codeVerifier = generateRandomString();
			const codeChallenge = await generateCodeChallenge(codeVerifier);

			const params = new URLSearchParams({
				response_type: 'code',
				client_id: clientId,
				redirect_uri: redirectUri,
				scope: 'tweet.read users.read follows.read offline.access',
				state: state,
				code_challenge: codeChallenge,
				code_challenge_method: 'S256',
			});

			await storeOAuthState(state, codeVerifier);

			const authorizationUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
			return Response.redirect(authorizationUrl, 302);
		}

		async function handleOauthCallback(request: Request, env: Env): Promise<Response> {
			const url = new URL(request.url);
			const code = url.searchParams.get('code');
			const state = url.searchParams.get('state');

			console.log('Handling oauth callback');

			// Get CORS headers first
			const corsHeaders = {
				'Access-Control-Allow-Origin': request.headers.get('Origin') || 'http://localhost:5173',
				'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
				'Access-Control-Allow-Credentials': 'true',
				'Access-Control-Max-Age': '86400',
			};

			// Common response headers
			const baseHeaders = {
				'Content-Type': 'application/json',
				...corsHeaders,
			};

			if (!code || !state) {
				return new Response(JSON.stringify({ error: 'Missing code or state' }), {
					status: 400,
					headers: baseHeaders,
				});
			}

			const storedState = await getOAuthState(state);
			if (!storedState) {
				return new Response(JSON.stringify({ error: 'Invalid state or expired' }), {
					status: 400,
					headers: baseHeaders,
				});
			}

			const codeVerifier = storedState.codeVerifier;
			const clientId = env.TWITTER_CLIENT_ID;
			const redirectUri = `${env.FRONTEND_URL}/callback`;

			const params = new URLSearchParams({
				code: code,
				grant_type: 'authorization_code',
				client_id: clientId,
				redirect_uri: redirectUri,
				code_verifier: codeVerifier,
			});

			try {
				const response = await fetch('https://api.twitter.com/2/oauth2/token', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
					},
					body: params.toString(),
				});

				if (!response.ok) {
					const errorText = await response.text();
					console.error('Error exchanging authorization code:', errorText);
					return new Response(JSON.stringify({ error: `Error exchanging authorization code: ${errorText}` }), {
						status: response.status,
						headers: baseHeaders,
					});
				}

				const data = (await response.json()) as {
					access_token: string;
					refresh_token: string;
					expires_in: number;
				};

				await storeAccessToken(data.access_token, data.refresh_token, data.expires_in);

				return new Response(
					JSON.stringify({
						access_token: data.access_token,
						refresh_token: data.refresh_token,
						expires_in: data.expires_in,
					}),
					{
						status: 200,
						headers: baseHeaders,
					},
				);
			} catch (error) {
				console.error('Error in OAuth callback:', error);
				return new Response(
					JSON.stringify({
						error: error instanceof Error ? error.message : 'Unknown error in OAuth callback',
					}),
					{
						status: 500,
						headers: baseHeaders,
					},
				);
			}
		}

		async function handleOauthRefresh(request: Request, env: Env): Promise<Response> {
			const refreshToken = await getRefreshToken();
			if (!refreshToken) {
				return new Response(JSON.stringify({ error: 'Refresh token not found' }), {
					status: 400,
					headers: {
						'Content-Type': 'application/json',
						...handleCors(request, env).headers,
					},
				});
			}

			const clientId = env.TWITTER_CLIENT_ID;
			const params = new URLSearchParams({
				refresh_token: refreshToken,
				grant_type: 'refresh_token',
				client_id: clientId,
			});

			try {
				const response = await fetch('https://api.twitter.com/2/oauth2/token', {
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: params.toString(),
				});

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`Error refreshing access token: ${errorText}`);
				}

				const data = (await response.json()) as {
					access_token: string;
					refresh_token: string;
					expires_in: number;
				};

				await updateAccessToken(data.access_token, data.refresh_token, data.expires_in);

				return new Response(
					JSON.stringify({
						access_token: data.access_token,
					}),
					{
						headers: {
							'Content-Type': 'application/json',
							...handleCors(request, env).headers,
						},
					},
				);
			} catch (error) {
				console.error('Error in OAuth refresh:', error);
				return new Response(
					JSON.stringify({
						error: error instanceof Error ? error.message : 'Unknown error in OAuth refresh',
					}),
					{
						status: 500,
						headers: {
							'Content-Type': 'application/json',
							...handleCors(request, env).headers,
						},
					},
				);
			}
		}

		/**
		 * ------------------------------------------------------------------
		 * Router
		 * ------------------------------------------------------------------
		 */
		const url = new URL(request.url);
		const path = url.pathname;

		// CORS preflight
		if (request.method === 'OPTIONS') {
			return handleCors(request, env);
		}

		// Route handling
		try {
			if (path.includes('/oauth/request_token')) {
				return await handleOauthRequestToken(request, env);
			} else if (path.includes('/oauth/callback')) {
				return await handleOauthCallback(request, env);
			} else if (path.includes('/oauth/refresh')) {
				return await handleOauthRefresh(request, env);
			} else if (path.includes('/process')) {
				return await processHandler(request, env);
			} else if (path === '/') {
				return new Response('API is operational', {
					headers: {
						'Content-Type': 'text/plain',
						...handleCors(request, env).headers,
					},
				});
			} else {
				return new Response('Not Found', {
					status: 404,
					headers: {
						'Content-Type': 'text/plain',
						...handleCors(request, env).headers,
					},
				});
			}
		} catch (error) {
			console.error('Unhandled error in router:', error);
			return new Response(
				JSON.stringify({
					error: error instanceof Error ? error.message : 'An unexpected error occurred',
				}),
				{
					status: 500,
					headers: {
						'Content-Type': 'application/json',
						...handleCors(request, env).headers,
					},
				},
			);
		}
	},
};
