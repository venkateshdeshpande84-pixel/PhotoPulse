import { RatedPhoto, LocalAnalysisStatus } from "../types";

/**
 * Service to perform local image analysis using HTML5 Canvas.
 * This is "cheaper" because it runs on the client and filters images before Gemini.
 */
export async function analyzeImageLocally(photo: RatedPhoto): Promise<{
  localStatus: LocalAnalysisStatus;
  localReason?: string;
  perceptualHash?: string;
  width: number;
  height: number;
  faceCount?: number;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(photo.file);
    
    img.onload = async () => {
      URL.revokeObjectURL(objectUrl);
      
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      let faceCount = 0;
      
      // 1. Resolution Filter
      if (Math.max(width, height) < 800) {
        resolve({
          localStatus: 'low_res',
          localReason: `Resolution too low (${width}x${height}). Minimum 800px recommended.`,
          width,
          height
        });
        return;
      }

      // 2. Experimental Face Detection (Shape Detection API)
      // This is local and fast if supported by the browser.
      let detectionSuccessful = false;
      try {
        if ('FaceDetector' in window) {
          const faceDetector = new (window as any).FaceDetector({
            maxFaces: 20,
            fastMode: true
          });
          const faces = await faceDetector.detect(img);
          faceCount = faces.length;
          detectionSuccessful = true;
        }
      } catch (err) {
        console.warn("Local face detection failed or not supported:", err);
      }
      
      // 3. Perceptual Hashing (Average Hash)
      // This helps detect near-identical burst shots without AI
      const hashSize = 16; // 16x16 grid for higher accuracy in detecting "burst" shots
      const canvas = document.createElement('canvas');
      canvas.width = hashSize;
      canvas.height = hashSize;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error("Could not create canvas context"));
        return;
      }
      
      // Draw image to small grid (grayscale + rescale)
      ctx.drawImage(img, 0, 0, hashSize, hashSize);
      const imageData = ctx.getImageData(0, 0, hashSize, hashSize);
      const data = imageData.data;
      
      let totalBrightness = 0;
      const grayValues = new Uint8Array(hashSize * hashSize);
      
      for (let i = 0; i < data.length; i += 4) {
        // Luminance formula
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        grayValues[i / 4] = gray;
        totalBrightness += gray;
      }
      
      const average = totalBrightness / (hashSize * hashSize);
      let hash = "";
      for (const val of grayValues) {
        hash += val > average ? "1" : "0";
      }
      
      resolve({
        localStatus: 'passed',
        perceptualHash: hash,
        width,
        height,
        faceCount: detectionSuccessful ? faceCount : undefined
      });
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image for analysis"));
    };
    
    img.src = objectUrl;
  });
}

/**
 * Compares two perceptual hashes and returns the similarity (0 to 1)
 */
export function compareHashes(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return 0;
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }
  return 1 - (distance / hash1.length);
}

/**
 * Filter and group near-identical photos locally
 * Threshold 0.95 is usually safe for "burst" shots
 */
export function applyLocalDeduplication(photos: RatedPhoto[]): RatedPhoto[] {
  const threshold = 0.92; // Adjust for "near-identical"
  const survivors = photos.filter(p => p.localStatus === 'passed' && p.perceptualHash);
  
  const results = [...photos];
  const processedIds = new Set<string>();

  for (let i = 0; i < survivors.length; i++) {
    const p1 = survivors[i];
    if (processedIds.has(p1.id)) continue;
    
    const group = [p1];
    processedIds.add(p1.id);

    for (let j = i + 1; j < survivors.length; j++) {
      const p2 = survivors[j];
      if (processedIds.has(p2.id)) continue;
      
      if (compareHashes(p1.perceptualHash!, p2.perceptualHash!) > threshold) {
        group.push(p2);
        processedIds.add(p2.id);
      }
    }

    if (group.length > 1) {
      // In a burst/near-identical group, we pick the one with highest resolution (or first as proxy)
      // and mark others as duplicates.
      group.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
      
      const winner = group[0];
      group.slice(1).forEach(dup => {
        const photoIdx = results.findIndex(r => r.id === dup.id);
        if (photoIdx !== -1) {
          results[photoIdx] = {
            ...results[photoIdx],
            localStatus: 'duplicate',
            localReason: `Near-identical to ${winner.name}`,
            duplicateOf: [winner.id],
            isDuplicate: true
          };
        }
      });
    }
  }

  return results;
}
