import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

const fields = [
  ['driver', 'Driver'], ['kart', 'Kart / number'], ['raceClass', 'Class'],
  ['track', 'Track'], ['lfPsi', 'LF tire pressure (psi)'], ['rfPsi', 'RF tire pressure (psi)'],
  ['lrPsi', 'LR tire pressure (psi)'], ['rrPsi', 'RR tire pressure (psi)'],
  ['frontStagger', 'Front stagger (in)'], ['rearStagger', 'Rear stagger (in)'],
  ['lfRollout', 'LF rollout (in)'], ['rfRollout', 'RF rollout (in)'],
  ['lrRollout', 'LR rollout (in)'], ['rrRollout', 'RR rollout (in)'],
  ['frontGear', 'Front sprocket (teeth)'], ['rearGear', 'Rear sprocket (teeth)'],
  ['leftWeight', 'Left side (%)'], ['crossWeight', 'Cross (%)'],
  ['tirePrep', 'Tire preparation'], ['chassis', 'Chassis / seat changes'],
  ['conditions', 'Track conditions'], ['feedback', 'Driver feedback'], ['notes', 'Other notes']
] as const;
export type Setup = Record<string, string>;
export const setupText = (setup: Setup) => fields.filter(([key]) => setup[key]?.trim()).map(([key,label]) => label + ': ' + setup[key]).join('\n');
export function SetupForm({ directory, onSaved }: { directory: string; onSaved: (setup: Setup) => void }) {
  const [values,setValues] = useState<Setup>({});
  const [saved,setSaved] = useState(false);
  const [error,setError] = useState('');
  useEffect(() => { let active = true; void FileSystem.readAsStringAsync(directory + 'setup.json').then(v => {
    if (active) { const data = JSON.parse(v) as Setup; setValues(data); onSaved(data); }
  }).catch(() => {}); return () => { active = false; }; }, [directory, onSaved]);
  return <View style={s.card}>
    <Text style={s.heading}>Kart setup and stagger</Text>
    <Text style={s.hint}>Optional. Saved privately on this phone for the mock test. Unknown measurements stay blank.</Text>
    {fields.map(([key,label]) => <View key={key}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={values[key] ?? ''} onChangeText={v => {setValues(old => ({...old,[key]:v}));setSaved(false);}} style={s.input} placeholderTextColor="#777" multiline={['notes','feedback','chassis','tirePrep'].includes(key)} keyboardType={/Psi|Stagger|Rollout|Gear|Weight/.test(key) ? 'decimal-pad' : 'default'} />
    </View>)}
    <Pressable accessibilityRole="button" style={s.button} onPress={() => { void (async () => {
      try { await FileSystem.writeAsStringAsync(directory + 'setup.json', JSON.stringify(values)); onSaved(values); setSaved(true); setError(''); }
      catch { setError('Unable to save setup on this phone.'); }
    })(); }}><Text style={s.buttonText}>Save setup</Text></Pressable>
    {saved && <Text style={s.hint}>Setup saved. It will be included when you share a report.</Text>}
    {!!error && <Text style={s.error}>{error}</Text>}
  </View>;
}
const s = StyleSheet.create({card:{backgroundColor:'#161619',borderRadius:12,borderWidth:1,borderColor:'#333',padding:18,gap:11},heading:{color:'#fff',fontWeight:'700',fontSize:19},hint:{color:'#aaa'},label:{color:'#ddd',marginBottom:4},input:{color:'#fff',borderWidth:1,borderColor:'#555',borderRadius:7,padding:10,minHeight:40},button:{backgroundColor:'#a3271f',padding:14,borderRadius:8,alignItems:'center'},buttonText:{color:'#fff',fontWeight:'700'},error:{color:'#ff9a9a'}});
