import { Platform } from 'react-native';
import { unzlibSync } from 'fflate';
import * as FileSystem from 'expo-file-system/legacy';
import { FrameDecoder, handshake, command, frame } from './mychron-protocol';

export type MyChronRun = {name:string;date:string;time:string;laps:string;best:string;size:number};
const HOST='10.0.0.1', PORT=2000;
function offsetFrame(n:number){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,true);return frame(b);}
async function withSocket<T>(fn:(s:DeviceSocket)=>Promise<T>):Promise<T>{
 if(Platform.OS==='web')throw Error('Use the installed iPhone app.');
 const TcpSocket=(await import('react-native-tcp-socket')).default;
 return new Promise<T>((resolve,reject)=>{
  let settled=false;
  const socket=TcpSocket.createConnection({host:HOST,port:PORT,interface:'wifi',connectTimeout:8000},()=>{});
  const connectionTimer=setTimeout(()=>{socket.destroy();if(!settled){settled=true;reject(Error('MyChron Wi-Fi connection timed out.'))}},10000);
  socket.once('connect',()=>{
    clearTimeout(connectionTimer);
    const device=new DeviceSocket(socket);
    void fn(device).then(value=>{if(!settled){settled=true;resolve(value)}}).catch(error=>{if(!settled){settled=true;reject(error)}}).finally(()=>device.close());
  });
  socket.once('error',e=>{clearTimeout(connectionTimer);if(!settled){settled=true;reject(e)}});
 });
}
class DeviceSocket{
 private queue:Uint8Array[]=[];
 private error:Error|null=null;
 private notify:(()=>void)|null=null;
 constructor(private socket:import('react-native-tcp-socket/lib/types/Socket').default){
  const decoder=new FrameDecoder();
  socket.on('data',raw=>{
   try{if(typeof raw==='string')throw Error('Expected binary device data.');this.queue.push(...decoder.push(new Uint8Array(raw)));}
   catch(e){this.error=e instanceof Error?e:Error('MyChron protocol error')}
   this.notify?.();
  });
  socket.on('close',()=>{this.error??=Error('Device closed connection.');this.notify?.()});
  socket.on('error',e=>{this.error=e;this.notify?.()});
 }
 close(){this.socket.destroy()}
 send(b:Uint8Array){if(this.error)throw this.error;this.socket.write(b)}
 async next(stage:string):Promise<Uint8Array>{
  if(this.queue.length)return this.queue.shift()!;
  if(this.error)throw this.error;
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{this.notify=null;reject(Error(stage+' timed out waiting for MyChron.'))},10000);
   this.notify=()=>{clearTimeout(timer);this.notify=null;resolve()}
  });
  if(this.queue.length)return this.queue.shift()!;
  throw this.error??Error(stage+' returned no data.');
 }
 async hello(){
  this.send(handshake());
  const b=await this.next('Handshake');
  if(b.length!==8||b[4]!==6||b[5]!==9)throw Error('Incorrect MyChron handshake.');
 }
 async read(op:number,sub:number,path?:string,onProgress?:(received:number,total:number)=>void){
  this.send(command(op,sub,0,1,path??''));
  const first=await this.next('Read command');
  const second=await this.next('Read size');
  if(first.length!==64||second.length!==64)throw Error('Unexpected read response headers.');
  const size=new DataView(second.buffer,second.byteOffset,second.byteLength).getUint32(16,true);
  if(size>20*1024*1024)throw Error('Session exceeds 20 MB download limit.');
  const out=new Uint8Array(size);
  let received=0;
  while(received<size){
   this.send(offsetFrame(received));
   const chunk=await this.next('Session data');
   if(chunk.length<=4)throw Error('Empty MyChron file chunk.');
   const pos=new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength).getUint32(0,true);
   if(pos!==received||received+chunk.length-4>size)throw Error('Corrupt MyChron file offset.');
   out.set(chunk.subarray(4),received);
   received+=chunk.length-4;
   onProgress?.(received,size);
  }
  return out;
 }
}
export async function getMyChronRuns():Promise<MyChronRun[]>{
 return withSocket(async s=>{
  await s.hello();
  const bytes=await s.read(0x24,0x02);
  const rows=Array.from(bytes, b=>String.fromCharCode(b)).join('').replace(/\0+$/,'').split(/\r?\n/).filter(Boolean);
  const result:MyChronRun[]=[];
  for(const line of rows){
   const columns=line.split(',').map(v=>v.trim());
   if(!/^a_\d+\.xrz$/i.test(columns[0]??''))continue;
   const size=Number(columns[1]);
   result.push({name:columns[0],size:Number.isFinite(size)?size:0,date:columns[2]??'',time:columns[3]??'',laps:columns[4]??'',best:columns[6]??''});
  }
  if(bytes.length>0&&rows.length>0&&!result.length&&!/name/i.test(rows[0]))throw Error('Session directory format was not recognized.');
  return result;
 });
}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(bytes:Uint8Array){
 let result='';
 for(let i=0;i<bytes.length;i+=3){
  const a=bytes[i],b=bytes[i+1],c=bytes[i+2];
  result+=alphabet[a>>2]+alphabet[((a&3)<<4)|((b??0)>>4)]+(i+1<bytes.length?alphabet[((b&15)<<2)|((c??0)>>6)]:'=')+(i+2<bytes.length?alphabet[c&63]:'=');
 }
 return result;
}
export async function downloadMyChronRun(run:MyChronRun,uri:string,onProgress:(received:number,total:number)=>void){
 if(!/^a_\d+\.xrz$/i.test(run.name))throw Error('Invalid MyChron session name.');
 const compressed=await withSocket(async s=>{await s.hello();return s.read(2,4,'1:/mem/'+run.name,onProgress)});
 if(compressed.length<6||compressed[0]!==0x78)throw Error('MyChron did not return a valid compressed XRK.');
 let xrk:Uint8Array;
 try{xrk=unzlibSync(compressed)}catch{throw Error('Compressed session was incomplete or invalid. No upload performed.')}
 if(xrk.length<100||xrk.length>20*1024*1024||Array.from(xrk.subarray(0,32), b=>String.fromCharCode(b)).join('').indexOf('<hCNF')<0)throw Error('Decompressed file did not contain a valid XRK header.');
 await FileSystem.writeAsStringAsync(uri,toBase64(xrk),{encoding:FileSystem.EncodingType.Base64});
 const info=await FileSystem.getInfoAsync(uri);
 if(!info.exists||info.size!==xrk.length)throw Error('Saved XRK size did not match downloaded data.');
 return {bytes:xrk.length,filename:run.name.replace(/\.xrz$/i,'.xrk')};
}
