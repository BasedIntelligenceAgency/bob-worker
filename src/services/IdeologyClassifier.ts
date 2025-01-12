import { Category, ClassificationResult } from '../types/classifier';

export class IdeologyClassifier {
	private categories: Category[];
	private categoryDescriptions: string;

	constructor(categoriesData: Category[]) {
		this.categories = categoriesData;
		this.categoryDescriptions = this.prepareCategoryDescriptions();
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

	async classifyUser(tweets: { text: string }[]): Promise<ClassificationResult> {
		const tweetTexts = tweets.map((tweet) => tweet.text);

		const prompt = `
    Task: Analyze these tweets to determine the user's ideological category and calculate various scores that measure their conviction, authenticity, and intellectual depth.

    Available Categories and their characteristics:
    ${this.categoryDescriptions}

    Tweets to analyze:
    ${JSON.stringify(tweetTexts.slice(0, 20), null, 2)}

    Analyze the tweets and provide a JSON response with exactly this structure, following these scoring guidelines:
    ${this.getPromptStructure()}
    `;

		try {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				},
				body: JSON.stringify({
					model: 'gpt-4',
					messages: [
						{
							role: 'system',
							content: `You are an expert in ideological analysis and political psychology.
              Your task is to provide detailed scoring and analysis, ensuring each score is carefully calculated based on evidence.
              Avoid default or zero scores - every score should reflect actual analysis of the content.
              Always respond with valid JSON matching the requested structure exactly.`,
						},
						{ role: 'user', content: prompt },
					],
					temperature: 0.3,
					max_tokens: 1500,
				}),
			});

			if (!response.ok) {
				throw new Error(`OpenAI API error: ${response.statusText}`);
			}

			const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
			const analysis = JSON.parse(data.choices[0].message.content);
			return this.validateResponse(analysis);
		} catch (error) {
			console.error('Error in classification:', error);
			return this.validateResponse({
				category: 'unknown',
				confidence: 0.0,
			});
		}
	}

	private getPromptStructure(): string {
		return `
    {
      "category": "name_of_category",
      "confidence": 0.0 to 1.0 (how confident are you in the categorization),
      "key_indicators": ["specific phrases, terms, or ideas that indicate their ideology"],
      "secondary_influences": ["other ideological influences evident in their tweets"],
      "language_patterns": ["recurring linguistic patterns or styles"],
      "conviction": 0.0 to 1.0 (scored based on consistency, strength, frequency, and assertiveness),
      "based_score": 0 to 100 (calculated from originality, independence, honesty, and engagement),
      "score_components": {
        "conviction": 0.0 to 1.0 (strength and consistency of beliefs),
        "authenticity": 0.0 to 1.0 (genuine expression vs. mimicry),
        "intellectual_rigor": 0.0 to 1.0 (depth of thought and reasoning),
        "contrarian": 0.0 to 1.0 (independence from mainstream narrative)
      }
    }`;
	}
}
