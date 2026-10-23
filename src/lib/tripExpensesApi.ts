/**
 * Datos de "Gastos" del viaje (pestañas Gastos y Gastos compartidos). Un solo lugar para hablar con la
 * base; las reglas viven en la migración 20261027020000_gastos_split.sql (RLS y triggers) y los cálculos
 * en src/lib/split.ts y src/lib/tripSpend.ts.
 *
 *  - Lo compartido (trip_split_*) lo ven todos los miembros del viaje.
 *  - Lo personal (public.expenses) solo su dueño.
 *  - Nada se guarda sin que la persona toque "Guardar".
 */
import type { SplitShare, SplitMode } from "@/lib/split";
import { safeExtension, uploadProblem } from "@/lib/uploadRules";

export type SplitPersonRow = {
  id: string;
  trip_id: string;
  name: string;
  member_id: string | null;
  linked_by_name?: boolean | null;
  created_at?: string;
};
export type TripMember = { user_id: string; name: string; avatar_url: string | null; is_owner: boolean };
export type SharedExpense = {
  id: string;
  trip_id: string;
  payer_id: string;
  amount: number;
  currency: string;
  description: string;
  category?: string | null;
  expense_date?: string | null;
  city?: string | null;
  merchant?: string | null;
  tip?: number | null;
  tax?: number | null;
  receipt_path?: string | null;
  split_mode?: SplitMode | null;
  created_by?: string | null;
  created_at: string;
  shares: SplitShare[];
};
export type SplitPaymentRow = {
  id: string;
  trip_id: string;
  from_person: string;
  to_person: string;
  amount: number;
  currency: string;
  paid_on?: string | null;
  created_by?: string | null;
  created_at?: string;
};
export type PersonalExpense = {
  id: string;
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  expense_date: string;
  city?: string | null;
  receipt_url?: string | null;
  trip_id?: string | null;
};

export type TripExpensesData = {
  trip: any;
  people: SplitPersonRow[];
  members: TripMember[];
  expenses: SharedExpense[];
  payments: SplitPaymentRow[];
  personal: PersonalExpense[];
};

type Client = any;

const rpc = async (client: Client, fn: string, args: Record<string, unknown>) => {
  try {
    if (typeof client?.rpc !== "function") return { data: null, error: { message: "sin rpc" } };
    return await client.rpc(fn, args);
  } catch (e) {
    return { data: null, error: { message: (e as Error)?.message ?? "error" } };
  }
};

/** Todo lo de Gastos del viaje. Antes, cada miembro queda con su persona (trip_split_sync_members). */
export async function loadTripExpenses(client: Client, tripId: string, userId: string | null): Promise<TripExpensesData> {
  await rpc(client, "trip_split_sync_members", { p_trip: tripId });
  const personalQuery = userId
    ? client.from("expenses").select("*").eq("user_id", userId).eq("trip_id", tripId).order("expense_date", { ascending: false })
    : Promise.resolve({ data: [] });
  const [t, ps, ex, sh, pay, mem, mine] = await Promise.all([
    client.from("trips").select("*").eq("id", tripId).maybeSingle(),
    client.from("trip_split_people").select("*").eq("trip_id", tripId).order("created_at"),
    client.from("trip_split_expenses").select("*").eq("trip_id", tripId).order("created_at", { ascending: false }),
    client.from("trip_split_shares").select("*").eq("trip_id", tripId),
    client.from("trip_split_payments").select("*").eq("trip_id", tripId).order("created_at", { ascending: false }),
    rpc(client, "trip_split_members", { p_trip: tripId }),
    personalQuery,
  ]);
  const shares = ((sh?.data as any[]) ?? []).filter((s) => s && s.expense_id);
  const byExpense = new Map<string, SplitShare[]>();
  for (const s of shares) {
    byExpense.set(s.expense_id, [...(byExpense.get(s.expense_id) ?? []), { person_id: s.person_id, amount: Number(s.amount), percent: s.percent ?? null }]);
  }
  return {
    trip: t?.data ?? null,
    people: ((ps?.data as SplitPersonRow[]) ?? []),
    members: Array.isArray(mem?.data) ? (mem.data as TripMember[]) : [],
    expenses: (((ex?.data as any[]) ?? []).map((e) => ({ ...e, amount: Number(e.amount), currency: e.currency || "MXN", shares: byExpense.get(e.id) ?? [] }))),
    payments: (((pay?.data as any[]) ?? []).map((p) => ({ ...p, amount: Number(p.amount), currency: p.currency || "MXN" }))),
    personal: ((mine?.data as PersonalExpense[]) ?? []),
  };
}

