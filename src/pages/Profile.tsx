import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DashboardLayout } from "@/components/DashboardLayout";
import BenefitsVault from "@/components/BenefitsVault";
import PromocionesActivas from "@/components/PromocionesActivas";
import AvatarCreator from "@/components/AvatarCreator";
import { Sparkles, LogOut, Wand2, RefreshCw, Crown, TrendingUp, BarChart3, Inbox, FileUp, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TravelAvatarCinematic } from "@/components/lux/TravelAvatarCinematic";
import { useTravelDNA, TravelDNAStats } from "@/components/lux/TravelDNAStats";
import { CompatibilityPanel } from "@/components/lux/CompatibilityPanel";
import { BestMomentsPanel } from "@/components/lux/BestMomentsPanel";
import { Tooltip as InlineTooltip } from "@/components/Tooltip";
import { useTooltipShown } from "@/hooks/useTooltipShown";
import { DeleteAccountSection } from "@/components/DeleteAccountSection";
import { InviteFriendsCard } from "@/components/InviteFriendsCard";
import { FriendsPrivacySection } from "@/components/social/FriendsPrivacySection";
import { dnaForDisplay } from "../../supabase/functions/_shared/dnaVoice";
import { AvatarCircle } from "@/components/avatar/AvatarCircle";
import { PriveSeal } from "@/components/PriveSeal";
import { notifyAvatarUpdated, useMyAvatar } from "@/hooks/useMyAvatar";
import { usePriveSeal } from "@/hooks/usePriveSeal";
import { useMemberCard } from "@/lib/memberCard";
import { MemberCardButton } from "@/components/membercard/MemberCardButton";
import { DNA_ARCHETYPES } from "@/lib/travelDna";
import { useAutoEvolveAvatar } from "@/components/avatar/useAutoEvolveAvatar";
import { ProfileWrappedLink } from "@/components/wrapped/WrappedPromo";
import { localISODate } from "@/lib/localDate";
import { readFunctionError } from "@/lib/functionErrors";
import { openCookieSettings } from "@/lib/consent";
import { dnaUpdatedLabel, PROFILE_SETTINGS_ID } from "@/lib/profileSettings";
import { withIatoMark } from "@/lib/iatoMark";

