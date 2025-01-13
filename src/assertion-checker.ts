import { z } from 'zod';
import { BasedScore, Env } from '.';

/**
 * ------------------------------------------------------------------
 * Types for Assertion Checking
 * ------------------------------------------------------------------
 */

const PoliticalBeliefSchema = z.object({
	belief: z.string().describe("Short, punchy statement of the user's political or social belief"),
	justification: z.string().describe('Short, punchy justification for the belief'),
	confidence: z.number(),
	importance: z.number().describe("How important this belief is to the user's identity. Should be between 0 and 1."),
});

const AssertionSchema = z.object({
	statement: z.string(),
	isFactCheckable: z.boolean(),
	modelConfidence: z.number().min(0).max(1),
	userConfidence: z.number().min(0).max(1),
	sourceContext: z.string().optional(),
});
type Assertion = z.infer<typeof AssertionSchema>;

const FactCheckResultSchema = z.object({
	statement: z.string(),
	isTrue: z.boolean(),
	confidence: z.number().min(0).max(1),
	explanation: z.string(),
	sources: z.array(z.string()),
});
type FactCheckResult = z.infer<typeof FactCheckResultSchema>;

/**
 * ------------------------------------------------------------------
 * Assertion Checker Class
 * ------------------------------------------------------------------
 */
export class AssertionChecker {
	private perplexityApiKey: string;
	private perplexityBaseUrl: string;

	constructor(apiKey: string, baseUrl: string = 'https://api.perplexity.ai') {
		this.perplexityApiKey = apiKey;
		this.perplexityBaseUrl = baseUrl;
	}

