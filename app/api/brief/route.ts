import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/brief — trả bản tin mới nhất.
export async function GET() {
  const { data, error } = await supabase
    .from("market_briefs")
    .select("trade_date, content, model, created_at")
    .order("trade_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ brief: data });
}