/** Mensaje claro para los rechazos de la base (nunca el texto técnico). */
export function splitErrorMessage(error: unknown): string {
  const m = String((error as { message?: string } | null)?.message ?? error ?? "");
  if (/split_payer_not_you/.test(m)) return "Si pagó otro miembro del viaje, que lo registre esa persona desde su app.";
  if (/split_sum_mismatch/.test(m)) return "La división no suma el total del gasto.";
  if (/split_person_has_payments/.test(m)) return "Esta persona tiene pagos registrados.";
  if (/split_person_in_expense/.test(m)) return "Esta persona está en un gasto dividido por montos o porcentajes: edítalo primero.";
  if (/split_(payer|share|payment)_other_trip/.test(m)) return "Esa persona no es de este viaje.";
  if (/positive|mayor a 0/.test(m)) return "El monto debe ser mayor a 0";
  if (/row-level security|no_access|permission denied|42501/.test(m)) return "No tienes permiso para hacer esto en este viaje.";
  return "No se pudo guardar. Intenta de nuevo.";
}

export type SharedExpenseInput = {
  payer_id: string;
  amount: number;
  currency: string;
  description: string;
  category: string;
  expense_date: string;
  city?: string | null;
  merchant?: string | null;
  tip?: number | null;
  tax?: number | null;
  receipt_path?: string | null;
  split_mode: SplitMode;
  scan?: Record<string, unknown> | null;
};

/** Gasto compartido con sus partes, en una sola transacción (la base revisa que sumen el total). */
export async function saveSharedExpense(client: Client, tripId: string, input: SharedExpenseInput, shares: SplitShare[], id?: string | null) {
  const { data, error } = await rpc(client, "trip_split_save_expense", {
    p_trip: tripId,
    p_expense: input,
    p_shares: shares.map((s) => ({ person_id: s.person_id, amount: s.amount, percent: s.percent ?? null })),
    p_id: id ?? null,
  });
  return { id: (data as string | null) ?? null, error };
}

export type PersonalExpenseInput = {
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  expense_date: string;
  city?: string | null;
};

/** Gasto solo mío (public.expenses: lo ve solo su dueño; también aparece en Gastos del dashboard). */
export async function savePersonalExpense(client: Client, userId: string, tripId: string, input: PersonalExpenseInput, receipt?: File | null) {
  let receipt_url: string | null = null;
  if (receipt) {
    const problem = uploadProblem("recibos", receipt);
    if (problem) return { data: null, error: { message: problem } };
    const path = `${userId}/${Date.now()}-recibo.${safeExtension(receipt.name)}`;
    const { error: upErr } = await client.storage.from("recibos").upload(path, receipt);
    if (!upErr) receipt_url = path;
  }
  const row = { user_id: userId, trip_id: tripId, ...input, receipt_url };
  let res = await client.from("expenses").insert(row).select().single();
  if (res?.error && /city/.test(String(res.error.message ?? ""))) {
    // Sin la columna city (migración pendiente) el gasto se guarda igual, sin ciudad.
    const { city: _c, ...rest } = row;
    res = await client.from("expenses").insert(rest).select().single();
  }
  return res as { data: PersonalExpense | null; error: unknown };
}

/** Registra un pago entre dos personas ("Liquidar"). La base exige que quien lo registra sea parte. */
export async function registerPayment(client: Client, tripId: string, p: { from_person: string; to_person: string; amount: number; currency: string }) {
  return client.from("trip_split_payments").insert({ trip_id: tripId, ...p }).select().single();
}

