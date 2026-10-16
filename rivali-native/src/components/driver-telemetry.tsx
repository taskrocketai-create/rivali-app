import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import WebView from 'react-native-webview';

export type TelemetryTrace={
 status:string;reason?:string;sourceSamples?:number;sampleStride?:number;
 channels:Record<string,string>;
 samples:Array<{t:number;lat?:number;lon?:number;speed?:number;rpm?:number;lateralG?:number;longitudinalG?:number}>;
};
type Props={trace?:TelemetryTrace;filename:string; laps:{lap_number:number;lap_time_sec:number;is_best:boolean}[]};
const escapeJson=(value:unknown)=>JSON.stringify(value).replace(/</g,'\\u003c');
export function DriverTelemetry({trace,filename,laps}:Props){
 const html=useMemo(()=>{
 const raw=escapeJson(trace?.samples??[]);
 const channels=escapeJson(trace?.channels??{});
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><style>
 *{box-sizing:border-box}body{margin:0;background:#111216;color:#eee;font:14px -apple-system,Arial;padding:12px}
 .panel{background:#191a20;border:1px solid #36363d;border-radius:12px;padding:12px;margin-bottom:12px}
 h3{margin:2px 0 12px;font-size:15px}svg{width:100%;touch-action:none;display:block}
 .controls{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}button{border:1px solid #4d4d56;background:#23242a;color:#ddd;border-radius:7px;padding:8px 11px}
 button.sel{border-color:#fa634b;color:#fff;background:#7a261e}
 .data{color:#b8b8bf;font-size:12px;line-height:1.7}.dot{fill:#ffb347;stroke:#fff;stroke-width:1.5}
 .trace{stroke:#ff6347;fill:none;stroke-width:2}.grid{stroke:#33363e;stroke-width:1}.small{fill:#bbb;font-size:11px}
 </style></head><body>
 <div class="panel"><h3>GPS racing line · Entire recording</h3><svg id="map" viewBox="0 0 340 220" aria-label="Recorded GPS path"></svg><div id="gpsStatus" class="data"></div></div>
 <div class="panel"><h3>Telemetry timeline</h3><div class="controls" id="controls"></div><svg id="chart" viewBox="0 0 340 180" aria-label="Telemetry chart"></svg><div id="readout" class="data">Move along chart to inspect a data point.</div></div>
 <div class="data">Telemetry is sampled for display. Original XRK remains unchanged. The plotted route is GPS position, not a verified preferred groove. Lap boundaries are not inferred.</div>
 <script>
 const samples=${raw}, channels=${channels};
 const names={speed:'GPS speed',rpm:'RPM',lateralG:'Lateral G',longitudinalG:'Longitudinal G'};
 const units={speed:'',rpm:'rpm',lateralG:'g',longitudinalG:'g'};
 const svgNS='http://www.w3.org/2000/svg', map=document.getElementById('map'),chart=document.getElementById('chart');
 let active='speed', selected=0, mapPoints=[];
 function node(parent,name,attrs,text){const e=document.createElementNS(svgNS,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;parent.appendChild(e);return e}
 function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
 const gps=samples.map((p,i)=>({i,lat:p.lat,lon:p.lon})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.lat>=-90&&p.lat<=90&&p.lon>=-180&&p.lon<=180);
 if(gps.length>3){
  const mid=gps.reduce((s,p)=>s+p.lat,0)/gps.length;
  const cos=Math.cos(mid*Math.PI/180);
  const xs=gps.map(p=>p.lon*cos),ys=gps.map(p=>p.lat);
  const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
  const span=Math.max((xmax-xmin)/292,(ymax-ymin)/185,0.000001);
  mapPoints=gps.map((p,j)=>({i:p.i,x:24+(xs[j]-xmin)/span,y:203-(ys[j]-ymin)/span}));
  const path=mapPoints.map((p,j)=>(j?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2)).join(' ');
  node(map,'path',{d:path,class:'trace'});
  node(map,'circle',{id:'gpsDot',cx:mapPoints[0].x,cy:mapPoints[0].y,r:4,class:'dot'});
  document.getElementById('gpsStatus').textContent=gps.length+' recorded GPS positions shown, from '+samples.length+' timeline samples.';
 }else{
  document.getElementById('gpsStatus').textContent='GPS map unavailable: no usable latitude/longitude samples.';
 }
 const keys=Object.keys(names).filter(k=>samples.some(p=>Number.isFinite(p[k])));
 const controls=document.getElementById('controls');
 keys.forEach(k=>{const btn=document.createElement('button');btn.textContent=names[k];btn.id='btn_'+k;btn.onclick=()=>{active=k;render()};controls.appendChild(btn)});
 function render(){
  chart.replaceChildren();
  keys.forEach(k=>document.getElementById('btn_'+k).className=k===active?'sel':'');
  const valid=samples.map((p,i)=>({i,t:p.t,v:p[active]})).filter(p=>Number.isFinite(p.v)&&Number.isFinite(p.t));
  if(!valid.length){document.getElementById('readout').textContent='Selected channel unavailable.';return}
  const vmin=Math.min(...valid.map(p=>p.v)),vmax=Math.max(...valid.map(p=>p.v));
  const tmin=valid[0].t,tmax=valid[valid.length-1].t;
  const tx=t=>24+292*(t-tmin)/Math.max(.001,tmax-tmin);
  const vy=v=>150-120*(v-vmin)/Math.max(.00001,vmax-vmin);
  for(let n=0;n<=4;n++){const y=30+n*30;node(chart,'line',{x1:24,x2:316,y1:y,y2:y,class:'grid'})}
  const path=valid.map((p,j)=>(j?'L':'M')+tx(p.t).toFixed(2)+' '+vy(p.v).toFixed(2)).join(' ');
  node(chart,'path',{d:path,class:'trace'});
  node(chart,'text',{x:24,y:17,class:'small'},vmax.toFixed(2));
  node(chart,'text',{x:24,y:166,class:'small'},vmin.toFixed(2));
  const cursor=node(chart,'line',{id:'cursor',x1:24,x2:24,y1:26,y2:152,stroke:'#ffbe56','stroke-width':1.5});
  function select(i){
   selected=clamp(i,0,samples.length-1);
   const point=samples[selected],x=tx(point.t);
   cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);
   const val=point[active];
   document.getElementById('readout').textContent='Time '+point.t.toFixed(2)+' s · '+names[active]+': '+(Number.isFinite(val)?val.toFixed(2):'N/A')+' '+units[active];
   const dot=document.getElementById('gpsDot');
   if(dot&&mapPoints.length){let closest=mapPoints[0];for(const p of mapPoints)if(Math.abs(p.i-selected)<Math.abs(closest.i-selected))closest=p;dot.setAttribute('cx',closest.x);dot.setAttribute('cy',closest.y)}
  }
  chart.onpointerdown=e=>{chart.setPointerCapture(e.pointerId);move(e)};
  chart.onpointermove=e=>{if(e.buttons)move(e)};
  function move(e){const rect=chart.getBoundingClientRect();const px=(e.clientX-rect.left)*340/rect.width;const t=tmin+clamp((px-24)/292,0,1)*(tmax-tmin);let closest=valid[0];for(const p of valid)if(Math.abs(p.t-t)<Math.abs(closest.t-t))closest=p;select(closest.i)}
  select(selected);
 }
 if(keys.length)render();else document.getElementById('readout').textContent='No speed, RPM, or acceleration channel available.';
 </script></body></html>`;
 },[trace]);
 if(!trace||trace.status!=='ready'||!trace.samples?.length)return <View style={styles.card}><Text style={styles.title}>Driver telemetry</Text><Text style={styles.muted}>{trace?.reason??'Detailed chart data not available for this recording. Reprocess the original XRK with the new analyzer.'}</Text></View>;
 return <View style={styles.card}><Text style={styles.title}>Driver telemetry · {filename}</Text>
 <Text style={styles.muted}>{trace.sourceSamples??trace.samples.length} source samples · synchronized GPS and charts · {laps.length} validated laps</Text>
 <WebView originWhitelist={['*']} source={{html}} scrollEnabled={false} javaScriptEnabled style={{height:610,backgroundColor:'#111216'}} />
 </View>;
}
const styles=StyleSheet.create({card:{backgroundColor:'#161619',borderColor:'#333',borderWidth:1,borderRadius:12,padding:12,gap:10},title:{color:'#eee',fontSize:18,fontWeight:'700'},muted:{color:'#aaa',fontSize:12}});
