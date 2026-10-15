import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
type Layout = {start_finish: number[][]; turns: Record<string,number[]>; groove: number[][]};
const empty = ():Layout => ({start_finish:[],turns:{},groove:[]});
const html = "<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no\"/><link rel=\"stylesheet\" href=\"https://unpkg.com/leaflet@1.9.4/dist/leaflet.css\"/><style>html,body,#map{height:100%;margin:0;background:#161619}</style></head><body><div id=\"map\"></div><script src=\"https://unpkg.com/leaflet@1.9.4/dist/leaflet.js\"></script><script>\nconst map=L.map('map').setView([35.7,-77.9],15);\nL.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20,attribution:'Esri imagery'}).addTo(map);\nlet mode='pan',layout={start_finish:[],turns:{},groove:[]},layer=L.layerGroup().addTo(map),points=[];\nfunction send(obj){window.ReactNativeWebView.postMessage(JSON.stringify(obj));}\nfunction draw(){layer.clearLayers(); if(layout.start_finish.length===2)L.polyline(layout.start_finish,{color:'#ffbb33',weight:5}).addTo(layer);\nObject.keys(layout.turns).forEach(k=>L.circleMarker(layout.turns[k],{radius:8,color:'#ff633d',fillOpacity:1}).bindTooltip('T'+k).addTo(layer));\nif(layout.groove.length>1)L.polyline([...layout.groove,layout.groove[0]],{color:'#47ef66',weight:4}).addTo(layer);\nif(mode==='groove')layout.groove.forEach((p,i)=>L.marker(p,{draggable:true}).on('dragend',e=>{const ll=e.target.getLatLng();layout.groove[i]=[ll.lat,ll.lng];draw();send({type:'change',layout})}).addTo(layer));}\nmap.on('click',e=>{let p=[e.latlng.lat,e.latlng.lng];if(mode==='start'){if(layout.start_finish.length===2)layout.start_finish=[];layout.start_finish.push(p)}\nelse if(['1','2','3','4'].includes(mode)){layout.turns[mode]=p;mode='pan'}\nelse return;draw();send({type:'change',layout});});\nfunction fit(){const b=map.getBounds(),c=map.getCenter(),a=(b.getEast()-b.getWest())*.22,d=(b.getNorth()-b.getSouth())*.2;\nlayout.groove=Array.from({length:8},(_,i)=>[c.lat+d*Math.sin(i*Math.PI/4),c.lng+a*Math.cos(i*Math.PI/4)]);mode='groove';draw();send({type:'change',layout});}\ndocument.addEventListener('message',e=>receive(e.data));window.addEventListener('message',e=>receive(e.data));\nfunction receive(raw){try{const o=JSON.parse(raw);if(o.type==='mode')mode=o.value;if(o.type==='fit')fit();if(o.type==='restore'){layout=o.layout;draw();if(o.center)map.setView(o.center,o.zoom||17)}if(o.type==='center'){map.setView(o.center,17);setTimeout(()=>map.invalidateSize(),100);send({type:'centered'})}}catch(e){}}\n</script></body></html>";
export function TrackMapper({directory}: {directory:string}) {
 const web=useRef<WebView>(null);const [ready,setReady]=useState(false);const [layout,setLayout]=useState<Layout>(empty());
 const [search,setSearch]=useState('');const [message,setMessage]=useState('Pan and zoom to the track, then mark start/finish, turns and groove.');
 const [mode,setMode]=useState('pan');const [busy,setBusy]=useState(false);
 const send=(o:object)=>{ const encoded=JSON.stringify(JSON.stringify(o)); web.current?.injectJavaScript('receive('+encoded+'); true;'); };
 useEffect(()=>{let active=true;void FileSystem.readAsStringAsync(directory+'track-layout.json').then(raw=>{if(!active)return;const x=JSON.parse(raw) as {layout:Layout;center?:number[]};setLayout(x.layout);setMessage('Saved track layout loaded.');setTimeout(()=>send({type:'restore',...x}),600);}).catch(()=>{});return()=>{active=false}},[directory]);
 async function find(){
  if(!search.trim()) {setMessage('Enter a track name or nearby town first.');return;}
  setBusy(true);setMessage('Finding track...');
  try{
   const normalized=search.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
   let center:number[]|null=null;
   if(normalized.includes('tri county kartway')||normalized.includes('tricounty kartway')){
     center=[35.560925,-78.05143];
   }else{
     const response=await fetch('https://nominatim.openstreetmap.org/search?q='+encodeURIComponent(search.trim())+'&format=jsonv2&limit=1&countrycodes=us',{headers:{'Accept':'application/json','Accept-Language':'en-US'}});
     if(!response.ok)throw Error('Location search is unavailable ('+response.status+'). Try Tri County Kartway or pan manually.');
     const rows=await response.json() as {lat:string;lon:string}[];
     if(!rows.length)throw Error('No match. Try the track name with the town and state.');
     center=[Number(rows[0].lat),Number(rows[0].lon)];
   }
   if(!center.every(Number.isFinite))throw Error('The location service returned invalid coordinates.');
   if(!ready)throw Error('Satellite map is still loading. Wait a moment and try again.');
   send({type:'center',center});
   setMessage('Moving the map to '+search.trim()+'...');
  }catch(e){setMessage(e instanceof Error?e.message:'Search unavailable. Pan on the map instead.');}
  finally{setBusy(false)}
 } const complete=layout.start_finish.length===2 && Object.keys(layout.turns).length===4 && layout.groove.length>=8;
 return <View style={s.card}><Text style={s.title}>Track layout and racing groove</Text><Text style={s.hint}>Satellite map needs internet. Drag the groove points to square off corners. The layout is operator-drawn, not measured GPS.</Text>
 <TextInput value={search} onChangeText={setSearch} style={s.input} placeholder="Track name or nearby town" placeholderTextColor="#aaa" />
 <Button label={busy?'Searching...':'Find location'} onPress={()=>void find()}/>
 <WebView ref={web} style={{height:340}} source={{html}} javaScriptEnabled domStorageEnabled originWhitelist={['*']} onLoad={()=>setReady(true)} onError={()=>{setReady(false);setMessage('Satellite map could not load. Check internet and reopen Rivali.')}} onMessage={e=>{try{const data=JSON.parse(e.nativeEvent.data);if(data.type==='change')setLayout(data.layout);if(data.type==='centered')setMessage('Map centered on the location. Zoom in and mark the track.');if(data.type==='map-error')setMessage(data.message)}catch{}}}/>
 <View style={s.buttons}>{[['pan','Pan/zoom'],['start','Start/finish'],['1','T1'],['2','T2'],['3','T3'],['4','T4'],['groove','Groove edit']].map(([value,label])=><Pressable key={value} onPress={()=>{setMode(value);send({type:'mode',value})}} style={[s.small,mode===value&&s.active]}><Text style={s.text}>{label}</Text></Pressable>)}</View>
 <Button label="Fit adjustable 8-point oval" onPress={()=>{setMode('groove');send({type:'fit'})}}/>
 <Text style={s.hint}>Start/finish {layout.start_finish.length}/2; turns {Object.keys(layout.turns).length}/4; groove {layout.groove.length}/8</Text>
 <Button label="Approve and save track layout" onPress={()=>void(async()=>{if(!complete){setMessage('Mark start/finish, all four turns and fit the groove first.');return}try{await FileSystem.writeAsStringAsync(directory+'track-layout.json',JSON.stringify({layout,trackName:search,saved_at:new Date().toISOString()}));setMessage('Track layout saved locally on this iPhone.')}catch{setMessage('Unable to save the track layout.')}})()}/>
 <Text style={s.hint}>{message}</Text>
 </View>;
}
function Button({label,onPress}:{label:string;onPress:()=>void}){return <Pressable onPress={onPress} style={s.button}><Text style={s.text}>{label}</Text></Pressable>}
const s=StyleSheet.create({card:{backgroundColor:'#161619',padding:14,borderRadius:12,gap:10},title:{fontSize:18,color:'#eee',fontWeight:'700'},hint:{color:'#aaa'},input:{color:'#fff',borderColor:'#555',borderWidth:1,borderRadius:8,padding:10},button:{backgroundColor:'#a3271f',padding:12,borderRadius:8,alignItems:'center'},text:{color:'#fff',fontWeight:'600'},buttons:{flexDirection:'row',flexWrap:'wrap',gap:5},small:{backgroundColor:'#333',padding:9,borderRadius:7},active:{backgroundColor:'#a3271f'}});
