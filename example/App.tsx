/**
 * rn-smart-tour example app.
 *
 * Mirrors a typical production setup (React Navigation native-stack, a FlatList,
 * persisted seen state) and exercises one behaviour per tour: auto-start,
 * auto-scroll inside a FlatList, a tour that moves between screens, a step whose
 * target is missing, and two screens that both have a target named "title".
 */
import { useRef } from 'react';
import { FlatList, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TourProvider, TourScrollable, TourTarget, useTour } from 'rn-smart-tour';
import type { StorageAdapter, Tour } from 'rn-smart-tour';
import { NavigationTourScope } from 'rn-smart-tour/react-navigation';
import { QaDriver } from './QaDriver';

type RootStack = { Home: undefined; Details: undefined };
const Stack = createNativeStackNavigator<RootStack>();
const navigationRef = createNavigationContainerRef<RootStack>();

const TOURS: Record<string, Tour> = {
  welcome: {
    id: 'welcome',
    autoStart: true,
    steps: [
      { targetId: 'title', title: 'Welcome', description: 'This tour starts by itself the first time.' },
      { targetId: 'help', title: 'Help', description: 'Replays the welcome tour, even after it was seen.' },
      { targetId: 'open-details', title: 'Another screen', description: 'Opens a second screen.' },
    ],
  },
  scroll: {
    id: 'scroll',
    steps: [
      { targetId: 'start-scroll', title: 'Auto-scroll', description: 'Next, the list scrolls to row 25.' },
      { targetId: 'row-25', title: 'Row 25', description: 'Scrolled into view, then measured.', position: 'top' },
    ],
  },
  cross: {
    id: 'cross',
    steps: [
      { targetId: 'start-cross', title: 'Across screens', description: 'Next opens the details screen.' },
      {
        targetId: 'details-card',
        title: 'On another screen',
        description: 'Shown once the screen has finished animating in.',
        beforeEnter: () => navigationRef.navigate('Details'),
      },
      {
        targetId: 'help',
        title: 'And back',
        description: 'Back on the first screen.',
        beforeEnter: () => navigationRef.goBack(),
      },
    ],
  },
  titleOnly: {
    id: 'titleOnly',
    steps: [{ targetId: 'title', title: 'Which title?', description: 'Only the focused screen counts.' }],
  },
  broken: {
    id: 'broken',
    steps: [
      { targetId: 'start-broken', title: 'Missing target', description: 'The next step points at nothing.' },
      { targetId: 'does-not-exist', title: 'Never shown', description: '' },
    ],
  },
};

/** In-memory storage. Real apps pass AsyncStorage or an MMKV wrapper. */
const memory: Record<string, string> = {};
const storage: StorageAdapter = {
  getItem: key => memory[key] ?? null,
  setItem: (key, value) => {
    memory[key] = value;
  },
};

const Button = ({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) => (
  <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>
);

const Status = () => {
  const { status, activeTour, currentStepIndex } = useTour();
  return (
    <Text testID="status" style={styles.status}>
      {activeTour ? `"${activeTour.id}" · step ${currentStepIndex + 1} · ${status}` : 'No tour running'}
    </Text>
  );
};

const ROWS = Array.from({ length: 30 }, (_, i) => i + 1);

const HomeScreen = () => {
  const { startTour, resetAll } = useTour();
  const listRef = useRef<FlatList<number>>(null);

  const header = (
    <View style={styles.controls}>
      <Status />
      <View style={styles.row}>
        <TourTarget name="open-details">
          <Button testID="open-details" label="Open details" onPress={() => navigationRef.navigate('Details')} />
        </TourTarget>
        <TourTarget name="start-cross">
          <Button testID="start-cross" label="Cross-screen tour" onPress={() => startTour('cross', { force: true })} />
        </TourTarget>
      </View>
      <View style={styles.row}>
        <TourTarget name="start-scroll">
          <Button testID="start-scroll" label="Auto-scroll tour" onPress={() => startTour('scroll', { force: true })} />
        </TourTarget>
        <TourTarget name="start-broken">
          <Button testID="start-broken" label="Missing target" onPress={() => startTour('broken', { force: true })} />
        </TourTarget>
      </View>
      <Button testID="reset" label="Reset all tours" onPress={resetAll} />
    </View>
  );

  return (
    <NavigationTourScope>
      <View style={styles.screen}>
        <View style={styles.header}>
          <TourTarget name="title">
            <Text style={styles.title}>Home</Text>
          </TourTarget>
          <TourTarget name="help">
            <Button testID="help" label="Help" onPress={() => startTour('welcome', { force: true })} />
          </TourTarget>
        </View>
        <TourScrollable scrollRef={listRef}>
          <FlatList
            ref={listRef}
            data={ROWS}
            keyExtractor={item => String(item)}
            ListHeaderComponent={header}
            contentContainerStyle={styles.content}
            renderItem={({ item }) =>
              item === 25 ? (
                <TourTarget name="row-25">
                  <View style={[styles.rowCard, styles.highlightRow]}>
                    <Text>Row {item} (tour target)</Text>
                  </View>
                </TourTarget>
              ) : (
                <View style={styles.rowCard}>
                  <Text>Row {item}</Text>
                </View>
              )
            }
          />
        </TourScrollable>
      </View>
    </NavigationTourScope>
  );
};

const DetailsScreen = () => {
  const { startTour } = useTour();
  return (
    <NavigationTourScope>
      <View style={[styles.screen, styles.content]}>
        <View style={styles.header}>
          {/* Same name as Home's title: only the focused screen's one is used. */}
          <TourTarget name="title">
            <Text style={styles.title}>Details</Text>
          </TourTarget>
        </View>
        <Status />
        <TourTarget name="details-card">
          <View style={styles.card}>
            <Text>A card on the second screen.</Text>
          </View>
        </TourTarget>
        <Button testID="title-tour" label='Highlight "title"' onPress={() => startTour('titleOnly', { force: true })} />
      </View>
    </NavigationTourScope>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <TourProvider tours={TOURS} storageAdapter={storage} missingTargetTimeoutMs={2000}>
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Details" component={DetailsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
        <QaDriver openDetails={() => navigationRef.navigate('Details')} />
      </TourProvider>
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
  status: { paddingBottom: 4, color: '#57606a' },
  controls: { gap: 12, paddingBottom: 12 },
  content: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
  button: { backgroundColor: '#0a66c2', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  pressed: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: '600' },
  card: { backgroundColor: '#fff', padding: 24, borderRadius: 10 },
  rowCard: { backgroundColor: '#e7e9ec', padding: 20, borderRadius: 10 },
  highlightRow: { borderWidth: 2, borderColor: '#0a66c2', backgroundColor: '#fff' },
});
