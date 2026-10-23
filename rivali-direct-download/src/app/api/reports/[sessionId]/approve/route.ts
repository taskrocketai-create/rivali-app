import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
export async function POST(_request:Request,{params}:{params:Promise<{sessionId:string}>}){
 const {sessionId}=await params;
 const db=await createClient();
 const {data:auth}=await db.auth.getClaims();
 const userId=auth?.claims?.sub;
 if(!userId)return NextResponse.json({error:"Unauthorized"},{status:401});
 const {data:record,error:recordError}=await db.from("session_telemetry")
   .select("report_analysis").eq("session_id",sessionId).eq("user_id",userId).maybeSingle();
 const report=record?.report_analysis as Record<string,unknown>|undefined;
 const interpretation=report?.interpretation as Record<string,unknown>|undefined;
 if(recordError||!interpretation?.what_data_says||!interpretation?.confidence_reason)
   return NextResponse.json({error:"Generate and review a Rivali report before approval."},{status:409});
 const approvedAt=new Date().toISOString();
 const {data,error}=await db.from("sessions")
   .update({report_status:"approved",report_approved_at:approvedAt})
   .eq("id",sessionId).eq("user_id",userId).eq("status","completed")
   .eq("report_status","pending_approval")
   .select("id,report_status,report_approved_at").maybeSingle();
 if(error)return NextResponse.json({error:error.message},{status:500});
 if(!data)return NextResponse.json({error:"Report was not pending operator approval."},{status:409});
 return NextResponse.json({ok:true,report:data,delivery:{sent:false,reason:"Approved privately. No automatic texts or payments."}},
 {headers:{"Cache-Control":"no-store"}});
}
