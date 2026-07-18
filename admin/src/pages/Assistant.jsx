import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { AssistantAPI } from '../api';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

const SUGGESTIONS = [
  'Where should I park?',
  'How crowded is parking today?',
  'Which floor has EV charging?',
  'How much will parking cost if I stay 3 hours?',
  'Navigate me',
];

const SpeechRecognitionCtor =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

function renderReply(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function NavigationCard({ navigation }) {
  if (!navigation?.ok || !navigation.recommendation) return null;
  const rec = navigation.recommendation;
  return (
    <div className="nav-card">
      <div className="nav-card-title">
        Go to <strong>{rec.slotCode}</strong> · {rec.basement.code}
      </div>
      <div className="nav-card-meta">
        {rec.basement.name}
        {rec.hasEvCharger ? ' · EV charger' : ''}
        {rec.company ? ` · ${rec.company.code}` : ' · GENERAL'}
        {` · row ${rec.row}, col ${rec.col}`}
      </div>
      <ol className="nav-card-steps">
        {(navigation.steps || []).map((step) => (
          <li key={step}>{renderReply(step)}</li>
        ))}
      </ol>
    </div>
  );
}

export default function Assistant() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Hi — I’m the ParkLane Smart Parking Assistant. Ask with the mic or type. I’ll answer from live parking data and can speak replies with ElevenLabs.',
      meta: null,
      navigation: null,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [tips, setTips] = useState([]);
  const [tipDismissed, setTipDismissed] = useState({});
  const [listening, setListening] = useState(false);
  const [voiceSupported] = useState(Boolean(SpeechRecognitionCtor));
  const [ttsReady, setTtsReady] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [speakingIdx, setSpeakingIdx] = useState(null);
  const endRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const autoSpeakRef = useRef(true);

  useEffect(() => {
    autoSpeakRef.current = autoSpeak;
  }, [autoSpeak]);

  useEffect(() => {
    AssistantAPI.context()
      .then(setSnapshot)
      .catch(() => setSnapshot(null));
    AssistantAPI.tips()
      .then((data) => setTips(data.tips || []))
      .catch(() => setTips([]));
    AssistantAPI.voiceStatus()
      .then((v) => setTtsReady(Boolean(v.configured)))
      .catch(() => setTtsReady(false));
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socket.on('assistant.tip', (payload) => {
      setTips(payload?.tips || []);
    });
    socket.on('occupancy.updated', () => {
      AssistantAPI.context()
        .then(setSnapshot)
        .catch(() => {});
      AssistantAPI.tips()
        .then((data) => setTips(data.tips || []))
        .catch(() => {});
    });
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      stopSpeaking();
    };
  }, []);

  function stopSpeaking() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setSpeakingIdx(null);
  }

  async function speakText(text, idx = null) {
    if (!ttsReady || !text) return;
    stopSpeaking();
    setSpeakingIdx(idx);
    try {
      const blob = await AssistantAPI.speak(text);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        stopSpeaking();
      };
      audio.onerror = () => {
        stopSpeaking();
        setError('Could not play ElevenLabs audio');
      };
      await audio.play();
    } catch (err) {
      setSpeakingIdx(null);
      setError(err.message);
    }
  }

  function applyContextSummary(summary) {
    if (!summary) return;
    if (summary.tips) setTips(summary.tips);
    setSnapshot((prev) =>
      prev
        ? {
            ...prev,
            summary: {
              ...prev.summary,
              crowd: summary.crowd ?? prev.summary.crowd,
              occupancyPct: summary.occupancyPct ?? prev.summary.occupancyPct,
              freeSlots: summary.freeSlots ?? prev.summary.freeSlots,
              evFree: summary.evFree ?? prev.summary.evFree,
            },
          }
        : prev
    );
  }

  async function send(text) {
    const message = String(text || '').trim();
    if (!message || loading) return;

    stopSpeaking();
    setError('');
    setInput('');
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: message, meta: null, navigation: null }]);
    setLoading(true);

    try {
      const data = await AssistantAPI.chat({ message, history });
      setMessages((prev) => {
        const next = [
          ...prev,
          {
            role: 'assistant',
            content: data.reply,
            meta: {
              mode: data.mode,
              model: data.model,
              contextSummary: data.contextSummary,
            },
            navigation: data.navigation || null,
          },
        ];
        if (autoSpeakRef.current && ttsReady) {
          const idx = next.length - 1;
          queueMicrotask(() => speakText(data.reply, idx));
        }
        return next;
      });
      applyContextSummary(data.contextSummary);
    } catch (err) {
      setError(err.message);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Sorry — I couldn’t reach the assistant API. ${err.message}`,
          meta: null,
          navigation: null,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function navigateMe() {
    if (loading) return;
    stopSpeaking();
    setError('');
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: 'Navigate me', meta: null, navigation: null },
    ]);
    setLoading(true);
    try {
      const plan = await AssistantAPI.navigate({ vehicleType: 'CAR', asGuest: true });
      setMessages((prev) => {
        const next = [
          ...prev,
          {
            role: 'assistant',
            content: plan.summary,
            meta: { mode: 'navigate', model: null },
            navigation: plan,
          },
        ];
        if (autoSpeakRef.current && ttsReady) {
          const idx = next.length - 1;
          queueMicrotask(() => speakText(plan.summary, idx));
        }
        return next;
      });
    } catch (err) {
      setError(err.message);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: err.message || 'Could not build navigation.',
          meta: null,
          navigation: null,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function toggleVoice() {
    if (!SpeechRecognitionCtor) {
      setError('Voice input needs Chrome/Edge (Web Speech API).');
      return;
    }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    stopSpeaking();

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'en-IN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    recognition.onstart = () => setListening(true);
    recognition.onerror = (event) => {
      setListening(false);
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setError(`Voice error: ${event.error}`);
      }
    };
    recognition.onend = () => setListening(false);
    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      const text = transcript.trim();
      if (!text) return;
      setInput(text);
      const isFinal = event.results[event.results.length - 1]?.isFinal;
      if (isFinal) {
        send(text);
      }
    };

    try {
      recognition.start();
    } catch (err) {
      setError(err.message || 'Could not start microphone');
      setListening(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    send(input);
  }

  const visibleTips = tips.filter((t) => !tipDismissed[t.id]);

  return (
    <div className="stack assistant-page">
      <div className="topbar">
        <div>
          <h2>Smart Parking Assistant</h2>
          <p>Mic in · ElevenLabs voice out · live navigation + tips</p>
        </div>
        <div className="assistant-top-actions">
          {snapshot?.summary && (
            <div className="assistant-live-pill" title="Live occupancy">
              <span className="assistant-live-dot" />
              {snapshot.summary.crowd} · {snapshot.summary.occupancyPct}% full ·{' '}
              {snapshot.summary.freeSlots} free · {snapshot.summary.evFree} EV open
            </div>
          )}
          <label className={`assistant-auto-speak ${ttsReady ? '' : 'disabled'}`} title={ttsReady ? 'Speak replies with ElevenLabs' : 'Add ELEVENLABS_API_KEY to enable'}>
            <input
              type="checkbox"
              checked={autoSpeak && ttsReady}
              disabled={!ttsReady}
              onChange={(e) => setAutoSpeak(e.target.checked)}
            />
            Auto-speak
          </label>
        </div>
      </div>

      {!ttsReady ? (
        <div className="assistant-tip-banner severity-info" role="status">
          <div>
            <strong>ElevenLabs TTS not connected</strong>
            <p>
              Add <code>ELEVENLABS_API_KEY</code> to <code>backend/.env</code>, restart the API, then
              refresh. Mic will still work; Speak buttons unlock after the key is set.
            </p>
          </div>
        </div>
      ) : null}

      {visibleTips.map((tip) => (
        <div key={tip.id} className={`assistant-tip-banner severity-${tip.severity || 'warn'}`} role="status">
          <div>
            <strong>{tip.title}</strong>
            <p>{tip.message}</p>
          </div>
          <div className="assistant-tip-actions">
            <button type="button" className="btn btn-secondary" onClick={() => navigateMe()} disabled={loading}>
              Navigate me
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setTipDismissed((prev) => ({ ...prev, [tip.id]: true }))}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}

      <section className="assistant-shell panel">
        <div className="assistant-suggestions">
          {SUGGESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              className="chip"
              onClick={() => (q === 'Navigate me' ? navigateMe() : send(q))}
              disabled={loading}
            >
              {q}
            </button>
          ))}
        </div>

        <div className="assistant-thread" role="log" aria-live="polite">
          {messages.map((m, idx) => (
            <div key={idx} className={`assistant-bubble ${m.role}`}>
              <div className="assistant-bubble-label">
                {m.role === 'user' ? 'You' : 'Assistant'}
                {m.meta?.mode && m.role === 'assistant' ? (
                  <span className="assistant-mode">
                    {m.meta.mode === 'llm'
                      ? m.meta.model || 'LLM'
                      : m.meta.mode === 'navigate'
                        ? 'navigate'
                        : 'live data'}
                  </span>
                ) : null}
                {m.role === 'assistant' && ttsReady ? (
                  <button
                    type="button"
                    className={`speak-btn ${speakingIdx === idx ? 'active' : ''}`}
                    onClick={() => (speakingIdx === idx ? stopSpeaking() : speakText(m.content, idx))}
                    title={speakingIdx === idx ? 'Stop' : 'Speak with ElevenLabs'}
                  >
                    {speakingIdx === idx ? 'Stop' : 'Speak'}
                  </button>
                ) : null}
              </div>
              <div className="assistant-bubble-body">{renderReply(m.content)}</div>
              <NavigationCard navigation={m.navigation} />
            </div>
          ))}
          {loading && (
            <div className="assistant-bubble assistant">
              <div className="assistant-bubble-label">Assistant</div>
              <div className="assistant-bubble-body assistant-typing">Checking live parking…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {error ? <div className="error">{error}</div> : null}

        <form className="assistant-composer" onSubmit={onSubmit}>
          <button
            type="button"
            className={`btn btn-secondary mic-btn ${listening ? 'listening' : ''}`}
            onClick={toggleVoice}
            disabled={loading || !voiceSupported}
            title={voiceSupported ? (listening ? 'Stop listening' : 'Speak') : 'Voice not supported in this browser'}
            aria-label={listening ? 'Stop voice input' : 'Start voice input'}
          >
            {listening ? 'Listening…' : 'Mic'}
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? 'Listening…' : 'Ask about parking, EV, cost, or navigate…'}
            disabled={loading}
            aria-label="Message"
          />
          <button className="btn" type="submit" disabled={loading || !input.trim()}>
            Send
          </button>
        </form>
        {!voiceSupported ? (
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Voice input works best in Chrome or Edge.
          </p>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Flow: Mic → question → live answer → {ttsReady ? 'ElevenLabs speaks it back' : 'enable TTS key to hear replies'}.
          </p>
        )}
      </section>
    </div>
  );
}
