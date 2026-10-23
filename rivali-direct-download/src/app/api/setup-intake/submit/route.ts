import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {isNumericSetupField,normalizeSetupNumber} from "@/lib/setup-measurements";
export const runtime="nodejs";
function guestDb(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key) throw new Error("Setup form database connection is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
const headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
export async function GET(request:Request){
 try {
  const token=new URL(request.url).searchParams.get("token")??"";
  if(!/^[a-f0-9]{64}$/.test(token))return NextResponse.json({valid:false},{status:404,headers});
  const {data,error}=await guestDb().rpc("check_setup_intake_link",{p_token:token});
  const item=Array.isArray(data)?data[0]:null;
  if(error||!item?.valid)return NextResponse.json({valid:false},{status:404,headers});
  return NextResponse.json({valid:true,recipientName:item.recipient_name||"Driver"}, {headers});
 }catch{return NextResponse.json({error:"The setup form is unavailable."},{status:503,headers});}
}
export async function POST(request:Request){
 try {
  const body=await request.json().catch(()=>null);
  const token=body?.token;
  const name=body?.driverName;
  const karts=body?.karts;
  if(typeof token!=="string"||!/^[a-f0-9]{64}$/.test(token)
    ||typeof name!=="string"||!name.trim()||name.length>120
    ||!Array.isArray(karts)||karts.length<1||karts.length>5
    ||JSON.stringify(karts).length>30000)
    return NextResponse.json({error:"Check the driver and kart information."},{status:400,headers});
  const badMeasurements:string[]=[];
  const sanitized=karts.map((k:unknown)=>{
    const kart=k as Record<string,unknown>;
    const incoming=kart?.setup&&typeof kart.setup==="object"&&!Array.isArray(kart.setup)
      ?kart.setup as Record<string,unknown>:{};
    const setup:Record<string,string|number>={};
    for(const [key,value] of Object.entries(incoming)){
      if(value===null||value===undefined||String(value).trim()==="")continue;
      if(isNumericSetupField(key)){
        const normalized=normalizeSetupNumber(value);
        if(normalized===null)badMeasurements.push(key.replaceAll("_"," "));
        else setup[key]=normalized;
      }else if(typeof value==="string") setup[key]=value.trim().slice(0,2000);
    }
    return {kart_number:String(kart?.kart_number??"").trim().slice(0,120),setup};
  });
  if(badMeasurements.length)return NextResponse.json({
    error:"Correct or clear these measurements: "+[...new Set(badMeasurements)].join(", ")
  },{status:400,headers});
  if(sanitized.some(k=>!k.kart_number))return NextResponse.json({error:"Each kart needs a number or unique name."},{status:400,headers});
  const {data,error}=await guestDb().rpc("submit_kart_setup_intake",{
    p_token:token,p_driver_name:name.trim(),p_karts:sanitized
  });
  if(error)return NextResponse.json({error:"Unable to save. Check the invitation and setup values, or ask for a new link."},{status:400,headers});
  return NextResponse.json({ok:true,kartCount:Array.isArray(data?.kart_ids)?data.kart_ids.length:sanitized.length},{headers});
 }catch{return NextResponse.json({error:"Could not submit the setup right now."},{status:503,headers});}
}
