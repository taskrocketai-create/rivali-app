import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { connectDoug, LiveCall } from '../lib/doug-live';

type Run = { id: string; session_date: string; session_type: string; report_status: string; best_lap_sec: number | null; average_lap_sec: number | null; lap_count: number | null; recommendations: { recommendation: string; confidence: string }[] };
export default function Account() {
  const [session, setSession] = useState<Session | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState('Microphone off'); const [calling, setCalling] = useState(false);
  const call = useRef<LiveCall | null>(null); const abort = useRef<AbortController | null>(null);
  const endCall = () => { abort.current?.abort(); abort.current = null; call.current?.close(); call.current = null; setCalling(false); setCaption('Microphone off'); };
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, value) => { if (active) setSession(value); });
    const lifecycle = AppState.addEventListener('change', state => {
      if (state === 'active') supabase!.auth.startAutoRefresh();
      else { supabase!.auth.stopAutoRefresh(); endCall(); }
    });
    if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
    return () => { active = false; listener.subscription.unsubscribe(); lifecycle.remove(); supabase!.auth.stopAutoRefresh(); abort.current?.abort(); call.current?.close(); };
  }, []);
  useEffect(() => {
    if (!session || !supabase) return;
    let active = true;
    supabase.from('sessions').select('id,session_date,session_type,report_status,best_lap_sec,average_lap_sec,lap_count,recommendations(recommendation,confidence)').eq('user_id', session.user.id).order('session_date', { ascending: false }).limit(30).then(({ data, error }) => {
      if (!active) return;
      if (error) Alert.alert('Runs unavailable', error.message);
      else { setRuns((data ?? []) as Run[]); setSelected(data?.[0]?.id); }
    });
    return () => { active = false; };
  }, [session]);
  async function perform(action: () => Promise<void>) { if (busy) return; setBusy(true); try { await action(); } catch (error) { Alert.alert('Rivali', error instanceof Error ? error.message : 'Could not finish this action.'); } finally { setBusy(false); } }
  async function startCall() {
    endCall(); const controller = new AbortController(); abort.current = controller; setCaption('Connecting Doug…');
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      call.current = await connectDoug(selected, setCaption, controller.signal); setCalling(true);
    } catch (error) { endCall(); throw error; } finally { clearTimeout(timeout); }
  }

  return <SafeAreaView style={styles.safe}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Rivali" />
      <Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={styles.muted}>‹ Race day</Text></Pressable>
      <Text style={styles.heading}>Your race shop</Text>{busy && <ActivityIndicator color="#bc3a30" />}
      {!session ? <View style={styles.card}>
        <Text style={styles.muted}>Sign in with your existing Rivali account.</Text>
        <TextInput accessibilityLabel="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} style={styles.input} placeholder="Email" placeholderTextColor="#999" />
        <TextInput accessibilityLabel="Password" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} placeholder="Password" placeholderTextColor="#999" />
        <ActionButton label="Sign in" busy={busy} perform={perform} action={async () => { if (!supabase) throw new Error('Account sign-in is not configured for this build.'); const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (error) throw error; setPassword(''); }} />
      </View> : <>
        <Text style={styles.muted}>{session.user.email}</Text>
        <ActionButton label="Refresh runs" busy={busy} perform={perform} action={async () => { const { data, error } = await supabase!.from('sessions').select('id,session_date,session_type,report_status,best_lap_sec,average_lap_sec,lap_count,recommendations(recommendation,confidence)').eq('user_id', session.user.id).order('session_date', { ascending: false }).limit(30); if (error) throw error; setRuns((data ?? []) as Run[]); }} />
        {!runs.length && <Text style={styles.muted}>No runs yet. Use a Race Day pass to upload your first session.</Text>}
        {runs.map(run => <Pressable key={run.id} accessibilityRole="button" onPress={() => setSelected(run.id)} style={[styles.card, selected === run.id && { borderColor: '#bc3a30' }]}>
          <Text style={styles.title}>{run.session_date} · {run.session_type}</Text>
          <Text style={styles.muted}>{run.report_status} · {run.lap_count ?? '—'} laps</Text><Text style={styles.text}>Best {run.best_lap_sec ?? '—'} s · average {run.average_lap_sec ?? '—'} s</Text>
          {['approved', 'sent'].includes(run.report_status) && run.recommendations.map((item, i) => <View key={i}><Text style={styles.text}>{item.recommendation}</Text><Text style={styles.muted}>Confidence: {item.confidence}</Text></View>)}
        </Pressable>)}
        <ActionButton label="Sign out" busy={busy} perform={perform} action={async () => { endCall(); const { error } = await supabase!.auth.signOut(); if (error) throw error; setRuns([]); setSelected(undefined); }} />
      </>}
    </ScrollView>
    {session && <Pressable accessibilityRole="button" accessibilityLabel="Ask Doug" onPress={() => setOpen(true)} style={styles.doug}><Ionicons name="mic" size={18} color="#eee" /><Text style={styles.text}>Ask Doug</Text></Pressable>}
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => { endCall(); setOpen(false); }}><View style={styles.overlay}><SafeAreaView style={styles.panel}>
      <Text style={styles.title}>Ask Doug</Text><Text style={styles.muted}>{caption}</Text>
      <ActionButton label={calling ? "End call" : "Talk to Doug"} busy={busy} perform={perform} action={async () => { if (calling) endCall(); else await startCall(); }} />
      <ActionButton label="Close" busy={busy} perform={perform} action={async () => { endCall(); setOpen(false); }} />
    </SafeAreaView></View></Modal>
  </SafeAreaView>;
}
function ActionButton({ label, busy, perform, action }: { label: string; busy: boolean; perform: (action: () => Promise<void>) => Promise<void>; action: () => Promise<void> }) {
  return <Pressable accessibilityRole="button" disabled={busy} style={[styles.button, busy && { opacity: 0.4 }]} onPress={() => void perform(action)}><Text style={styles.text}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#09090b' }, content: { padding: 22, paddingBottom: 110, gap: 16 }, logo: { width: '100%', height: 90 },
  heading: { color: '#eee', fontSize: 30, fontWeight: '800' }, title: { color: '#ddd', fontSize: 18, fontWeight: '700' }, text: { color: '#eee', fontSize: 15, lineHeight: 23 }, muted: { color: '#aaa', fontSize: 13, lineHeight: 20 },
  card: { padding: 18, gap: 12, backgroundColor: '#161619', borderRadius: 14, borderWidth: 1, borderColor: '#333338' }, input: { color: '#eee', borderWidth: 1, borderColor: '#45454a', padding: 14, borderRadius: 9 },
  button: { backgroundColor: '#a3271f', padding: 14, minHeight: 48, alignItems: 'center', borderRadius: 10 }, doug: { position: 'absolute', right: 20, bottom: 26, flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: '#a3271f', paddingHorizontal: 15, minHeight: 46, borderRadius: 24 },
  overlay: { flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' }, panel: { backgroundColor: '#161619', padding: 24, gap: 14, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
});
