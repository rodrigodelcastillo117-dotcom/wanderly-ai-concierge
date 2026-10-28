import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { CalendarHeart, Compass, Globe2, Lock, Map as MapIcon, MapPin, MoreHorizontal, Plane, Sparkles, UserMinus, Users, Utensils } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { SmartImage } from "@/components/media/SmartImage";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FriendAvatar } from "@/components/social/FriendAvatar";
import { PriveSeal } from "@/components/PriveSeal";
import { PokeButtons } from "@/components/social/PokeButtons";
import { TripPostcard } from "@/components/social/TripPostcard";
import { PlanTogetherDialog } from "@/components/social/PlanTogetherDialog";
import { FriendTrips } from "@/components/social/FriendTrips";
import { ActivityGrid } from "@/components/social/FriendActivity";
import { useFriendAvatars } from "@/hooks/useFriendAvatars";
import { loadFriendActivity, loadFriendTrips, type ActivityItem, type FriendTrip } from "@/lib/friendActivity";
import { supabase } from "@/integrations/supabase/client";
import { removeFriend as removeFriendRpc } from "@/lib/friendRequests";
import { useAuth } from "@/contexts/AuthContext";
import { destinationQuery } from "@/lib/categoryImagery";
import { localISODate } from "@/lib/localDate";
import { flagEmoji, uniqueCountries } from "@/lib/countryFlags";
import {
  commonGround, dnaLabel, firstName, monthYear, parseFriendProfile, pickPostcardTrip, planWithFriendHref, prettyPlace, shortMonthYear,
  showAfinidad, tripPhase, yearOf, type FriendProfileData, type FriendProfileResult, type SaludosState, type SharedTrip,
} from "@/lib/social";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PostalOption = { key: string; place: string; country: string | null; year: string | null; upcoming: boolean; cover: string | null; label: string };

const PHASE: Record<ReturnType<typeof tripPhase>, string> = { vivido: "Vivido", en_curso: "En curso", proximo: "Próximo", sin_fecha: "Por definir" };

function SectionTitle({ id, eyebrow, title, icon: Icon }: { id: string; eyebrow: string; title: string; icon: typeof Plane }) {
  return (
    <div className="mb-4 md:mb-5">
      <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-1.5 flex items-center gap-1.5"><Icon className="w-3 h-3" aria-hidden="true" /> {eyebrow}</p>
      <h2 id={id} className="font-display text-2xl md:text-3xl">{title}</h2>
    </div>
  );
}

function AffinityRing({ value }: { value: number }) {
  const r = 34, c = 2 * Math.PI * r;
  return (
    <div className="relative w-24 h-24 shrink-0" data-testid="affinity">
      <svg viewBox="0 0 80 80" className="w-24 h-24 -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r={r} stroke="hsl(var(--border))" strokeWidth="4" fill="none" />
        <circle cx="40" cy="40" r={r} stroke="hsl(var(--primary))" strokeWidth="4" fill="none" strokeDasharray={`${(value / 100) * c} ${c}`} strokeLinecap="round"
          className="drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl gold-text leading-none">{value}%</span>
      </div>
    </div>
  );
}

function PrivateProfile() {
  return (
    <div className="px-4 md:px-10 py-16 md:py-24 max-w-xl mx-auto text-center animate-fade-up" data-testid="friend-private">
      <div className="mx-auto mb-6 w-16 h-16 rounded-full border border-primary/30 bg-primary/5 flex items-center justify-center">
        <Lock className="w-6 h-6 text-primary" />
      </div>
      <h1 className="font-display text-3xl md:text-4xl mb-3">Este perfil es privado</h1>
      <p className="text-muted-foreground text-sm md:text-base mb-8">
        Solo los amigos conectados en IATOS pueden verlo. Si te compartió su código, conéctense desde Social.
      </p>
      <Button asChild className="bg-gradient-gold text-primary-foreground gold-glow">
        <Link to="/dashboard/social">Volver a Social</Link>
      </Button>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="animate-pulse" data-testid="friend-loading" aria-busy="true">
      <div className="h-[260px] md:h-[360px] bg-white/[0.03]" />
      <div className="px-4 md:px-10 max-w-5xl mx-auto -mt-20 space-y-6">
        <div className="w-32 h-40 rounded-[28px] bg-white/[0.06]" />
        <div className="h-10 w-2/3 rounded-xl bg-white/[0.05]" />
        <div className="grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-white/[0.04]" />)}</div>
      </div>
    </div>
  );
}

