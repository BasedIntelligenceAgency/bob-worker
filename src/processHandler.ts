import { callXApi } from "./callXApi";

export async function processHandler(request: Request, env: Env): Promise<Response> {
	if (env.FAKE_API) {
		// wait 2 seconds
		await new Promise(resolve => setTimeout(resolve, 1000));
		return new Response(JSON.stringify({
			score: 89
		}), {
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

		const data = await response.json();
		const tweets = data || { data: [] };

		// data structure is this:
		// {
		// 	"data": [
		// 		{
		// 			"created_at": "2024-10-12T14:22:24.000Z",
		// 			"conversation_id": "1845107756996702312",
		// 			"id": "1845107756996702312",
		// 			"text": "I feel like people are still pretty intimidated by DNS, setting up a domain, hosting on a free solution.\n\nI should make a tutorial from this. You can have a hosted .com website or blog that costs $0/month and $12/yr for the domain, and takes less than 20 minutes to set up.",
		// 			"edit_history_tweet_ids": [
		// 				"1845107756996702312"
		// 			],
		// 			"author_id": "1830340867737178112"
		// 		},
		// 		...
		// 	]
		// }

		const stringifiedTweets = (tweets as any).data.map((tweet: any) => tweet.text).join("\n");
		console.log("stringifiedTweets", stringifiedTweets);

		// AI HERE


		const prompt =
			`${stringifiedTweets}

Determine if the user is based or biased. Specifically, based means that they express opinions which are not towing either side of the political spectrum and have independent thoughts separate from their political party.
Biased means that they are expressing opinions which are towing either side of the political spectrum and are not independent.
Give a score from 0 to 100 based on how based or biased the user is. A score of 0 indicates very biased and a score of 100 indicates very based.
Also give an "engagement" score from 0 to 100. A score of 0 indicates the user never says anything political or interesting and a score of 100 indicates the user is very engaged in social issues, politics and current events.
Do not award points for being political or not. Generally, just ignore the non-political content. We are interested in how much NPC-like behavior the user exhibits-- how much they repeat talking points and echo the mainstream narrative.

Your response should be in JSON block format with the following keys: 'explanation', 'basedScore', 'engagementScore', for example:
\`\`\`json
{
	"explanation": "The user is very based/biased because <good reasons>.",
	"basedScore": <0-100>,
	"engagementScore": <0-100>
}
\`\`\``;

		const xResponse = await callXApi(env, prompt);
		const xData = await xResponse.json();
		console.log("xData", xData);

		// parse the xData
		const content = (xData as any)?.choices[0]?.message?.content || "";
		console.log("content", content);

		let parsedXData = null;
		let retryCount = 0;

		while (parsedXData === null && retryCount < 5) {
			try {
				// find the JSON block
				let jsonStart = content.indexOf("```json");
				let jsonEnd = content.indexOf("```", jsonStart + 1);

				// if they don't exist, find the first { and last }
				if (jsonStart === -1 || jsonEnd === -1) {
					jsonStart = content.indexOf("{");
					jsonEnd = content.lastIndexOf("}") + 1;
				} else {
					jsonStart += "```json".length;
				}

				const jsonBlock = content.substring(jsonStart, jsonEnd).trim();
				console.log("jsonBlock", jsonBlock);
				parsedXData = JSON.parse(jsonBlock);
				console.log("parsedXData", parsedXData);
			} catch (err) {
				console.error(`Parsing attempt ${retryCount + 1} failed:`, err);
				retryCount++;
			}
		}

		if (parsedXData === null) {
			return new Response(
				JSON.stringify({ error: "Failed to parse AI response after 5 attempts" }),
				{ status: 500, headers: { "Content-Type": "application/json" } }
			);
		}

		if (!parsedXData.basedScore || !parsedXData.engagementScore) {
			return new Response(
				JSON.stringify({ error: "Invalid response from AI" }),
				{ headers: { "Content-Type": "application/json" } }
			);
		}

		return new Response(JSON.stringify(parsedXData), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (err) {
		console.error(err);
		return new Response(
			JSON.stringify({ error: err instanceof Error ? err.message : "An unknown error occurred" }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}