	/**
	 * Extract assertions from political beliefs
	 */
	async extractAssertions(beliefs: z.infer<typeof PoliticalBeliefSchema>[]): Promise<Assertion[]> {
		const systemMessage = `You are an expert fact-checker analyzing political beliefs.
			For each belief, provide a structured analysis in this format:

			Assertion 1:
			Statement: [the factual claim]
			Fact-checkable: [yes/no]
			Model Confidence: [0-1]
			User Confidence: [0-1]
			Context: [relevant context or explanation]

			Assertion 2:
			[and so on...]

			Focus on extracting verifiable factual claims from opinions.`;

		const userMessage = `Analyze these political beliefs for factual claims:
			${beliefs
				.map(
					(b) => `Belief: ${b.belief}\nJustification: ${b.justification}\nUser Confidence: ${b.confidence}\nImportance: ${b.importance}\n`,
				)
				.join('\n')}`;

		try {
			const response = await fetch(`${this.perplexityBaseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${this.perplexityApiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: 'llama-3.1-sonar-small-128k-online',
					messages: [
						{ role: 'system', content: systemMessage },
						{ role: 'user', content: userMessage },
					],
					temperature: 0.2,
					top_p: 0.9,
					max_tokens: 2048,
					search_domain_filter: ['perplexity.ai'],
					return_images: false,
					return_related_questions: false,
					search_recency_filter: 'month',
					top_k: 0,
					stream: false,
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error('Perplexity API error:', errorText);
				throw new Error(`Perplexity API error: ${errorText}`);
			}

			const result: any = await response.json();
			if (!result?.choices?.[0]?.message?.content) {
				throw new Error('Invalid response format from Perplexity API');
			}

			return this.parseAssertionsFromResponse(result.choices[0].message.content);
		} catch (error) {
			console.error('Error in extractAssertions:', error);
			return []; // Return empty array instead of throwing
		}
	}

	/**
	 * Parse assertions from LLM response
	 */
	private parseAssertionsFromResponse(content: string): Assertion[] {
		try {
			// First try parsing as JSON
			try {
				const parsed = JSON.parse(content);
				if (Array.isArray(parsed)) {
					return parsed
						.map((assertion: any) => {
							try {
								return AssertionSchema.parse({
									statement: assertion.statement,
									isFactCheckable: assertion.isFactCheckable,
									modelConfidence: assertion.modelConfidence,
									userConfidence: assertion.userConfidence,
									sourceContext: assertion.sourceContext,
								});
							} catch (error) {
								console.error('Failed to parse assertion:', error);
								return null;
							}
						})
						.filter((a): a is Assertion => a !== null);
				}
			} catch (e) {
				console.log('Failed to parse as JSON, attempting to parse markdown...', content);
			}

			// If JSON parsing fails, try parsing markdown format
			const assertions: Assertion[] = [];
			const sections = content.split(/(?=\d+\.|Assertion \d+:|\n\n)/g);

			for (const section of sections) {
				try {
					const assertion: Partial<Assertion> = {
						modelConfidence: 0.5, // Default values
						userConfidence: 0.5,
						isFactCheckable: false,
					};

					// Extract statement
					const statementMatch = section.match(/(?:Statement:|Claim:)\s*(.+?)(?=\n|$)/i);
					if (statementMatch) {
						assertion.statement = statementMatch[1].trim();
					}

					// Extract fact-checkable status
					const factCheckMatch = section.match(/(?:Fact.?checkable:|Verifiable:)\s*(.+?)(?=\n|$)/i);
					if (factCheckMatch) {
						assertion.isFactCheckable = /yes|true|verifiable/i.test(factCheckMatch[1]);
					}

					// Extract confidences
					const modelConfMatch = section.match(/(?:Model Confidence:|Confidence:)\s*([\d.]+)/i);
					if (modelConfMatch) {
						assertion.modelConfidence = parseFloat(modelConfMatch[1]);
					}

					const userConfMatch = section.match(/User Confidence:\s*([\d.]+)/i);
					if (userConfMatch) {
						assertion.userConfidence = parseFloat(userConfMatch[1]);
					}

					// Extract context
					const contextMatch = section.match(/(?:Context:|Analysis:|Explanation:)\s*(.+?)(?=\n\n|$)/is);
					if (contextMatch) {
						assertion.sourceContext = contextMatch[1].trim();
					}

					// Only add if we have the minimum required fields
					if (assertion.statement) {
						try {
							assertions.push(
								AssertionSchema.parse({
									statement: assertion.statement,
									isFactCheckable: assertion.isFactCheckable,
									modelConfidence: assertion.modelConfidence,
									userConfidence: assertion.userConfidence,
									sourceContext: assertion.sourceContext,
								}),
							);
						} catch (e) {
							console.warn('Failed to validate assertion:', assertion, e);
						}
					}
				} catch (e) {
					console.warn('Failed to parse section:', section, e);
				}
			}

			return assertions;
		} catch (error) {
			console.error('Failed to parse assertions:', error);
			return [];
		}
	}

	/**
	 * Fact check assertions using Perplexity
	 */
	async factCheckAssertions(assertions: Assertion[]): Promise<FactCheckResult[]> {
		const factCheckable = assertions.filter((a) => a.isFactCheckable);
		const results: FactCheckResult[] = [];

		for (const assertion of factCheckable) {
			const systemMessage = `You are a fact-checking expert. Analyze the claim and provide a response in this exact format:

Determination: [true/false]
Confidence: [number between 0 and 1]
Explanation: [brief explanation of the determination]
Sources:
- [source 1]
- [source 2]
- [source 3]

Do not include any other text or formatting.`;

			const userMessage = `Fact check this claim: "${assertion.statement}"
Context: ${assertion.sourceContext || 'None provided'}
User's confidence: ${assertion.userConfidence}

Please provide your analysis in the exact format specified.`;

			try {
				const response = await this.retryFetch(`${this.perplexityBaseUrl}/chat/completions`, {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${this.perplexityApiKey}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: 'llama-3.1-sonar-small-128k-online',
						messages: [
							{ role: 'system', content: systemMessage },
							{ role: 'user', content: userMessage },
						],
						temperature: 0.1, // Lower temperature for more consistent formatting
						top_p: 0.9,
						max_tokens: 2048,
						search_domain_filter: ['perplexity.ai'],
						return_images: false,
						return_related_questions: false,
						search_recency_filter: 'month',
						top_k: 0,
						stream: false,
					}),
				});

				const result: any = await response.json();

				if (result?.choices?.[0]?.message?.content) {
					const content = result.choices[0].message.content;

					const factCheck = this.parseFactCheckFromResponse(content);

					if (factCheck) {
						results.push({
							...factCheck,
							statement: assertion.statement,
						});
					}
				}
			} catch (error) {
				console.error(`Error fact-checking assertion "${assertion.statement}":`, error);
			}
		}

		return results;
	}

	/**
	 * Parse fact check results from LLM response
	 */
	private parseFactCheckFromResponse(content: string): Omit<FactCheckResult, 'statement'> | null {
		try {
			// Initialize result object
			const result: Partial<FactCheckResult> = {
				sources: [],
			};

			// Split content into lines and process each line
			const lines = content.split('\n');

			for (const line of lines) {
				const trimmedLine = line.trim();

				// Skip empty lines
				if (!trimmedLine) continue;

				// Parse determination (true/false)
				if (trimmedLine.toLowerCase().startsWith('determination:')) {
					const value = trimmedLine.split(':')[1].trim().toLowerCase();
					result.isTrue = value === 'true' || value === 'yes';
				}
				// Parse confidence
				else if (trimmedLine.toLowerCase().startsWith('confidence:')) {
					const value = parseFloat(trimmedLine.split(':')[1].trim());
					result.confidence = isNaN(value) ? 0.5 : Math.max(0, Math.min(1, value));
				}
				// Parse explanation
				else if (trimmedLine.toLowerCase().startsWith('explanation:')) {
					result.explanation = trimmedLine.split(':')[1].trim();
				}
				// Parse sources
				else if (trimmedLine.startsWith('-')) {
					const source = trimmedLine.substring(1).trim();
					if (source) {
						result.sources?.push(source);
					}
				}
			}

			// Validate that we have all required fields
			if (result.isTrue !== undefined && result.confidence !== undefined && result.explanation && result.sources?.length) {
				return result as Omit<FactCheckResult, 'statement'>;
			}

			console.warn('Missing required fields in fact check response:', result);
			return null;
		} catch (error) {
			console.error('Failed to parse fact check response:', error);
			console.error('Content that failed to parse:', content);
			return null;
		}
	}

	private async retryFetch(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				const response = await fetch(url, options);
				if (response.ok) return response;

				const errorText = await response.text();
				lastError = new Error(`API error: ${errorText}`);

				// Wait before retrying
				await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
			} catch (error) {
				lastError = error as Error;
				if (attempt === maxRetries - 1) break;
				await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
			}
		}

		throw lastError || new Error('Failed after max retries');
	}

	private isValidFactCheck(result: Partial<FactCheckResult>): result is Omit<FactCheckResult, 'statement'> {
		return (
			typeof result.isTrue === 'boolean' &&
			typeof result.confidence === 'number' &&
			result.confidence >= 0 &&
			result.confidence <= 1 &&
			typeof result.explanation === 'string' &&
			result.explanation.length > 0 &&
			Array.isArray(result.sources) &&
			result.sources.length > 0
		);
	}
}

/**
 * ------------------------------------------------------------------
 * Usage Example
 * ------------------------------------------------------------------
 */
export async function enhanceBasedScore(basedScore: BasedScore, env: Env): Promise<BasedScore & { factChecks: FactCheckResult[] }> {
	const checker = new AssertionChecker(env.PERPLEXITY_API_KEY);

	// Process mainstream and contrarian beliefs separately
	console.log('Processing mainstream beliefs:', basedScore.mainstream_beliefs);
	const mainstreamAssertions = await checker.extractAssertions(basedScore.mainstream_beliefs);

	console.log('Processing contrarian beliefs:', basedScore.contrarian_beliefs);
	const contrarianAssertions = await checker.extractAssertions(basedScore.contrarian_beliefs);

	// Combine assertions and fact check
	const allAssertions = [...mainstreamAssertions, ...contrarianAssertions];
	console.log('All assertions to fact check:', allAssertions);

	const factChecks = await checker.factCheckAssertions(allAssertions);
	console.log('Fact check results:', factChecks);

	// Calculate truthfulness score with weighted consideration
	const truthfulnessScore = calculateEnhancedTruthfulnessScore(factChecks, basedScore);

	return {
		...basedScore,
		truthfulness_score: truthfulnessScore,
		factChecks,
	};
}

function calculateEnhancedTruthfulnessScore(factChecks: FactCheckResult[], basedScore: BasedScore): number {
	if (factChecks.length === 0) return 50;

	// Weight mainstream vs contrarian claims differently
	const weightedScore = factChecks.reduce((acc, check) => {
		// Find if this is from mainstream or contrarian beliefs
		const isMainstream = basedScore.mainstream_beliefs.some((belief) => belief.belief.includes(check.statement));

		// Weight mainstream claims more heavily as they're more likely to be commonly verifiable
		const weight = isMainstream ? 1.2 : 0.8;
		return acc + (check.isTrue ? check.confidence * 100 * weight : 0);
	}, 0);

	return Math.round(weightedScore / factChecks.length);
}
