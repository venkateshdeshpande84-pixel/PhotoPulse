import React, { useState, useEffect, useMemo } from "react";
import { 
  Camera, 
  LogOut, 
  Star, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Image as ImageIcon,
  ChevronRight,
  Heart,
  Eye,
  Layout,
  Zap,
  Trash2,
  ExternalLink,
  RefreshCw,
  Copy,
  Download
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { RatedPhoto, PhotoRating, LocalAnalysisStatus, AnalysisMode } from "./types";
import { reviewImage } from "./services/geminiService";
import { analyzeImageLocally, applyLocalDeduplication } from "./services/imageAnalysisService";

export default function App() {
  const [photos, setPhotos] = useState<RatedPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAnalyzingLocally, setIsAnalyzingLocally] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<RatedPhoto | null>(null);
  const [filter, setFilter] = useState<string>("All");
  const [mode, setMode] = useState<AnalysisMode>('wedding');

  const processedPhotos = useMemo(() => {
    // 1. First, respect local deduplication logic results
    // Local processing already marked some as 'duplicate' or 'low_res' in the photos state
    
    // 2. Group by pose_tag for AI survivors
    const groups: Record<string, RatedPhoto[]> = {};
    photos.forEach(p => {
      // Only group by AI pose tag for those that passed local filtering and have AI ratings
      if (p.rating?.pose_tag && p.localStatus === 'passed') {
        const tag = p.rating.pose_tag.toLowerCase().trim();
        if (!groups[tag]) groups[tag] = [];
        groups[tag].push(p);
      }
    });

    // 3. Second-level Deduplication (AI Pose Based)
    return photos.map(p => {
      // If already locally filtered as duplicate or low-res, respect that
      if (p.localStatus === 'duplicate' || p.localStatus === 'low_res') {
        return { ...p, isDuplicate: p.localStatus === 'duplicate' };
      }

      if (!p.rating?.pose_tag) return { ...p, isDuplicate: false };
      
      const tag = p.rating.pose_tag.toLowerCase().trim();
      const group = groups[tag];
      if (group.length <= 1) return { ...p, isDuplicate: false };

      // Sort group by manualKeep (true first), then overall_score descending
      const sortedGroup = [...group].sort((a, b) => {
        if (a.manualKeep && !b.manualKeep) return -1;
        if (!a.manualKeep && b.manualKeep) return 1;
        return (b.rating?.overall_score || 0) - (a.rating?.overall_score || 0);
      });
      
      const rank = sortedGroup.findIndex(item => item.id === p.id);
      
      let isDuplicate = false;
      let duplicateOf: string[] = [];
      
      if (group.length === 2) {
        isDuplicate = rank > 0;
        if (isDuplicate) {
          duplicateOf = [sortedGroup[0].id];
        }
      } else if (group.length > 2) {
        isDuplicate = rank > 1;
        if (isDuplicate) {
          duplicateOf = [sortedGroup[0].id, sortedGroup[1].id];
        }
      }

      return { ...p, isDuplicate, duplicateOf };
    });
  }, [photos]);

  const toggleManualKeep = (id: string) => {
    setPhotos(prev => {
      const updated = prev.map(p => p.id === id ? { ...p, manualKeep: !p.manualKeep } : p);
      if (selectedPhoto?.id === id) {
        const updatedPhoto = updated.find(p => p.id === id);
        if (updatedPhoto) setSelectedPhoto(updatedPhoto);
      }
      return updated;
    });
  };

  const deletePhoto = (id: string) => {
    if (selectedPhoto?.id === id) setSelectedPhoto(null);
    setPhotos(prev => prev.filter(p => p.id !== id));
  };

  const filteredPhotos = processedPhotos.filter(p => {
    if (filter === "Duplicates") return p.isDuplicate;
    if (filter === "All") return !p.isDuplicate; // Default view hides duplicates
    if (filter === "All (Inc. Duplicates)") return true;
    return p.rating?.recommended_action === filter && !p.isDuplicate;
  });

  const getPoseGroupCount = (poseTag?: string) => {
    if (!poseTag) return 0;
    const tag = poseTag.toLowerCase().trim();
    return photos.filter(p => p.rating?.pose_tag?.toLowerCase().trim() === tag).length;
  };

  const exportToCSV = () => {
    if (photos.length === 0) return;

    // Helper to escape CSV values for Excel compatibility
    const escapeCSV = (val: any) => {
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = ["Image Title", "Rating", "Faces", "Duplicate", "Ready for Album", "Comment"];
    const rows = processedPhotos.map(photo => {
      const title = photo.name;
      const rating = photo.rating?.overall_score ?? "N/A";
      const faces = photo.rating?.face_count ?? photo.faceCount ?? 0;
      
      let duplicateVal = "n/a";
      if (photo.isDuplicate && photo.duplicateOf && photo.duplicateOf.length > 0) {
        // Find the "Better Version" name
        const original = photos.find(p => p.id === photo.duplicateOf![0]);
        duplicateVal = original ? original.name : "Duplicate";
      }

      const readyForAlbum = photo.rating?.recommended_action === "Final Album" ? "Yes" : "No";
      
      // Combine AI verdict and local results into the comment
      const commentParts = [];
      if (photo.rating?.short_verdict) commentParts.push(photo.rating.short_verdict);
      if (photo.localReason) commentParts.push(photo.localReason);
      if (mode === 'wedding' && faces < 2) commentParts.push("Low face count for wedding");
      const comment = commentParts.length > 0 ? commentParts.join(" | ") : "Pending analysis";

      return [
        escapeCSV(title),
        escapeCSV(rating),
        escapeCSV(faces),
        escapeCSV(duplicateVal),
        escapeCSV(readyForAlbum),
        escapeCSV(comment)
      ];
    });

    const csvContent = [
      headers.map(h => escapeCSV(h)).join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `photopulse_review_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setIsAnalyzingLocally(true);
    const newPhotos: RatedPhoto[] = [];
    
    // Initial batch creation - Increased to 30 as requested for MVP
    const fileArray = Array.from(files).slice(0, 30) as File[];
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const photo: RatedPhoto = {
        id: `local-${Date.now()}-${i}`,
        name: file.name,
        mimeType: file.type,
        thumbnailLink: URL.createObjectURL(file),
        file: file,
        localStatus: 'pending'
      };
      
      // Immediate local analysis for resolution and hashing
      try {
        const analysis = await analyzeImageLocally(photo);
        newPhotos.push({ ...photo, ...analysis });
      } catch (err) {
        newPhotos.push({ ...photo, localStatus: 'pending', error: 'Local analysis failed' });
      }
    }

    // Apply local deduplication to the new batch
    const finalBatch = applyLocalDeduplication(newPhotos);
    
    setPhotos(prev => [...prev, ...finalBatch]);
    setIsAnalyzingLocally(false);
  };

  const rateAllPhotos = async () => {
    setLoading(true);
    // Only send images that passed local filters (not duplicates, not low-res) to AI
    const survivors = photos.filter(p => p.localStatus === 'passed' && !p.rating && !p.isRating);
    
    for (const photo of survivors) {
      await ratePhoto(photo);
    }
    setLoading(false);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]); // Remove data:image/jpeg;base64,
      };
      reader.onerror = error => reject(error);
    });
  };

  const ratePhoto = async (photo: any) => {
    if (photo.rating || photo.isRating) return;

    setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, isRating: true, error: undefined } : p));
    
    try {
      const base64 = await fileToBase64(photo.file);
      const rating = await reviewImage(base64, photo.mimeType, mode);
      
      setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, rating, isRating: false } : p));
      if (selectedPhoto?.id === photo.id) {
        setSelectedPhoto(prev => prev ? { ...prev, rating } : null);
      }
    } catch (e: any) {
      console.error("Rating failed", e);
      setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, isRating: false, error: "Failed to rate image" } : p));
    }
  };

  const getActionColor = (action?: string) => {
    switch (action) {
      case "Final Album": return "text-emerald-500 bg-emerald-50 border-emerald-200";
      case "Shortlist": return "text-blue-500 bg-blue-50 border-blue-200";
      case "Maybe": return "text-amber-500 bg-amber-50 border-amber-200";
      case "Reject": return "text-rose-500 bg-rose-50 border-rose-200";
      default: return "text-slate-400 bg-slate-50 border-slate-200";
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 hidden sm:block leading-none mb-1">PhotoPulse</h1>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden sm:block">Intelligent Photo Curator</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden lg:flex items-center bg-slate-100 rounded-xl p-1 border border-slate-200">
              <button
                onClick={() => setMode('wedding')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                  mode === 'wedding' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Wedding
              </button>
              <button
                onClick={() => setMode('vacation')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                  mode === 'vacation' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Vacation
              </button>
              <button
                onClick={() => setMode('general')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                  mode === 'general' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                General
              </button>
            </div>
            <button
              onClick={exportToCSV}
              disabled={photos.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:border-indigo-600 text-slate-600 rounded-xl transition-all font-semibold shadow-sm disabled:opacity-50"
              title="Export results to Excel/CSV"
            >
              <Download className="w-4 h-4" />
              <span className="hidden md:inline">Export CSV</span>
            </button>
            <label className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:border-indigo-600 text-slate-600 rounded-xl transition-all font-semibold cursor-pointer">
              {isAnalyzingLocally ? <Loader2 className="w-4 h-4 animate-spin text-indigo-600" /> : <ImageIcon className="w-4 h-4" />}
              <span>{isAnalyzingLocally ? 'Analysis...' : 'Upload Photos'}</span>
              <input 
                type="file" 
                multiple 
                accept="image/*" 
                className="hidden" 
                onChange={handleFileUpload}
                disabled={isAnalyzingLocally}
              />
            </label>
            <button
              onClick={rateAllPhotos}
              disabled={loading || isAnalyzingLocally || photos.length === 0 || photos.every(p => p.rating || p.localStatus !== 'passed')}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all font-semibold shadow-lg shadow-indigo-100 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              <span>{loading ? 'AI Rating...' : 'Critique Collection'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Photo Grid */}
        <div className="lg:col-span-7 xl:col-span-8">
          {photos.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4 overflow-x-auto pb-2 sm:pb-0 no-scrollbar">
                  <h2 className="text-2xl font-bold text-slate-900 mr-4">Your Gallery</h2>
                  {["All", "All (Inc. Duplicates)", "Duplicates", "Final Album", "Shortlist", "Maybe", "Reject"].map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all whitespace-nowrap border ${
                        filter === f 
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' 
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <span className="text-sm font-medium text-slate-500 bg-white px-3 py-1 rounded-full border border-slate-200 flex-shrink-0 ml-4">
                  {filteredPhotos.length} / {photos.length} Photos
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredPhotos.map((photo) => (
                  <motion.div
                    key={photo.id}
                    layoutId={photo.id}
                    onClick={() => setSelectedPhoto(photo)}
                    className={`group relative aspect-square bg-white rounded-2xl overflow-hidden border-2 cursor-pointer transition-all ${
                      selectedPhoto?.id === photo.id ? 'border-indigo-600 ring-4 ring-indigo-50' : 'border-transparent hover:border-slate-200'
                    }`}
                  >
                    <img 
                      src={photo.thumbnailLink} 
                      alt={photo.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    
                    {/* Rating Badge */}
                    <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                      {photo.localStatus === 'duplicate' && (
                        <div className="bg-slate-700 text-white px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm flex items-center gap-1 mb-1">
                          <Copy className="w-3 h-3" />
                          Near Identical
                        </div>
                      )}
                      {photo.localStatus === 'low_res' && (
                        <div className="bg-rose-500 text-white px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm flex items-center gap-1 mb-1">
                          <AlertCircle className="w-3 h-3" />
                          Low Res
                        </div>
                      )}
                      {photo.localStatus === 'passed' && photo.isDuplicate && (
                        <div className="bg-amber-500 text-white px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm flex items-center gap-1 mb-1">
                          <Copy className="w-3 h-3" />
                          Similar Pose
                        </div>
                      )}
                      {(photo.rating?.face_count !== undefined || photo.faceCount !== undefined) && (photo.rating?.face_count ?? photo.faceCount ?? 0) < 2 && photo.localStatus === 'passed' && (
                        <div className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm flex items-center gap-1 mb-1 ${
                          mode === 'wedding' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}>
                          <Eye className="w-3 h-3" />
                          {photo.rating?.face_count ?? photo.faceCount ?? 0} { (photo.rating?.face_count ?? photo.faceCount ?? 0) === 1 ? 'Face' : 'Faces' }
                        </div>
                      )}
                      {photo.localStatus === 'passed' && photo.rating === undefined && photo.faceCount === undefined && !photo.isRating && (
                        <div className="bg-slate-100 text-slate-400 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm flex items-center gap-1 mb-1 border border-slate-200">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Detecting...
                        </div>
                      )}
                      {photo.localStatus === 'passed' && !photo.isDuplicate && getPoseGroupCount(photo.rating?.pose_tag) > 1 && (
                        <div className="bg-indigo-600 text-white px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm flex items-center gap-1 mb-1">
                          <Layout className="w-3 h-3" />
                          +{getPoseGroupCount(photo.rating?.pose_tag) - 1} Similar
                        </div>
                      )}
                      {photo.rating && (
                        <>
                          <div className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${getActionColor(photo.rating.recommended_action)} shadow-sm`}>
                            {photo.rating.recommended_action}
                          </div>
                          <div className="bg-white/90 backdrop-blur px-2 py-1 rounded-lg text-xs font-bold text-slate-900 shadow-sm border border-slate-100 flex items-center gap-1">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            {photo.rating.overall_score}
                          </div>
                        </>
                      )}
                    </div>

                    {photo.isRating && (
                      <div className="absolute inset-0 bg-indigo-600/20 backdrop-blur-[2px] flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-white animate-spin" />
                      </div>
                    )}

                    {photo.error && (
                      <div className="absolute inset-0 bg-rose-500/20 backdrop-blur-[2px] flex items-center justify-center">
                        <AlertCircle className="w-8 h-8 text-white" />
                      </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-3">
                      <p className="text-white text-xs font-medium truncate w-full pr-8">{photo.name}</p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deletePhoto(photo.id);
                        }}
                        className="p-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-lg shadow-lg transition-colors"
                        title="Delete Photo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[400px] bg-white rounded-3xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mb-6">
                <ImageIcon className="w-10 h-10 text-indigo-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Upload Your Collection</h3>
              <p className="text-slate-500 mb-2 max-w-xs mx-auto">
                Select your mode and upload up to 30 photos. We'll find the best shots and group duplicates.
              </p>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-8">
                Powered by Gemini 3 Flash
              </p>
              <div className="flex flex-col items-center gap-6 mb-8">
                <div className="flex items-center bg-slate-100 rounded-2xl p-1.5 border border-slate-200">
                  <button
                    onClick={() => setMode('wedding')}
                    className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
                      mode === 'wedding' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Star className={`w-4 h-4 ${mode === 'wedding' ? 'fill-indigo-600' : ''}`} />
                    Wedding
                  </button>
                  <button
                    onClick={() => setMode('vacation')}
                    className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
                      mode === 'vacation' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Zap className="w-4 h-4" />
                    Vacation
                  </button>
                  <button
                    onClick={() => setMode('general')}
                    className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
                      mode === 'general' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <ImageIcon className="w-4 h-4" />
                    General
                  </button>
                </div>
                
                <label className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-semibold shadow-xl shadow-indigo-100 transition-all cursor-pointer flex items-center gap-2">
                  <ImageIcon className="w-5 h-5" />
                  Select Photos
                  <input 
                    type="file" 
                    multiple 
                    accept="image/*" 
                    className="hidden" 
                    onChange={handleFileUpload}
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Details Panel */}
        <div className="lg:col-span-5 xl:col-span-4">
          <div className="sticky top-28">
            <AnimatePresence mode="wait">
              {selectedPhoto ? (
                <motion.div
                  key={selectedPhoto.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"
                >
                  <div className="aspect-video relative group">
                    <img 
                      src={selectedPhoto.thumbnailLink} 
                      alt={selectedPhoto.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-4 right-4 flex gap-2">
                      <button
                        onClick={() => deletePhoto(selectedPhoto.id)}
                        className="p-2 bg-rose-500/90 backdrop-blur text-white rounded-xl shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-600"
                        title="Delete Photo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                    <div className="p-6">
                      <div className="flex items-start justify-between mb-6">
                        <div>
                          <h3 className="text-xl font-bold text-slate-900 mb-1 truncate max-w-[200px]">
                            {selectedPhoto.name}
                          </h3>
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-slate-500">
                          {selectedPhoto.width}x{selectedPhoto.height}
                        </p>
                        <span className="text-slate-300">•</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          selectedPhoto.localStatus === 'passed' ? 'text-emerald-600' : 'text-rose-600'
                        }`}>
                          {selectedPhoto.localStatus === 'passed' ? 'Valid' : selectedPhoto.localStatus.replace('_', ' ')}
                        </span>
                        <span className="text-slate-300">•</span>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                          <Eye className="w-3.5 h-3.5 text-slate-400" />
                          <span>
                            { (selectedPhoto.rating?.face_count !== undefined || selectedPhoto.faceCount !== undefined) 
                               ? `${selectedPhoto.rating?.face_count ?? selectedPhoto.faceCount} ${ (selectedPhoto.rating?.face_count ?? selectedPhoto.faceCount) === 1 ? 'Face' : 'Faces' }`
                               : 'Scanning...'
                            }
                          </span>
                        </div>
                      </div>
                        </div>
                        {selectedPhoto.localStatus === 'passed' && !selectedPhoto.rating && !selectedPhoto.isRating && (
                          <button
                            onClick={() => ratePhoto(selectedPhoto)}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
                          >
                            <Zap className="w-4 h-4" />
                            AI Critique
                          </button>
                        )}
                      </div>

                      {selectedPhoto.localStatus === 'passed' && mode === 'wedding' && (selectedPhoto.rating?.face_count ?? selectedPhoto.faceCount ?? 0) < 2 && (
                        <div className="p-4 rounded-2xl mb-6 flex items-start gap-3 border bg-slate-50 border-slate-200">
                          <Eye className="w-5 h-5 mt-0.5 text-slate-400" />
                          <div>
                            <h4 className="text-sm font-bold text-slate-700">
                              Low Face Count
                            </h4>
                            <p className="text-xs text-slate-500 mt-1">
                              { (selectedPhoto.rating?.face_count ?? selectedPhoto.faceCount ?? 0) === 0 
                                ? "No faces detected. This might be a landscape or detail shot." 
                                : "Only one face detected. Wedding albums usually focus on the couple." 
                              }
                            </p>
                          </div>
                        </div>
                      )}

                      {selectedPhoto.localStatus !== 'passed' && (
                        <div className={`p-4 rounded-2xl mb-6 flex items-start gap-3 border ${
                          selectedPhoto.localStatus === 'duplicate' ? 'bg-slate-50 border-slate-200' : 'bg-rose-50 border-rose-100'
                        }`}>
                          <AlertCircle className={`w-5 h-5 mt-0.5 ${
                            selectedPhoto.localStatus === 'duplicate' ? 'text-slate-400' : 'text-rose-500'
                          }`} />
                          <div>
                            <h4 className={`text-sm font-bold ${
                              selectedPhoto.localStatus === 'duplicate' ? 'text-slate-700' : 'text-rose-700'
                            }`}>
                              {selectedPhoto.localStatus === 'duplicate' ? 'Filtered as Duplicate' : 'Filtered for Quality'}
                            </h4>
                            <p className="text-xs text-slate-500 mt-1">
                              {selectedPhoto.localReason || "This photo doesn't meet the criteria for AI critique."}
                            </p>
                          </div>
                        </div>
                      )}

                    {selectedPhoto.isRating ? (
                      <div className="py-12 flex flex-col items-center justify-center text-center">
                        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
                        <p className="text-slate-900 font-bold mb-1">AI is Reviewing...</p>
                        <p className="text-sm text-slate-500">Analyzing smiles, composition, and lighting</p>
                      </div>
                    ) : selectedPhoto.rating ? (
                      <div className="space-y-6">
                        {/* Overall Score */}
                        <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <div className="w-14 h-14 bg-white rounded-xl shadow-sm flex items-center justify-center text-2xl font-black text-indigo-600 border border-slate-100">
                            {selectedPhoto.rating.overall_score}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <div className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${getActionColor(selectedPhoto.rating.recommended_action)}`}>
                                {selectedPhoto.rating.recommended_action}
                              </div>
                              {selectedPhoto.isDuplicate && (
                                <div className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200">
                                  Similar Pose
                                </div>
                              )}
                              {selectedPhoto.manualKeep && (
                                <div className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700 border border-indigo-200">
                                  Manually Kept
                                </div>
                              )}
                            </div>
                            <p className="text-sm font-medium text-slate-900 italic">"{selectedPhoto.rating.short_verdict}"</p>
                          </div>
                        </div>

                        {/* Pose Tag & Keep Button */}
                        <div className="px-4 py-3 bg-indigo-50 rounded-xl border border-indigo-100 flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2 text-indigo-600 mb-1">
                              <Layout className="w-3 h-3" />
                              <span className="text-[10px] font-bold uppercase tracking-wider">Pose Group</span>
                            </div>
                            <p className="text-xs font-medium text-indigo-900 capitalize">
                              {selectedPhoto.rating.pose_tag.replace(/_/g, ' ')}
                            </p>
                          </div>
                          <button
                            onClick={() => toggleManualKeep(selectedPhoto.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                              selectedPhoto.manualKeep 
                                ? 'bg-indigo-600 text-white shadow-md' 
                                : 'bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50'
                            }`}
                          >
                            <CheckCircle2 className={`w-3 h-3 ${selectedPhoto.manualKeep ? 'text-white' : 'text-indigo-600'}`} />
                            {selectedPhoto.manualKeep ? 'Kept' : 'Keep'}
                          </button>
                        </div>

                        {/* Better Versions Section */}
                        {selectedPhoto.isDuplicate && selectedPhoto.duplicateOf && selectedPhoto.duplicateOf.length > 0 && (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Recommended Alternatives</h4>
                              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                                Master: {photos.find(p => p.id === selectedPhoto.duplicateOf![0])?.name || 'Main Photo'}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              {selectedPhoto.duplicateOf.map(id => {
                                const betterPhoto = processedPhotos.find(p => p.id === id);
                                if (!betterPhoto) return null;
                                return (
                                  <div 
                                    key={id} 
                                    onClick={() => setSelectedPhoto(betterPhoto)}
                                    className="relative aspect-video rounded-xl overflow-hidden border border-slate-200 cursor-pointer hover:border-indigo-600 transition-all group"
                                  >
                                    <img 
                                      src={betterPhoto.thumbnailLink} 
                                      alt={betterPhoto.name}
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                    />
                                    <div className="absolute top-1 right-1 bg-white/90 backdrop-blur px-1.5 py-0.5 rounded text-[10px] font-black text-indigo-600 shadow-sm border border-slate-100 flex items-center gap-0.5">
                                      <Star className="w-2 h-2 fill-amber-400 text-amber-400" />
                                      {betterPhoto.rating?.overall_score}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Criteria Grid */}
                        <div className="grid grid-cols-2 gap-3">
                          <ScoreItem icon={<Heart className="w-3 h-3" />} label="Expression" score={selectedPhoto.rating.criteria_scores.smile_expression} />
                          <ScoreItem icon={<Eye className="w-3 h-3" />} label="Eye Contact" score={selectedPhoto.rating.criteria_scores.eye_contact_attention} />
                          <ScoreItem icon={<Layout className="w-3 h-3" />} label="Pose" score={selectedPhoto.rating.criteria_scores.pose_composition} />
                          <ScoreItem icon={<Zap className="w-3 h-3" />} label="Quality" score={selectedPhoto.rating.criteria_scores.sharpness_technical_quality} />
                        </div>

                        {/* Reasoning */}
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">AI Reasoning</h4>
                          <p className="text-sm text-slate-600 leading-relaxed">
                            {selectedPhoto.rating.reasoning}
                          </p>
                        </div>

                        {/* Strengths & Weaknesses */}
                        <div className="grid grid-cols-1 gap-4">
                          <div className="space-y-2">
                            <h4 className="text-xs font-bold text-emerald-500 uppercase tracking-widest">Strengths</h4>
                            {selectedPhoto.rating.strengths.map((s, i) => (
                              <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                                <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                                <span>{s}</span>
                              </div>
                            ))}
                          </div>
                          <div className="space-y-2">
                            <h4 className="text-xs font-bold text-rose-500 uppercase tracking-widest">Weaknesses</h4>
                            {selectedPhoto.rating.weaknesses.map((w, i) => (
                              <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                                <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                                <span>{w}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center border-2 border-dashed border-slate-100 rounded-2xl">
                        <Zap className="w-8 h-8 text-slate-200 mx-auto mb-3" />
                        <p className="text-sm text-slate-400">Select a photo and click Analyze<br/>to get AI feedback</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : (
                <div className="h-[600px] bg-white rounded-3xl border border-slate-200 border-dashed flex flex-col items-center justify-center p-8 text-center">
                  <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-4">
                    <ImageIcon className="w-8 h-8 text-slate-300" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">No Photo Selected</h3>
                  <p className="text-sm text-slate-500">
                    Choose a photo from your gallery to see detailed AI analysis and ratings.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}

function ScoreItem({ icon, label, score }: { icon: React.ReactNode, label: string, score: number }) {
  const getScoreColor = (s: number) => {
    if (s >= 8) return "text-emerald-600";
    if (s >= 6) return "text-amber-600";
    return "text-rose-600";
  };

  return (
    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-slate-400">{icon}</div>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-lg font-black ${getScoreColor(score)}`}>
        {score}<span className="text-[10px] text-slate-300 ml-0.5">/10</span>
      </div>
    </div>
  );
}
