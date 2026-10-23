// Recuerdos: viaje por fecha, calendario, álbumes y vista unificada (recuerdos + momentos + diario).
import { describe, expect, it, vi } from "vitest";
import {
  buildAlbums, countLabel, filterByTrip, groupByDay, latestMonth, monthGrid, rangeLabelEs, shiftMonth, tripForDate, unifyItems,
  type RecuerdoRow, type RecuerdoTrip,
} from "@/lib/recuerdos/model";
import { uploadRecuerdo, setAlbumShared, type RecuerdosClient } from "@/lib/recuerdos/api";

const TRIPS: RecuerdoTrip[] = [
  { id: "lis", destino: "Lisboa", fecha_salida: "2026-03-10", fecha_regreso: "2026-03-20" },
  { id: "sin", destino: "Sintra", fecha_salida: "2026-03-14", fecha_regreso: "2026-03-15" },
  { id: "cdmx", destino: "CDMX", fecha_salida: "2026-05-01", fecha_regreso: null },
];

describe("viaje por fecha", () => {
  it("la fecha dentro de un viaje lo asigna; fuera de todos, ninguno", () => {
    expect(tripForDate("2026-03-10", TRIPS)).toBe("lis");
    expect(tripForDate("2026-03-20", TRIPS)).toBe("lis");
    expect(tripForDate("2026-03-21", TRIPS)).toBeNull();
    expect(tripForDate("2026-01-01", TRIPS)).toBeNull();
  });
  it("si dos viajes se enciman, gana el más corto (el más específico)", () => {
    expect(tripForDate("2026-03-14", TRIPS)).toBe("sin");
  });
  it("sin fecha de regreso, solo el día de salida", () => {
    expect(tripForDate("2026-05-01", TRIPS)).toBe("cdmx");
    expect(tripForDate("2026-05-02", TRIPS)).toBeNull();
    expect(tripForDate("no-es-fecha", TRIPS)).toBeNull();
  });
});

const row = (o: Partial<RecuerdoRow> & { id: string; taken_on: string }): RecuerdoRow => ({
  user_id: "me", trip_id: null, media_type: "foto", storage_path: `me/${o.id}.jpg`, thumb_path: `me/${o.id}_t.jpg`,
  taken_at: null, created_at: "2026-10-01T00:00:00Z", favorite: false, date_source: "exif", trip_source: "ninguno", ...o,
});

describe("vista unificada", () => {
  const items = unifyItems("me", {
    recuerdos: [
      row({ id: "r1", taken_on: "2026-03-12", trip_id: "lis", favorite: true }),
      row({ id: "r2", taken_on: "2026-03-12", trip_id: "lis" }),
      row({ id: "r3", taken_on: "2026-04-02", user_id: "otro", trip_id: "lis" }),
      row({ id: "v1", taken_on: "2026-03-13", trip_id: "lis", media_type: "video", storage_path: "me/v1.mp4", thumb_path: null, date_source: "video" }),
    ],
    moments: [
      { id: "m1", trip_id: "lis", caption: "Alfama", created_at: "2026-03-15T12:00:00", image_path: "me/m1.jpg", image_url: null },
      { id: "m2", trip_id: null, caption: null, created_at: "2026-03-15T12:00:00", image_path: null, image_url: null }, // sin foto
    ],
    journal: [{ id: "j1", trip_id: "lis", text: "Día uno", created_at: "2026-03-11T09:00:00", photo_path: "me/lis/j1.jpg" }],
  });

  it("junta las tres fuentes sin copiarlas y marca lo que compartió otro", () => {
    expect(items.map((i) => i.key)).toEqual(["diario:j1", "recuerdo:r1", "recuerdo:r2", "recuerdo:v1", "momento:m1", "recuerdo:r3"]);
    expect(items.find((i) => i.id === "m1")).toMatchObject({ bucket: "travel-moments-private", source: "momento", dateSource: "subida", caption: "Alfama" });
    expect(items.find((i) => i.id === "j1")).toMatchObject({ bucket: "journal-photos", path: "me/lis/j1.jpg" });
    expect(items.find((i) => i.id === "r3")?.mine).toBe(false);
  });

  it("por día, las favoritas primero", () => {
    expect(groupByDay(items).get("2026-03-12")?.map((i) => i.id)).toEqual(["r1", "r2"]);
  });

  it("calendario: semanas de lunes a domingo con las fotos en su día", () => {
    const g = monthGrid(2026, 2, items); // marzo 2026 empieza en domingo
    expect(g.length % 7).toBe(0);
    expect(g[0]).toMatchObject({ day: "2026-02-23", inMonth: false });
    expect(g[6]).toMatchObject({ day: "2026-03-01", inMonth: true });
    expect(g.find((c) => c.day === "2026-03-12")?.items).toHaveLength(2);
    expect(g.filter((c) => c.inMonth)).toHaveLength(31);
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(latestMonth(items, "2026-10-23")).toEqual({ year: 2026, month: 3 });
    expect(latestMonth([], "2026-10-23")).toEqual({ year: 2026, month: 9 });
  });

  it("filtro por viaje y sin viaje", () => {
    expect(filterByTrip(items, "lis")).toHaveLength(6);
    expect(filterByTrip(items, "sin-viaje")).toHaveLength(0);
    expect(filterByTrip(items, "todos")).toHaveLength(6);
  });

  it("álbumes: portada (favorita), fechas del viaje, conteo de fotos y videos, compartido", () => {
    const extra = unifyItems("me", { recuerdos: [row({ id: "s1", taken_on: "2026-06-01" })], moments: [], journal: [] });
    const albums = buildAlbums([...items, ...extra], TRIPS, new Set(["lis"]));
    expect(albums.map((a) => a.id)).toEqual(["lis", "sin-viaje"]);
    expect(albums[0]).toMatchObject({ title: "Lisboa", start: "2026-03-10", end: "2026-03-20", count: 6, photos: 5, videos: 1, shared: true, fromOthers: 1 });
    expect(albums[0].cover?.id).toBe("r1");
    expect(albums[1]).toMatchObject({ title: "Sin viaje", count: 1, shared: false });
    expect(rangeLabelEs("2026-03-10", "2026-03-20")).toBe("10 – 20 de marzo de 2026");
    expect(rangeLabelEs("2026-12-28", "2027-01-03")).toBe("28 de diciembre de 2026 – 3 de enero de 2027");
    expect(countLabel(5, 1)).toBe("5 fotos · 1 video");
    expect(countLabel(1, 0)).toBe("1 foto");
  });
});