const Profile = () => {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { signOut, user } = useAuth();
  // El engrane "Ajustes" del encabezado abre /dashboard/perfil#ajustes: baja a la sección real de ajustes.
  // Las secciones de arriba cargan después (tarjetas, promociones) y empujan la página: se vuelve a
  // alinear un par de veces mientras se acomoda.
  useEffect(() => {
    if (hash !== `#${PROFILE_SETTINGS_ID}`) return;
    const go = () => document.getElementById(PROFILE_SETTINGS_ID)?.scrollIntoView?.({ block: "start" });
    go();
    const timers = [400, 1200, 2500].map((ms) => window.setTimeout(go, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [hash]);
  // Una sola fuente del avatar para toda la app (antes aquí salía la "R" y en el DNA la imagen).
  const { url: avatarUrl } = useMyAvatar();
  const prive = usePriveSeal();
  // Tu tarjeta de rango (la calcula el servidor: my_member_card), junto al avatar.
  const { card, loading: cardLoading } = useMemberCard(user?.id ?? null);
  const [fullName, setFullName] = useState<string>("");
  const [openAvatar, setOpenAvatar] = useState(false);
  const [confirmDeleteAvatar, setConfirmDeleteAvatar] = useState(false);
  const [deletingAvatar, setDeletingAvatar] = useState(false);

  // "Borrar mi avatar" (lo promete el Aviso de Privacidad): el servidor borra la imagen pública, la
  // base y las variantes privadas, profiles.avatar_url y los recuerdos del avatar.
  const deleteMyAvatar = async () => {
    setDeletingAvatar(true);
    const { data, error } = await supabase.functions.invoke("generate-avatar", { body: { action: "eliminar" } });
    setDeletingAvatar(false);
    setConfirmDeleteAvatar(false);
    if (error || !(data as { ok?: boolean } | null)?.ok) { toast.error("No pudimos borrar tu avatar. Intenta de nuevo."); return; }
    notifyAvatarUpdated(null);
    toast.success("Borramos tu avatar y sus imágenes.");
  };
  const { dna, reload } = useTravelDNA();
  const [evolving, setEvolving] = useState(false);
  const [dnaMeta, setDnaMeta] = useState<{ version: number | null; updated_at: string | null }>({
    version: null,
    updated_at: null,
  });
  const tipDNA = useTooltipShown("travel_dna_perfil");
  // Viaje que terminó hace poco y aún no da su recuerdo: se pide (idempotente en el servidor).
  useAutoEvolveAvatar(!!avatarUrl);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      setFullName((data as any)?.full_name ?? "");

      const { data: prefs } = await supabase
        .from("ai_user_preferences")
        .select("dna_version, dna_updated_at")
        .eq("user_id", user.id)
        .maybeSingle();
      setDnaMeta({
        version: (prefs as any)?.dna_version ?? null,
        updated_at: (prefs as any)?.dna_updated_at ?? null,
      });
    })();
  }, [user]);

  const evolucionar = async () => {
    setEvolving(true);
    try {
      const { error } = await supabase.functions.invoke("evolucionar-dna", { body: {} });
      if (error) throw error;
      toast.success("Perfil de viajero actualizado");
      reload();
      // refresh meta
      if (user) {
        const { data: prefs } = await supabase
          .from("ai_user_preferences")
          .select("dna_version, dna_updated_at")
          .eq("user_id", user.id)
          .maybeSingle();
        setDnaMeta({
          version: (prefs as any)?.dna_version ?? null,
          updated_at: (prefs as any)?.dna_updated_at ?? null,
        });
      }
    } catch (e: unknown) {
      // Nunca el texto técnico ("Edge Function returned a non-2xx status code"), auditoría de cuenta #16.
      const info = await readFunctionError(e, "No pudimos recalcular tu perfil de viajero. Intenta de nuevo en unos minutos.");
      toast.error(info.message);
    } finally {
      setEvolving(false);
    }
  };


  // "Evolución detectada" te habla de tú (los DNA guardados antes en tercera persona se convierten).
  const divergencias: string[] = (dnaForDisplay(dna?.perfil)?.divergencias_detectadas as string[] | undefined) ?? [];
  const evolucionMsg =
    divergencias[0] ??
    (dna && dna.tripCount > 0
      ? `Tu estilo dominante: ${dna.dominant ? DNA_ARCHETYPES[dna.dominant].label.toLowerCase() : "por descubrir"}. Sigue viajando para refinar tu perfil de viajero.`
      : "Crea tu primer viaje para activar la evolución de tu avatar.");

  const diasDesde = (iso: string | null) => {
    if (!iso) return null;
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return d;
  };
  const dias = diasDesde(dnaMeta.updated_at);

  return (
    <DashboardLayout>
      <div className="px-4 py-6 md:p-10 max-w-5xl space-y-12">
        {/* HEADER */}
        <section className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex items-center gap-5">
            <AvatarCircle url={avatarUrl} name={fullName || "Viajero"} size="md" prive={prive} />
            {/* En el celular la tarjeta va junto a tu foto, más chica; en pantallas grandes, a la derecha del nombre. */}
            {card ? (
              <div className="md:hidden w-[150px] shrink-0 -rotate-[2deg] motion-reduce:rotate-0 drop-shadow-[0_14px_20px_rgba(0,0,0,0.5)]" data-testid="profile-member-card-mobile">
                <MemberCardButton card={card} testId="profile-card-mobile" />
              </div>
            ) : null}
          </div>
          <div className="flex-1">
            <p className="text-xs text-primary tracking-[0.25em] uppercase mb-2">Tu Travel Avatar</p>
            <h1 className="font-display text-3xl md:text-4xl mb-1 flex items-center gap-2 flex-wrap">
              <span>{fullName || "Viajero"}</span>
              {prive && <PriveSeal size="md" />}
            </h1>
            <p className="text-sm mb-1 flex items-center gap-1.5" data-testid="profile-dna-archetype">
              <Crown className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
              <span className="text-muted-foreground">Perfil de viajero:</span>
              <span className="gold-text font-medium">{dna?.dominant ? DNA_ARCHETYPES[dna.dominant].label : dna ? "por descubrir" : "…"}</span>
            </p>
            {user?.email && (
              <p className="text-sm text-muted-foreground mb-3" data-testid="profile-signed-in-email">
                Sesión iniciada como <span className="text-foreground">{user.email}</span>
              </p>
            )}
            <p className="text-muted-foreground mb-4">
              {avatarUrl
                ? "Este avatar te representa en todo IATOS: perfil, viajes, social y compatibilidad."
                : "Crea tu Travel Avatar a partir de tu selfie: se parece a ti y evoluciona con cada viaje."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setOpenAvatar(true)} className="bg-gradient-gold text-primary-foreground gold-glow">
                <Wand2 className="w-4 h-4 mr-2" />
                {avatarUrl ? "Cambiar mi avatar" : "Crear mi avatar"}
              </Button>
              {avatarUrl && (
                <Button variant="ghost" onClick={() => setConfirmDeleteAvatar(true)} disabled={deletingAvatar}
                  className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" /> Borrar mi avatar
                </Button>
              )}
            </div>
          </div>
          {/* Tu tarjeta de rango a un lado del avatar (al tocarla se abre grande). */}
          {card || cardLoading ? (
            <div className="hidden md:block w-[280px] max-w-full shrink-0 self-center md:-rotate-[2deg] motion-reduce:rotate-0 drop-shadow-[0_18px_24px_rgba(0,0,0,0.5)]" data-testid="profile-member-card">
              <MemberCardButton card={card} loading={cardLoading} testId="profile-card" />
            </div>
          ) : null}
        </section>

        {/* IATOS Wrapped: tu año en viajes */}
        <ProfileWrappedLink today={localISODate()} />

        {/* TRAVEL DNA — HERO */}
        <section className="glass-card rounded-3xl p-6 md:p-8 border border-primary/20 gold-glow space-y-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-2 flex items-center gap-2">
                <Crown className="w-3 h-3" /> Tu identidad de viajero
              </p>
              <h2 className="font-display text-3xl md:text-5xl">Tu perfil de viajero</h2>
              <p className="text-xs md:text-sm gold-text mt-2">
                Evoluciona con cada viaje
                {dnaMeta.version != null && <> · Versión {dnaMeta.version}</>}
                {dias != null && <> · {dnaUpdatedLabel(dias)}</>}
              </p>
            </div>
            <Button
              onClick={evolucionar}
              disabled={evolving}
              className="bg-gradient-gold text-primary-foreground gold-glow"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${evolving ? "animate-spin" : ""}`} />
              {evolving ? "Recalculando…" : "✨ Recalcular mi perfil de viajero"}
            </Button>
          </div>

          {tipDNA.shouldShow && (
            <InlineTooltip
              id="travel_dna_perfil"
              icon="✨"
              text="Tu perfil de viajero evoluciona cada 3 viajes automáticamente. También lo puedes recalcular manual aquí."
              position="inline"
              onDismiss={tipDNA.dismiss}
            />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* AVATAR CINEMATICO */}
            <div className="lg:col-span-2">
              <TravelAvatarCinematic dna={dna} onEditAvatar={() => setOpenAvatar(true)} />
              <p className="text-xs text-muted-foreground mt-2 px-1">
                {dna
                  ? `${dna.tripCount} viajes · ${dna.visitCount} lugares · tu perfil evoluciona con cada experiencia`
                  : "Cargando tu identidad..."}
              </p>
            </div>

            {/* DNA STATS */}
            <div className="glass-card rounded-3xl p-5">
              <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-3 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" /> Perfil de viajero
              </p>
              {dna ? (
                <TravelDNAStats dna={dna} />
              ) : (
                <p className="text-xs text-muted-foreground">Cargando…</p>
              )}
            </div>

            {/* EVOLUCIÓN */}
            <div className="glass-card rounded-3xl p-5 lg:col-span-2 border border-primary/15">
              <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-2 flex items-center gap-1.5">
                <TrendingUp className="w-3 h-3" /> Evolución detectada
              </p>
              <p className="text-sm md:text-base leading-relaxed text-foreground/90">{evolucionMsg}</p>
              {divergencias.length > 1 && (
                <ul className="mt-3 text-xs text-muted-foreground list-disc pl-4 space-y-1">
                  {divergencias.slice(1, 4).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* VIAJES PASADOS */}
            <Link
              to="/dashboard/viajes/importar"
              className="glass-card rounded-3xl p-5 border border-primary/15 hover:border-primary/40 transition flex items-start gap-3 lg:col-span-3"
            >
              <FileUp className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                <span className="block font-medium">Sube un viaje que ya hiciste</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Boletos, pases de abordar o reservas de hotel: la IA arma el viaje con lo que pagaste, lo guarda en Mis viajes y tu avatar gana un detalle del destino.
                </span>
              </span>
            </Link>

            {/* COMPATIBILIDAD */}
            <div className="glass-card rounded-3xl p-5">
              <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-3">Compatibilidad de viaje</p>
              <CompatibilityPanel />
            </div>

            {/* MEJORES MOMENTOS */}
            <div className="glass-card rounded-3xl p-5 lg:col-span-3">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <p className="text-[10px] tracking-[0.3em] text-primary uppercase">Mejores momentos</p>
                <p className="text-[10px] text-muted-foreground">
                  Sube fotos de tus mejores viajes — Iato aprende qué te encanta
                </p>
              </div>
              <BestMomentsPanel />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            Tu perfil de viajero se recalcula automáticamente cada 3 viajes. Si quieres hacerlo ahora,{" "}
            <button type="button" onClick={evolucionar} disabled={evolving} className="text-primary underline underline-offset-2 disabled:opacity-60">
              recalcúlalo aquí
            </button>.
          </p>
        </section>

        {/* PERFIL DE GUSTOS */}
        <section>
          <h2 className="font-display text-2xl md:text-3xl mb-3">Perfil de gustos</h2>
          <p className="text-muted-foreground mb-6">
            Actualiza tus preferencias y la IA recalibrará todas las recomendaciones.
          </p>
          <Button
            onClick={() => navigate("/onboarding/deep")}
            variant="outline"
            className="border-primary/40 hover:bg-primary/10"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Editar mis preferencias
          </Button>
        </section>

        {/* QUÉ VEN MIS AMIGOS (Social): avatar, viajes y actividad que comparto */}
        <FriendsPrivacySection />

        {/* BÓVEDA */}
        <section>
          <div className="mb-6">
            <p className="text-xs text-primary tracking-[0.25em] uppercase mb-2">Premium</p>
            <h2 className="font-display text-3xl md:text-4xl mb-2">Tus tarjetas y programas</h2>
            <p className="text-muted-foreground">
              Guarda tus tarjetas, membresías y seguros. Cuando le pides a Iato un resumen o buscar promociones,
              solo usa el nombre, el nivel y los beneficios de cada programa; tus documentos y números nunca se envían a la IA.
            </p>
          </div>
          <BenefitsVault />
        </section>

        {/* PROMOCIONES */}
        <section>
          <PromocionesActivas />
        </section>

        <InviteFriendsCard />

        {isAdmin && (
          <button
            type="button"
            onClick={() => navigate("/dashboard/admin")}
            className="w-full glass-card rounded-xl p-5 flex items-center gap-3 text-left hover:border-primary/40 transition"
          >
            <BarChart3 className="w-5 h-5 text-primary shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Panel de métricas</p>
              <p className="text-xs text-muted-foreground">Usuarios, viajes, reservas y crecimiento en vivo</p>
            </div>
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={() => navigate("/dashboard/admin/operaciones")}
            className="w-full glass-card rounded-xl p-5 flex items-center gap-3 text-left hover:border-primary/40 transition"
          >
            <Inbox className="w-5 h-5 text-primary shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Mesa de operaciones</p>
              <p className="text-xs text-muted-foreground">Solicitudes que atiende una persona del equipo</p>
            </div>
          </button>
        )}

        {/* AJUSTES (auditoría de cuenta #18): el engrane del encabezado abría el mismo Perfil que el avatar.
            Ahora lleva aquí (#ajustes), con los ajustes que sí existen; no se inventan otros. */}
        <section id={PROFILE_SETTINGS_ID} className="scroll-mt-20 space-y-4" aria-labelledby="ajustes-title" data-testid="profile-settings">
          <div>
            <p className="text-xs text-primary tracking-[0.25em] uppercase mb-2">Cuenta</p>
            <h2 id="ajustes-title" className="font-display text-2xl md:text-3xl">Ajustes</h2>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            <li><Link to="/dashboard/pro" className="block glass-card rounded-xl p-4 hover:border-primary/40 transition"><span className="block font-medium">Plan y facturación</span><span className="block text-xs text-muted-foreground mt-0.5">Tu plan IATOS PRO y, si pagas, el portal de Stripe.</span></Link></li>
            <li><button type="button" onClick={() => navigate("/onboarding/deep")} className="w-full text-left glass-card rounded-xl p-4 hover:border-primary/40 transition"><span className="block font-medium">Preferencias de viaje</span><span className="block text-xs text-muted-foreground mt-0.5">Lo que {withIatoMark("Iato")} usa para recomendarte.</span></button></li>
            <li><Link to="/dashboard/perfil#que-ven-mis-amigos" className="block glass-card rounded-xl p-4 hover:border-primary/40 transition"><span className="block font-medium">Privacidad con tus amigos</span><span className="block text-xs text-muted-foreground mt-0.5">Qué ven de ti en Social.</span></Link></li>
            <li><button type="button" onClick={openCookieSettings} className="w-full text-left glass-card rounded-xl p-4 hover:border-primary/40 transition"><span className="block font-medium">Cookies y analítica</span><span className="block text-xs text-muted-foreground mt-0.5">Cambia lo que aceptaste en el aviso de cookies.</span></button></li>
          </ul>
        </section>

        <DeleteAccountSection />

        <section className="pt-6 border-t border-white/[0.06] flex justify-center">
          <Button
            variant="outline"
            onClick={async () => {
              await signOut();
              navigate("/");
            }}
            className="rounded-full border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/[0.04] gap-2 px-6"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </Button>
        </section>
      </div>

      <Dialog open={openAvatar} onOpenChange={setOpenAvatar}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-background border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Tu Travel Avatar</DialogTitle>
          </DialogHeader>
          <AvatarCreator
            onComplete={(url) => {
              // generate-avatar ("elegir") ya lo guardó con la llave de servicio: profiles.avatar_url
              // solo la escribe el servidor (N-L1). Aquí solo se avisa.
              if (url) toast.success("¡Avatar actualizado en todo IATOS!");
              setOpenAvatar(false);
            }}
            onSkip={() => setOpenAvatar(false)}
          />
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmDeleteAvatar} onOpenChange={setConfirmDeleteAvatar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar tu Travel Avatar?</AlertDialogTitle>
            <AlertDialogDescription>
              Borramos la imagen que ven tus amigos, la imagen base y las versiones guardadas, y los recuerdos de viaje dibujados en él.
              Tus viajes no se tocan. Puedes crear otro cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteMyAvatar()} disabled={deletingAvatar}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Borrar mi avatar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default Profile;