function TripCard({ t, today, onPostal, selected }: { t: SharedTrip; today: string; onPostal: () => void; selected: boolean }) {
  const phase = tripPhase(t, today);
  return (
    <article className={`snap-start shrink-0 w-[78%] sm:w-auto glass-card rounded-2xl overflow-hidden border transition ${selected ? "border-primary/50" : "border-white/[0.05] hover:border-primary/25"}`}>
      <Link to={`/dashboard/viajes/${t.id}`} className="block group">
        <SmartImage alt={t.destino} imageUrl={t.cover_image_url} stockQuery={destinationQuery(t.destino, t.pais_destino)} icon={MapPin}
          className="h-36 md:h-40 w-full" imgClassName="group-hover:scale-105" captionPosition="top-right">
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
          <span className={`absolute top-3 left-3 z-[2] text-[10px] px-2.5 py-1 rounded-full backdrop-blur ${phase === "vivido" ? "bg-black/55 text-white/85" : "bg-primary/90 text-primary-foreground"}`}>{PHASE[phase]}</span>
        </SmartImage>
        <div className="px-4 pt-3">
          <p className="text-[10px] text-primary tracking-[0.18em] uppercase truncate">{t.pais_destino ?? " "}</p>
          <h3 className="font-display text-xl truncate group-hover:text-primary transition">{t.destino}</h3>
          <p className="text-xs text-muted-foreground">{shortMonthYear(t.fecha_salida) ?? "Sin fechas"}</p>
        </div>
      </Link>
      <div className="px-4 pb-4 pt-2">
        <button type="button" onClick={onPostal} className="text-xs text-primary hover:underline underline-offset-4">
          {selected ? "En la postal ✓" : "Hacer postal de este viaje"}
        </button>
      </div>
    </article>
  );
}

