import { useState, useRef, useMemo } from 'react';
import { 
  Mic, 
  Play, 
  Download, 
  Eye, 
  EyeOff, 
  Settings2, 
  Type, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  RotateCcw,
  Volume2,
  ChevronRight,
  Sparkles,
  Check,
  X,
  Share2,
  ExternalLink,
  HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import { cn } from './lib/utils';

// --- Types ---
interface Question {
  question: string;
  options: string[];
  correctIndex: number;
}

interface LanguageConfig {
  name: string;
  variants: string[];
  instruction: string;
  quizPrompt: string;
}

// --- Constants ---
const TEXT_MODEL = "gemini-3-flash-preview";
const TTS_MODEL = "gemini-3.1-flash-tts-preview";

const LENGTHS = {
  short: { label: 'Corto', words: '50-75', icon: Clock },
  medium: { label: 'Medio', words: '125-150', icon: Clock },
  long: { label: 'Largo', words: '250-300', icon: Clock }
};

const LANGUAGES: Record<string, LanguageConfig> = {
  en: { 
    name: 'Inglés', 
    variants: ['American', 'British', 'Australian'], 
    instruction: 'Create a natural English {level} level monologue or short story about "{topic}". The length must be approximately {words} words. Focus on natural speech patterns.', 
    quizPrompt: 'Based on the provided text, generate 5 multiple-choice questions in English. Each question must have 4 options and one clearly correct answer. Return ONLY a JSON object: { "questions": [{ "question": "string", "options": ["string"], "correctIndex": number }] }' 
  },
  es: { 
    name: 'Español', 
    variants: ['España', 'México', 'Argentina'], 
    instruction: 'Crea un monólogo o historia natural en español nivel {level} sobre "{topic}". La extensión debe ser de aproximadamente {words} palabras. Usa lenguaje auténtico.', 
    quizPrompt: 'Basándote en el texto, genera 5 preguntas de tipo test en español para evaluar la comprensión. Cada pregunta debe tener 4 opciones y una respuesta correcta. Devuelve ÚNICAMENTE un objeto JSON: { "questions": [{ "question": "string", "options": ["string"], "correctIndex": number }] }' 
  },
  fr: { 
    name: 'Francés', 
    variants: ['France', 'Québec'], 
    instruction: 'Créez un monologue ou une histoire naturelle en français de niveau {level} sur "{topic}". Environ {words} mots.', 
    quizPrompt: 'Sur la base du texte, générez 5 questions à choix multiples en français. Chaque question doit avoir 4 opciones. Renvoyez UNIQUEMENT un objet JSON.' 
  },
  de: { 
    name: 'Alemán', 
    variants: ['Standard', 'Bayerisch'], 
    instruction: 'Erstellen Sie einen natürlichen deutschen Monolog auf {level}-Niveau über "{topic}". Etwa {words} Wörter.', 
    quizPrompt: 'Erstellen Sie basierend auf dem Text 5 Multiple-Choice-Fragen auf Deutsch. Geben Sie NUR ein JSON-Objekt zurück.' 
  }
};

// --- Utilities ---
const pcmToWav = (pcmData: Int16Array, sampleRate: number): Blob => {
  const buffer = new ArrayBuffer(44 + pcmData.length * 2);
  const view = new DataView(buffer);
  const writeString = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 32 + pcmData.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcmData.length * 2, true);
  for (let i = 0; i < pcmData.length; i++) view.setInt16(44 + i * 2, pcmData[i], true);
  
  return new Blob([buffer], { type: 'audio/wav' });
};

