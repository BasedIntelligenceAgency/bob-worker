
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
		const tweets = data || [];

		// AI HERE
		// const score = something_from_ai;
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
