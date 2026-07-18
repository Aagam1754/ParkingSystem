import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AssistantAPI } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { getMemberLocation, requestLocationPermission } from '../services/location';
import { setGuidedSlot } from '../services/parkWatch';
import { speakAssistant, stopSpeaking } from '../services/tts';
import { colors, spacing } from '../theme';

const SUGGESTIONS = [
  'Where should I park?',
  'How crowded is parking today?',
  'Which floor has EV charging?',
  'How much will parking cost if I stay 3 hours?',
  'Navigate me',
];

function stripMarkdownBold(text) {
  return String(text || '').replace(/\*\*([^*]+)\*\*/g, '$1');
}

function RichText({ text, style, boldStyle }) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text style={style}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <Text key={i} style={boldStyle}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

function NavigationCard({ navigation }) {
  if (!navigation?.ok || !navigation.recommendation) return null;
  const rec = navigation.recommendation;
  const poolLabel =
    navigation.poolPath === 'COMPANY'
      ? rec.company?.code || 'COMPANY'
      : navigation.poolPath === 'GENERAL_OVERFLOW'
        ? 'GENERAL overflow'
        : 'GENERAL';

  return (
    <View style={styles.navCard}>
      <Text style={styles.navTitle}>
        Go to {rec.slotCode} · {rec.basement.code}
      </Text>
      <Text style={styles.navMeta}>
        {rec.basement.name}
        {rec.hasEvCharger ? ' · EV charger' : ''}
        {` · ${poolLabel}`}
        {` · row ${rec.row}, col ${rec.col}`}
      </Text>
      {(navigation.steps || []).map((step, idx) => (
        <View key={`${idx}-${step.slice(0, 24)}`} style={styles.navStepRow}>
          <Text style={styles.navStepNum}>{idx + 1}</Text>
          <RichText text={step} style={styles.navStep} boldStyle={styles.bold} />
        </View>
      ))}
    </View>
  );
}

