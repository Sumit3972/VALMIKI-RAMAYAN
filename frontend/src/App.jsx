import { useState, useEffect, useRef } from 'react';
import { fetchShlokas, fetchTranslation, fetchAudioUrls, fetchMetadata } from './api';
import { Volume2, Play, Pause, BookOpen, Loader2, ChevronDown, ChevronUp, Scroll, Languages, Headphones } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Kanda Name Mapping ──────────────────────────────────────────────
const KANDA_NAMES = {
  1: { hindi: 'बालकाण्ड', english: 'Balkand', short: 'बाल' },
  2: { hindi: 'अयोध्याकाण्ड', english: 'Ayodhyakand', short: 'अयो' },
  3: { hindi: 'अरण्यकाण्ड', english: 'Aranyakand', short: 'अरण्य' },
  4: { hindi: 'किष्किन्धाकाण्ड', english: 'Kishkindhakand', short: 'किष्किं' },
  5: { hindi: 'सुन्दरकाण्ड', english: 'Sundarkand', short: 'सुन्दर' },
  6: { hindi: 'युद्धकाण्ड', english: 'Yuddhakand', short: 'युद्ध' },
  7: { hindi: 'उत्तरकाण्ड', english: 'Uttarakand', short: 'उत्तर' },
};

function getKandaLabel(kandaNum) {
  const kanda = KANDA_NAMES[kandaNum];
  if (!kanda) return `Kanda ${kandaNum}`;
  return `${kanda.english}`;
}

function getKandaHindi(kandaNum) {
  return KANDA_NAMES[kandaNum]?.hindi || '';
}

