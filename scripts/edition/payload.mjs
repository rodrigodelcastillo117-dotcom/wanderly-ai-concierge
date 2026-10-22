// Construye, a partir del JSON editorial, la MISMA forma que devuelve prive_edition_issue (o
// edition_admin_preview). Solo para pruebas, capturas con datos simulados y la evidencia del PDF: la app real
// siempre lee del servidor. Mantener en sincronía con edition_article_json / edition_issue_json.
export function bodyWords(body) {
  let n = 0;
  const count = (s) => (s && s.trim() ? s.trim().split(/\s+/).length : 0);
  for (const b of body ?? []) {
    if (b.es) n += count(b.es);
    if (b.t === "facts") for (const it of b.items ?? []) n += count([it.label?.es, it.value?.es].filter(Boolean).join(" "));
    if (b.t === "agenda") for (const it of b.items ?? []) n += count(it.es);
  }
  return n;
}

/**
 * @param doc JSON de data/prive/edition/issue-NN.json
 * @param opts.preview  true = forma de la vista previa del editor (estados y licencias visibles)
 * @param opts.approvedImages  claves de imagen con licencia aprobada (por omisión: todas)
 * @param opts.publishedAt     fecha de publicación simulada
 */
export function payloadFromDoc(doc, opts = {}) {
  const approved = new Set(opts.approvedImages ?? doc.images.map((i) => i.key));
  const preview = !!opts.preview;
  const sources = new Map(doc.sources.map((s) => [s.key, s]));
  const imgOk = (k) => preview || approved.has(k);
  const imageJson = (i) => ({
    key: i.key, provider: i.provider, url: i.url, page_url: i.page_url, photographer: i.photographer, photographer_url: i.photographer_url,
    license: i.license, license_url: i.license_url, illustrative: i.illustrative, depicts: i.depicts, alt: i.alt, focal: i.focal,
    allow_pdf: i.allow_pdf, allow_offline: i.allow_offline, ...(preview ? { license_status: approved.has(i.key) ? "approved" : "pending" } : {}),
  });
  const today = opts.today ?? "2026-10-22";
  const articles = doc.articles.map((a, idx) => {
    const keys = [a.hero_image, ...a.body.filter((b) => b.t === "img").map((b) => b.image)].filter(Boolean);
    const words = bodyWords(a.body);
    return {
      slug: a.slug, issue: doc.issue.slug, section: a.section, format: a.format, topics: a.topics, kicker: a.kicker, title: a.title, dek: a.dek,
      byline: a.byline, ...(a.hero_image && imgOk(a.hero_image) ? { hero_image: a.hero_image } : {}), fact_status: a.fact_status,
      sensitive: a.sensitive, ...(a.fact_date ? { fact_date: a.fact_date } : {}), ...(a.valid_until ? { valid_until: a.valid_until } : {}),
      ...(a.valid_until && a.valid_until < today ? { expired: true } : {}),
      destinations: a.destinations, reading_minutes: Math.max(1, Math.ceil(words / 220)), word_count: words, sort_order: (idx + 1) * 10,
      version: 1, drafted_by: "claude", ...(preview ? { status: "pending_review" } : { published_at: opts.publishedAt ?? "2026-11-01T12:00:00Z", approved_by_label: "Dirección editorial IATOS Privé" }),
      body: a.body.filter((b) => b.t !== "img" || imgOk(b.image)), actions: a.actions,
      image_keys: keys.filter(imgOk),
      sources: a.sources.map((s) => {
        const src = sources.get(s.key);
        return { key: src.key, kind: src.kind, entity: src.entity, ...(src.author ? { author: src.author } : {}), title: src.title, url: src.url,
          ...(src.published_at ? { published_at: src.published_at } : {}), consulted_at: src.consulted_at, used_for: s.used_for, data_used: src.data_used,
          reuse_rights: src.reuse_rights, attribution: src.attribution, ...(src.distribution_restrictions ? { distribution_restrictions: src.distribution_restrictions } : {}),
          link_status: "unchecked" };
      }),
    };
  });
  const images = {};
  for (const i of doc.images) if (imgOk(i.key)) images[i.key] = imageJson(i);
  return {
    found: true, ...(preview ? { preview: true } : {}),
    issue: { slug: doc.issue.slug, number: doc.issue.number, period_start: doc.issue.period_start, period_label: doc.issue.period_label, title: doc.issue.title,
      cover_line: doc.issue.cover_line, ...(imgOk(doc.issue.cover_image) ? { cover_image: doc.issue.cover_image } : {}), cover_article: doc.issue.cover_article,
      research_closed_at: doc.issue.research_closed_at, version: 1, ...(preview ? { status: "pending_review", plan: doc.issue.plan } : { published_at: opts.publishedAt ?? "2026-11-01T12:00:00Z" }) },
    articles, images, retracted: [], saved: [], generated_at: opts.generatedAt ?? "2026-11-01T12:00:00Z",
  };
}
