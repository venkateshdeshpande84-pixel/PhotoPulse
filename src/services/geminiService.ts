import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisMode } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const reviewImage = async (base64: string, mimeType: string, mode: AnalysisMode = 'wedding') => {
  const weddingPrompt = `You are an image reviewer for a wedding gallery selection workflow.
Your job is to analyze each wedding photo and rate it for album-worthiness based on clear visual and emotional criteria.
Goal: Help identify the best wedding photos of the couple for final selection.
Instructions:
- Analyze the expression, eye contact, couple presentation, pose, and technical quality.
- If it's a couple photo, verify if both are looking good.
- Provide a pose_tag for grouping (e.g., 'standing_embrace', 'sitting_close').`;

  const vacationPrompt = `You are a travel and vacation photo curator.
Your job is to analyze vacation photos and identify the most memorable, vibrant, and storytelling shots for a trip highlights reel.
Goal: Select photos that capture the essence of the destination, adventure, and personal joy.
Instructions:
- Analyze scenery, lighting, vibrancy, and candidate energy.
- Reward unique landmarks, candid laughter, and atmospheric views.
- Provide a pose_tag or category_tag (e.g., 'scenic_landscape', 'group_adventure', 'food_culture').`;

  const generalPrompt = `You are a professional image critic and reviewer.
Your job is to analyze the uploaded image and provide a comprehensive critique.
Goal: Provide actionable feedback and an objective rating for the image.
Instructions:
- Analyze lighting, composition, subject matter, and technical execution.
- If faces are present, evaluate expressions.
- Provide a pose_tag or category_tag for grouping similar types of images.`;

  let modePrompt = weddingPrompt;
  if (mode === 'vacation') modePrompt = vacationPrompt;
  else if (mode === 'general') modePrompt = generalPrompt;

  const prompt = `${modePrompt}

Additional Evaluation Rules:
1. Count the number of distinct human faces clearly visible in the image.
2. Provide a score for various criteria from 1 to 10.
3. Be honest and selective.

Output format:
Return your response in valid JSON only.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        { text: prompt },
        { inlineData: { data: base64, mimeType } }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          overall_score: { type: Type.NUMBER },
          short_verdict: { type: Type.STRING },
          face_count: { type: Type.NUMBER, description: "Number of human faces detected in the image." },
          criteria_scores: {
            type: Type.OBJECT,
            properties: {
              smile_expression: { type: Type.NUMBER, description: "Effectiveness of subject expression." },
              eye_contact_attention: { type: Type.NUMBER },
              couple_presentation: { type: Type.NUMBER, description: "How well subjects are presented together." },
              pose_composition: { type: Type.NUMBER },
              sharpness_technical_quality: { type: Type.NUMBER },
              emotional_impact: { type: Type.NUMBER },
              background_distractions: { type: Type.NUMBER },
              album_selection_potential: { type: Type.NUMBER }
            },
            required: [
              "smile_expression",
              "eye_contact_attention",
              "couple_presentation",
              "pose_composition",
              "sharpness_technical_quality",
              "emotional_impact",
              "background_distractions",
              "album_selection_potential"
            ]
          },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommended_action: { type: Type.STRING, description: "One of: Final Album, Shortlist, Maybe, Reject" },
          reasoning: { type: Type.STRING },
          pose_tag: { 
            type: Type.STRING, 
            description: "A short, descriptive tag for the pose or subject type. Use consistent tags for similar shots." 
          }
        },
        required: [
          "overall_score",
          "short_verdict",
          "face_count",
          "criteria_scores",
          "strengths",
          "weaknesses",
          "recommended_action",
          "reasoning",
          "pose_tag"
        ]
      }
    }
  });

  return JSON.parse(response.text);
};
