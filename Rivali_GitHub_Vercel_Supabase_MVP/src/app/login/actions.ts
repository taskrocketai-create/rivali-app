"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
const credentials = z.object({ email: z.email(), password: z.string().min(8) });
export async function login(formData: FormData) {
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    redirect("/login?error=Enter+a+valid+email+and+8-character+password");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
export async function signup(formData: FormData) {
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    redirect("/login?error=Enter+a+valid+email+and+8-character+password");
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp(parsed.data);
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/login?message=Check+your+email+to+confirm+the+account");
}
export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