export const addGuest = (client: Client, tripId: string, name: string) =>
  client.from("trip_split_people").insert({ trip_id: tripId, name: name.trim().slice(0, 80) }).select().single();

export const claimGuest = (client: Client, guestId: string) => rpc(client, "trip_split_claim_guest", { p_guest: guestId });
export const unlinkPerson = (client: Client, personId: string) => rpc(client, "trip_split_unlink", { p_person: personId });

// ───── Foto del ticket ─────
export type ReceiptReading = {
  merchant: string | null;
  date: string | null;
  total: number;
  currency: string | null;
  subtotal: number | null;
  tip: number | null;
  tax: number | null;
  items: { name: string; quantity: number | null; amount: number | null }[];
  confidenceScore: number;
  confidence: "alta" | "media" | "baja";
  warnings: string[];
};
export type ScanOutcome =
  | { ok: true; path: string; receipt: ReceiptReading }
  | { ok: false; path: string | null; code: string; message: string };

const SCAN_FALLBACK = "No pudimos leer el ticket. Captura el gasto a mano; la foto queda guardada.";

/** Sube la foto a trip-receipts/<viaje>/<yo>/… (privado) y pide la lectura. No guarda ningún gasto. */
export async function uploadAndScanReceipt(client: Client, opts: { tripId: string; userId: string; file: File; currencyHint?: string | null }): Promise<ScanOutcome> {
  const problem = uploadProblem("trip-receipts", opts.file);
  if (problem) return { ok: false, path: null, code: "archivo", message: problem };
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${opts.tripId}/${opts.userId}/${Date.now()}-${rand}.${safeExtension(opts.file.name, opts.file.type === "application/pdf" ? "pdf" : "jpg")}`;
  const { error: upErr } = await client.storage.from("trip-receipts").upload(path, opts.file, { contentType: opts.file.type || undefined });
  if (upErr) return { ok: false, path: null, code: "subida", message: "No se pudo subir la foto. Revisa tu conexión e intenta de nuevo." };
  try {
    const { data, error } = await client.functions.invoke("scan-receipt", {
      body: { trip_id: opts.tripId, path, currency_hint: opts.currencyHint ?? null },
    });
    // Con 4xx/5xx, supabase-js deja la respuesta en error.context (un Response): ahí viene el motivo.
    let body = (data ?? null) as any;
    const ctx = (error as any)?.context;
    if (!body && ctx && typeof ctx.json === "function") body = await ctx.json().catch(() => null);
    if (body?.ok && body.receipt) return { ok: true, path, receipt: body.receipt as ReceiptReading };
    return { ok: false, path, code: String(body?.code ?? "error"), message: typeof body?.message === "string" ? body.message : SCAN_FALLBACK };
  } catch {
    return { ok: false, path, code: "error", message: SCAN_FALLBACK };
  }
}

/** Quita una foto que ya no se va a usar (se canceló o el gasto quedó como personal). */
export async function discardReceipt(client: Client, path: string | null | undefined) {
  if (!path) return;
  try { await client.storage.from("trip-receipts").remove([path]); } catch { /* la purga del viaje la borra */ }
}

/** Enlace temporal (5 min) para ver la foto de un gasto compartido. */
export async function receiptUrl(client: Client, path: string): Promise<string | null> {
  try {
    const { data } = await client.storage.from("trip-receipts").createSignedUrl(path, 300);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/** Mi parte de los gastos compartidos de todos mis viajes (para Gastos del dashboard). */
export async function loadMySharedParts(client: Client): Promise<{
  share_id: string; expense_id: string; trip_id: string; amount: number; currency: string; category: string;
  description: string; expense_date: string; city: string | null; total: number; payer_name: string; paid_by_me: boolean;
}[]> {
  const { data, error } = await rpc(client, "my_split_shares", {});
  if (error || !Array.isArray(data)) return [];
  return data.map((r: any) => ({ ...r, amount: Number(r.amount), total: Number(r.total) }));
}
