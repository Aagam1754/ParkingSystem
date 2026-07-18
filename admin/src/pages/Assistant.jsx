import { useEffect, useRef, useState } from 'react';
import { AssistantAPI } from '../api';

const SUGGESTIONS = [
  'Where should I park?',
  'How crowded is parking today?',
  'Which floor has EV charging?',
  'How much will parking cost if I stay 3 hours?',
];

function renderReply(text) {
  // Light markdown: **bold** and line breaks only
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function Assistant() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Hi — I’m the ParkLane Smart Parking Assistant. Ask me where to park, how busy it is, EV chargers, or estimated cost. I answer from live basement data.',
      meta: null,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    AssistantAPI.context()
      .then(setSnapshot)
      .catch(() => setSnapshot(null));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  async function send(text) {
    const message = String(text || '').trim();
    if (!message || loading) return;

    setError('');
    setInput('');
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: message, meta: null }]);
    setLoading(true);

    try {
      const data = await AssistantAPI.chat({ message, history });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply,
          meta: {
            mode: data.mode,
            model: data.model,
            contextSummary: data.contextSummary,
          },
        },
      ]);
      if (data.contextSummary) {
        setSnapshot((prev) =>
          prev
            ? {
                ...prev,
                summary: {
                  ...prev.summary,
                  crowd: data.contextSummary.crowd,
                  occupancyPct: data.contextSummary.occupancyPct,
                  freeSlots: data.contextSummary.freeSlots,
                  evFree: data.contextSummary.evFree,
                },
              }
            : prev
        );
      }
    } catch (err) {
      setError(err.message);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Sorry — I couldn’t reach the assistant API. ${err.message}`,
          meta: null,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className="stack assistant-page">
      <div className="topbar">
        <div>
          <h2>Smart Parking Assistant</h2>
          <p>LLM chatbot grounded in live Eastface occupancy, EV bays, and tariff data</p>
        </div>
        {snapshot?.summary && (
          <div className="assistant-live-pill" title="Refreshed with each reply">
            <span className="assistant-live-dot" />
            {snapshot.summary.crowd} · {snapshot.summary.occupancyPct}% full ·{' '}
            {snapshot.summary.freeSlots} free · {snapshot.summary.evFree} EV open
          </div>
        )}
      </div>

      <section className="assistant-shell panel">
        <div className="assistant-suggestions">
          {SUGGESTIONS.map((q) => (
            <button key={q} type="button" className="chip" onClick={() => send(q)} disabled={loading}>
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
                    {m.meta.mode === 'llm' ? m.meta.model || 'LLM' : 'live data'}
                  </span>
                ) : null}
              </div>
              <div className="assistant-bubble-body">{renderReply(m.content)}</div>
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
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about parking, EV, or cost…"
            disabled={loading}
            aria-label="Message"
          />
          <button className="btn" type="submit" disabled={loading || !input.trim()}>
            Send
          </button>
        </form>
      </section>
    </div>
  );
}
