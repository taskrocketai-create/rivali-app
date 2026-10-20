import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';

type Phase = 'practice' | 'qualifying' | 'feature';
type Reading = { id: string; phase: Phase; moment: 'cold' | 'hot'; time: string; psi: string[]; temp: string[]; notes: string };
type Kart = { id: string; driver: string; number: string; className: string; stagger: string; readings: Reading[]; notes: string[] };
const STORAGE = 'rivali-raceday-pit-v1';
const initial: Kart[] = [
  { id: 'stephen', driver: 'Stephen', number: '145', className: 'Clone 390', stagger: '1.25', readings: [], notes: [] },
  { id: 'kart2', driver: '', number: '', className: '', stagger: '', readings: [], notes: [] },
  { id: 'kart3', driver: '', number: '', className: '', stagger: '', readings: [], notes: [] },
];
const wheels = ['LF', 'RF', 'LR', 'RR'];
const phases: Phase[] = ['practice', 'qualifying', 'feature'];
export default function RaceDay() {
  const [karts, setKarts] = useState<Kart[]>(initial);
  const [selected, setSelected] = useState('stephen');
  const [phase, setPhase] = useState<Phase>('practice');
  const [moment, setMoment] = useState<'cold'|'hot'>('cold');
  const [psi, setPsi] = useState(['','','','']);
  const [temp, setTemp] = useState(['','','','']);
  const [note, setNote] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder);
  useEffect(() => { SecureStore.getItemAsync(STORAGE).then(raw => { if (raw) { const data = JSON.parse(raw) as Kart[]; if (Array.isArray(data) && data.length === 3) setKarts(data); } }).catch(() => {}).finally(() => setLoaded(true)); }, []);
  useEffect(() => { if (loaded) SecureStore.setItemAsync(STORAGE, JSON.stringify(karts)).catch(() => Alert.alert('Save failed', 'Could not save pit notes on this phone.')); }, [karts, loaded]);
  const kart = useMemo(() => karts.find(k => k.id === selected) ?? karts[0], [karts, selected]);
  function update(patch: Partial<Kart>) { setKarts(old => old.map(k => k.id === selected ? { ...k, ...patch } : k)); }
  function setValue(values: string[], index: number, value: string, setter: (v: string[]) => void) { setter(values.map((v, i) => i === index ? value : v)); }
  function saveReadings() {
    if (psi.some(v => !v.trim() || !Number.isFinite(Number(v)) || Number(v) <= 0)) { Alert.alert('Missing pressures', 'Enter valid PSI for all four tires.'); return; }
    if (temp.some(v => v.trim() && !Number.isFinite(Number(v)))) { Alert.alert('Temperature', 'Enter numeric temperatures or leave them blank.'); return; }
    const reading: Reading = { id: String(Date.now()), phase, moment, time: new Date().toISOString(), psi: [...psi], temp: [...temp], notes: note.trim() };
    update({ readings: [...kart.readings, reading] }); setPsi(['','','','']); setTemp(['','','','']); setNote('');
    Alert.alert('Recorded', `${kart.driver || 'Kart'} ${phase} ${moment} readings saved on this phone.`);
  }
  async function pushToTalk() {
    try {
      if (recording.isRecording) { await recorder.stop(); setAudioUri(recorder.uri); await setAudioModeAsync({ allowsRecording: false }); return; }
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone permission is required.');
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync(); setAudioUri(null); recorder.record();
    } catch (e) { Alert.alert('Audio', e instanceof Error ? e.message : 'Recording failed.'); }
  }
  const next = moment === 'cold'
    ? 'Confirm the actual stagger and collect all four cold pressures before this session. If available, record tire surface temperatures.'
    : 'Immediately collect hot pressures, then temperatures. Ask the driver what changed on entry, center, and exit. Compare this session before changing setup.';
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
    <Text style={s.brand}>RIVALI  /  DOUG</Text><Text style={s.heading}>RaceDay Pit Control</Text>
    <Text style={s.muted}>Three independent kart records. Measurements remain on this phone until a server sync is implemented.</Text>
    <View style={s.row}>{karts.map(k => <Pressable key={k.id} onPress={() => { setSelected(k.id); setPsi(['','','','']); setTemp(['','','','']); setNote(''); }} style={[s.tab, selected === k.id && s.active]}><Text style={s.white}>{k.driver || 'Open slot'}</Text><Text style={s.muted}>{k.number ? '#' + k.number : 'No number'}</Text></Pressable>)}</View>
    <View style={s.panel}><Text style={s.label}>KART IDENTITY</Text>
      {([['driver','Driver'],['number','Kart number'],['className','Class'],['stagger','Rear stagger (in)']] as const).map(([key,label]) => <TextInput key={key} accessibilityLabel={label} placeholder={label} placeholderTextColor="#888" value={kart[key]} onChangeText={value => update({ [key]: value })} style={s.input} />)}
    </View>
    <View style={s.row}>{phases.map(p => <Pressable key={p} onPress={() => setPhase(p)} style={[s.tab, phase === p && s.active]}><Text style={s.white}>{p}</Text></Pressable>)}</View>
    <View style={s.row}>{(['cold','hot'] as const).map(m => <Pressable key={m} onPress={() => setMoment(m)} style={[s.tab, moment === m && s.active]}><Text style={s.white}>{m.toUpperCase()}</Text></Pressable>)}</View>
    <View style={s.panel}><Text style={s.label}>DOUG'S NEXT INSTRUCTION</Text><Text style={s.white}>{next}</Text></View>
    <View style={s.panel}><Text style={s.label}>TIRE READINGS · {moment.toUpperCase()} · {phase.toUpperCase()}</Text>
      <View style={s.row}><Text style={[s.muted,{flex:1}]}>Wheel</Text><Text style={[s.muted,{flex:2}]}>Pressure PSI</Text><Text style={[s.muted,{flex:2}]}>Surface °F</Text></View>
      {wheels.map((w,i) => <View key={w} style={s.row}><Text style={[s.white,{flex:1}]}>{w}</Text><TextInput accessibilityLabel={w + ' pressure PSI'} keyboardType="decimal-pad" value={psi[i]} onChangeText={v => setValue(psi,i,v,setPsi)} style={[s.input,{flex:2}]} placeholder="PSI" placeholderTextColor="#888"/><TextInput accessibilityLabel={w + ' temperature Fahrenheit'} keyboardType="decimal-pad" value={temp[i]} onChangeText={v => setValue(temp,i,v,setTemp)} style={[s.input,{flex:2}]} placeholder="°F" placeholderTextColor="#888"/></View>)}
      <TextInput accessibilityLabel="Session observation" placeholder="Track, prep, handling, elapsed time after run..." placeholderTextColor="#888" value={note} onChangeText={setNote} multiline style={s.input}/>
      <Pressable style={s.button} onPress={saveReadings}><Text style={s.white}>Save readings for this kart</Text></Pressable>
    </View>
    <View style={s.panel}><Text style={s.label}>PUSH TO TALK · RECORD PIT NOTE</Text>
      <Pressable style={s.button} onPress={() => void pushToTalk()}><Text style={s.white}>{recording.isRecording ? 'Stop recording' : 'Record voice note'}</Text></Pressable>
      <Text style={s.muted}>{recording.isRecording ? 'Recording...' : audioUri ? 'Voice note captured, not yet uploaded or transcribed.' : 'Microphone off. Doug live voice conversation is not yet connected on this screen.'}</Text>
      <TextInput accessibilityLabel="Crew chief notes" placeholder="Type the driver debrief or crew chief decision..." placeholderTextColor="#888" value={note} onChangeText={setNote} multiline style={s.input}/>
      <Pressable style={s.tab} onPress={() => { if (!note.trim()) return; update({ notes: [...kart.notes, `${new Date().toLocaleString()} [${phase}] ${note.trim()}`] }); setNote(''); }}><Text style={s.white}>Save debrief / setup decision</Text></Pressable>
    </View>
    <Text style={s.label}>RECORDED HISTORY · {kart.driver || 'OPEN SLOT'}</Text>
    {[...kart.notes].reverse().map((n,i) => <Text key={'n'+i} style={s.muted}>{n}</Text>)}
    {[...kart.readings].reverse().map(r => <View key={r.id} style={s.panel}><Text style={s.white}>{r.phase} · {r.moment} · {new Date(r.time).toLocaleTimeString()}</Text><Text style={s.muted}>{wheels.map((w,i) => `${w} ${r.psi[i]} PSI${r.temp[i] ? ' / ' + r.temp[i] + '°F' : ''}`).join('  |  ')}</Text><Text style={s.muted}>{r.notes}</Text></View>)}
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({
 safe:{flex:1,backgroundColor:'#09090b'},page:{padding:18,paddingBottom:70,gap:14},brand:{color:'#ff643c',fontWeight:'800',letterSpacing:2},heading:{color:'#fff',fontSize:26,fontWeight:'800'},white:{color:'#fff',fontSize:14,fontWeight:'600'},muted:{color:'#aaa',fontSize:12},label:{color:'#ff805b',fontSize:12,fontWeight:'800'},row:{flexDirection:'row',alignItems:'center',gap:8},tab:{flex:1,backgroundColor:'#252529',padding:12,borderRadius:9,alignItems:'center',gap:3},active:{backgroundColor:'#853021',borderColor:'#ff643c',borderWidth:1},panel:{backgroundColor:'#18181b',padding:14,borderRadius:12,gap:10},input:{backgroundColor:'#101014',borderColor:'#404047',borderWidth:1,borderRadius:8,padding:10,color:'#fff',minWidth:0},button:{backgroundColor:'#a3271f',padding:15,borderRadius:9,alignItems:'center'}
});
