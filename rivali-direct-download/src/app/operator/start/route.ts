import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      const url = new URL("/reports", request.url);
      url.searchParams.set("operatorError", error.message);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.redirect(new URL("/reports", request.url));
}