function MessageBubble({ item, ttsReady, speakingId, onSpeak, onStop }) {
  const isUser = item.role === 'user';
  const isSpeaking = speakingId === item.id;
  return (
    <View style={[styles.bubbleWrap, isUser ? styles.bubbleWrapUser : styles.bubbleWrapBot]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleBot]}>
        {!isUser ? (
          <View style={styles.bubbleHeader}>
            <Text style={styles.bubbleLabel}>Assistant</Text>
            {item.meta?.mode ? (
              <Text style={styles.metaInline}>
                {item.meta.mode}
                {item.meta.model ? ` · ${item.meta.model}` : ''}
              </Text>
            ) : null}
            {ttsReady ? (
              <Pressable
                onPress={() => (isSpeaking ? onStop() : onSpeak(item))}
                style={[styles.speakBtn, isSpeaking && styles.speakBtnActive]}
              >
                <Text style={styles.speakBtnText}>{isSpeaking ? 'Stop' : 'Speak'}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <RichText
          text={item.content}
          style={[styles.bubbleText, isUser && styles.bubbleTextUser]}
          boldStyle={styles.bold}
        />
      </View>
      {!isUser ? <NavigationCard navigation={item.navigation} /> : null}
    </View>
  );
}

export default function AssistantScreen() {
  const { profile } = useAuth();
  const companyCode = profile?.companyCode || null;

  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content: companyCode
        ? `Hi — I’m the ParkLane assistant for **${companyCode}**. I’ll find a **free bay** (company FCFS → GENERAL overflow), speak directions with ElevenLabs, and notify you when the gate confirms you’re parked.`
        : 'Hi — I’m the ParkLane Smart Parking Assistant.',
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
  const [ttsReady, setTtsReady] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [speakingId, setSpeakingId] = useState(null);
  const [location, setLocation] = useState(null);
  const [locBusy, setLocBusy] = useState(false);
  const listRef = useRef(null);
  const idRef = useRef(1);
  const autoSpeakRef = useRef(true);

  useEffect(() => {
    autoSpeakRef.current = autoSpeak;
  }, [autoSpeak]);

  const nextId = () => {
    idRef.current += 1;
    return `m-${idRef.current}`;
  };

  const refreshLocation = useCallback(async (forceAsk = false) => {
    setLocBusy(true);
    try {
      if (forceAsk) await requestLocationPermission();
      const loc = await getMemberLocation();
      setLocation(loc);
      return loc;
    } catch (err) {
      setLocation({ ok: false, granted: false, error: err.message });
      return null;
    } finally {
      setLocBusy(false);
    }
  }, []);

  const memberCoords = useCallback(() => {
    if (!location?.ok) return {};
    return { lat: location.lat, lng: location.lng };
  }, [location]);

  const memberNavPayload = useCallback(
    (extra = {}) => ({
      vehicleType: 'CAR',
      companyCode,
      asGuest: false,
      ...memberCoords(),
      ...extra,
    }),
    [companyCode, memberCoords]
  );

  const refreshLive = useCallback(async () => {
    try {
      const [ctx, tipData, voice] = await Promise.all([
        AssistantAPI.context(),
        AssistantAPI.tips(),
        AssistantAPI.voiceStatus().catch(() => ({ configured: false })),
      ]);
      setSnapshot(ctx);
      setTips(tipData.tips || []);
      setTtsReady(Boolean(voice.configured));
    } catch {
      /* keep last good snapshot */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshLive();
      refreshLocation(false);
      const poll = setInterval(() => refreshLive(), 5000);
      return () => {
        clearInterval(poll);
        stopSpeaking();
        setSpeakingId(null);
      };
    }, [refreshLive, refreshLocation])
  );

  useEffect(() => {
    if (!companyCode) return;
    setMessages((prev) => {
      if (prev[0]?.id !== 'welcome') return prev;
      return [
        {
          ...prev[0],
          content: `Hi — I’m the ParkLane assistant for **${companyCode}**. I’ll find a **free bay** (company FCFS → GENERAL overflow), speak directions with ElevenLabs, and notify you when the gate confirms you’re parked.`,
        },
        ...prev.slice(1),
      ];
    });
  }, [companyCode]);

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

  async function playVoice(item) {
    if (!ttsReady) return;
    stopSpeaking();
    setSpeakingId(item.id);
    setError('');
    try {
      // Auto / Speak on navigate → slot script only. Manual speak on other replies → full text.
      if (item.navigation?.ok) {
        await speakAssistant({ navigation: item.navigation });
      } else {
        await speakAssistant({ text: stripMarkdownBold(item.content) });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSpeakingId(null);
    }
  }

  function maybeAutoSpeak(item) {
    if (!autoSpeakRef.current || !ttsReady) return;
    // Speak only when we have an available free bay to navigate to
    if (!item.navigation?.ok) return;
    queueMicrotask(() => playVoice(item));
  }

  async function send(text) {
    const message = String(text || '').trim();
    if (!message || loading) return;

    stopSpeaking();
    setSpeakingId(null);
    setError('');
    setInput('');
    const history = messages
      .filter((m) => m.id !== 'welcome' || messages.length === 1)
      .map((m) => ({ role: m.role, content: stripMarkdownBold(m.content) }));

    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', content: message, meta: null, navigation: null },
    ]);
    setLoading(true);

    try {
      let coords = memberCoords();
      if (!coords.lat) {
        const loc = await refreshLocation(true);
        if (loc?.ok) coords = { lat: loc.lat, lng: loc.lng };
      }
      const data = await AssistantAPI.chat({
        message,
        history,
        companyCode,
        asGuest: false,
        ...coords,
      });
      const assistantMsg = {
        id: nextId(),
        role: 'assistant',
        content: data.reply,
        meta: {
          mode: data.mode,
          model: data.model,
          contextSummary: data.contextSummary,
        },
        navigation: data.navigation || null,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      applyContextSummary(data.contextSummary);
      if (data.navigation?.ok) {
        await setGuidedSlot(data.navigation.recommendation?.slotCode);
      }
      maybeAutoSpeak(assistantMsg);
    } catch (err) {
      setError(err.message);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
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

  async function navigateMe(preferEv = false) {
    if (loading) return;
    stopSpeaking();
    setSpeakingId(null);
    setError('');
    const label = preferEv ? 'Navigate me to an EV bay' : 'Navigate me';
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', content: label, meta: null, navigation: null },
    ]);
    setLoading(true);
    try {
      let coords = memberCoords();
      if (!coords.lat) {
        const loc = await refreshLocation(true);
        if (loc?.ok) coords = { lat: loc.lat, lng: loc.lng };
      }
      const plan = await AssistantAPI.navigate(
        memberNavPayload({ preferEv, ...coords })
      );
      const assistantMsg = {
        id: nextId(),
        role: 'assistant',
        content: plan.summary,
        meta: { mode: 'navigate', model: null },
        navigation: plan,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (plan.ok) await setGuidedSlot(plan.recommendation?.slotCode);
      maybeAutoSpeak(assistantMsg);
    } catch (err) {
      setError(err.message);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
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

  const visibleTips = tips.filter((t) => !tipDismissed[t.id]);
  const myPool = (snapshot?.companyPools || []).find((p) => p.companyCode === companyCode);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <View style={styles.headerBlock}>
        <View style={styles.topRow}>
          {snapshot?.summary ? (
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>
                {snapshot.summary.crowd} · {snapshot.summary.occupancyPct}% ·{' '}
                {snapshot.summary.freeSlots} free
                {myPool != null ? ` · ${companyCode} ${myPool.free}` : ''}
              </Text>
            </View>
          ) : (
            <View />
          )}
          <View style={styles.autoSpeakRow}>
            <Text style={[styles.autoSpeakLabel, !ttsReady && { opacity: 0.4 }]}>
              Slot voice
            </Text>
            <Switch
              value={autoSpeak && ttsReady}
              disabled={!ttsReady}
              onValueChange={setAutoSpeak}
              trackColor={{ false: colors.bg3, true: colors.accent2 }}
              thumbColor={colors.ink}
            />
          </View>
        </View>

        {!ttsReady ? (
          <Text style={styles.warnBanner}>
            ElevenLabs not connected on API — add ELEVENLABS_API_KEY to backend/.env and restart
            the API.
          </Text>
        ) : null}

        <Pressable style={styles.locChip} onPress={() => refreshLocation(true)} disabled={locBusy}>
          <Text style={styles.locText}>
            {locBusy
              ? 'Getting location…'
              : location?.ok
                ? `GPS · ${location.label}`
                : location?.granted === false
                  ? 'Tap to allow location'
                  : 'Enable location for lobby directions'}
          </Text>
        </Pressable>

        {visibleTips.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tipsRow}>
            {visibleTips.map((tip) => (
              <Pressable
                key={tip.id}
                style={styles.tipChip}
                onPress={() => setTipDismissed((d) => ({ ...d, [tip.id]: true }))}
              >
                <Text style={styles.tipText} numberOfLines={2}>
                  {tip.message}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestRow}>
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s}
              style={styles.suggestChip}
              onPress={() => (s === 'Navigate me' ? navigateMe(false) : send(s))}
              disabled={loading}
            >
              <Text style={styles.suggestText}>{s}</Text>
            </Pressable>
          ))}
          <Pressable
            style={styles.suggestChipAccent}
            onPress={() => navigateMe(true)}
            disabled={loading}
          >
            <Text style={styles.suggestTextAccent}>EV navigate</Text>
          </Pressable>
        </ScrollView>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MessageBubble
            item={item}
            ttsReady={ttsReady}
            speakingId={speakingId}
            onSpeak={playVoice}
            onStop={() => {
              stopSpeaking();
              setSpeakingId(null);
            }}
          />
        )}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListFooterComponent={
          loading ? (
            <View style={styles.typing}>
              <ActivityIndicator color={colors.accent} size="small" />
              <Text style={styles.typingText}>Finding a free bay…</Text>
            </View>
          ) : null
        }
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about parking…"
          placeholderTextColor={colors.muted}
          editable={!loading}
          multiline
          onSubmitEditing={() => send(input)}
          blurOnSubmit
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
          onPress={() => send(input)}
          disabled={!input.trim() || loading}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg0,
  },
  headerBlock: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    paddingBottom: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 8,
    backgroundColor: colors.bg2,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.line,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent2,
  },
  liveText: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  autoSpeakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  autoSpeakLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  warnBanner: {
    color: colors.warn,
    fontSize: 12,
    lineHeight: 16,
  },
  locChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.bg2,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.line,
  },
  locText: {
    color: colors.accent2,
    fontSize: 12,
    fontWeight: '600',
  },
  tipsRow: {
    maxHeight: 56,
  },
  tipChip: {
    backgroundColor: 'rgba(255,176,32,0.12)',
    borderColor: 'rgba(255,176,32,0.35)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    maxWidth: 280,
  },
  tipText: {
    color: colors.warn,
    fontSize: 12,
  },
  suggestRow: {
    maxHeight: 40,
  },
  suggestChip: {
    backgroundColor: colors.bg2,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  suggestChipAccent: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  suggestText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '600',
  },
  suggestTextAccent: {
    color: colors.bg0,
    fontSize: 12,
    fontWeight: '700',
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  bubbleWrap: {
    marginBottom: spacing.sm,
    maxWidth: '92%',
  },
  bubbleWrapUser: {
    alignSelf: 'flex-end',
  },
  bubbleWrapBot: {
    alignSelf: 'flex-start',
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: colors.accent,
  },
  bubbleBot: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  bubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  bubbleLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  metaInline: {
    color: colors.muted,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  speakBtn: {
    marginLeft: 'auto',
    backgroundColor: colors.bg3,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  speakBtnActive: {
    backgroundColor: colors.accent,
  },
  speakBtnText: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: '800',
  },
  bubbleText: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
  },
  bubbleTextUser: {
    color: colors.bg0,
    fontWeight: '600',
  },
  bold: {
    fontWeight: '800',
  },
  navCard: {
    marginTop: 8,
    backgroundColor: colors.bg1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    gap: 6,
  },
  navTitle: {
    color: colors.accent,
    fontWeight: '800',
    fontSize: 15,
  },
  navMeta: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: 4,
  },
  navStepRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  navStepNum: {
    color: colors.accent2,
    fontWeight: '800',
    width: 18,
    fontSize: 12,
    marginTop: 2,
  },
  navStep: {
    flex: 1,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 18,
  },
  typing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  typingText: {
    color: colors.muted,
    fontSize: 13,
  },
  error: {
    color: colors.danger,
    paddingHorizontal: spacing.md,
    paddingBottom: 4,
    fontSize: 12,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.bg1,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    backgroundColor: colors.bg2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.ink,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  sendBtn: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendText: {
    color: colors.bg0,
    fontWeight: '800',
    fontSize: 14,
  },
});