// Cliente simulado: storage + tabla recuerdos.
function fakeClient(opts: { insertError?: string } = {}) {
  const uploads: Array<{ path: string; type: string }> = [];
  const removed: string[][] = [];
  const inserts: unknown[] = [];
  const q: Record<string, unknown> = {};
  let result: { data: unknown; error: unknown } = { data: null, error: null };
  for (const op of ["select", "eq", "in", "not", "order", "limit", "update", "delete"]) q[op] = () => q;
  q.insert = (v: unknown) => { inserts.push(v); result = opts.insertError ? { data: null, error: { message: opts.insertError, code: opts.insertError === "dup" ? "23505" : "P0001" } } : { data: { ...(v as object), created_at: "x" }, error: null }; return q; };
  q.single = async () => result;
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  const client = {
    from: vi.fn(() => q),
    storage: { from: vi.fn(() => ({
      upload: vi.fn(async (path: string, _b: Blob, o: { contentType: string }) => { uploads.push({ path, type: o.contentType }); return { error: null }; }),
      remove: vi.fn(async (p: string[]) => { removed.push(p); return { error: null }; }),
      createSignedUrls: vi.fn(async () => ({ data: [], error: null })),
    })) },
  } as unknown as RecuerdosClient;
  return { client, uploads, removed, inserts };
}

describe("subida", () => {
  const prepared = { kind: "foto" as const, blob: new Blob(["x"], { type: "image/jpeg" }), mime: "image/jpeg" as const, ext: "jpg" as const, thumb: new Blob(["t"]),
    width: 2048, height: 1536, durationS: null, takenOn: "2026-03-12", takenAt: null, dateSource: "exif" as const, name: "IMG.jpg" };

  it("sube archivo y miniatura con la ruta {uid}/{id} y crea la fila con el viaje por fecha", async () => {
    const f = fakeClient();
    const r = await uploadRecuerdo(f.client, "me", prepared, { id: "lis", source: "fecha" }, "11111111-1111-4111-8111-111111111111");
    expect(r.ok).toBe(true);
    expect(f.uploads).toEqual([
      { path: "me/11111111-1111-4111-8111-111111111111.jpg", type: "image/jpeg" },
      { path: "me/11111111-1111-4111-8111-111111111111_t.jpg", type: "image/jpeg" },
    ]);
    expect(f.inserts[0]).toMatchObject({ user_id: "me", trip_id: "lis", trip_source: "fecha", taken_on: "2026-03-12", date_source: "exif", media_type: "foto",
      storage_path: "me/11111111-1111-4111-8111-111111111111.jpg", thumb_path: "me/11111111-1111-4111-8111-111111111111_t.jpg" });
  });

  it("si la fila no se guarda, borra lo subido (no quedan archivos huérfanos)", async () => {
    const f = fakeClient({ insertError: "recuerdos_cupo" });
    const r = await uploadRecuerdo(f.client, "me", prepared, { id: null, source: "fecha" }, "22222222-2222-4222-8222-222222222222");
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/5,000/) });
    expect(f.removed[0]).toEqual(["me/22222222-2222-4222-8222-222222222222.jpg", "me/22222222-2222-4222-8222-222222222222_t.jpg"]);
    expect(f.inserts[0]).toMatchObject({ trip_id: null, trip_source: "ninguno" });
  });

  it("compartir un álbum ya compartido no es error", async () => {
    expect(await setAlbumShared(fakeClient({ insertError: "dup" }).client, "me", "lis", true)).toBe(true);
  });
});
