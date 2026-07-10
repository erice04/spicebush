export interface PcaPoint {
  id: number;
  pc1: number;
  pc2: number;
  sex: string | null;
  sex_known: boolean;
  is_prediction: boolean;
  probability_female: number | null;
}

export interface PcaLoading {
  variable: string;
  label: string;
  pc1: number;
  pc2: number;
}

export interface PcaResult {
  points: PcaPoint[];
  loadings: PcaLoading[];
  explained_variance_ratio: number[];
}

export interface ConfusionMatrix {
  labels: string[];
  matrix: number[][];
}

export interface ClassificationPrediction {
  id: number;
  predicted_sex: string;
  probability_female: number;
  is_prediction: boolean;
  evaluation: string;
  actual_sex?: string | null;
  sex?: string | null;
}

export interface ClassificationResult {
  labeled_count: number;
  unlabeled_count: number;
  loocv_accuracy: number;
  confusion_matrix: ConfusionMatrix;
  loocv_predictions: ClassificationPrediction[];
  predictions: ClassificationPrediction[];
}

export interface PreprocessingInfo {
  feature_columns: string[];
  labeled_sex_values: string[];
  unlabeled_sex_values: string[];
  imputed_features: Record<string, string>;
  pca_sample_size: number;
  classification_sample_size: number;
}

export interface AnalysisResponse {
  pca: PcaResult;
  classification: ClassificationResult;
  preprocessing: PreprocessingInfo;
}
