/**
 * rn-smart-tour example app.
 *
 * Each section exercises one behaviour so it can be checked by hand (and later
 * by Maestro flows): auto-start, replaying a seen tour, auto-scroll, a step
 * whose target is missing, and a target that has its own onLayout.
 */
import { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { DapProvider, DapScrollView, DapTarget, useDap } from 'rn-smart-tour';
import type { StorageAdapter, Tour } from 'rn-smart-tour';

const TOURS: Record<string, Tour> = {
  welcome: {
    id: 'welcome',
    autoStart: true,
    steps: [
      { targetId: 'title', title: 'Welcome', description: 'This tour starts by itself the first time.' },
      { targetId: 'help', title: 'Help', description: 'Replays the welcome tour, even after it was seen.' },
      { targetId: 'layout-card', title: 'Your own onLayout', description: 'Still measured correctly.', position: 'top' },
    ],
  },
  scroll: {
    id: 'scroll',
    steps: [
      { targetId: 'start-scroll', title: 'Auto-scroll', description: 'Next, the list scrolls to a target below the fold.' },
      { targetId: 'deep-target', title: 'Found it', description: 'The highlight follows the target after scrolling.', position: 'top' },
    ],
  },
  broken: {
    id: 'broken',
    steps: [
      { targetId: 'start-broken', title: 'Missing target', description: 'The next step points at a target that does not exist.' },
      { targetId: 'does-not-exist', title: 'Never shown', description: '' },
    ],
  },
};

/** In-memory storage. Real apps pass AsyncStorage or an MMKV wrapper. */
const memory: Record<string, string> = {};

const Button = ({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) => (
  <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>
);

const Home = () => {
  const { startTour, resetAll, activeTour, currentStepIndex } = useDap();
  const [layoutCount, setLayoutCount] = useState(0);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <DapTarget name="title">
          <Text style={styles.title}>rn-smart-tour</Text>
        </DapTarget>
        <DapTarget name="help">
          <Button testID="help" label="Help" onPress={() => startTour('welcome', { force: true })} />
        </DapTarget>
      </View>

      <Text testID="status" style={styles.status}>
        {activeTour ? `Tour "${activeTour.id}" · step ${currentStepIndex + 1}` : 'No tour running'}
      </Text>

      <DapScrollView contentContainerStyle={styles.content}>
        <DapTarget name="layout-card" onLayout={() => setLayoutCount(c => c + 1)}>
          <View style={styles.card}>
            <Text style={styles.cardText}>Target with its own onLayout (fired {layoutCount}×)</Text>
          </View>
        </DapTarget>

        <View style={styles.row}>
          <DapTarget name="start-scroll">
            <Button testID="start-scroll" label="Auto-scroll tour" onPress={() => startTour('scroll', { force: true })} />
          </DapTarget>
          <DapTarget name="start-broken">
            <Button testID="start-broken" label="Missing-target tour" onPress={() => startTour('broken', { force: true })} />
          </DapTarget>
        </View>
        <Button testID="reset" label="Reset all tours" onPress={resetAll} />

        {Array.from({ length: 12 }, (_, i) => (
          <View key={i} style={styles.filler}>
            <Text style={styles.cardText}>Filler row {i + 1}</Text>
          </View>
        ))}

        <DapTarget name="deep-target">
          <View style={[styles.card, styles.deepCard]}>
            <Text style={styles.cardText}>Target below the fold</Text>
          </View>
        </DapTarget>
      </DapScrollView>
    </SafeAreaView>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      {/* Inline adapter on purpose: the provider must not reload storage on every render. */}
      <DapProvider
        tours={TOURS}
        missingTargetTimeoutMs={2000}
        storageAdapter={{
          getItem: key => memory[key] ?? null,
          setItem: (key, value) => {
            memory[key] = value;
          },
        } satisfies StorageAdapter}>
        <Home />
      </DapProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f5f7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#1b1f24' },
  status: { paddingHorizontal: 16, paddingBottom: 8, color: '#57606a' },
  content: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  button: { backgroundColor: '#0a66c2', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  pressed: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: '600' },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 10 },
  deepCard: { borderWidth: 2, borderColor: '#0a66c2' },
  cardText: { color: '#1b1f24' },
  filler: { backgroundColor: '#e7e9ec', padding: 24, borderRadius: 10 },
});