export default function FriendProfile() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [result, setResult] = useState<FriendProfileResult | null>(null);
  const [me, setMe] = useState<{ name: string; avatar: string | null; prive?: boolean }>({ name: "Tú", avatar: null });
  const [saludos, setSaludos] = useState<SaludosState | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [postalKey, setPostalKey] = useState<string | null>(null);
  const postalRef = useRef<HTMLElement>(null);
  const today = localISODate();
  const location = useLocation();
  // Viajes que decidió mostrar y su actividad compartida (20261027090000_social_amigos.sql).
  const [trips, setTrips] = useState<FriendTrip[] | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    setResult(null);
    setTrips(null);
    setActivity(null);
    if (!UUID.test(id)) { setResult({ status: "privado" }); return; }
    (async () => {
      const [{ data, error }, { data: mine }, t, a] = await Promise.all([
        supabase.rpc("amigo_perfil", { p_amigo: id }),
        supabase.from("profiles").select("full_name, username, avatar_url").eq("id", user.id).maybeSingle(),
        loadFriendTrips(supabase as never, id),
        loadFriendActivity(supabase as never, id),
      ]);
      if (!alive) return;
      const r = error ? ({ status: "error" } as const) : parseFriendProfile(data);
      setResult(r);
      if (r.status === "ok") setSaludos(r.data.saludos);
      setTrips(t.status === "ok" ? t.viajes : []);
      setActivity(a.status === "ok" ? a.items : []);
      const m = mine as { full_name?: string | null; username?: string | null; avatar_url?: string | null } | null;
      setMe({ name: firstName(m, "Tú"), avatar: m?.avatar_url ?? null, prive: r.status === "ok" && r.data.yo_prive });
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.id]);

  useEffect(() => {
    if (result?.status === "eres_tu") navigate("/dashboard/perfil", { replace: true });
  }, [result, navigate]);

  const data: FriendProfileData | null = result?.status === "ok" ? result.data : null;
  // Avatar con enlace firmado (solo amigos aceptados y si no lo apagó); si no, la URL del perfil o la inicial.
  const signedAvatars = useFriendAvatars(data ? [data.amigo.id] : []);
  const friendAvatar = data ? signedAvatars.get(data.amigo.id) ?? data.amigo.avatar_url : null;

  // Desde un aviso ("respondió tu pregunta") se llega con #actividad.
  useEffect(() => {
    if (location.hash !== "#actividad" || activity === null) return;
    document.getElementById("actividad")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [location.hash, activity]);
  const nombre = data ? firstName(data.amigo, "Tu amigo") : "";
  const fullName = data ? (data.amigo.full_name ?? data.amigo.username ?? "Viajero") : "";

  const postalOptions = useMemo<PostalOption[]>(() => {
    if (!data) return [];
    const opts: PostalOption[] = data.viajes_juntos.map((t) => ({
      key: `trip:${t.id}`, place: t.destino, country: t.pais_destino, year: yearOf(t.fecha_salida),
      upcoming: tripPhase(t, today) === "proximo", cover: t.cover_image_url, label: t.destino,
    }));
    for (const s of data.en_comun.suenos) {
      opts.push({ key: `sueno:${s}`, place: prettyPlace(s), country: null, year: null, upcoming: true, cover: null, label: `✨ ${prettyPlace(s)}` });
    }
    return opts;
  }, [data, today]);

  const defaultPostal = useMemo(() => {
    if (!data) return null;
    const t = pickPostcardTrip(data.viajes_juntos, today);
    return t ? `trip:${t.id}` : postalOptions[0]?.key ?? null;
  }, [data, today, postalOptions]);
  const postal: PostalOption = postalOptions.find((o) => o.key === (postalKey ?? defaultPostal))
    ?? { key: "mundo", place: "El mundo", country: null, year: null, upcoming: true, cover: null, label: "El mundo" };

  const heroTrip = data ? pickPostcardTrip(data.viajes_juntos, today) : null;
  const countries = useMemo(() => (data ? uniqueCountries(data.lugares) : []), [data]);
  const sharedIds = useMemo(() => new Set(data?.viajes_juntos.map((t) => t.id) ?? []), [data]);
  const common = data ? commonGround(data.en_comun, data.dna.ritmo) : [];

  // quitar_amigo (servidor): borra la amistad; con bloquear, además impide que vuelva a pedirla con
  // tu código. Sin bloquear, si vuelve a usar tu código solo te llega una solicitud que tú decides.
  const removeFriend = async (bloquear = false) => {
    if (!user || !data) return;
    const r = await removeFriendRpc(supabase as never, data.amigo.id, bloquear);
    if (!r?.ok) { toast.error("No se pudo quitar la amistad. Intenta de nuevo."); return; }
    toast.success(bloquear ? `Bloqueaste a ${nombre}. Ya no podrá mandarte solicitudes.` : `Ya no estás conectado con ${nombre}.`);
    navigate("/dashboard/social", { replace: true });
  };

  const choosePostal = (key: string) => {
    setPostalKey(key);
    postalRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  if (!result || result.status === "eres_tu") return <DashboardLayout><ProfileSkeleton /></DashboardLayout>;
  if (result.status !== "ok" || !data || !saludos) {
    return (
      <DashboardLayout>
        {result.status === "error" ? (
          <div className="px-4 md:px-10 py-16 max-w-xl mx-auto text-center">
            <h1 className="font-display text-3xl mb-3">No pudimos abrir este perfil</h1>
            <p className="text-muted-foreground text-sm mb-6">Revisa tu conexión e intenta de nuevo.</p>
            <Button onClick={() => window.location.reload()} variant="outline" className="border-primary/30 text-primary">Reintentar</Button>
          </div>
        ) : <PrivateProfile />}
      </DashboardLayout>
    );
  }

  const ec = data.en_comun;
  const desde = monthYear(data.amigos_desde);
  const hogar = [data.amigo.ciudad_origen, data.amigo.pais_origen && data.amigo.pais_origen !== data.amigo.ciudad_origen ? data.amigo.pais_origen : null].filter(Boolean).join(", ");
  const dnaChips = [
    data.dna.ritmo && dnaLabel("ritmo", data.dna.ritmo),
    ...data.dna.comida.map((c) => dnaLabel("comida", c)),
    ...data.dna.tardes.map((c) => dnaLabel("tardes", c)),
    ...data.dna.hospedaje.map((c) => dnaLabel("hospedaje", c)),
  ].filter((x): x is NonNullable<ReturnType<typeof dnaLabel>> => !!x);

  const stats = [
    { n: data.viajes_juntos_total, label: data.viajes_juntos_total === 1 ? "Viaje juntos" : "Viajes juntos", icon: Plane, testId: "shared-trips-count" },
    { n: countries.length, label: countries.length === 1 ? "País en su mapa" : "Países en su mapa", icon: Globe2, testId: "countries-count" },
    { n: saludos.total, label: saludos.total === 1 ? "Saludo" : "Saludos", icon: Sparkles, testId: "pokes-count" },
  ].filter((x) => x.n > 0);

  return (
    <DashboardLayout>
      <div className="pb-16 animate-fade-up">
        {/* PORTADA: su último viaje juntos o su ciudad */}
        <div className="relative -mt-[52px] md:-mt-[56px]">
          <SmartImage
            alt={heroTrip ? heroTrip.destino : hogar || "Viaje"}
            imageUrl={heroTrip?.cover_image_url ?? null}
            stockQuery={heroTrip ? destinationQuery(heroTrip.destino, heroTrip.pais_destino) : destinationQuery(data.amigo.ciudad_origen ?? "luxury", data.amigo.pais_origen)}
            icon={Compass}
            eager
            className="h-[300px] md:h-[400px] w-full"
            captionPosition="top-right"
            captionClassName="top-16 right-4"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/10 to-background" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,transparent_40%,hsl(var(--background))_100%)] opacity-60" />
          </SmartImage>
        </div>

        <div className="px-4 md:px-10 max-w-5xl mx-auto -mt-36 md:-mt-48 relative z-10 space-y-10 md:space-y-14">
          {/* ENCABEZADO */}
          <section className="flex flex-col sm:flex-row sm:items-end gap-5 md:gap-8">
            <FriendAvatar name={fullName} url={friendAvatar} shape="portrait" testId="friend-avatar"
              className="w-32 h-40 md:w-44 md:h-56 border border-primary/50 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.9),0_0_0_6px_hsl(var(--background))] text-5xl" />
            <div className="min-w-0 flex-1 pb-1">
              <p className="text-[10px] md:text-xs tracking-[0.3em] text-primary uppercase mb-2">Compañero de viaje</p>
              <h1 className="font-display text-4xl md:text-6xl leading-[1.02] break-words">
                {fullName}
                {data.amigo.is_prive && <span className="inline-block ml-2.5 md:ml-3 align-middle"><PriveSeal size="lg" /></span>}
              </h1>
              {data.amigo.is_prive && <p className="mt-1.5 text-[10px] tracking-[0.3em] uppercase gold-text">Miembro IATOS Privé</p>}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs md:text-sm text-muted-foreground">
                {hogar && <span className="inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-primary" /> {hogar}</span>}
                {desde && <span className="inline-flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-primary" /> Amigos desde {desde}</span>}
                {data.amigo.username && <span>@{data.amigo.username}</span>}
              </div>
              {data.dna.estilo && <p className="mt-3 font-display italic text-lg md:text-xl gold-text">“{data.dna.estilo}”</p>}
            </div>
          </section>

          {/* Pendiente (coordinación): aquí podría ir la tarjeta de membresía del amigo (MemberCard) cuando
              su equipo publique una versión para terceros; hoy solo se muestra el sello Privé (booleano). */}
          {/* ACCIONES */}
          <section className="flex flex-col md:flex-row md:items-start gap-3 md:gap-4" aria-label="Acciones">
            <div className="flex-1">
              <PokeButtons friendId={data.amigo.id} friendName={nombre} state={saludos} onChange={setSaludos} />
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => setPlanOpen(true)} variant="outline" className="h-11 rounded-full border-primary/40 text-primary hover:bg-primary/10 px-5">
                <CalendarHeart className="w-4 h-4 mr-2" /> Planear juntos
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Más opciones" className="w-11 h-11 rounded-full border border-white/10 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.04]">
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setConfirmRemove(true)} className="text-destructive focus:text-destructive">
                    <UserMinus className="w-4 h-4 mr-2" /> Dejar de ser amigos
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </section>

          {/* CONTADORES: solo lo que ya existe (nada de "0" que desanime) */}
          {stats.length >= 2 && (
            <section className={`grid gap-2.5 md:gap-4 ${stats.length === 3 ? "grid-cols-3" : "grid-cols-2"}`} aria-label="Juntos en números">
              {stats.map((s) => (
                <div key={s.label} className="glass-card rounded-2xl p-3.5 md:p-6 border border-white/[0.05] text-center md:text-left">
                  <s.icon className="w-4 h-4 text-primary mb-2 mx-auto md:mx-0" />
                  <p className="font-display text-3xl md:text-5xl gold-text leading-none" data-testid={s.testId}>{s.n}</p>
                  <p className="text-[10px] md:text-xs text-muted-foreground mt-1.5 md:mt-2 leading-tight">{s.label}</p>
                </div>
              ))}
            </section>
          )}

          {/* VIAJES JUNTOS */}
          <section aria-labelledby="viajes-juntos">
            <SectionTitle id="viajes-juntos" eyebrow="Bitácora compartida" title="Viajes juntos" icon={Plane} />
            {data.viajes_juntos.length === 0 ? (
              <div className="glass-card rounded-3xl p-6 md:p-8 border border-primary/15 flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
                <div className="flex -space-x-4 shrink-0">
                  <FriendAvatar name={me.name} url={me.avatar} className="w-14 h-14 text-lg border-2 border-background" />
                  <FriendAvatar name={fullName} url={friendAvatar} className="w-14 h-14 text-lg border-2 border-background" />
                </div>
                <div className="flex-1">
                  <p className="font-display text-xl md:text-2xl">Su primer viaje juntos está por escribirse</p>
                  <p className="text-sm text-muted-foreground mt-1">Invita a {nombre} a un viaje tuyo o empiecen uno desde cero.</p>
                </div>
                <Button onClick={() => setPlanOpen(true)} className="bg-gradient-gold text-primary-foreground gold-glow rounded-full">Planear el primero</Button>
              </div>
            ) : (
              <div className="flex sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 overflow-x-auto sm:overflow-visible snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0 pb-2 sm:pb-0 [scrollbar-width:none]">
                {data.viajes_juntos.map((t) => (
                  <TripCard key={t.id} t={t} today={today} selected={postal.key === `trip:${t.id}`} onPostal={() => choosePostal(`trip:${t.id}`)} />
                ))}
              </div>
            )}
          </section>

          {/* VIAJES DE CARLO: los que decidió mostrar */}
          <section aria-labelledby="sus-viajes">
            <SectionTitle id="sus-viajes" eyebrow="Su mapa" title={`Viajes de ${nombre}`} icon={MapIcon} />
            {trips === null ? <div className="h-32 rounded-2xl bg-white/[0.03] animate-pulse" /> : <FriendTrips trips={trips} nombre={nombre} />}
          </section>

          {/* LO QUE HA HECHO: actividad que decidió compartir */}
          <section aria-labelledby="actividad" className="scroll-mt-20">
            <SectionTitle id="actividad" eyebrow="Lo que ha hecho" title={`Lo que recomienda ${nombre}`} icon={Utensils} />
            {activity === null ? (
              <div className="h-40 rounded-2xl bg-white/[0.03] animate-pulse" />
            ) : activity.length === 0 ? (
              <div className="glass-card rounded-2xl p-5 md:p-6 border border-white/[0.05]" data-testid="activity-empty">
                <p className="text-sm md:text-base">{nombre} aún no comparte sus reservas, recomendaciones ni lugares.</p>
                <p className="text-xs text-muted-foreground mt-1">Cuando lo prenda en «Qué ven mis amigos», aquí verás a dónde fue, qué pidió y qué te recomienda.</p>
              </div>
            ) : (
              <ActivityGrid items={activity} friendId={data.amigo.id} friendName={nombre}
                onChange={(n) => setActivity((xs) => (xs ?? []).map((x) => (x.clave === n.clave ? n : x)))} />
            )}
          </section>

          {/* POSTAL */}
          <section ref={postalRef} aria-labelledby="postal" className="glass-card rounded-3xl p-5 md:p-10 border border-primary/15 scroll-mt-20">
            <div className="grid md:grid-cols-[1fr_420px] gap-6 md:gap-10 items-center">
              <div>
                <SectionTitle id="postal" eyebrow="Recuerdo para compartir" title={postal.upcoming ? "La postal de su próximo viaje" : "Su postal juntos"} icon={Sparkles} />
                <p className="text-sm text-muted-foreground leading-relaxed max-w-md">
                  Los dos avatares en {postal.place === "El mundo" ? "su próximo destino" : postal.place}, con timbre y matasellos. Mándala por WhatsApp o súbela a tus historias.
                </p>
                {postalOptions.length > 1 && (
                  <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Destino de la postal">
                    {postalOptions.slice(0, 8).map((o) => (
                      <button key={o.key} type="button" onClick={() => setPostalKey(o.key)} aria-pressed={postal.key === o.key}
                        className={`px-3.5 py-1.5 rounded-full text-xs border transition ${postal.key === o.key ? "bg-primary text-primary-foreground border-primary" : "border-white/10 text-muted-foreground hover:text-foreground hover:border-primary/40"}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <TripPostcard
                key={postal.key}
                me={me}
                friend={{ name: nombre, avatar: friendAvatar, prive: data.amigo.is_prive }}
                place={postal.place}
                country={postal.country}
                year={postal.year}
                upcoming={postal.upcoming}
                coverUrl={postal.cover}
              />
            </div>
          </section>

          {/* EN QUÉ SE PARECEN */}
          <section aria-labelledby="en-comun">
            <SectionTitle id="en-comun" eyebrow="Química viajera" title="En qué se parecen" icon={Sparkles} />
            <div className="glass-card rounded-3xl p-5 md:p-8 border border-white/[0.05] space-y-6" data-testid="common-ground">
              {showAfinidad(ec.afinidad) && (
                <div className="flex items-center gap-5">
                  <AffinityRing value={ec.afinidad} />
                  <div>
                    <p className="font-display text-xl md:text-2xl">{ec.afinidad >= 75 ? "Almas gemelas de viaje" : ec.afinidad >= 55 ? "Gran equipo de viaje" : "Buena química viajera"}</p>
                    <p className="text-xs md:text-sm text-muted-foreground mt-1">Afinidad según el perfil de viajero de los dos.</p>
                  </div>
                </div>
              )}
              {common.length > 0 ? (
                <ul className="grid sm:grid-cols-2 gap-2.5">
                  {common.slice(0, 8).map((c) => (
                    <li key={c.key} className="flex items-center gap-3 rounded-2xl bg-white/[0.025] border border-white/[0.05] px-4 py-3">
                      <span className="text-xl" aria-hidden="true">{c.emoji}</span>
                      <span className="text-sm flex-1">{c.text}</span>
                      {c.tipo === "sueno" && c.value && (
                        <Link to={planWithFriendHref(data.amigo.id, c.value)} className="text-xs text-primary hover:underline shrink-0">Planear</Link>
                      )}
                    </li>
                  ))}
                </ul>
              ) : !ec.yo_tengo_dna ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <p className="text-sm md:text-base flex-1">Completa tu perfil de viajero para descubrir en qué se parecen {nombre} y tú.</p>
                  <Button asChild className="bg-gradient-gold text-primary-foreground rounded-full"><Link to="/onboarding/deep">Completar mi perfil de viajero</Link></Button>
                </div>
              ) : !ec.amigo_tiene_dna ? (
                <p className="text-sm md:text-base">Cuando {nombre} complete su perfil de viajero, aquí verán en qué se parecen. Mándale un saludo para recordárselo ✈️</p>
              ) : (
                <p className="text-sm md:text-base">Polos opuestos: el mejor pretexto para que cada uno le enseñe al otro su forma de viajar.</p>
              )}
            </div>
          </section>

          {(dnaChips.length > 0 || data.lugares.length > 0) && <div className="grid lg:grid-cols-2 gap-10 md:gap-14 lg:gap-8">
            {/* SU TRAVEL DNA */}
            <section aria-labelledby="su-dna">
              <SectionTitle id="su-dna" eyebrow="Perfil de viajero" title={`Así viaja ${nombre}`} icon={Compass} />
              {dnaChips.length ? (
                <div className="flex flex-wrap gap-2">
                  {dnaChips.map((c) => (
                    <span key={c.label} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full border border-primary/20 bg-primary/[0.06] text-sm">
                      <span aria-hidden="true">{c.emoji}</span> {c.label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{nombre} aún no completa su perfil de viajero.</p>
              )}
            </section>

            {/* POR DÓNDE HA VIAJADO */}
            <section aria-labelledby="lugares">
              <SectionTitle id="lugares" eyebrow="Pasaporte" title="Por dónde ha viajado" icon={Globe2} />
              {data.lugares.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aún no hay viajes terminados en su mapa.</p>
              ) : (
                <div className="space-y-4">
                  {countries.length > 0 && (
                    <ul className="flex flex-wrap gap-3" aria-label="Países">
                      {countries.map((c) => (
                        <li key={c.name} className="flex flex-col items-center w-14" title={c.name}>
                          <span className="text-3xl leading-none" aria-hidden="true">{flagEmoji(c.code)}</span>
                          <span className="mt-1 text-[10px] text-muted-foreground text-center leading-tight line-clamp-2">{c.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {data.lugares.map((l) => (
                      <span key={l.ciudad} className="px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-xs text-foreground/85">{prettyPlace(l.ciudad)}</span>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Solo se muestran viajes que ya terminaron, sin fechas.</p>
                </div>
              )}
            </section>
          </div>}
        </div>
      </div>

      <PlanTogetherDialog open={planOpen} onOpenChange={setPlanOpen} friendId={data.amigo.id} friendName={nombre} sharedTripIds={sharedIds} suenos={ec.suenos} />

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dejar de ser amigos de {nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Ya no verán sus perfiles ni podrán saludarse. Los viajes que comparten no se borran: cada quien conserva su acceso.
              Si vuelve a usar tu código, te llegará una solicitud que puedes rechazar; si lo bloqueas, ya no podrá pedírtela.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeFriend(true)} className="border border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10">Quitar y bloquear</AlertDialogAction>
            <AlertDialogAction onClick={() => void removeFriend(false)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Dejar de ser amigos</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
