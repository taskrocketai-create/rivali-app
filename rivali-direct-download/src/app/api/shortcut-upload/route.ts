import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer?.startsWith("rv_") || bearer.length > 100)
    return NextResponse.json({ error: "Invalid Rivali upload token." }, { status: 401 });

  const admin = createAdminClient();
  const tokenHash = createHash("sha256").update(bearer).digest("hex");
  const { data: tokenRow, error: tokenError } = await admin
    .from("shortcut_tokens")
    .select("id,user_id")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (tokenError || !tokenRow)
    return NextResponse.json({ error: "Invalid or revoked Rivali upload token." }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xrk"))
    return NextResponse.json({ error: "Attach one MyChron .xrk file as ‘file’." }, { status: 400 });
  if (!file.size || file.size > 100 * 1024 * 1024)
    return NextResponse.json({ error: "XRK files must be between 1 byte and 100 MB." }, { status: 413 });

  const id = randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${tokenRow.user_id}/pending/${id}/${safeName}`;
  const bytes = await file.arrayBuffer();
  const { error: uploadError } = await admin.storage.from("telemetry").upload(path, bytes, {
    contentType: "application/octet-stream",
    upsert: false,
  });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { error: insertError } = await admin.from("pending_imports").insert({
    id,
    user_id: tokenRow.user_id,
    raw_file_name: file.name,
    raw_storage_path: path,
    size_bytes: file.size,
    source: "ios_shortcut",
  });
  if (insertError) {
    await admin.storage.from("telemetry").remove([path]);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }
  await admin.from("shortcut_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tokenRow.id);
  return NextResponse.json({ ok: true, pendingImportId: id, fileName: file.name });
}
