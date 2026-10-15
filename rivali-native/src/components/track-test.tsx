import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ActivityIndicator, AppState, Image, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';
import { SetupForm, setupText, type Setup } from './setup-form';
import { TrackMapper, type FastestGroove } from './track-mapper';
import { getMyChronRuns, downloadMyChronRun, type MyChronRun } from '../lib/mychron-download';

type Report = { fastestGroove?: FastestGroove; filename: string; text: string; confidence: string; confidenceReason: string; observations: string[]; warnings: string[]; unavailable: string[]; summary: { lap_count: number; best_lap_sec: number | null; average_lap_sec: number | null; consistency_stdev_sec: number | null; laps: { lap_number: number; lap_time_sec: number; is_best: boolean }[] } };
type Pending = { id: string; filename: string; uri: string; path: string; uploaded: boolean };
const backend = process.env.EXPO_PUBLIC_TRACK_ANALYSIS_URL?.replace(/\/$/, '');
const storageUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const storageKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export default function TrackTest() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [status, setStatus] = useState(''); const [error, setError] = useState(supabase ? '' : 'Rivali sign-in is not configured.');
  const [pending, setPending] = useState<Pending | null>(null); const [report, setReport] = useState<Report | null>(null);
  const [saved, setSaved] = useState<{ file: string; report: Report }[]>([]);
  const [setup, setSetup] = useState<Setup>({});
  const [myChronRuns, setMyChronRuns] = useState<MyChronRun[]>([]);
  const [wifiFile, setWifiFile] = useState(false);
  const [deviceNotice,setDeviceNotice] = useState('');
  const locked = useRef(false);
  const activeUser = useRef<string | undefined>(undefined);
  const directory = session && FileSystem.documentDirectory ? `${FileSystem.documentDirectory}track-test-${session.user.id}/` : null;

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => { if (active) { activeUser.current = data.session?.user.id; setSession(data.session); } });
    const { data: auth } = supabase.auth.onAuthStateChange((_event, value) => { if (activeUser.current !== value?.user.id) { setReport(null); setPending(null); setSaved([]); } activeUser.current = value?.user.id; setSession(value); });
    const lifecycle = AppState.addEventListener('change', state => { if (state === 'active') supabase!.auth.startAutoRefresh(); else supabase!.auth.stopAutoRefresh(); });
    supabase.auth.startAutoRefresh();
    return () => { active = false; auth.subscription.unsubscribe(); lifecycle.remove(); supabase!.auth.stopAutoRefresh(); };
  }, []);

  useEffect(() => {
    let active = true;
    if (!directory) return;
    void (async () => {
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const files = await FileSystem.readDirectoryAsync(directory);
      const reports = await Promise.all(files.filter(f => f.startsWith('report-')).sort().reverse().slice(0, 10).map(async file => ({ file, report: JSON.parse(await FileSystem.readAsStringAsync(directory + file)) as Report })));
      if (active) { setSaved(reports); setReport(reports[0]?.report ?? null); }
      if (files.includes('pending.json')) { const value = JSON.parse(await FileSystem.readAsStringAsync(directory + 'pending.json')) as Pending; if (active) {setPending(value);if(!value.uploaded)setWifiFile(true);} }
    })().catch(() => { if (active) setError('Could not restore saved runs on this phone. You can choose the original XRK again.'); });
    return () => { active = false; };
  }, [directory]);

  async function perform(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not finish. Please retry.'); }
    finally { locked.current = false; setBusy(false); setStatus(''); }
  }
  async function choose() {
    if (!session || !directory) return;
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled) return;
    const file = result.assets[0];
    if (!file.name.toLowerCase().endsWith('.xrk')) throw new Error('Choose the original MyChron .xrk file from Race Studio 3.');
    const info = await FileSystem.getInfoAsync(file.uri);
    if (!info.exists || info.size <= 0 || info.size > 20 * 1024 * 1024) throw new Error('Choose a nonempty XRK file up to 20 MB.');
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    const uri = directory + id + '.xrk';
    await FileSystem.copyAsync({ from: file.uri, to: uri });
    const value = { id, filename: file.name, uri, path: `${session.user.id}/track-tests/${id}/source.xrk`, uploaded: false };
    await FileSystem.writeAsStringAsync(directory + 'pending.json', JSON.stringify(value));
    setPending(value); setReport(null);
  }
  async function scanMyChron() {
    setStatus('Reading MyChron 5S session list...');
    const runs=await getMyChronRuns();
    setMyChronRuns(runs);
    setDeviceNotice(runs.length ? runs.length+' sessions found' : 'MyChron replied: 0 sessions.');
  }
  async function takeMyChronRun(selected:MyChronRun) {
    if (!session || !directory) throw Error('Sign in before downloading.');
    if (pending) throw Error('Complete the pending upload before downloading another session.');
    const id=`${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
    const uri=directory+id+'.xrk';
    setStatus('Downloading XRK over MyChron Wi-Fi...');
    let result;
    try {
      result=await downloadMyChronRun(selected,uri,(done,total)=>setStatus('Downloading MyChron: '+Math.round(done/total*100)+'%'));
    }catch(e){await FileSystem.deleteAsync(uri,{idempotent:true});throw e;}
    const value:Pending={id,filename:result.filename,uri,path:`${session.user.id}/track-tests/${id}/source.xrk`,uploaded:false};
    await FileSystem.writeAsStringAsync(directory+'pending.json',JSON.stringify(value));
    setPending(value);setReport(null);setMyChronRuns([]);setWifiFile(true);
    setStatus('XRK verified and queued. Switch to LTE or regular Wi-Fi for automatic upload.');
  }
  // Returning from Wi-Fi Settings triggers the queued upload and report generation.
  useEffect(()=>{
    if(!pending || !wifiFile || !session || !backend)return;
    const tryUpload=async()=>{
      try{const response=await fetch(backend+'/health',{signal:AbortSignal.timeout(5000)});
        if(response.ok){setWifiFile(false);void perform(run);}
      }catch{/* Still connected to MyChron Wi-Fi. Retain the verified XRK. */}
    };
    void tryUpload();
    const listener=AppState.addEventListener('change',value=>{if(value==='active')void tryUpload()});
    return ()=>listener.remove();
  },[pending,wifiFile,session]);
  async function run() {
    if (!pending || !directory || !session || !supabase || !backend || !storageUrl || !storageKey) throw new Error('Rivali analysis is not configured.');
    const userId = session.user.id;
    const fresh = await supabase.auth.getSession(); const token = fresh.data.session?.access_token;
    if (!token) throw new Error('Sign in again before analyzing a run.');
    let value = pending;
    if (!value.uploaded) {
      setStatus('Uploading your XRK…');
      const response = await FileSystem.uploadAsync(`${storageUrl}/storage/v1/object/telemetry/${value.path}`, value.uri, { httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT, headers: { apikey: storageKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' } });
      if (response.status !== 200 && response.status !== 201) throw new Error('Upload did not finish. Your file is saved on this phone; retry when you have internet.');
      value = { ...value, uploaded: true }; await FileSystem.writeAsStringAsync(directory + 'pending.json', JSON.stringify(value)); setPending(value);
    }
    setStatus('Analyzing your run… Keep Rivali open.');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 300000);
    try {
      const response = await fetch(`${backend}/analyze`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: value.path, filename: value.filename }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Analysis failed. Your uploaded file is saved; retry analysis.');
      if (!data.text || !data.summary) throw new Error('The server returned an incomplete report. Please retry.');
      await FileSystem.writeAsStringAsync(directory + `report-${value.id}.json`, JSON.stringify(data));
      await FileSystem.deleteAsync(directory + 'pending.json', { idempotent: true });
      await FileSystem.deleteAsync(value.uri, { idempotent: true });
      if (activeUser.current === userId) { setReport(data as Report); setPending(null); setSaved(current => [{ file: `report-${value.id}.json`, report: data as Report }, ...current].slice(0, 10)); }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw new Error('Analysis timed out. Your upload is saved; tap Run analysis again to retrieve or retry it.');
      throw e;
    } finally { clearTimeout(timeout); }
  }

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Rivali — Turn Data Into Speed" />
    <Text style={styles.heading}>Track test</Text><Text style={styles.muted}>Upload XRK · Analyze · Share report</Text>
    {!session ? <View style={styles.card}><Text style={styles.title}>Sign in to Rivali</Text>
      <TextInput accessibilityLabel="Email" value={email} onChangeText={setEmail} editable={!busy} autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor="#999" style={styles.input} />
      <TextInput accessibilityLabel="Password" value={password} onChangeText={setPassword} editable={!busy} secureTextEntry placeholder="Password" placeholderTextColor="#999" style={styles.input} />
      <ActionButton label="Sign in" disabled={busy || !email.trim() || !password} onPress={() => void perform(async () => { if (!supabase) throw new Error('Rivali sign-in is not configured.'); const { error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (loginError) throw loginError; setPassword(''); })} />
    </View> : <>
      {directory && <TrackMapper directory={directory} fastestGroove={report?.fastestGroove} />}
      {directory && <SetupForm directory={directory} onSaved={setSetup} />}
      <View style={styles.card}><Text style={styles.title}>1 · Choose a run</Text><Text style={styles.muted}>Internet is needed for upload and analysis. Leave MyChron Wi-Fi after downloading the file.</Text>
        <ActionButton label="Find MyChron 5S sessions (Wi-Fi)" disabled={busy || !!pending} onPress={() => void perform(scanMyChron)} />
        {!!deviceNotice && <Text style={styles.muted}>{deviceNotice}</Text>}`n        {myChronRuns.map(item=><Pressable key={item.name} disabled={busy || !!pending} accessibilityRole="button" style={styles.saved} onPress={() => void perform(()=>takeMyChronRun(item))}><Text style={styles.text}>{item.name} · {item.date} {item.time} · {item.laps} laps</Text><Text style={styles.muted}>Download XRK to Rivali queue</Text></Pressable>)}
        {wifiFile && <Text style={styles.muted}>XRK verified. Leave MyChron Wi-Fi and use LTE or regular Wi-Fi. Rivali will upload and analyze when you return to the app.</Text>}
        <ActionButton label="Choose XRK file" disabled={busy} onPress={() => void perform(choose)} />{pending && <Text style={styles.text}>{pending.filename} · {pending.uploaded ? 'Uploaded' : 'Saved on phone'}</Text>}
        <ActionButton label={pending?.uploaded ? "Retry / retrieve analysis" : "Run analysis"} disabled={busy || !pending} onPress={() => void perform(run)} />
      </View>
      {report && <View style={styles.card}><Text style={styles.title}>2 · Report ready</Text><Text style={styles.text}>{report.filename}</Text><Text style={styles.confidence}>Confidence: {report.confidence.toUpperCase()}</Text><Text style={styles.muted}>{report.confidenceReason}</Text>
        {report.observations.map((line, i) => <Text key={i} style={styles.text}>{line}</Text>)}
        <ActionButton label="Share report" disabled={busy} onPress={() => void perform(async () => { await Share.share({ title: "Rivali track test report", message: report.text + (setupText(setup) ? "\n\nKART SETUP (operator supplied, not verified from telemetry)\n" + setupText(setup) : "") }); })} />
        <Text style={styles.title}>Quality flags</Text>{report.warnings.map((line, i) => <Text key={i} style={styles.muted}>{line}</Text>)}
        <Text style={styles.title}>Not assessed</Text>{report.unavailable.map((line, i) => <Text key={i} style={styles.muted}>{line}</Text>)}
        <Text style={styles.title}>Lap times</Text>{report.summary.laps.map(lap => <Text key={lap.lap_number} style={styles.text}>Lap {lap.lap_number} · {lap.lap_time_sec.toFixed(3)} s{lap.is_best ? ' · BEST' : ''}</Text>)}
      </View>}
      {!!saved.length && <View style={styles.card}><Text style={styles.title}>Saved reports · available offline</Text>{saved.map(item => <Pressable key={item.file} accessibilityRole="button" disabled={busy} onPress={() => setReport(item.report)} style={styles.saved}><Text style={styles.text}>{item.report.filename}</Text></Pressable>)}</View>}
      <ActionButton label="Sign out" disabled={busy} onPress={() => void perform(async () => { await supabase!.auth.signOut(); setReport(null); setSaved([]); setPending(null); })} />
    </>}
    {busy && <View style={styles.card}><ActivityIndicator color="#c3352b" /><Text accessibilityLiveRegion="polite" style={styles.text}>{status || 'Working…'}</Text></View>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </ScrollView></SafeAreaView>;
}
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#09090b' }, content: { padding: 22, paddingBottom: 40, gap: 14 }, logo: { width: '100%', height: 74 },
  heading: { color: '#eee', fontSize: 30, fontWeight: '800' }, title: { color: '#eee', fontSize: 18, fontWeight: '700' }, text: { color: '#eee', lineHeight: 23 }, muted: { color: '#aaa', fontSize: 13, lineHeight: 20 },
  card: { backgroundColor: '#161619', borderColor: '#333', borderWidth: 1, borderRadius: 12, padding: 18, gap: 12 }, input: { color: '#eee', borderWidth: 1, borderColor: '#555', borderRadius: 8, padding: 14 },
  button: { backgroundColor: '#a3271f', borderRadius: 8, padding: 15, minHeight: 48, alignItems: 'center' }, buttonText: { color: '#fff', fontWeight: '700' }, disabled: { opacity: 0.4 }, confidence: { color: '#ddd', fontWeight: '700' }, error: { color: '#ff9393', lineHeight: 22 }, saved: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#444' },
});
