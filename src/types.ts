export interface RatingCriteria {
  smile_expression: number;
  eye_contact_attention: number;
  couple_presentation: number;
  pose_composition: number;
  sharpness_technical_quality: number;
  emotional_impact: number;
  background_distractions: number;
  album_selection_potential: number;
}

export interface PhotoRating {
  overall_score: number;
  short_verdict: string;
  criteria_scores: RatingCriteria;
  strengths: string[];
  weaknesses: string[];
  recommended_action: "Final Album" | "Shortlist" | "Maybe" | "Reject";
  reasoning: string;
  pose_tag: string;
  face_count?: number;
}

export type LocalAnalysisStatus = 'pending' | 'duplicate' | 'low_res' | 'passed' | 'no_faces';
export type AnalysisMode = 'wedding' | 'vacation' | 'general';

export interface RatedPhoto {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink: string;
  file: File;
  rating?: PhotoRating;
  isRating?: boolean;
  error?: string;
  
  // Local Analysis Fields
  localStatus: LocalAnalysisStatus;
  localReason?: string;
  perceptualHash?: string;
  width?: number;
  height?: number;
  faceCount?: number;
  
  // Grouping Logic
  isDuplicate?: boolean;
  duplicateOf?: string[];
  manualKeep?: boolean;
}
