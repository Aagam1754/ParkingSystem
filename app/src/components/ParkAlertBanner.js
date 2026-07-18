import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { onParkAlert } from '../services/parkAlerts';
import { colors, spacing } from '../theme';

export default function ParkAlertBanner() {
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    let hideTimer;
    const unsub = onParkAlert((payload) => {
      setAlert(payload);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setAlert(null), 8000);
    });
    return () => {
      clearTimeout(hideTimer);
      unsub();
    };
  }, []);

  if (!alert) return null;

  return (
    <Pressable style={styles.banner} onPress={() => setAlert(null)}>
      <View style={styles.dot} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{alert.title}</Text>
        <Text style={styles.body}>{alert.body}</Text>
      </View>
      <Text style={styles.dismiss}>OK</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 48,
    left: spacing.md,
    right: spacing.md,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.bg2,
    borderColor: colors.accent2,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent2,
    marginTop: 4,
  },
  title: {
    color: colors.accent,
    fontWeight: '800',
    fontSize: 14,
  },
  body: {
    color: colors.ink,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  dismiss: {
    color: colors.muted,
    fontWeight: '700',
    fontSize: 12,
    marginTop: 2,
  },
});