// --- Main Component ---
export default function App() {
  // Config
  const [lang, setLang] = useState('en');
  const [topic, setTopic] = useState('');
  const [variant, setVariant] = useState('American');
  const [level, setLevel] = useState('B1-B2');
  const [length, setLength] = useState<keyof typeof LENGTHS>('medium');
  const [gender, setGender] = useState<'Female' | 'Male'>('Female');

  const [customApiKey, setCustomApiKey] = useState('');
  const [useSystemKey, setUseSystemKey] = useState(true);

  // Interaction State
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [script, setScript] = useState('');
  const [quiz, setQuiz] = useState<Question[] | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Interaction State
  const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});
  const [showResults, setShowResults] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showShareHelp, setShowShareHelp] = useState(false);

  // Refs
  const audioRef = useRef<HTMLAudioElement>(null);

  const sharedUrl = "https://ais-pre-glifkwdah3ibbigpdeprb5-21298071089.europe-west2.run.app";

  const handleGenerate = async () => {
    const activeKey = useSystemKey ? process.env.GEMINI_API_KEY : customApiKey;

    if (!topic || !activeKey) {
      if (!topic) setError("Por favor, introduce un tema para el ejercicio.");
      if (!activeKey) setError("Clave de API no configurada. Por favor, introdúcela para continuar.");
      return;
    }

    const ai = new GoogleGenAI({ apiKey: activeKey });

    setIsGenerating(true);
    setError(null);
    setAudioUrl(null);
    setQuiz(null);
    setScript('');
    setUserAnswers({});
    setShowResults(false);
    setShowTranscript(false);

    try {
      const cfg = LANGUAGES[lang];
      const selectedLength = LENGTHS[length];
      
      // 1. Generate text
      const textPrompt = cfg.instruction
        .replace('{level}', level)
        .replace('{topic}', topic)
        .replace('{words}', selectedLength.words);

      const tResp = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: textPrompt
      });
      const generatedText = tResp.text;
      if (!generatedText) throw new Error("No text generated");
      setScript(generatedText);

      // 2. Generate quiz
      const qResp = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: `Texto original: ${generatedText}\n\nTarea técnica: ${cfg.quizPrompt}`,
        config: { responseMimeType: "application/json" }
      });
      const quizJson = qResp.text;
      if (quizJson) {
        const quizData = JSON.parse(quizJson);
        setQuiz(quizData.questions);
      }

      // 3. Generate audio (TTS)
      const voicePrompt = `Actúa como profesor de idiomas. Lee el siguiente texto de forma clara, pausada y con acento ${variant} (${cfg.name}). Eres una voz ${gender === 'Female' ? 'femenina' : 'masculina'}. TEXTO A LEER: ${generatedText}`;
      
      const aResp = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ parts: [{ text: voicePrompt }] }],
        config: { 
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: gender === 'Female' ? 'Kore' : 'Charon' 
              }
            }
          }
        }
      });

      const audioPart = aResp.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.includes('audio'));
      
      if (audioPart?.inlineData) {
        const pcmB64 = audioPart.inlineData.data;
        const bStr = atob(pcmB64);
        const pcm = new Int16Array(bStr.length / 2);
        for (let i = 0; i < pcm.length; i++) {
          pcm[i] = bStr.charCodeAt(i * 2) | (bStr.charCodeAt(i * 2 + 1) << 8);
        }
        const blob = pcmToWav(pcm, 24000);
        setAudioUrl(URL.createObjectURL(blob));
      }

    } catch (e) {
      console.error(e);
      setError("Ocurrió un problema en la generación. Los modelos multimodales pueden tener límites de cuota.");
    } finally {
      setIsGenerating(false);
    }
  };

  const score = useMemo(() => {
    if (!quiz) return 0;
    return Object.entries(userAnswers).reduce((acc, [idx, ans]) => {
      const qIdx = parseInt(idx);
      return acc + (ans === quiz[qIdx].correctIndex ? 1 : 0);
    }, 0);
  }, [userAnswers, quiz]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 selection:bg-blue-500/30 pb-20 font-sans">
      {/* Header */}
      <header className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 sticky top-0 z-30 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-900/20">
            <Mic className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-white flex items-center gap-2">
            Auditiva <span className="text-slate-500 font-normal text-sm hidden sm:inline">AI Lab</span>
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowShareHelp(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold px-3 py-1.5 rounded-md transition-all shadow-lg shadow-blue-900/20"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Compartir / Embeber</span>
          </button>
          <div className="hidden md:flex bg-slate-800 rounded-md px-3 py-1.5 items-center gap-2 text-[10px] font-bold uppercase tracking-widest border border-slate-700 text-slate-400">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            Status: Engine Active
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 md:p-6 grid grid-cols-12 gap-4">
        
        {/* Left Column: Configuration Bento Box */}
        <section className="col-span-12 lg:col-span-4 flex flex-col gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/5 rounded-full blur-3xl -mr-16 -mt-16" />
            
            <div className="flex items-center gap-2 mb-6 relative z-10">
              <Settings2 className="w-4 h-4 text-blue-500" />
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Configuration</h2>
            </div>

            <div className="space-y-5 relative z-10">
              {/* API Key Configuration */}
              <div className="space-y-3 p-3 bg-slate-950/50 border border-slate-800 rounded-xl">
                <div className="flex items-center justify-between">
                   <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">API Key Access</label>
                   <button 
                    onClick={() => setUseSystemKey(!useSystemKey)}
                    className="text-[9px] font-bold text-blue-500 hover:underline uppercase"
                   >
                    {useSystemKey ? 'Usar propia' : 'Usar sistema'}
                   </button>
                </div>
                {!useSystemKey ? (
                  <input 
                    type="password"
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    placeholder="Pega tu API Key de AI Studio..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                ) : (
                  <div className="px-3 py-2 bg-slate-900/50 rounded-lg border border-slate-800/50 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                    <span className="text-[10px] font-medium text-slate-500">Sistema Activo (Auto)</span>
                  </div>
                )}
              </div>

              {/* Language */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Language</label>
                <select 
                  value={lang} 
                  onChange={(e) => setLang(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none transition-all cursor-pointer appearance-none"
                >
                  {Object.entries(LANGUAGES).map(([code, cfg]) => (
                    <option key={code} value={code} className="bg-slate-950">{cfg.name}</option>
                  ))}
                </select>
              </div>

              {/* Variant and Level */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Variant</label>
                  <select 
                    value={variant} 
                    onChange={(e) => setVariant(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-medium text-slate-300 focus:ring-1 focus:ring-blue-500 outline-none"
                  >
                    {LANGUAGES[lang].variants.map(v => <option key={v} value={v} className="bg-slate-950">{v}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Mastery</label>
                  <select 
                    value={level} 
                    onChange={(e) => setLevel(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-medium text-slate-300 focus:ring-1 focus:ring-blue-500 outline-none"
                  >
                    <option value="A1-A2" className="bg-slate-950">A1/A2</option>
                    <option value="B1-B2" className="bg-slate-950">B1/B2</option>
                    <option value="C1-C2" className="bg-slate-950">C1/C2</option>
                  </select>
                </div>
              </div>

              {/* Length */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Duration</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(LENGTHS).map(([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => setLength(key as any)}
                      className={cn(
                        "py-2 rounded-lg text-[10px] font-bold border transition-all uppercase tracking-tight",
                        length === key 
                          ? "bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-900/20" 
                          : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700"
                      )}
                    >
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Topic */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Contextual Topic</label>
                <textarea 
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-300 focus:ring-1 focus:ring-blue-500 outline-none resize-none placeholder:text-slate-700"
                  placeholder="Describe the scenario..."
                />
              </div>

              <div className="flex items-center gap-2 p-1 bg-slate-950/50 rounded-xl border border-slate-800">
                <button 
                  onClick={() => setGender('Female')}
                  className={cn(
                    "flex-1 py-2 text-[10px] font-bold rounded-lg transition-all uppercase tracking-widest",
                    gender === 'Female' ? "bg-slate-800 text-blue-400 shadow-sm" : "text-slate-600"
                  )}
                >
                  Female
                </button>
                <button 
                  onClick={() => setGender('Male')}
                  className={cn(
                    "flex-1 py-2 text-[10px] font-bold rounded-lg transition-all uppercase tracking-widest",
                    gender === 'Male' ? "bg-slate-800 text-blue-400 shadow-sm" : "text-slate-600"
                  )}
                >
                  Male
                </button>
              </div>

              <button 
                onClick={handleGenerate}
                disabled={isGenerating}
                className={cn(
                  "w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] mt-4",
                  isGenerating 
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed" 
                    : "bg-blue-600 text-white hover:bg-blue-700 shadow-xl shadow-blue-900/20"
                )}
              >
                {isGenerating ? <RotateCcw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span className="text-xs tracking-widest uppercase">{isGenerating ? "Processing..." : "Generate Lab"}</span>
              </button>
            </div>
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-start gap-3 shadow-sm"
            >
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
              <p className="text-xs font-medium text-rose-600 leading-tight">{error}</p>
            </motion.div>
          )}
        </section>

        {/* Right Column: Execution Area */}
        <section className="col-span-12 lg:col-span-8 flex flex-col gap-4">
          <AnimatePresence mode="wait">
            {!script && !isGenerating && (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 min-h-[400px] bg-slate-900/40 border-2 border-dashed border-slate-800 rounded-[32px] flex flex-col items-center justify-center text-center p-12 space-y-4"
              >
                <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center">
                  <Play className="w-8 h-8 text-slate-700" />
                </div>
                <div className="max-w-[280px] space-y-2">
                  <h3 className="font-bold text-slate-500 uppercase tracking-[0.3em] text-[10px]">Awaiting Instructions</h3>
                  <p className="text-slate-600 text-xs leading-relaxed">
                    Configure the generative engine to synthesize audio and interactive assessments.
                  </p>
                </div>
              </motion.div>
            )}

            {isGenerating && (
              <motion.div 
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 min-h-[400px] bg-slate-900 border border-slate-800 rounded-[32px] flex flex-col items-center justify-center text-center p-12 space-y-8"
              >
                <div className="relative">
                  <div className="w-24 h-24 border-2 border-slate-800 border-t-blue-500 rounded-full animate-spin" />
                  <Mic className="absolute inset-0 m-auto w-8 h-8 text-blue-500 animate-pulse" />
                </div>
                <div className="space-y-4 font-mono">
                  <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest">Synthesizing...</h3>
                  <div className="flex gap-4">
                    {["TRANSCRIPT", "VOICE", "ASSESSMENT"].map((step, idx) => (
                      <div key={step} className="flex flex-col items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: `${idx * 200}ms` }} />
                        <span className="text-[8px] text-slate-600 font-bold tracking-[0.2em]">{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {script && !isGenerating && (
              <motion.div 
                key="content"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                {/* Audio Module */}
                <div className="bg-blue-600 rounded-[32px] p-8 text-white shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
                  
                  <div className="relative z-10 flex flex-col md:flex-row items-center gap-8 justify-between">
                    <div className="space-y-3">
                      <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-white/10 rounded-md text-[9px] font-black uppercase tracking-[0.2em] backdrop-blur-md border border-white/5">
                        <Volume2 className="w-3 h-3" /> Audio Engine Ready
                      </div>
                      <h2 className="text-3xl font-black tracking-tighter uppercase italic">Unit Assessment</h2>
                      <div className="flex gap-3">
                        <div className="text-[9px] font-bold uppercase tracking-widest bg-blue-700 px-2.5 py-1 rounded-md">{variant}</div>
                        <div className="text-[9px] font-bold uppercase tracking-widest bg-blue-700 px-2.5 py-1 rounded-md">{level}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {audioUrl && (
                        <div className="bg-white/10 rounded-full p-2 backdrop-blur-xl border border-white/10 flex items-center gap-3">
                          <audio ref={audioRef} src={audioUrl} className="hidden" onEnded={() => setShowTranscript(false)} />
                          <button 
                            onClick={() => audioRef.current?.paused ? audioRef.current.play() : audioRef.current.pause()}
                            className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-blue-600 hover:scale-105 active:scale-95 transition-all shadow-xl"
                          >
                            <Play className="w-8 h-8 fill-current translate-x-1" />
                          </button>
                          <a 
                            href={audioUrl} 
                            download="audio_lab.wav"
                            className="pr-4 py-2 text-[10px] font-black uppercase tracking-widest text-white/70 hover:text-white transition-colors flex items-center gap-2"
                          >
                            <Download className="w-3 h-3" /> Save
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Transcript Module */}
                <div className="bg-slate-900 border border-slate-800 rounded-[28px] overflow-hidden">
                  <button 
                    onClick={() => setShowTranscript(!showTranscript)}
                    className={cn(
                      "w-full px-8 py-5 flex items-center justify-between transition-all group",
                      showTranscript ? "bg-slate-800/50" : "hover:bg-slate-800/30"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
                        showTranscript ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-500"
                      )}>
                        {showTranscript ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </div>
                      <div className="text-left font-mono">
                        <span className="block text-[10px] font-bold text-slate-300 uppercase tracking-widest">Transcription</span>
                        <span className="text-[8px] text-slate-600 font-bold uppercase tracking-[0.2em]">{showTranscript ? 'Secure View' : 'Hidden by Default'}</span>
                      </div>
                    </div>
                    <ChevronRight className={cn("w-4 h-4 text-slate-700 transition-transform duration-300", showTranscript && "rotate-90")} />
                  </button>
                  
                  <AnimatePresence>
                    {showTranscript && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="bg-slate-950/50"
                      >
                        <div className="p-8 font-mono text-sm leading-loose text-slate-400 select-none">
                          <span className="text-blue-500/50 mr-4 inline-block select-none">00:01</span>
                          <span className="italic"> "{script}"</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Quiz Module: Bento Style */}
                {quiz && (
                  <div className="bg-slate-900 border border-slate-800 rounded-[32px] p-8 md:p-10 space-y-10 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/5 rounded-full blur-3xl -mr-16 -mt-16" />
                    
                    <div className="flex items-center justify-between border-b border-slate-800 pb-8 relative z-10">
                       <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-6 h-6 text-blue-500" />
                        <h2 className="text-xl font-bold text-white uppercase tracking-tighter italic">Diagnostic Results</h2>
                      </div>
                      
                      {showResults && (
                        <motion.div 
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className={cn(
                            "px-6 py-2 rounded-lg font-mono font-bold text-sm",
                            score >= 4 ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-blue-600 text-white"
                          )}
                        >
                          SCORE: {score}/{quiz.length}
                        </motion.div>
                      )}
                    </div>

                    <div className="space-y-12 relative z-10">
                      {quiz.map((q, qIdx) => (
                        <div key={qIdx} className="space-y-6">
                          <div className="flex items-start gap-4">
                            <span className="text-blue-500 font-mono text-xs font-black mt-1.5 select-none">[Q{qIdx + 1}]</span>
                            <p className="text-lg font-bold text-slate-200 tracking-tight leading-relaxed">
                              {q.question}
                            </p>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-0 md:pl-10">
                            {q.options.map((option, oIdx) => {
                              const isSelected = userAnswers[qIdx] === oIdx;
                              const isCorrect = q.correctIndex === oIdx;
                              
                              let btnStyles = "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700 hover:bg-slate-900";
                              
                              if (showResults) {
                                if (isCorrect) btnStyles = "bg-emerald-500/10 border-emerald-500 text-emerald-300 shadow-lg shadow-emerald-900/10";
                                else if (isSelected) btnStyles = "bg-rose-500/10 border-rose-500 text-rose-300 opacity-80";
                                else btnStyles = "bg-slate-950 border-slate-900 text-slate-700 opacity-30 grayscale";
                              } else if (isSelected) {
                                btnStyles = "bg-blue-600 border-blue-600 text-white shadow-xl shadow-blue-900/20";
                              }

                              return (
                                <button
                                  key={oIdx}
                                  disabled={showResults}
                                  onClick={() => setUserAnswers(prev => ({ ...prev, [qIdx]: oIdx }))}
                                  className={cn(
                                    "p-5 text-left text-xs rounded-2xl border transition-all flex items-center justify-between font-bold tracking-tight",
                                    btnStyles
                                  )}
                                >
                                  <span>{option}</span>
                                  {showResults && isCorrect && <Check className="w-4 h-4" />}
                                  {showResults && isSelected && !isCorrect && <X className="w-4 h-4" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="pt-4 relative z-10">
                      {showResults ? (
                        <button 
                          onClick={() => {
                            setUserAnswers({});
                            setShowResults(false);
                          }}
                          className="w-full py-4 bg-slate-800 rounded-xl font-bold text-slate-300 uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-slate-700 transition-all"
                        >
                          <RotateCcw className="w-4 h-4" /> Reset Workshop
                        </button>
                      ) : (
                        <button 
                          disabled={Object.keys(userAnswers).length < quiz.length}
                          onClick={() => {
                            setShowResults(true);
                            window.scrollTo({ top: 300, behavior: 'smooth' });
                          }}
                          className={cn(
                            "w-full py-5 rounded-2xl font-black uppercase tracking-[0.2em] text-xs transition-all",
                            Object.keys(userAnswers).length < quiz.length
                              ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                              : "bg-blue-600 text-white hover:bg-blue-700 shadow-xl shadow-blue-900/20"
                          )}
                        >
                          Submit Diagnostic
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      {/* App Footer Bar */}
      <footer className="h-10 bg-blue-700 text-white text-[9px] font-mono flex items-center px-6 justify-between fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 font-bold uppercase tracking-widest">
        <div className="flex gap-6">
          <span className="flex items-center gap-1.5"><Play className="w-2.5 h-2.5 fill-current" /> Multimodal.Live_v2.0</span>
          <span className="hidden sm:inline">Engine: {TEXT_MODEL}</span>
          <span className="hidden md:inline">Language: {lang.toUpperCase()}</span>
        </div>
        <div className="flex gap-4 items-center">
          <span className="bg-white/20 px-2 py-0.5 rounded uppercase">{isGenerating ? 'Synthesizing...' : 'Live Lab Ready'}</span>
        </div>
      </footer>

      {/* Share / Embed Help Modal */}
      <AnimatePresence>
        {showShareHelp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-[32px] w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Share2 className="w-5 h-5 text-blue-500" />
                    <h2 className="text-xl font-bold text-white uppercase tracking-tighter italic">Compartir Lab</h2>
                  </div>
                  <button onClick={() => setShowShareHelp(false)} className="text-slate-500 hover:text-white transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl">
                    <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                       <ExternalLink className="w-3 h-3" /> URL Directa (Para Google Sites)
                    </h3>
                    <p className="text-[10px] text-slate-400 mb-3">Usa esta URL para "Insertar" en Google Sites o compartir directamente:</p>
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between gap-4">
                      <code className="text-[10px] text-blue-300 break-all select-all">{sharedUrl}</code>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-2xl">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-2 flex items-center gap-2">
                       <HelpCircle className="w-3 h-3" /> Guía de Inserción
                    </h3>
                    <ul className="text-[10px] text-slate-500 space-y-2 list-disc pl-4">
                      <li>En Google Sites: Selecciona <strong className="text-slate-300">Insertar {'>'} Por URL</strong>.</li>
                      <li>Si falla, elige <strong className="text-slate-300">Insertar código</strong> y pega el siguiente iframe:</li>
                    </ul>
                    <div className="mt-3 bg-slate-950 p-3 rounded-lg border border-slate-800 text-[9px] font-mono text-slate-400 break-all select-all">
                      {`<iframe src="${sharedUrl}" width="100%" height="800px" frameborder="0"></iframe>`}
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setShowShareHelp(false)}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs uppercase tracking-widest transition-all"
                >
                  Entendido
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
