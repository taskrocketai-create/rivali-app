import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';

const fields = [
  ['driver','Driver'],['kart','Kart / number'],['raceClass','Class'],['track','Track'],
  ['lfPsi','LF tire pressure (psi)'],['rfPsi','RF tire pressure (psi)'],
  ['lrPsi','LR tire pressure (psi)'],['rrPsi','RR tire pressure (psi)'],
  ['frontStagger','Front stagger (in)'],['rearStagger','Rear stagger (in)'],
  ['lfRollout','LF rollout (in)'],['rfRollout','RF rollout (in)'],
  ['lrRollout','LR rollout (in)'],['rrRollout','RR rollout (in)'],
  ['frontGear','Front sprocket (teeth)'],['rearGear','Rear sprocket (teeth)'],
  ['leftWeight','Left side (%)'],['crossWeight','Cross (%)'],
  ['tirePrep','Tire preparation'],['chassis','Chassis / seat changes'],
  ['conditions','Track conditions'],['feedback','Driver feedback'],['notes','Other notes']
] as const;
export type Setup = Record<string,string>;
export const setupText = (setup:Setup) => fields.filter(([k]) => setup[k]?.trim()).map(([k,label]) => label+': '+setup[k]).join('\n');
type Driver={id:string;name:string};
type Kart={id:string;name:string;racer_id:string};
type Baseline={setup:Record<string,unknown>;conditions:Record<string,unknown>};
export function SetupForm({directory,onSaved}:{directory:string;onSaved:(data:Setup)=>void}){
 const [values,setValues]=useState<Setup>({});
 const [drivers,setDrivers]=useState<Driver[]>([]);
 const [karts,setKarts]=useState<Kart[]>([]);
 const [driverId,setDriverId]=useState('');
 const [kartId,setKartId]=useState('');
 const [notice,setNotice]=useState('');
 const [saved,setSaved]=useState(false);
 const [loading,setLoading]=useState(false);
 useEffect(()=>{let active=true;void FileSystem.readAsStringAsync(directory+'setup.json').then(raw=>{
   if(active){const data=JSON.parse(raw) as Setup;setValues(data);onSaved(data)}
 }).catch(()=>{});return()=>{active=false}},[directory,onSaved]);
 useEffect(()=>{let active=true;if(!supabase)return;void(async()=>{
   const [r,k]=await Promise.all([supabase.from('racers').select('id,name').order('name'),
     supabase.from('karts').select('id,name,racer_id').order('name')]);
   if(!active)return;
   if(r.error||k.error)setNotice('Could not load saved drivers. Check your Rivali account.');
   else{setDrivers(r.data??[]);setKarts(k.data??[])}
 })();return()=>{active=false}},[]);
 async function load(driver:Driver,kart?:Kart){
   if(!supabase)return;
   setLoading(true);setNotice('Loading saved setup...');
   try{
     // Session baseline is matched to this driver and, when selected, this specific kart.
     let query=supabase.from('sessions').select('setup,conditions').eq('racer_id',driver.id).order('created_at',{ascending:false}).limit(50);
     if(kart)query=query.eq('kart_id',kart.id);
     const {data,error}=await query;
     if(error)throw error;
     const baseline=(data??[]).find(s=>Boolean((s.setup as Record<string,unknown>)?.fillout_answers)) as Baseline|undefined;
     const answers=(baseline?.setup?.fillout_answers??{}) as Record<string,unknown>;
     const read=(name:string)=>answers[name]==null||answers[name]==='?'?'':String(answers[name]);
     const next:Setup={
       driver:driver.name,kart:kart?.name??read('kart number'),raceClass:read('class'),track:read('track'),
       lfPsi:read('lf cold psi'),rfPsi:read('rf cold psi'),lrPsi:read('lr cold psi'),rrPsi:read('rr cold psi'),
       frontStagger:read('front stagger'),rearStagger:read('rear stagger'),
       lfRollout:read('lf circumference'),rfRollout:read('rf circumference'),
       lrRollout:read('lr circumference'),rrRollout:read('rr circumference'),
       frontGear:read('front sprocket'),rearGear:read('rear sprocket'),
       leftWeight:read('left'),crossWeight:read('cross'),tirePrep:read('lf prep chemical'),
       chassis:read('chassis'),conditions:read('track condition'),notes:read('baseline notes')
     };
     setValues(next);setSaved(false);
     setNotice(baseline?'Saved Fillout baseline loaded. Review the values, then tap Save setup.':'Driver selected. No submitted setup baseline found for this selection.');
   }catch(e){setNotice('Could not retrieve baseline: '+(e instanceof Error?e.message:'unknown error'))}
   finally{setLoading(false)}
 }
 return <View style={s.card}>
  <Text style={s.heading}>Kart setup and stagger</Text>
  <Text style={s.hint}>Select a saved Rivali driver to prefill the setup. The original database submission will not be modified.</Text>
  {drivers.map(d=><Pressable key={d.id} disabled={loading} onPress={()=>{setDriverId(d.id);setKartId('');void load(d)}} style={[s.picker,driverId===d.id&&s.selected]}><Text style={s.buttonText}>{d.name}</Text></Pressable>)}
  {!!driverId && karts.filter(k=>k.racer_id===driverId).map(k=><Pressable key={k.id} disabled={loading} onPress={()=>{setKartId(k.id);const d=drivers.find(x=>x.id===driverId);if(d)void load(d,k)}} style={[s.picker,kartId===k.id&&s.selected]}><Text style={s.buttonText}>Kart: {k.name}</Text></Pressable>)}
  {!!notice && <Text style={s.hint}>{notice}</Text>}
  {fields.map(([key,label])=><View key={key}><Text style={s.label}>{label}</Text>
   <TextInput accessibilityLabel={label} value={values[key]??''} onChangeText={v=>{setValues(old=>({...old,[key]:v}));setSaved(false)}}
    style={s.input} placeholderTextColor="#777" multiline={['notes','feedback','chassis','tirePrep'].includes(key)}
    keyboardType={/Psi|Stagger|Rollout|Gear|Weight/.test(key)?'decimal-pad':'default'}/></View>)}
  <Pressable disabled={loading} style={s.button} onPress={()=>{void(async()=>{try{
    await FileSystem.writeAsStringAsync(directory+'setup.json',JSON.stringify(values));onSaved(values);setSaved(true);setNotice('Setup saved to this iPhone.')
  }catch{setNotice('Unable to save setup on this iPhone.')}})()}}><Text style={s.buttonText}>Save setup</Text></Pressable>
  {saved&&<Text style={s.hint}>Saved and ready to include when sharing a report.</Text>}
 </View>
}
const s=StyleSheet.create({card:{backgroundColor:'#161619',borderRadius:12,borderWidth:1,borderColor:'#333',padding:18,gap:11},heading:{color:'#fff',fontWeight:'700',fontSize:19},hint:{color:'#aaa'},label:{color:'#ddd',marginBottom:4},input:{color:'#fff',borderWidth:1,borderColor:'#555',borderRadius:7,padding:10,minHeight:40},button:{backgroundColor:'#a3271f',padding:14,borderRadius:8,alignItems:'center'},picker:{backgroundColor:'#37373b',padding:10,borderRadius:7},selected:{backgroundColor:'#a3271f'},buttonText:{color:'#fff',fontWeight:'700'}});
