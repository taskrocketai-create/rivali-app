import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.json({error:"Sign in first."},{status:401});
  const body = await request.json().catch(()=>({}));
  const recipient = typeof body.recipientName==="string" ? body.recipientName.trim().slice(0,120) : "Stephen";
  const token=randomBytes(32).toString("hex");
  const tokenHash=createHash("sha256").update(token).digest("hex");
  const {error} = await db.from("setup_intake_invites").insert({
    owner_id:userId, token_hash:tokenHash, recipient_name:recipient,
    expires_at:new Date(Date.now()+30*24*60*60*1000).toISOString()
  });
  if(error) return NextResponse.json({error:"Could not create intake link. Confirm the database migration is installed."},{status:500});
  const origin=new URL(request.url).origin;
  return NextResponse.json({url:`${origin}/setup-intake/${token}`,recipientName:recipient,expiresInDays:30},
    {headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
}
