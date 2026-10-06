import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { api, appendFile, clearCredential, Credential, json, loadCredential, RaceStatus, saveCredential, webDashboard } from '../lib/api';

type Intake = { driverName: string; kartName: string; chassisMake: string; chassisModel: string; drivingStyle: 'lift' | 'burp_throttle' | 'full_throttle_brake_drag' | 'other' };
const initialIntake: Intake = { driverName: '', kartName: '', chassisMake: '', chassisModel: '', drivingStyle: 'other' };
export default function Home() {
  const [credential, setCredential] = useState<Credential | null>(null);
  const [status, setStatus] = useState<RaceStatus | null>(null);
  const [code, setCode] = useState('');
  const [intake, setIntake] = useState(initialIntake);
  const [sessionType, setSessionType] = useState('practice');
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [doug, setDoug] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder);

  useEffect(() => {
    let active = true;
    loadCredential().then(value => { if (active) { setCredential(value); setReady(true); } }).catch(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!credential) return;
    let active = true;
    api<RaceStatus>('status', credential.accessToken).then(value => {
      if (active) { setStatus(value); setSelectedRun(value.sessions[0]?.id ?? null); }
    }).catch(error => { if (active) Alert.alert('Rivali', String(error.message)); });
    return () => { active = false; };
  }, [credential]);
  useEffect(() => {
    if (recording.isRecording && recording.durationMillis >= 180000) {
      recorder.stop().then(() => setRecordedUri(recorder.uri)).catch(() => Alert.alert('Recording', 'Could not stop the recording.'));
    }
  }, [recording.isRecording, recording.durationMillis, recorder]);

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch (error) { Alert.alert('Rivali', error instanceof Error ? error.message : 'Could not finish this action.'); }
    finally { setBusy(false); }
  }
  async function refresh() {
    if (!credential) return;
    const value = await api<RaceStatus>('status', credential.accessToken);
    setStatus(value);
    setSelectedRun(current => value.sessions.some(run => run.id === current) ? current : value.sessions[0]?.id ?? null);
  }
  async function claim() {
    const value = await api<Credential>('claim', undefined, { ...json({ code: code.trim() }), headers: { 'Content-Type': 'application/json', 'X-Rivali-Native': '1' } });
    if (!value.accessToken || !value.expiresAt) throw new Error('This Rivali server needs the native app update.');
    await saveCredential(value); setCredential(value); setCode('');
  }
  async function upload() {
    if (!credential) return;
    const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (picked.canceled) return;
    const file = picked.assets[0];
    if (!file.name.toLowerCase().endsWith('.xrk')) throw new Error('Choose a MyChron .xrk file.');
    if (file.size !== undefined && file.size > 100 * 1024 * 1024) throw new Error('The maximum file size is 100 MB.');
    const form = new FormData();
    appendFile(form, 'file', file.uri, file.name, 'application/octet-stream'); form.append('sessionType', sessionType);
    const result = await api<{ sessionId: string }>('upload', credential.accessToken, { method: 'POST', body: form });
    await refresh(); setSelectedRun(result.sessionId); Alert.alert('Run uploaded', 'Your run is queued for analysis.');
  }
  async function toggleRecording() {
    if (recording.isRecording) { await recorder.stop(); setRecordedUri(recorder.uri); await setAudioModeAsync({ allowsRecording: false }); return; }
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) throw new Error('Allow microphone access in Settings to record a debrief.');
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync(); setRecordedUri(null); setTranscript(''); recorder.record();
  }
  async function sendRecording() {
    if (!credential || !selectedRun || !recordedUri) throw new Error('Select a run and record a debrief first.');
    const form = new FormData(); form.append('sessionId', selectedRun);
    appendFile(form, 'audio', recordedUri, 'debrief.m4a', 'audio/mp4');
    const result = await api<{ transcript: string }>('debrief', credential.accessToken, { method: 'POST', body: form });
    setTranscript(result.transcript); setRecordedUri(null);
  }
  async function closeDoug() {
    if (recording.isRecording) { await recorder.stop(); setRecordedUri(recorder.uri); }
    await setAudioModeAsync({ allowsRecording: false }); setDoug(false);
  }
  function button(label: string, action: () => Promise<void>, disabled = false) {
    return <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={() => void perform(action)} style={[styles.button, (busy || disabled) && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
  }
  if (!ready) return <SafeAreaView style={styles.safe}><ActivityIndicator color="#c33535" /></SafeAreaView>;
  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Rivali" />
      <Text style={styles.eyebrow}>TURN DATA INTO SPEED</Text>
      <Text style={styles.heading}>Race day, ready.</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push("/account")} style={styles.chip}><Text style={styles.text}>Open your race shop · sign in</Text></Pressable>
      {busy && <ActivityIndicator color="#c33535" />}
      {!credential ? <View style={styles.card}>
        <Text style={styles.title}>Enter your Race Day code</Text>
        <Text style={styles.muted}>Use the code supplied for your event.</Text>
        <TextInput accessibilityLabel="Race Day code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} style={styles.input} placeholder="Race Day code" placeholderTextColor="#999" />
        {button('Open race day', claim, code.trim().length < 6)}
      </View> : <>
        <View style={styles.card}><Text style={styles.title}>{status?.pass.driverName || 'Your race day'}</Text><Text style={styles.muted}>{status?.pass.className}</Text>{button('Refresh runs', refresh)}</View>
        {status && !status.pass.intakeComplete && <View style={styles.card}>
          <Text style={styles.title}>Driver and kart</Text><Text style={styles.muted}>Chassis details are optional. Share only what you are comfortable providing.</Text>
          {(['driverName', 'kartName', 'chassisMake', 'chassisModel'] as const).map(field => <TextInput key={field} accessibilityLabel={field} placeholder={{ driverName: 'Driver name', kartName: 'Kart name', chassisMake: 'Chassis make (optional)', chassisModel: 'Chassis model (optional)' }[field]} placeholderTextColor="#999" value={intake[field]} onChangeText={value => setIntake(current => ({ ...current, [field]: value }))} style={styles.input} />)}
          <Text style={styles.muted}>Typical driving style</Text><View style={styles.choices}>
            {(['lift', 'burp_throttle', 'full_throttle_brake_drag', 'other'] as const).map(value => <Pressable key={value} accessibilityRole="button" onPress={() => setIntake(current => ({ ...current, drivingStyle: value }))} style={[styles.chip, intake.drivingStyle === value && styles.selected]}><Text style={styles.text}>{{ lift: 'Lift', burp_throttle: 'Burp throttle', full_throttle_brake_drag: 'Brake drag', other: 'Other / unsure' }[value]}</Text></Pressable>)}
          </View>{button('Save intake', async () => { await api('intake', credential.accessToken, json(intake)); await refresh(); }, !intake.driverName.trim() || !intake.kartName.trim())}
        </View>}
        <View style={styles.card}><Text style={styles.title}>Upload a run</Text><View style={styles.choices}>{['practice', 'hot laps', 'heat', 'feature'].map(value => <Pressable key={value} accessibilityRole="button" onPress={() => setSessionType(value)} style={[styles.chip, sessionType === value && styles.selected]}><Text style={styles.text}>{value}</Text></Pressable>)}</View>{button('Choose MyChron file', upload, !status?.pass.intakeComplete)}</View>
        <Text style={styles.title}>Recent runs</Text>
        {status?.sessions.length === 0 && <Text style={styles.muted}>Upload your first run to start analysis.</Text>}
        {status?.sessions.map(run => <Pressable key={run.id} accessibilityRole="button" onPress={() => { setSelectedRun(run.id); setRecordedUri(null); setTranscript(''); }} style={[styles.card, selectedRun === run.id && styles.selected]}>
          <Text style={styles.title}>{run.session_type}</Text><Text style={styles.muted}>{run.report_status} · {run.lap_count ?? '—'} laps · best {run.best_lap_sec ?? '—'} s</Text>
          {run.recommendations.map((item, index) => <View key={index}><Text style={styles.text}>{item.recommendation}</Text><Text style={styles.muted}>Confidence: {item.confidence}</Text></View>)}
        </Pressable>)}
        {button('Sign out of race day', async () => { await clearCredential(); setCredential(null); setStatus(null); setSelectedRun(null); setRecordedUri(null); setTranscript(''); })}
      </>}
    </ScrollView>
    <Pressable accessibilityRole="button" accessibilityLabel="Ask Doug" onPress={() => setDoug(true)} style={styles.doug}><Ionicons name="mic" size={18} color="#eee" /><Text style={styles.buttonText}>Ask Doug</Text></Pressable>
    <Modal visible={doug} transparent animationType="slide" onRequestClose={() => void perform(closeDoug)}>
      <View style={styles.overlay}><SafeAreaView style={styles.panel}>
        <Text style={styles.title}>Doug · Race debrief</Text><Text style={styles.muted}>Select a run, then tell Doug what the kart was doing. Review before sending.</Text>
        {button(recording.isRecording ? 'Stop recording' : 'Record debrief', toggleRecording, !selectedRun)}
        <Text style={styles.muted}>{recording.isRecording ? `Listening… ${Math.round(recording.durationMillis / 1000)}s / 180s` : recordedUri ? 'Recording ready to send.' : 'Microphone off'}</Text>
        {button('Send debrief', sendRecording, !recordedUri || recording.isRecording)}
        {transcript ? <ScrollView style={{ maxHeight: 180 }}><Text style={styles.text}>{transcript}</Text></ScrollView> : null}
        {button('Open Doug live in Rivali', async () => { await closeDoug(); if (!webDashboard) throw new Error('Rivali connection is not configured.'); await Linking.openURL(webDashboard); })}
        {button('Close', closeDoug)}
      </SafeAreaView></View>
    </Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#09090b' }, content: { padding: 22, paddingBottom: 110, gap: 16 },
  logo: { width: '100%', height: 90 }, eyebrow: { color: '#aaa', fontSize: 11, letterSpacing: 3 }, heading: { color: '#eee', fontSize: 32, fontWeight: '800' },
  card: { backgroundColor: '#161619', padding: 18, borderRadius: 14, borderWidth: 1, borderColor: '#333338', gap: 12 },
  title: { color: '#ddd', fontSize: 19, fontWeight: '700' }, text: { color: '#eee', fontSize: 15, lineHeight: 23 }, muted: { color: '#aaa', fontSize: 13, lineHeight: 20 },
  input: { color: '#eee', backgroundColor: '#0c0c0f', borderWidth: 1, borderColor: '#45454a', borderRadius: 9, padding: 14, minHeight: 48 },
  button: { backgroundColor: '#a3271f', padding: 14, minHeight: 48, alignItems: 'center', borderRadius: 10 }, buttonText: { color: '#eee', fontWeight: '700' }, disabled: { opacity: 0.45 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { padding: 11, backgroundColor: '#232328', borderRadius: 8, borderWidth: 1, borderColor: '#45454a' }, selected: { borderColor: '#bc3a30' },
  doug: { position: 'absolute', right: 20, bottom: 26, flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: '#a3271f', paddingHorizontal: 15, minHeight: 46, borderRadius: 24 },
  overlay: { flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' }, panel: { backgroundColor: '#161619', padding: 24, gap: 14, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
});