// ── Shloka Card ─────────────────────────────────────────────────────
function ShlokaCard({ 
  shloka, 
  index,
  playingAudioId, 
  isAudioLoading, 
  onPlayAudio, 
  onStopAudio,
  currentAudioType 
}) {
  const [showTranslation, setShowTranslation] = useState(false);
  const [targetLang, setTargetLang] = useState('en');
  const [translationText, setTranslationText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState(null);
  const [audioType, setAudioType] = useState('sanskrit');

  const isPlaying = playingAudioId === shloka.id;
  const isLoadingAudio = isAudioLoading && playingAudioId === shloka.id;

  useEffect(() => {
    const loadTranslation = async () => {
      if (!showTranslation) return;
      
      setIsTranslating(true);
      setTranslationText('');
      setTranslationError(null);
      try {
        const data = await fetchTranslation(shloka.id, targetLang);
        setTranslationText(data.text);
      } catch (err) {
        console.error("Translation failed", err);
        setTranslationError("Translation failed. Please try again later.");
      } finally {
        setIsTranslating(false);
      }
    };
    loadTranslation();
  }, [shloka.id, targetLang, showTranslation, shloka.english]);

  const handleTogglePlay = () => {
    if (isPlaying) {
      onStopAudio();
    } else {
      onPlayAudio(shloka.id, audioType);
    }
  };

  const audioLabels = { sanskrit: 'संस्कृत', hi: 'हिन्दी', en: 'English' };
  const audioShort = { sanskrit: 'SA', hi: 'HI', en: 'EN' };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={`glass-panel rounded-2xl relative overflow-hidden group transition-all duration-300 ${isPlaying ? 'border-glow audio-playing ring-1 ring-primary/20' : 'hover:border-white/10'}`}
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
              <span className="text-primary text-xs sm:text-sm font-bold">{shloka.shloka_number?.split('.').pop() || '?'}</span>
            </div>
            <div className="hidden sm:block">
              <span className="text-[10px] text-textMuted uppercase tracking-widest font-medium">Shloka</span>
              <p className="text-xs text-textSecondary font-medium leading-none mt-0.5">{shloka.shloka_number}</p>
            </div>
          </div>
          
          {/* Audio Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Audio type tabs */}
            <div className="flex bg-surfaceHighlight/60 rounded-lg p-0.5 border border-white/5">
              {['sanskrit', 'hi', 'en'].map(type => (
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
                      ? 'bg-primary/20 text-primary shadow-sm' 
                      : 'text-textMuted hover:text-textSecondary'
                  }`}
                >
                  {audioShort[type]}
                </button>
              ))}
            </div>

            {/* Play/Pause button */}
            <button 
              onClick={handleTogglePlay}
              disabled={isAudioLoading && !isPlaying && playingAudioId !== shloka.id}
              className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg transition-all duration-200 disabled:opacity-40 ${
                isPlaying 
                  ? 'bg-primary text-background shadow-lg shadow-primary/30' 
                  : 'bg-surfaceHighlight border border-white/10 text-textMuted hover:text-white hover:border-primary/30 hover:bg-primary/10'
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
            onClick={() => setShowTranslation(!showTranslation)}
            className="flex items-center gap-2 text-textMuted hover:text-primary transition-colors duration-200 text-xs font-medium group/btn"
          >
            <Languages className="w-3.5 h-3.5 group-hover/btn:text-primary transition-colors" />
            <span>{showTranslation ? 'Hide Translation' : 'View Translation'}</span>
            {showTranslation ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* Translation Panel */}
        <AnimatePresence>
          {showTranslation && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="mt-3 overflow-hidden"
            >
              <div className="bg-surface/70 border border-border rounded-xl p-4">
                {/* Language tabs */}
                <div className="flex gap-2 mb-3">
                  {[
                    { key: 'hi', label: 'हिन्दी', labelEn: 'Hindi' },
                    { key: 'en', label: 'EN', labelEn: 'English' }
                  ].map(lang => (
                    <button 
                      key={lang.key}
                      disabled={isTranslating}
                      onClick={() => setTargetLang(lang.key)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold tracking-wide transition-all duration-200 ${
                        targetLang === lang.key 
                          ? 'bg-primary text-background shadow-sm' 
                          : 'bg-surfaceHighlight/60 text-textMuted hover:text-textSecondary border border-white/5'
                      }`}
                    >
                      {lang.labelEn}
                    </button>
                  ))}
                </div>

                <div className="min-h-[40px] flex items-center">
                  {isTranslating ? (
                    <div className="flex items-center gap-2 text-primary/70">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-xs font-medium">Translating...</span>
                    </div>
                  ) : translationError ? (
                    <p className="text-sm font-medium text-accent">
                      {translationError}
                    </p>
                  ) : (
                    <p className={`text-sm sm:text-base leading-relaxed ${
                      targetLang === 'hi' 
                        ? 'font-sanskrit text-textMain' 
                        : 'font-serif text-textSecondary'
                    }`}>
                      {translationText}
                    </p>
                  )}
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

  // Audio Player Logic
  const handlePlayAudio = async (shlokaId, type) => {
    if (audioRef.current) audioRef.current.pause();
    setPlayingAudioId(shlokaId);
    setCurrentAudioType(type);
    setIsAudioLoading(true);
    setAudioUrls([]);
    setCurrentAudioIndex(0);

    setAudioErrorId(null);

    try {
      const data = await fetchAudioUrls(shlokaId, type);
      if (data.urls && data.urls.length > 0) {
        setAudioUrls(data.urls);
      } else {
        setPlayingAudioId(null);
        setAudioErrorId(shlokaId);
      }
    } catch (err) {
      console.error("Audio generation failed", err);
      setPlayingAudioId(null);
      setAudioErrorId(shlokaId);
    } finally {
      setIsAudioLoading(false);
    }
  };

  const handleStopAudio = () => {
    if (audioRef.current) audioRef.current.pause();
    setPlayingAudioId(null);
  };

  useEffect(() => {
    if (audioUrls.length > 0 && audioRef.current) {
      audioRef.current.src = audioUrls[currentAudioIndex];
      audioRef.current.play().catch(e => {
        console.error("Play error:", e);
        setPlayingAudioId(null);
      });
    }
  }, [audioUrls, currentAudioIndex]);

  const handleAudioEnded = () => {
    if (currentAudioIndex < audioUrls.length - 1) {
      setCurrentAudioIndex(prev => prev + 1);
    } else {
      setPlayingAudioId(null);
      setCurrentAudioIndex(0);
    }
  };

  const currentKandaMeta = metadata.find(m => m.kanda === kanda);
  const availableSargas = currentKandaMeta ? currentKandaMeta.sargas : [];

  return (
    <div className="h-screen flex flex-col bg-gradient-sacred overflow-hidden">
      <audio ref={audioRef} onEnded={handleAudioEnded} className="hidden" />

      {/* ── Navbar ── */}
      <nav className="w-full bg-surface/90 backdrop-blur-xl z-50 border-b border-border flex-shrink-0">
        <div className="max-w-4xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3">
          <div className="flex items-center justify-between gap-3">
            {/* Logo */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
                <BookOpen className="text-primary w-4 h-4 sm:w-[18px] sm:h-[18px]" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-sm sm:text-base font-serif font-bold text-glow leading-none">Valmiki Ramayana</h1>
                <p className="text-[10px] text-textMuted mt-0.5 font-medium">वाल्मीकि रामायण</p>
              </div>
              <h1 className="sm:hidden text-sm font-serif font-bold text-glow">Ramayana</h1>
            </div>
            
            {/* Selectors */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Kanda selector */}
              <div className="flex flex-col">
                <label className="text-[9px] text-textMuted font-semibold uppercase tracking-[0.15em] mb-1 hidden sm:block">Kanda</label>
                <select 
                  id="kanda-select"
                  className="bg-surfaceHighlight border border-white/10 rounded-lg px-2.5 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-textMain focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all min-w-[110px] sm:min-w-[150px]"
                  value={kanda} 
                  onChange={e => {
                    const newKanda = Number(e.target.value);
                    setKanda(newKanda);
                    const meta = metadata.find(m => m.kanda === newKanda);
                    if (meta && meta.sargas.length > 0) setSarga(meta.sargas[0]);
                  }}
                >
                  {metadata.map(m => (
                    <option key={m.kanda} value={m.kanda}>
                      {getKandaLabel(m.kanda)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sarga selector */}
              <div className="flex flex-col">
                <label className="text-[9px] text-textMuted font-semibold uppercase tracking-[0.15em] mb-1 hidden sm:block">Sarga</label>
                <select 
                  id="sarga-select"
                  className="bg-surfaceHighlight border border-white/10 rounded-lg px-2.5 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-textMain focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all min-w-[70px] sm:min-w-[90px]"
                  value={sarga} 
                  onChange={e => setSarga(Number(e.target.value))}
                >
                  {availableSargas.map(s => (
                    <option key={s} value={s}>Sarga {s}</option>
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
                  {getKandaLabel(kanda)} — <span className="text-primary">Sarga {sarga}</span>
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
            <p className="text-sm text-textMuted font-medium">Loading shlokas...</p>
          </div>
        ) : shlokas.length === 0 ? (
          <div className="flex flex-col justify-center items-center h-60 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-surface border border-border flex items-center justify-center">
              <BookOpen className="w-7 h-7 text-textMuted" />
            </div>
            <p className="text-sm text-textMuted font-medium">No shlokas found for this selection.</p>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {shlokas.map((shloka, i) => (
              <ShlokaCard 
                key={shloka.id} 
                shloka={{...shloka, audioError: audioErrorId === shloka.id}}
                index={i}
                playingAudioId={playingAudioId}
                isAudioLoading={isAudioLoading}
                currentAudioType={currentAudioType}
                onPlayAudio={handlePlayAudio}
                onStopAudio={handleStopAudio}
              />
            ))}
          </div>
        )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
