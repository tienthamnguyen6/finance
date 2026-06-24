import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_KEY!;

if (!url || !key) {
  console.warn("[supabase] SUPABASE_URL hoặc SUPABASE_KEY chưa được set");
}

export const supabase = createClient(url ?? "", key ?? "", {
  auth: { persistSession: false },
});
