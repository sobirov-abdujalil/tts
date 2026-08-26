import { useEffect, useRef, useState } from "react";
import { BASIC_VOICES, DEFAULT_VOICE_ID, MAX_INPUT_CHARS } from "@tts/shared";
import { useLocalTts } from "../tts/useLocalTts.js";
import { useDeviceAnalysis } from "../tts/useDeviceAnalysis.js";
import { DeviceAnalysisCard } from "../components/DeviceAnalysisCard.js";

const ERROR_TITLES: Record<string, string> = {
  "unsupported-browser": "This browser can't run on-device speech",
  "model-load-failed": "Couldn't load the speech model",
  "generation-failed": "Generation failed",
  "runtime-failure": "Your device ran into a problem",
  cancelled: "Cancelled",
  "invalid-input": "Check your input",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkspacePage() {
  const tts = useLocalTts();
  const analysis = useDeviceAnalysis(tts.getModel);
  const { needsMeasurement, runMeasurement } = analysis;
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState<string>(DEFAULT_VOICE_ID);

  // Quietly measure real speed once, after the first successful generation,
  // when no valid cached measurement exists (the model is already warm then).
  const autoMeasureAttempted = useRef(false);
  useEffect(() => {
    if (tts.state.phase !== "ready") return;
    if (!needsMeasurement || autoMeasureAttempted.current) return;
    autoMeasureAttempted.current = true;
    const timer = setTimeout(() => void runMeasurement(), 1_500);
    return () => clearTimeout(timer);
  }, [tts.state.phase, needsMeasurement, runMeasurement]);

  const trimmedLength = text.trim().length;
  const overLimit = trimmedLength > MAX_INPUT_CHARS;
  const busy = tts.state.phase === "loading-model" || tts.state.phase === "generating";
  const canGenerate =
    !busy && tts.state.phase !== "unsupported" && tts.state.phase !== "checking" && !overLimit && trimmedLength > 0;

  const downloadName = `speech-${voiceId}-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`;

  const handleGenerate = (): void => {
    void tts.generate(text, voiceId);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">AI Text-to-Speech</h1>
        <p className="flex items-center gap-2 text-sm text-gray-600">
          <span
            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 font-medium text-emerald-700"
            data-testid="privacy-badge"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6.5V4.5a1.5 1.5 0 1 1 3 0V6Z" />
            </svg>
            Generated on your device
          </span>
          Your text never leaves your browser.
        </p>
      </header>

      <DeviceAnalysisCard analysis={analysis} />

      {tts.state.error !== null && (
        <div
          role="alert"
          data-testid="error-banner"
          className={
            tts.state.error.code === "cancelled"
              ? "flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700"
              : "flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          }
        >
          <div>
            <p className="font-semibold">{ERROR_TITLES[tts.state.error.code] ?? "Something went wrong"}</p>
            <p>{tts.state.error.message}</p>
          </div>
          <button
            type="button"
            onClick={tts.dismissError}
            aria-label="Dismiss error"
            className="rounded p-1 text-inherit opacity-70 hover:opacity-100"
          >
            âœ•
          </button>
        </div>
      )}

      {tts.state.phase === "unsupported" && (
        <div
          data-testid="unsupported-panel"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <p className="font-semibold">On-device generation isn't available in this browser.</p>
          <p className="mt-1">
            Local speech generation requires a browser with WebAssembly support, such as a recent
            version of Chrome, Edge, Firefox, or Safari.
          </p>
        </div>
      )}

      <section
        aria-label="Text to synthesize"
        className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <label htmlFor="tts-text" className="text-sm font-medium text-gray-700">
          Text
        </label>
        <textarea
          id="tts-text"
          data-testid="editor"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Type or paste the text you want to hearâ€¦"
          rows={7}
          disabled={tts.state.phase === "unsupported"}
          className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-base leading-relaxed outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
        />
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">English voices Â· runs locally</span>
          <span
            data-testid="char-counter"
            aria-live="polite"
            className={overLimit ? "font-semibold text-red-600" : "text-gray-500"}
          >
            {trimmedLength.toLocaleString()} / {MAX_INPUT_CHARS.toLocaleString()}
            {overLimit ? " â€” too long" : ""}
          </span>
        </div>
      </section>

      <section aria-label="Voice and generation controls" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-48 flex-col gap-1">
            <label htmlFor="voice-select" className="text-sm font-medium text-gray-700">
              Voice
            </label>
            <select
              id="voice-select"
              data-testid="voice-select"
              value={voiceId}
              onChange={(event) => setVoiceId(event.target.value)}
              disabled={busy || tts.state.phase === "unsupported"}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
            >
              {BASIC_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name} Â· {voice.language} ({voice.gender})
                </option>
              ))}
            </select>
          </div>

          {!busy ? (
            <button
              type="button"
              data-testid="generate-btn"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              Generate speech
            </button>
          ) : (
            <button
              type="button"
              data-testid="cancel-btn"
              onClick={tts.cancel}
              className="rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
        </div>

        <div aria-live="polite" data-testid="status" className="min-h-6 text-sm text-gray-600">
          {tts.state.phase === "checking" && <span>Checking your deviceâ€¦</span>}
          {tts.state.phase === "loading-model" && (
            <div className="flex flex-col gap-2" data-testid="model-progress">
              <span>
                Downloading speech model (~86&nbsp;MB, cached for next time). This happens once.
              </span>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((tts.state.progress ?? 0) * 100)}
                className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
              >
                <div
                  className="h-full rounded-full bg-indigo-600 transition-[width]"
                  style={{ width: `${Math.round((tts.state.progress ?? 0) * 100)}%` }}
                />
              </div>
              <span className="tabular-nums text-gray-500">
                {Math.round((tts.state.progress ?? 0) * 100)}%
              </span>
            </div>
          )}
          {tts.state.phase === "generating" && (
            <span className="inline-flex items-center gap-2" data-testid="generating-status">
              <span
                aria-hidden="true"
                className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"
              />
              Generating audio on your deviceâ€¦
            </span>
          )}
          {tts.state.phase === "ready" && tts.state.activeDevice && (
            <span data-testid="ready-status">
              Ready â€” running on {tts.state.activeDevice === "webgpu" ? "WebGPU" : "WebAssembly"}.
            </span>
          )}
        </div>
      </section>

      {tts.state.audioUrl !== null && (
        <section
          aria-label="Generated audio"
          data-testid="result-panel"
          className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-sm font-medium text-gray-700">Result</h2>
          <audio controls src={tts.state.audioUrl} data-testid="player" className="w-full" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              WAV Â· 24 kHz mono{tts.state.audioBytes !== null ? ` Â· ${formatBytes(tts.state.audioBytes)}` : ""}
            </span>
            <a
              href={tts.state.audioUrl}
              download={downloadName}
              data-testid="download-btn"
              className="rounded-md border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
            >
              Download WAV
            </a>
          </div>
        </section>
      )}
    </main>
  );
}


