import { Category, ClassificationResult } from '../types/classifier';

export class IdeologyClassifier {
	private categories: Category[];
	private categoryDescriptions: string;
	private env: { GROK_API_KEY: string; GROK_BASE_URL: string };

	constructor(categories: Category[], env: { GROK_API_KEY: string; GROK_BASE_URL: string }) {
		this.categories = categories;
		this.categoryDescriptions = this.prepareCategoryDescriptions();
		this.env = env;
	}

	private prepareCategoryDescriptions(): string {
		return this.categories
			.map(
				(category) => `
        Category: ${category.name}
        Language Markers: ${category.features.language_markers.slice(0, 5).join(', ')}
        Key Beliefs: ${category.features.beliefs.slice(0, 5).join(', ')}
        Cultural Indicators: ${category.features.cultural_signifiers.slice(0, 5).join(', ')}
        Common Hashtags: ${category.features.hashtags.slice(0, 5).join(', ')}
        `,
			)
			.join('\n');
	}

	private validateResponse(analysis: Partial<ClassificationResult>): ClassificationResult {
		const defaultResult: ClassificationResult = {
			category: 'unknown',
			confidence: 0.0,
			key_indicators: [],
			secondary_influences: [],
			language_patterns: [],
			conviction: 0.0,
			based_score: 0.0,
			score_components: {
				conviction: 0.0,
				authenticity: 0.0,
				intellectual_rigor: 0.0,
				contrarian: 0.0,
			},
		};

		const result = { ...defaultResult, ...analysis };

		// Calculate based_score from conviction if not present
		if (!result.based_score && result.conviction) {
			result.based_score = result.conviction * 100;
		}

		// Ensure confidence is between 0 and 1
		result.confidence = Math.max(0.0, Math.min(1.0, result.confidence));

		return result;
	}

	async classifyUser(tweets: { text: string }[], fakeApi: boolean): Promise<ClassificationResult> {
		const tweetTexts = tweets.map((tweet) => tweet.text);

		if (fakeApi) {
			return this.getFakeApiResponse();
		}

		const prompt = `
    Task: Analyze these tweets to determine the user's ideological category and calculate various scores.

    Available Categories and their characteristics:
    ${this.categoryDescriptions}

    Tweets to analyze:
    ${JSON.stringify(tweetTexts.slice(0, 20), null, 2)}

    Important Instructions:
    1. Analyze the language patterns, beliefs, and cultural indicators in the tweets
    2. Match them against the available categories
    3. Identify key phrases and recurring themes
    4. Calculate scores based on actual content, avoid default values
    5. Consider both explicit statements and implicit indicators
    6. Look for evidence of independent thinking vs group alignment
    7. Assess the strength and consistency of expressed beliefs

    Provide a detailed JSON response with meaningful scores and analysis.
    Each score should be justified by the content in the tweets.
    Never return default zero values - analyze the actual content.

    Response Structure:
    ${this.getPromptStructure()}
    `;

		try {
			const response = await fetch(`${this.env.GROK_BASE_URL}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.env.GROK_API_KEY}`,
				},
				body: JSON.stringify({
					model: 'grok-beta',
					messages: [
						{
							role: 'system',
							content: `You are an expert analyst in political psychology and ideological patterns.
							Your task is to provide detailed, evidence-based analysis of social media content.

							Key Requirements:
							- Analyze actual content thoroughly - never return default values
							- Look for specific language patterns and belief indicators
							- Match content against provided ideological categories
							- Calculate scores based on evidence in the content
							- Provide specific examples for your classifications
							- Return clean JSON without any markdown formatting

							If you can't determine a specific category, choose the closest match and explain why in key_indicators.`,
						},
						{ role: 'user', content: prompt },
					],
					temperature: 0.7,
					max_tokens: 2000,
				}),
			});

			if (!response.ok) {
				console.error('Grok API error:', await response.text());
				throw new Error(`Grok API error: ${response.statusText}`);
			}

			const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
			console.log('Raw API response:', data.choices[0].message.content); // Debug log

			try {
				// Clean the response content and remove markdown code blocks
				let cleanedContent = data.choices[0].message.content.trim();

				// Remove markdown code blocks if present
				cleanedContent = cleanedContent.replace(/```json\n|\n```/g, '');
				cleanedContent = cleanedContent.replace(/```\n|\n```/g, '');

				// Additional cleaning if needed
				cleanedContent = cleanedContent.trim();

				console.log('Cleaned content:', cleanedContent); // Debug log

				const analysis = JSON.parse(cleanedContent);
				return this.validateResponse(analysis);
			} catch (parseError) {
				console.error('JSON Parse Error:', parseError);
				console.error('Raw content:', data.choices[0].message.content);
				return this.validateResponse({
					category: 'unknown',
					confidence: 0.0,
					error: 'Failed to parse API response',
				});
			}
		} catch (error) {
			console.error('Error in classification:', error);
			return this.validateResponse({
				category: 'unknown',
				confidence: 0.0,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	}

	private getPromptStructure(): string {
		return `
{
  "category": "Must be one of the provided category names. Choose the best match based on evidence.",
  "confidence": "Score between 0.1 and 1.0 indicating certainty of classification",
  "key_indicators": ["List specific phrases or patterns that support the classification"],
  "secondary_influences": ["List other ideological elements found in the content"],
  "language_patterns": ["Describe specific linguistic patterns observed"],
  "conviction": "Score between 0.1 and 1.0 based on strength of expressed beliefs",
  "based_score": "Score between 1 and 100 measuring originality and independence of thought",
  "score_components": {
    "conviction": "Score between 0.1 and 1.0 measuring belief consistency",
    "authenticity": "Score between 0.1 and 1.0 measuring genuine expression",
    "intellectual_rigor": "Score between 0.1 and 1.0 measuring depth of thought",
    "contrarian": "Score between 0.1 and 1.0 measuring independence from mainstream"
  }
}`;
	}

	private getFakeApiResponse(): ClassificationResult {
		return {
			category: 'Tech Bro Cryptard',
			confidence: 0.6,
			key_indicators: [
				"Use of terms like 'building', 'creating', 'side project', 'AI agents', 'GitHub', 'tinkering'",
				"References to technology and coding ('GitHubCopilot', 'AI voice Government agent', 'OpenAI real-time voice api')",
				"Expressions of enthusiasm for technology and development ('this is so trueee', 'future is gonna be interesting')",
				"Mentions of productivity and efficiency ('doing is faster than thinking')",
			],
			secondary_influences: [
				'References to Elon Musk, indicating admiration for tech entrepreneurs',
				'Interest in open source community and collaboration',
			],
			language_patterns: [
				'Use of tech jargon and buzzwords common in the tech industry',
				'Frequent use of emojis to express excitement or agreement',
				"Emphasis on action over contemplation ('building >>> thinking to build')",
			],
			conviction: 0.8,
			based_score: 70,
			score_components: {
				conviction: 0.8,
				authenticity: 0.6,
				intellectual_rigor: 0.5,
				contrarian: 0.5,
			},
		};
	}
}
