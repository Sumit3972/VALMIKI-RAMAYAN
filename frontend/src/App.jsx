import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchShlokas,
  fetchTranslation,
  fetchAudioUrls,
  fetchMetadata,
  searchShlokas,
} from "./api";
import {
  Volume2,
  Play,
  Pause,
  BookOpen,
  Loader2,
  ChevronDown,
  ChevronUp,
  Scroll,
  Languages,
  Headphones,
  Search,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ── Kanda Name Mapping ──────────────────────────────────────────────
const KANDA_NAMES = {
  1: { hindi: "बालकाण्ड", english: "Balkand", short: "बाल" },
  2: { hindi: "अयोध्याकाण्ड", english: "Ayodhyakand", short: "अयो" },
  3: { hindi: "अरण्यकाण्ड", english: "Aranyakand", short: "अरण्य" },
  4: { hindi: "किष्किन्धाकाण्ड", english: "Kishkindhakand", short: "किष्किं" },
  5: { hindi: "सुन्दरकाण्ड", english: "Sundarkand", short: "सुन्दर" },
  6: { hindi: "युद्धकाण्ड", english: "Yuddhakand", short: "युद्ध" },
};

function getKandaLabel(kandaNum) {
  const kanda = KANDA_NAMES[kandaNum];
  if (!kanda) return `Kanda ${kandaNum}`;
  return `${kanda.english}`;
}

function getKandaHindi(kandaNum) {
  return KANDA_NAMES[kandaNum]?.hindi || "";
}

// ── Shloka Card ─────────────────────────────────────────────────────
function ShlokaCard({
  shloka,
  index,
  allShlokas,
  translationCache,
  prefetchInFlight,
  playingAudioId,
  isAudioLoading,
  onPlayAudio,
  onStopAudio,
  currentAudioType,
  onActiveShloka,
}) {
  const [showTranslation, setShowTranslation] = useState(false);
  const [targetLang, setTargetLang] = useState("en");
  const [translationData, setTranslationData] = useState({
    translation: "",
    context: "",
    insight: "",
  });
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState(null);
  const [audioType, setAudioType] = useState("sanskrit");

  const handleToggleTranslation = () => {
    const nextShow = !showTranslation;
    setShowTranslation(nextShow);
    if (nextShow && onActiveShloka) {
      onActiveShloka(shloka.id, shloka.shloka_number);
    }
  };

  // Parse structured response from backend
  function parseTranslation(raw) {
    if (!raw) return { translation: "", context: "", insight: "" };
    const translationMatch = raw.match(
      /\|\|\|TRANSLATION\|\|\|([\s\S]*?)(?=\|\|\|CONTEXT\|\|\||\|\|\|INSIGHT\|\|\||$)/,
    );
    const contextMatch = raw.match(
      /\|\|\|CONTEXT\|\|\|([\s\S]*?)(?=\|\|\|INSIGHT\|\|\||$)/,
    );
    const insightMatch = raw.match(/\|\|\|INSIGHT\|\|\|([\s\S]*)$/);

    const cleanText = (text) => {
      if (!text) return "";
      return text
        .replace(
          /^(translation|context|insight|अनुवाद|संदर्भ|विशेष दृष्टि)\s*[:：-]*\s*/i,
          "",
        )
        .replace(
          /^(1\.\s*translation|2\.\s*context|3\.\s*insight)\s*[:：-]*\s*/i,
          "",
        )
        .trim();
    };

    return {
      translation: cleanText(
        translationMatch ? translationMatch[1].trim() : raw.trim(),
      ),
      context: cleanText(contextMatch ? contextMatch[1].trim() : ""),
      insight: cleanText(insightMatch ? insightMatch[1].trim() : ""),
    };
  }

  const isPlaying = playingAudioId === shloka.id;
  const isLoadingAudio = isAudioLoading && playingAudioId === shloka.id;

  // Cache key helper
  const cacheKey = (id, lang) => `${id}_${lang}`;

  // Background prefetch — always in the SAME language the user is viewing
  // Uses prefetchInFlight Set to prevent duplicate concurrent requests
  const prefetchNext = useCallback(
    (currentIndex, lang) => {
      const PREFETCH_COUNT = 7;
      for (let offset = 1; offset <= PREFETCH_COUNT; offset++) {
        const nextShloka = allShlokas?.[currentIndex + offset];
        if (!nextShloka) break;

        const key = `${nextShloka.id}_${lang}`;

        // Skip if already cached
        if (translationCache.current[key]) continue;
        // Skip if a fetch is already in-flight for this exact key
        if (prefetchInFlight.current.has(key)) continue;

        // Mark as in-flight immediately to prevent duplicates
        prefetchInFlight.current.add(key);

        // Stagger requests: 200ms * offset for smooth parallel prefetch
        setTimeout(async () => {
          try {
            const data = await fetchTranslation(nextShloka.id, lang);
            translationCache.current[key] = parseTranslation(data.text);
            console.log(
              `[Prefetch ✓] ${lang.toUpperCase()} shloka ${nextShloka.id}`,
            );
          } catch {
            // Silent fail — prefetch is best-effort; key removed so it can retry later
          } finally {
            prefetchInFlight.current.delete(key);
          }
        }, offset * 200);
      }
    },
    [allShlokas, translationCache, prefetchInFlight],
  );

  useEffect(() => {
    const loadTranslation = async () => {
      if (!showTranslation) return;

      const key = cacheKey(shloka.id, targetLang);

      // ── Cache hit: instant load ──────────────────────────────
      if (translationCache.current[key]) {
        setTranslationData(translationCache.current[key]);
        prefetchNext(index, targetLang);
        return;
      }

      // ── Cache miss: fetch from API ───────────────────────────
      setIsTranslating(true);
      setTranslationData({ translation: "", context: "", insight: "" });
      setTranslationError(null);
      try {
        const data = await fetchTranslation(shloka.id, targetLang);
        const parsed = parseTranslation(data.text);
        translationCache.current[key] = parsed; // store in shared cache
        setTranslationData(parsed);
        prefetchNext(index, targetLang); // prefetch next 3
      } catch (err) {
        console.error("Translation failed", err);
        setTranslationError("Translation failed. Please try again later.");
      } finally {
        setIsTranslating(false);
      }
    };
    loadTranslation();
  }, [shloka.id, targetLang, showTranslation]);

  const handleTogglePlay = () => {
    if (isPlaying) {
      onStopAudio();
    } else {
      onPlayAudio(shloka.id, audioType);
    }
  };

  const audioLabels = { sanskrit: "संस्कृत", hi: "हिन्दी", en: "English" };
  const audioShort = { sanskrit: "SA", hi: "HI", en: "EN" };

  return (
    <motion.div
      id={`shloka-card-${shloka.id}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: index * 0.04,
        duration: 0.4,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      className={`glass-panel rounded-2xl relative overflow-hidden group transition-all duration-300 ${isPlaying ? "border-glow audio-playing ring-1 ring-primary/20" : "hover:border-white/10"}`}
    >
      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

      {/* Card body */}
      <div className="p-4 sm:p-5 md:p-6">
        {/* Header: Shloka number + Audio Controls */}
        <div className="flex items-center justify-between mb-4 gap-3">
          {/* Shloka badge */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
              <span className="text-primary text-xs sm:text-sm font-bold">
                {shloka.shloka_number?.split(".").pop() || "?"}
              </span>
            </div>
            <div className="hidden sm:block">
              <span className="text-[10px] text-textMuted uppercase tracking-widest font-medium">
                Shloka
              </span>
              <p className="text-xs text-textSecondary font-medium leading-none mt-0.5">
                {shloka.shloka_number}
              </p>
            </div>
          </div>

          {/* Audio Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Audio type tabs */}
            <div className="flex bg-surfaceHighlight/60 rounded-lg p-0.5 border border-white/5">
              {["sanskrit", "hi", "en"].map((type) => (
                <button
                  key={type}
                  disabled={isAudioLoading || isTranslating}
                  onClick={() => {
                    setAudioType(type);
                    if (isPlaying && currentAudioType !== type) onStopAudio();
                  }}
                  title={audioLabels[type]}
                  className={`px-2 py-1 sm:px-2.5 sm:py-1 rounded-md text-[10px] sm:text-[11px] font-semibold tracking-wide transition-all duration-200 ${
                    audioType === type
                      ? "bg-primary/20 text-primary shadow-sm"
                      : "text-textMuted hover:text-textSecondary"
                  }`}
                >
                  {audioShort[type]}
                </button>
              ))}
            </div>

            {/* Play/Pause button */}
            <button
              onClick={handleTogglePlay}
              disabled={
                isAudioLoading && !isPlaying && playingAudioId !== shloka.id
              }
              className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg transition-all duration-200 disabled:opacity-40 ${
                isPlaying
                  ? "bg-primary text-background shadow-lg shadow-primary/30"
                  : "bg-surfaceHighlight border border-white/10 text-textMuted hover:text-white hover:border-primary/30 hover:bg-primary/10"
              }`}
            >
              {isLoadingAudio ? (
                <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current ml-0.5" />
              )}
            </button>
          </div>
        </div>

        {/* Audio Error Message */}
        {shloka.audioError && (
          <div className="mb-4 text-xs font-medium text-accent bg-accent/10 border border-accent/20 rounded-md px-3 py-2">
            Failed to load audio. Please try again.
          </div>
        )}

        {/* Sanskrit Text */}
        <div className="mb-4">
          <p className="text-lg sm:text-xl md:text-2xl leading-relaxed sm:leading-loose font-sanskrit text-textMain tracking-wide text-glow-subtle">
            {shloka.sanskrit}
          </p>
        </div>
        {/* Translation Toggle */}
        <div className="border-t border-border pt-3">
          <button
            onClick={handleToggleTranslation}
            className="flex items-center gap-2 text-textMuted hover:text-primary transition-colors duration-200 text-xs font-semibold group/btn"
          >
            <Languages className="w-3.5 h-3.5 group-hover/btn:text-primary transition-colors" />
            <span>
              {showTranslation ? "Hide Translation" : "View Translation"}
            </span>
            {showTranslation ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
        </div>

        {/* Translation Panel */}
        <AnimatePresence>
          {showTranslation && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="mt-3 overflow-hidden"
            >
              <div className="bg-surface/70 border border-border rounded-xl p-4">
                {/* Language tabs */}
                <div className="flex gap-2 mb-3">
                  {[
                    { key: "hi", label: "हिन्दी", labelEn: "Hindi" },
                    { key: "en", label: "EN", labelEn: "English" },
                  ].map((lang) => (
                    <button
                      key={lang.key}
                      disabled={isTranslating}
                      onClick={() => setTargetLang(lang.key)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold tracking-wide transition-all duration-200 ${
                        targetLang === lang.key
                          ? "bg-primary text-background shadow-sm"
                          : "bg-surfaceHighlight/60 text-textMuted hover:text-textSecondary border border-white/5"
                      }`}
                    >
                      {lang.labelEn}
                    </button>
                  ))}
                </div>

                <div className="min-h-[40px]">
                  {isTranslating ? (
                    <div className="flex items-center gap-2 text-primary/70 py-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-xs font-medium">
                        Translating...
                      </span>
                    </div>
                  ) : translationError ? (
                    <p className="text-sm font-medium text-accent">
                      {translationError}
                    </p>
                  ) : translationData.translation ? (
                    <div className="space-y-3">
                      {/* Translation */}
                      <p
                        className={`text-sm sm:text-base leading-relaxed ${
                          targetLang === "hi"
                            ? "font-sanskrit text-textMain"
                            : "font-serif text-textSecondary"
                        }`}
                      >
                        {translationData.translation}
                      </p>

                      {/* Context */}
                      {translationData.context && (
                        <div className="border-t border-white/5 pt-3">
                          <p className="text-[10px] uppercase tracking-widest text-textMuted font-semibold mb-1.5">
                            Context
                          </p>
                          <p className="text-xs sm:text-sm leading-relaxed text-textMuted italic">
                            {translationData.context}
                          </p>
                        </div>
                      )}

                      {/* Insight — only shown when present */}
                      {translationData.insight && (
                        <div className="mt-2 rounded-lg bg-primary/5 border border-primary/15 px-3 py-2.5">
                          <p className="text-[10px] uppercase tracking-widest text-primary/70 font-semibold mb-1.5">
                            ✦ Insight
                          </p>
                          <p className="text-xs sm:text-sm leading-relaxed text-primary/80">
                            {translationData.insight}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Main App ────────────────────────────────────────────────────────
function App() {
  const [metadata, setMetadata] = useState([]);
  const [kanda, setKanda] = useState(1);
  const [sarga, setSarga] = useState(1);
  const [shlokas, setShlokas] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Global Audio State
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [audioErrorId, setAudioErrorId] = useState(null);
  const [currentAudioType, setCurrentAudioType] = useState(null);
  const [audioUrls, setAudioUrls] = useState([]);
  const [currentAudioIndex, setCurrentAudioIndex] = useState(0);
  const audioRef = useRef(null);
  // Shared translation cache: key = `${shlokaId}_${lang}`, value = parsed translation object
  const translationCache = useRef({});
  // Tracks in-flight prefetch keys to prevent duplicate concurrent requests
  const prefetchInFlight = useRef(new Set());

  // Shared audio cache: key = `${shlokaId}_${audioType}`, value = array of audio URLs
  const audioCache = useRef({});
  // Tracks in-flight audio prefetch keys to prevent duplicate concurrent requests
  const audioPrefetchInFlight = useRef(new Set());

  // Resume states
  const [resumeState, setResumeState] = useState(null);
  const [shouldScrollToShloka, setShouldScrollToShloka] = useState(null);

  // Theme State
  const [theme, setTheme] = useState(
    () => localStorage.getItem("valmiki_ramayan_theme") || "saffron",
  );

  // Sync Theme attribute on DOM root
  useEffect(() => {
    if (theme === "saffron") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    localStorage.setItem("valmiki_ramayan_theme", theme);
  }, [theme]);

  // Global Search State
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const handleSearchSubmit = async (e) => {
    if (e) e.preventDefault();
    if (searchQuery.trim().length < 2) return;

    setIsSearching(true);
    setSearchError(null);
    setSearchResults([]);

    try {
      const data = await searchShlokas(searchQuery);
      setSearchResults(data.results || []);
    } catch (err) {
      console.error(err);
      setSearchError("Search failed. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  // Load saved location on mount
  useEffect(() => {
    const saved = localStorage.getItem("valmiki_ramayan_resume");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.kanda && parsed.sarga) {
          setResumeState(parsed);
        }
      } catch (e) {
        console.error("Failed to parse resume state", e);
      }
    }
  }, []);

  // Sync / Hide banner when user manually navigates to the saved place
  useEffect(() => {
    if (
      resumeState &&
      resumeState.kanda === kanda &&
      resumeState.sarga === sarga
    ) {
      setResumeState(null);
    }
  }, [kanda, sarga, resumeState]);

  // Save current location helper
  const saveLocationToLocalStorage = useCallback(
    (kNum, sNum, shlokaId = null, shlokaNum = null) => {
      const state = {
        kanda: kNum,
        sarga: sNum,
        shlokaId,
        shlokaNumber: shlokaNum,
      };
      localStorage.setItem("valmiki_ramayan_resume", JSON.stringify(state));
    },
    [],
  );

  // Fetch Metadata
  useEffect(() => {
    const loadMeta = async () => {
      try {
        const data = await fetchMetadata();
        if (data.metadata && data.metadata.length > 0) {
          setMetadata(data.metadata);
          setKanda(data.metadata[0].kanda);
          setSarga(data.metadata[0].sargas[0]);
        }
      } catch (e) {
        console.error("Failed to load metadata", e);
      }
    };
    loadMeta();
  }, []);

  // Fetch Shlokas
  useEffect(() => {
    const loadShlokas = async () => {
      setIsLoading(true);
      try {
        const data = await fetchShlokas(kanda, sarga);
        setShlokas(data.shlokas || []);
        // Clear translation & audio cache and in-flight trackers when sarga changes
        translationCache.current = {};
        prefetchInFlight.current.clear();
        audioCache.current = {};
        audioPrefetchInFlight.current.clear();
        if (audioRef.current) audioRef.current.pause();
        setPlayingAudioId(null);
        setAudioErrorId(null);
      } catch (err) {
        console.error("Failed to load shlokas", err);
      } finally {
        setIsLoading(false);
      }
    };
    if (kanda && sarga) loadShlokas();
  }, [kanda, sarga]);

  // Scroll and highlight resumed shloka card
  useEffect(() => {
    if (shlokas.length > 0 && shouldScrollToShloka) {
      let attempts = 0;
      const tryScroll = () => {
        const element = document.getElementById(
          `shloka-card-${shouldScrollToShloka}`,
        );
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          element.classList.add("resume-highlight");
          setTimeout(() => {
            element.classList.remove("resume-highlight");
          }, 3000);
          setShouldScrollToShloka(null);
        } else if (attempts < 15) {
          attempts++;
          setTimeout(tryScroll, 100); // Retry every 100ms
        } else {
          setShouldScrollToShloka(null); // Give up
        }
      };
      setTimeout(tryScroll, 100);
    }
  }, [shlokas, shouldScrollToShloka]);

  // Audio Prefetcher for the next 7 shlokas
  const prefetchNextAudio = useCallback(
    (currentIndex, type) => {
      const PREFETCH_COUNT = 7;
      for (let offset = 1; offset <= PREFETCH_COUNT; offset++) {
        const nextShloka = shlokas?.[currentIndex + offset];
        if (!nextShloka) break;

        const key = `${nextShloka.id}_${type}`;

        if (audioCache.current[key]) continue;
        if (audioPrefetchInFlight.current.has(key)) continue;

        audioPrefetchInFlight.current.add(key);

        // Stagger audio requests by 300ms for fast parallel prefetch
        setTimeout(async () => {
          try {
            const data = await fetchAudioUrls(nextShloka.id, type);
            if (data.urls && data.urls.length > 0) {
              audioCache.current[key] = data.urls;
              console.log(
                `[Audio Prefetch ✓] ${type.toUpperCase()} shloka ${nextShloka.id}`,
              );
            }
          } catch {
            // Silent fail for prefetch
          } finally {
            audioPrefetchInFlight.current.delete(key);
          }
        }, offset * 100);
      }
    },
    [shlokas],
  );

  // Helper: directly start playing audio via audioRef (bypasses state batching delays)
  const playAudioDirect = useCallback((urls, index = 0) => {
    if (audioRef.current && urls && urls.length > 0) {
      audioRef.current.src = urls[index];
      audioRef.current.play().catch((e) => {
        console.error("Play error:", e);
        setPlayingAudioId(null);
      });
    }
  }, []);

  // Audio Player Logic
  const handlePlayAudio = async (shlokaId, type) => {
    if (audioRef.current) audioRef.current.pause();
    setPlayingAudioId(shlokaId);
    setCurrentAudioType(type);
    setIsAudioLoading(true);
    setAudioUrls([]);
    setCurrentAudioIndex(0);
    setAudioErrorId(null);

    const cacheKey = `${shlokaId}_${type}`;
    const currentIndex = shlokas.findIndex((s) => s.id === shlokaId);

    // Cache hit — play IMMEDIATELY, then prefetch in background
    if (audioCache.current[cacheKey]) {
      const urls = audioCache.current[cacheKey];
      setAudioUrls(urls);
      setIsAudioLoading(false);
      // Play directly without waiting for React re-render
      playAudioDirect(urls, 0);
      if (currentIndex !== -1) {
        // Defer prefetch so it doesn't block current playback
        setTimeout(() => prefetchNextAudio(currentIndex, type), 0);
        const currentShloka = shlokas[currentIndex];
        saveLocationToLocalStorage(
          kanda,
          sarga,
          shlokaId,
          currentShloka?.shloka_number,
        );
      }
      return;
    }

    // Cache miss — fetch, play IMMEDIATELY on response, then prefetch
    try {
      const data = await fetchAudioUrls(shlokaId, type);
      if (data.urls && data.urls.length > 0) {
        audioCache.current[cacheKey] = data.urls;
        setAudioUrls(data.urls);
        setIsAudioLoading(false);
        // Play directly without waiting for React re-render or prefetch completion
        playAudioDirect(data.urls, 0);
        if (currentIndex !== -1) {
          // Defer prefetch so it doesn't compete with immediate playback
          setTimeout(() => prefetchNextAudio(currentIndex, type), 0);
          const currentShloka = shlokas[currentIndex];
          saveLocationToLocalStorage(
            kanda,
            sarga,
            shlokaId,
            currentShloka?.shloka_number,
          );
        }
      } else {
        setPlayingAudioId(null);
        setAudioErrorId(shlokaId);
        setIsAudioLoading(false);
      }
    } catch (err) {
      console.error("Audio generation failed", err);
      setPlayingAudioId(null);
      setAudioErrorId(shlokaId);
      setIsAudioLoading(false);
    }
  };

  const handleStopAudio = () => {
    if (audioRef.current) audioRef.current.pause();
    setPlayingAudioId(null);
  };

  // Only handles audio index changes (multi-segment audio within a shloka)
  useEffect(() => {
    if (audioUrls.length > 0 && currentAudioIndex > 0 && audioRef.current) {
      audioRef.current.src = audioUrls[currentAudioIndex];
      audioRef.current.play().catch((e) => {
        console.error("Play error:", e);
        setPlayingAudioId(null);
      });
    }
  }, [currentAudioIndex]);

  const handleAudioEnded = () => {
    if (currentAudioIndex < audioUrls.length - 1) {
      setCurrentAudioIndex((prev) => prev + 1);
    } else {
      // Current shloka audio finished: Auto play next shloka's audio if available
      const currentIndex = shlokas.findIndex((s) => s.id === playingAudioId);
      if (currentIndex !== -1 && currentIndex < shlokas.length - 1) {
        const nextShloka = shlokas[currentIndex + 1];
        // Clear stale in-flight entries so all 7 prefetch slots are available for the next shloka
        audioPrefetchInFlight.current.clear();
        handlePlayAudio(nextShloka.id, currentAudioType);
      } else {
        setPlayingAudioId(null);
        setCurrentAudioIndex(0);
      }
    }
  };

  const currentKandaMeta = metadata.find((m) => m.kanda === kanda);
  const availableSargas = currentKandaMeta ? currentKandaMeta.sargas : [];

  return (
    <div className="h-screen flex flex-col bg-gradient-sacred overflow-hidden">
      <audio ref={audioRef} onEnded={handleAudioEnded} className="hidden" />

      {/* ── Navbar ── */}
      <nav className="w-full bg-surface/90 backdrop-blur-xl z-50 border-b border-border flex-shrink-0">
        <div className="max-w-4xl mx-auto px-3 sm:px-4 py-2 sm:py-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
            {/* Top row: Logo, Search trigger, Theme selector (mobile only) */}
            <div className="flex items-center justify-between w-full sm:w-auto">
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
                  <BookOpen className="text-primary w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                </div>
                <div>
                  <h1 className="text-sm sm:text-base font-serif font-bold text-glow leading-none">
                    Valmiki Ramayana
                  </h1>
                  <p className="text-[9px] sm:text-[10px] text-textMuted mt-0.5 font-medium">
                    वाल्मीकि रामायण
                  </p>
                </div>
              </div>

              {/* Mobile row right-side controls (Search & Theme) */}
              <div className="flex items-center gap-2 sm:hidden">
                <button
                  onClick={() => setSearchOpen(true)}
                  className="p-1.5 bg-surfaceHighlight border border-white/10 rounded-lg text-textMuted hover:text-primary hover:border-primary/30 transition-all flex items-center justify-center"
                  title="Search Shlokas"
                >
                  <Search className="w-4 h-4" />
                </button>

                <select
                  id="theme-select-mobile"
                  className="bg-surfaceHighlight border border-white/10 rounded-lg px-1.5 py-1 text-xs font-medium text-textMain outline-none min-w-[70px]"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                >
                  <option value="saffron">Saffron</option>
                  <option value="dandaka">Dandaka</option>
                  <option value="setu">Setu</option>
                </select>
              </div>
            </div>

            {/* Desktop controls or second-row selectors (Kanda & Sarga) on mobile */}
            <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 w-full sm:w-auto">
              {/* Desktop Search */}
              <button
                onClick={() => setSearchOpen(true)}
                className="hidden sm:flex p-2 bg-surfaceHighlight border border-white/10 rounded-lg text-textMuted hover:text-primary hover:border-primary/30 transition-all items-center justify-center"
                title="Search Shlokas"
              >
                <Search className="w-4 h-4" />
              </button>

              {/* Desktop Theme */}
              <div className="hidden sm:flex flex-col">
                <label className="text-[9px] text-textMuted font-semibold uppercase tracking-[0.15em] mb-1">
                  Theme
                </label>
                <select
                  id="theme-select"
                  className="bg-surfaceHighlight border border-white/10 rounded-lg px-2 sm:px-2.5 sm:py-2 text-xs sm:text-sm font-medium text-textMain focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all min-w-[70px] sm:min-w-[90px]"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                >
                  <option value="saffron">Saffron</option>
                  <option value="dandaka">Dandaka</option>
                  <option value="setu">Setu</option>
                </select>
              </div>

              {/* Kanda selector */}
              <div className="flex flex-col flex-1 sm:flex-initial">
                <label className="text-[9px] text-textMuted font-semibold uppercase tracking-[0.15em] mb-1 hidden sm:block">
                  Kanda
                </label>
                <select
                  id="kanda-select"
                  className="bg-surfaceHighlight border border-white/10 rounded-lg px-2 py-1 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-textMain focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all w-full sm:min-w-[150px]"
                  value={kanda}
                  onChange={(e) => {
                    const newKanda = Number(e.target.value);
                    setKanda(newKanda);
                    const meta = metadata.find((m) => m.kanda === newKanda);
                    if (meta && meta.sargas.length > 0) {
                      const newSarga = meta.sargas[0];
                      setSarga(newSarga);
                      saveLocationToLocalStorage(newKanda, newSarga);
                    }
                  }}
                >
                  {metadata.map((m) => (
                    <option key={m.kanda} value={m.kanda}>
                      {getKandaLabel(m.kanda)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sarga selector */}
              <div className="flex flex-col flex-shrink-0">
                <label className="text-[9px] text-textMuted font-semibold uppercase tracking-[0.15em] mb-1 hidden sm:block">
                  Sarga
                </label>
                <select
                  id="sarga-select"
                  className="bg-surfaceHighlight border border-white/10 rounded-lg px-2 py-1 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-textMain focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all min-w-[75px] sm:min-w-[90px]"
                  value={sarga}
                  onChange={(e) => {
                    const newSarga = Number(e.target.value);
                    setSarga(newSarga);
                    saveLocationToLocalStorage(kanda, newSarga);
                  }}
                >
                  {availableSargas.map((s) => (
                    <option key={s} value={s}>
                      Sarga {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Chapter Header ── */}
      <div className="w-full border-b border-border bg-surface/40 flex-shrink-0">
        <div className="max-w-4xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Scroll className="w-4 h-4 text-primary/60 hidden sm:block" />
              <div>
                <h2 className="text-sm sm:text-base font-serif font-bold text-textMain">
                  {getKandaLabel(kanda)} —{" "}
                  <span className="text-primary">Sarga {sarga}</span>
                </h2>
                <p className="text-xs text-textMuted mt-0.5 font-sanskrit">
                  {getKandaHindi(kanda)} — सर्ग {sarga}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-textMuted">
              <span className="text-[11px] sm:text-xs font-medium bg-surfaceHighlight/60 px-2.5 py-1 rounded-md border border-white/5">
                {shlokas.length} श्लोक
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Content (scrollable) ── */}
      <main className="flex-1 overflow-hidden">
        <div className="content-scroll h-full">
          <div className="max-w-2xl w-full mx-auto px-3 sm:px-4 py-4 sm:py-6">
            {isLoading ? (
              <div className="flex flex-col justify-center items-center h-60 gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
                <p className="text-sm text-textMuted font-medium">
                  Loading shlokas...
                </p>
              </div>
            ) : shlokas.length === 0 ? (
              <div className="flex flex-col justify-center items-center h-60 gap-3">
                <div className="w-16 h-16 rounded-2xl bg-surface border border-border flex items-center justify-center">
                  <BookOpen className="w-7 h-7 text-textMuted" />
                </div>
                <p className="text-sm text-textMuted font-medium">
                  No shlokas found for this selection.
                </p>
              </div>
            ) : (
              <div className="space-y-3 sm:space-y-4">
                {shlokas.map((shloka, i) => (
                  <ShlokaCard
                    key={shloka.id}
                    shloka={{
                      ...shloka,
                      audioError: audioErrorId === shloka.id,
                    }}
                    index={i}
                    allShlokas={shlokas}
                    translationCache={translationCache}
                    prefetchInFlight={prefetchInFlight}
                    playingAudioId={playingAudioId}
                    isAudioLoading={isAudioLoading}
                    currentAudioType={currentAudioType}
                    onPlayAudio={handlePlayAudio}
                    onStopAudio={handleStopAudio}
                    onActiveShloka={(id, num) =>
                      saveLocationToLocalStorage(kanda, sarga, id, num)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── Beautiful Resume Floating Banner ── */}
      <AnimatePresence>
        {resumeState && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md"
          >
            <div className="glass-panel rounded-2xl p-4 flex items-center justify-between gap-4 border border-primary/30 shadow-2xl shadow-primary/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center flex-shrink-0 animate-pulse">
                  <Headphones className="text-primary w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] text-primary uppercase tracking-widest font-semibold">
                    Resume Journey
                  </p>
                  <p className="text-xs text-textSecondary font-medium mt-0.5">
                    Continue {getKandaLabel(resumeState.kanda)} — Sarga{" "}
                    {resumeState.sarga}
                    {resumeState.shlokaNumber
                      ? ` (Shloka ${resumeState.shlokaNumber.split(".").pop()})`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setKanda(resumeState.kanda);
                    setSarga(resumeState.sarga);
                    if (resumeState.shlokaId) {
                      setShouldScrollToShloka(resumeState.shlokaId);
                    }
                    setResumeState(null);
                  }}
                  className="px-3.5 py-1.5 bg-primary text-background rounded-lg text-xs font-bold shadow-lg shadow-primary/20 hover:bg-primary-hover transition-all btn-pill"
                >
                  Resume
                </button>
                <button
                  onClick={() => {
                    setResumeState(null);
                  }}
                  className="p-1.5 rounded-lg hover:bg-white/5 text-textMuted hover:text-textSecondary transition-colors"
                >
                  <ChevronDown className="w-4 h-4 rotate-90" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Global Search Overlay Modal ── */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="glass-panel w-full max-w-2xl rounded-3xl overflow-hidden border border-white/10 shadow-2xl flex flex-col max-h-[85vh]"
            >
              {/* Search Header */}
              <div className="p-4 sm:p-6 border-b border-white/5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-primary font-serif font-bold text-base">
                  <Search className="w-5 h-5" />
                  <span>Explore Ramayana</span>
                </div>
                <button
                  onClick={() => {
                    setSearchOpen(false);
                    setSearchQuery("");
                    setSearchResults([]);
                    setSearchError(null);
                  }}
                  className="px-3 py-1.5 rounded-lg hover:bg-white/5 text-textMuted hover:text-textSecondary text-xs font-semibold tracking-wider uppercase transition-colors"
                >
                  Close
                </button>
              </div>

              {/* Input field */}
              <div className="px-4 sm:px-6 py-4 border-b border-white/5 bg-surface/30">
                <form onSubmit={handleSearchSubmit} className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="Search Sanskrit shlokas, English, or Hindi translations..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-surfaceHighlight/50 border border-white/10 rounded-xl pl-4 pr-10 py-3 text-sm text-textMain placeholder:text-textMuted focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none transition-all"
                      autoFocus
                    />
                    {isSearching && (
                      <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      </div>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={isSearching || searchQuery.trim().length < 2}
                    className="px-5 py-3 bg-primary text-background rounded-xl text-sm font-bold shadow-lg shadow-primary/15 hover:bg-primary-hover disabled:opacity-40 transition-all btn-pill"
                  >
                    Search
                  </button>
                </form>
                {searchQuery.trim().length > 0 &&
                  searchQuery.trim().length < 2 && (
                    <p className="text-[10px] text-textMuted mt-1.5 ml-1">
                      Type at least 2 characters to search
                    </p>
                  )}
              </div>

              {/* Search Results list */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 scrollbar-thin">
                {isSearching ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-xs text-textMuted">
                      Searching ancient scriptures...
                    </p>
                  </div>
                ) : searchError ? (
                  <p className="text-sm text-accent text-center py-8">
                    {searchError}
                  </p>
                ) : searchResults.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-sm text-textMuted italic">
                      {searchQuery
                        ? "No matches found. Try searching for 'dharma', 'Rama', 'bow', or 'Sita'."
                        : "Type keywords above to search across all Kandas and Sargas."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-textMuted font-semibold mb-2">
                      Found {searchResults.length} matches
                    </p>
                    {searchResults.map((res) => (
                      <div
                        key={res.id}
                        onClick={() => {
                          setKanda(res.kanda);
                          setSarga(res.sarga);
                          setShouldScrollToShloka(res.id);
                          setSearchOpen(false);
                          setSearchQuery("");
                          setSearchResults([]);
                        }}
                        className="p-4 rounded-xl bg-surfaceHighlight/40 border border-white/5 hover:border-primary/25 hover:bg-primary/5 cursor-pointer transition-all duration-200 group"
                      >
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <span className="text-[10px] text-primary uppercase font-bold tracking-wider">
                            {getKandaLabel(res.kanda)} — Sarga {res.sarga}
                          </span>
                          <span className="text-[10px] text-textMuted bg-surfaceHighlight px-2 py-0.5 rounded font-mono group-hover:text-textSecondary">
                            {res.shloka_number}
                          </span>
                        </div>
                        <p className="text-sm font-sanskrit text-textMain mb-2 leading-relaxed line-clamp-2">
                          {res.sanskrit}
                        </p>
                        <p className="text-xs text-textMuted line-clamp-2 font-serif group-hover:text-textSecondary">
                          {res.english}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
