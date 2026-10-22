// Stripe al borrar la cuenta (A-16 / IATOS-050 y ronda sec2-b). Sin Deno ni SDK: Stripe se inyecta
// (stripeFetchDeps usa fetch a la API REST; las pruebas, un doble en memoria). Probado en
// src/test/deleteAccount.test.ts y src/test/accountDeletion.test.ts.
//
// Qué se hace con el cliente de Stripe al borrar una cuenta (decisión documentada en docs/ops):
//   * se cancelan todas las suscripciones vivas y se quitan (detach) sus métodos de pago: no puede
//     haber cobros nuevos;
//   * NO se borra el objeto Customer: se le quitan nombre, correo, teléfono, dirección y
//     descripción, y se marca como eliminado. Stripe conserva de todas formas las facturas y cargos
//     (con el nombre y correo con que se emitieron) por obligaciones legales, fiscales y para
//     atender disputas; borrar el Customer no los elimina y nos impediría ligar una disputa tardía
//     a la solicitud de borrado.
//
// Antes: solo se cancelaba la suscripción guardada en subscriptions y CUALQUIER error de Stripe
// abortaba el borrado (billing_cancellation_failed). Una suscripción ya cancelada o expirada en
// Stripe dejaba a la persona sin poder borrar su cuenta, y una segunda suscripción del mismo
// cliente (doble checkout) seguía cobrando.
// Ahora: se cancelan TODAS las suscripciones vivas del cliente; "ya cancelada" o "no existe" cuenta
// como éxito. Solo un error real (red, 5xx, llave inválida) detiene el borrado, para no borrar la
// cuenta mientras Stripe sigue cobrando.

export type StripeSub = { id: string; status: string; customer?: string | null };

export type StripeCallFailure = { ok: false; httpStatus: number; code?: string | null; message?: string | null };
export type StripeCallResult = { ok: true; status?: string } | StripeCallFailure;

export interface BillingDeps {
  /** Todas las suscripciones del cliente (status=all), ya paginadas. */
  listSubscriptions(customerId: string): Promise<StripeSub[]>;
  retrieveSubscription(id: string): Promise<StripeSub | null>;
  cancelSubscription(id: string): Promise<StripeCallResult>;
  /** Métodos de pago guardados del cliente (ids). */
  listPaymentMethods?(customerId: string): Promise<string[]>;
  detachPaymentMethod?(id: string): Promise<StripeCallResult>;
  /** Quita los datos personales del Customer y lo marca como eliminado. */
  redactCustomer?(customerId: string): Promise<StripeCallResult>;
}

/** Estados en los que Stripe ya no cobra: no hay nada que cancelar. */
const TERMINAL = new Set(["canceled", "incomplete_expired"]);

/** ¿El error de Stripe significa "ya no hay nada que cancelar"? */
export function isAlreadyGone(r: StripeCallResult): boolean {
  if (r.ok) return true;
  const f = r as StripeCallFailure;
  if (f.httpStatus === 404 || f.code === "resource_missing") return true;
  return /already (been )?cancel|is canceled|status of canceled|no such subscription/i.test(f.message ?? "");
}

export type CancelOutcome =
  | { ok: true; canceled: string[]; alreadyGone: string[] }
  | { ok: false; failed: string };

export async function cancelAllSubscriptions(
  deps: BillingDeps,
  ref: { customerId?: string | null; subscriptionId?: string | null },
): Promise<CancelOutcome> {
  const ids = new Set<string>();
  const customers = new Set<string>();
  if (ref.customerId) customers.add(ref.customerId);

  // Si solo hay id de suscripción, se averigua el cliente para encontrar las demás.
  if (ref.subscriptionId) {
    const sub = await deps.retrieveSubscription(ref.subscriptionId);
    if (sub) {
      if (!TERMINAL.has(sub.status)) ids.add(sub.id);
      if (sub.customer) customers.add(sub.customer);
    }
  }
  for (const c of customers) {
    for (const sub of await deps.listSubscriptions(c)) {
      if (!TERMINAL.has(sub.status)) ids.add(sub.id);
    }
  }

  const canceled: string[] = [];
  const alreadyGone: string[] = [];
  for (const id of ids) {
    const r = await deps.cancelSubscription(id);
    if (r.ok) canceled.push(id);
    else if (isAlreadyGone(r)) alreadyGone.push(id);
    else return { ok: false, failed: id };
  }
  return { ok: true, canceled, alreadyGone };
}

