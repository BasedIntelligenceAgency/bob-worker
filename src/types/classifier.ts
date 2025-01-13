export interface CategoryFeatures {
	language_markers: string[];
	beliefs: string[];
	cultural_signifiers: string[];
	hashtags: string[];
}

export interface Category {
	name: string;
	features: CategoryFeatures;
}

export interface ScoreComponents {
	conviction: number;
	authenticity: number;
	intellectual_rigor: number;
	contrarian: number;
}

export interface ClassificationResult {
	category: string;
	confidence: number;
	key_indicators: string[];
	secondary_influences: string[];
	language_patterns: string[];
	conviction: number;
	based_score: number;
	score_components: ScoreComponents;
}
