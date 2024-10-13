// import { callXApi } from "./callXApi";

import { handleCors } from "./handleCors";

export async function processHandler(request: Request, env: Env): Promise<Response> {
	if (env.FAKE_API == "true") {
		// wait 2 seconds
		await new Promise(resolve => setTimeout(resolve, 1000));


		const responses = [
			{ "explanation": "The user exhibits a mix of independent thought and engagement with current trends and technologies, often discussing topics like AI, crypto, and gaming with unique perspectives or insights. However, there are moments where the user engages with political or controversial topics in a way that could be seen as echoing broader narratives, particularly around issues like the electoral college or critiques of institutions. The user's content is not strictly political but shows a lean towards tech and startup culture with a critical eye on mainstream practices and thoughts, suggesting a moderate level of 'based' behavior due to the mix of independent tech insights and occasional alignment with popular tech community sentiments.", "basedScore": 75, "engagementScore": 85 },
			{ "explanation": "The user expresses a wide range of interests from technology, AI, gaming, to politics and spirituality, often with an independent or unconventional perspective. They critique both sides of political issues, like commenting on the electoral college's impact on voting or the media's portrayal of social issues in San Francisco, suggesting a resistance to typical partisan lines. However, their engagement with political content is mixed with personal projects, tech developments, and cultural commentary, which shows a balanced approach rather than a deep dive into partisanship. Their willingness to engage with or critique any topic, including controversial ones, without aligning strictly to a political side, indicates a high level of 'based' behavior. Their engagement score is also high due to frequent discussions on current events, technology, and societal issues, but not exclusively political, hence not reaching the maximum.", "basedScore": 85, "engagementScore": 90 },
			{ "explanation": "The user is literally Kamala Harris.", "basedScore": 0, "engagementScore": 100 },
		]

		return new Response(JSON.stringify(responses[Math.floor(Math.random() * responses.length)]), {
			headers: { 'Content-Type': 'application/json' },
		});
	}
	try {
		const requestBody = await request.json() as { userId: string; };
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
		} else {
			// If userId is provided and it's not a numeric ID, assume it's a username
			if (isNaN(Number(twitterUserId))) {
				const username = twitterUserId;
				const userLookupUrl = `https://api.twitter.com/2/users/by/username/${username}`;

				const userLookupResponse = await fetch(userLookupUrl, {
					headers: {
						'Authorization': `Bearer ${env.TWITTER_BEARER_TOKEN}`,
					},
				});

				const userLookupData = await userLookupResponse.json();
				twitterUserId = (userLookupData as any).data.id;
			}
		}

		const userTimelineUrl = `https://api.twitter.com/2/users/${twitterUserId}/tweets?max_results=100&tweet.fields=created_at,author_id,conversation_id,in_reply_to_user_id&exclude=retweets,replies`;

		const response = await fetch(userTimelineUrl, {
			headers: {
				'Authorization': `Bearer ${env.TWITTER_BEARER_TOKEN}`,
			},
		});

		console.log("response", response);

		const data = await response.json() as { data: any[] };
const tweets = data.data || [];

// Transform tweets into the expected format
const transformedTweets = tweets.map(tweet => ({
  created_at: tweet.created_at,
  conversation_id: tweet.conversation_id,
  id: tweet.id,
  text: tweet.text,
  edit_history_tweet_ids: tweet.edit_history_tweet_ids,
  author_id: tweet.author_id
}));

const requestBody2 = {
  data: transformedTweets
};

const parsedXData = await fetch("https://api.basedorbiased.com/process", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(requestBody2)
});

		const jsonData = await parsedXData.json();

		return new Response(JSON.stringify(jsonData), {
			headers: handleCors(request, env).headers,
		});

		// AI HERE

// 		const prompt =
// 			`${stringifiedTweets}

// Determine if the user is based or biased. Specifically, based means that they express opinions which are not towing either side of the political spectrum and have independent thoughts separate from their political party.
// Biased means that they are expressing opinions which are towing either side of the political spectrum and are not independent.
// Give a score from 0 to 100 based on how based or biased the user is. A score of 0 indicates very biased and a score of 100 indicates very based.
// Also give an "engagement" score from 0 to 100. A score of 0 indicates the user never says anything political or interesting and a score of 100 indicates the user is very engaged in social issues, politics and current events.
// Do not award points for being political or not. Generally, just ignore the non-political content. We are interested in how much NPC-like behavior the user exhibits-- how much they repeat talking points and echo the mainstream narrative.

// Your response should be in JSON block format with the following keys: 'explanation', 'basedScore', 'engagementScore', for example:
// \`\`\`json
// {
// 	"explanation": "The user is very based/biased because <good reasons>.",
// 	"basedScore": <0-100>,
// 	"engagementScore": <0-100>
// }
// \`\`\``;

// 		const xResponse = await callXApi(env, prompt);
// 		const xData = await xResponse.json();
// 		console.log("xData", xData);

// 		// parse the xData
// 		const content = (xData as any)?.choices[0]?.message?.content || "";
// 		console.log("content", content);

// 		let parsedXData = null;
// 		let retryCount = 0;

// 		while (parsedXData === null && retryCount < 5) {
// 			try {
// 				// find the JSON block
// 				let jsonStart = content.indexOf("```json");
// 				let jsonEnd = content.indexOf("```", jsonStart + 1);

// 				// if they don't exist, find the first { and last }
// 				if (jsonStart === -1 || jsonEnd === -1) {
// 					jsonStart = content.indexOf("{");
// 					jsonEnd = content.lastIndexOf("}") + 1;
// 				} else {
// 					jsonStart += "```json".length;
// 				}

// 				const jsonBlock = content.substring(jsonStart, jsonEnd).trim();
// 				console.log("jsonBlock", jsonBlock);
// 				parsedXData = JSON.parse(jsonBlock);
// 				console.log("parsedXData", parsedXData);
// 			} catch (err) {
// 				console.error(`Parsing attempt ${retryCount + 1} failed:`, err);
// 				retryCount++;
// 			}
// 		}

// 		if (parsedXData === null) {
// 			return new Response(
// 				JSON.stringify({ error: "Failed to parse AI response after 5 attempts" }),
// 				{ status: 500, headers: { "Content-Type": "application/json" } }
// 			);
// 		}

// 		if (!parsedXData.basedScore || !parsedXData.engagementScore) {
// 			return new Response(
// 				JSON.stringify({ error: "Invalid response from AI" }),
// 				{ headers: { "Content-Type": "application/json" } }
// 			);
// 		}

// 		return new Response(JSON.stringify(parsedXData), {
// 			headers: { "Content-Type": "application/json" },
// 		});
	} catch (err) {
		console.error(err);
		return new Response(
			JSON.stringify({ error: err instanceof Error ? err.message : "An unknown error occurred" }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}