/** Quita todos los métodos de pago del cliente (no más cobros). "Ya no existe" cuenta como hecho. */
export async function detachAllPaymentMethods(deps: BillingDeps, customerId: string): Promise<{ ok: boolean; detached: number; failed?: string }> {
  if (!deps.listPaymentMethods || !deps.detachPaymentMethod) return { ok: false, detached: 0, failed: "sin_dependencias" };
  let detached = 0;
  for (const pm of await deps.listPaymentMethods(customerId)) {
    const r = await deps.detachPaymentMethod(pm);
    if (r.ok || isAlreadyGone(r) || (r as StripeCallFailure).code === "payment_method_unexpected_state") detached++;
    else return { ok: false, detached, failed: pm };
  }
  return { ok: true, detached };
}

/** Implementación con fetch a la API REST de Stripe (sin SDK). */
export function stripeFetchDeps(secretKey: string, fetchImpl: typeof fetch = fetch): BillingDeps {
  const api = "https://api.stripe.com/v1";
  const headers = { Authorization: `Bearer ${secretKey}` };
  const readError = async (res: Response): Promise<StripeCallResult> => {
    const j = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    return { ok: false, httpStatus: res.status, code: j.error?.code ?? null, message: j.error?.message ?? null };
  };
  return {
    async listSubscriptions(customerId) {
      const out: StripeSub[] = [];
      let after: string | null = null;
      for (let page = 0; page < 20; page++) {
        const qs = new URLSearchParams({ customer: customerId, status: "all", limit: "100" });
        if (after) qs.set("starting_after", after);
        const res = await fetchImpl(`${api}/subscriptions?${qs}`, { headers });
        if (res.status === 404) return out; // cliente ya borrado en Stripe
        if (!res.ok) throw new Error(`stripe_list_${res.status}`);
        const j = await res.json() as { data?: StripeSub[]; has_more?: boolean };
        const data = j.data ?? [];
        out.push(...data);
        if (!j.has_more || !data.length) break;
        after = data[data.length - 1].id;
      }
      return out;
    },
    async retrieveSubscription(id) {
      const res = await fetchImpl(`${api}/subscriptions/${encodeURIComponent(id)}`, { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`stripe_retrieve_${res.status}`);
      const j = await res.json() as { id: string; status: string; customer?: string | { id: string } | null };
      return { id: j.id, status: j.status, customer: typeof j.customer === "string" ? j.customer : j.customer?.id ?? null };
    },
    async listPaymentMethods(customerId) {
      const out: string[] = [];
      let after: string | null = null;
      for (let page = 0; page < 20; page++) {
        const qs = new URLSearchParams({ limit: "100" });
        if (after) qs.set("starting_after", after);
        const res = await fetchImpl(`${api}/customers/${encodeURIComponent(customerId)}/payment_methods?${qs}`, { headers });
        if (res.status === 404) return out;
        if (!res.ok) throw new Error(`stripe_payment_methods_${res.status}`);
        const j = await res.json() as { data?: Array<{ id: string }>; has_more?: boolean };
        const data = j.data ?? [];
        out.push(...data.map((d) => d.id));
        if (!j.has_more || !data.length) break;
        after = data[data.length - 1].id;
      }
      return out;
    },
    async detachPaymentMethod(id) {
      const res = await fetchImpl(`${api}/payment_methods/${encodeURIComponent(id)}/detach`, { method: "POST", headers });
      return res.ok ? { ok: true } : readError(res);
    },
    async redactCustomer(customerId) {
      // Cadena vacía = borrar el campo en la API de Stripe.
      const body = new URLSearchParams({
        name: "", email: "", phone: "", description: "", address: "", shipping: "",
        "metadata[supabase_user_id]": "", "metadata[iatos_deleted]": "true",
      });
      const res = await fetchImpl(`${api}/customers/${encodeURIComponent(customerId)}`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, body,
      });
      if (res.ok) return { ok: true };
      const r = await readError(res);
      // Un Customer ya borrado en Stripe ya no tiene datos que quitar.
      return isAlreadyGone(r) || /deleted/i.test((r as StripeCallFailure).message ?? "") ? { ok: true } : r;
    },
    async cancelSubscription(id) {
      const res = await fetchImpl(`${api}/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE", headers });
      if (!res.ok) return readError(res);
      const j = await res.json().catch(() => ({})) as { status?: string };
      return { ok: true, status: j.status };
    },
  };
}
