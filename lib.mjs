import { scryptSync, randomBytes, randomInt, timingSafeEqual, createHmac } from "node:crypto";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const norm = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
const toSlug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ---------- crypto ---------- */
const hashPw = (pw, salt) => scryptSync(pw, salt, 64);
function safeEq(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && timingSafeEqual(A, B);
}
function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verify(token, secret) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const good = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEq(mac, good)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

/* ---------- tirage ---------- */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// members: [{slug, foyer}] -> { giverSlug: receiverSlug } ou null si impossible
export function makeDraw(members) {
  const givers = members.map((m) => m.slug);
  const foyerOf = Object.fromEntries(members.map((m) => [m.slug, norm(m.foyer)]));
  for (let t = 0; t < 50000; t++) {
    const rec = shuffle(givers);
    const ok = givers.every((g, i) => {
      const r = rec[i];
      if (r === g) return false;
      return !(foyerOf[g] && foyerOf[g] === foyerOf[r]);
    });
    if (ok) return Object.fromEntries(givers.map((g, i) => [g, rec[i]]));
  }
  return null;
}

/* ---------- validation ---------- */
function cleanWishes(input) {
  if (!Array.isArray(input) || input.length > 40) throw new HttpError(400, "Liste invalide (40 idées maximum).");
  return input.map((w) => {
    const title = String(w?.title || "").trim().slice(0, 120);
    if (!title) throw new HttpError(400, "Chaque idée doit avoir un titre.");
    let url = String(w?.url || "").trim().slice(0, 500);
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    if (url) { try { new URL(url); } catch { url = ""; } }
    return {
      id: typeof w?.id === "string" && /^[a-z0-9]{4,40}$/.test(w.id) ? w.id : randomBytes(6).toString("hex"),
      title,
      url,
      note: String(w?.note || "").trim().slice(0, 300),
    };
  });
}

/* ---------- handler ---------- */
export async function handle(req, store, env) {
  try {
    return await route(req, store, env);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Erreur serveur" }, 500);
  }
}

async function route(req, store, env) {
  if (!env.SESSION_SECRET || !env.FAMILY_CODE)
    throw new HttpError(500, "Configuration manquante : SESSION_SECRET et FAMILY_CODE.");

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const method = req.method;

  let body = {};
  if (method === "POST" || method === "PUT") {
    const raw = await req.text();
    try { body = raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, "Requête invalide."); }
  }

  const getUser = (slug) => store.get(`users/${slug}`, { type: "json" });
  const putUser = (slug, u) => store.setJSON(`users/${slug}`, u);
  const getMeta = async () => (await store.get("meta", { type: "json" })) || { organizer: null, drawn: false };
  const token = (slug) => sign({ u: slug, exp: Date.now() + 1000 * 60 * 60 * 24 * 60 }, env.SESSION_SECRET);

  /* --- public --- */
  if (method === "POST" && path === "/signup") {
    const name = String(body.name || "").trim().replace(/\s+/g, " ");
    const slug = toSlug(name);
    const password = String(body.password || "");
    if (name.length < 2 || name.length > 40 || !slug) throw new HttpError(400, "Prénom invalide (2 à 40 caractères).");
    if (password.length < 6) throw new HttpError(400, "Mot de passe : 6 caractères minimum.");
    if (!safeEq(norm(body.code), norm(env.FAMILY_CODE))) throw new HttpError(403, "Code famille incorrect.");
    const meta = await getMeta();
    if (meta.drawn) throw new HttpError(403, "Le tirage a déjà eu lieu : demande à l'organisateur.");
    if (await getUser(slug)) throw new HttpError(409, "Ce prénom existe déjà. Ajoute ton initiale (ex. « Marie L »).");
    const salt = randomBytes(16).toString("hex");
    await putUser(slug, {
      name,
      foyer: String(body.foyer || "").trim().slice(0, 40),
      salt,
      hash: hashPw(password, salt).toString("hex"),
      wishes: [],
      createdAt: Date.now(),
    });
    if (!meta.organizer) await store.setJSON("meta", { ...meta, organizer: slug });
    return json({ token: token(slug) });
  }

  if (method === "POST" && path === "/login") {
    const slug = toSlug(body.name);
    const u = slug ? await getUser(slug) : null;
    const salt = u?.salt || "0".repeat(32);
    const h = hashPw(String(body.password || ""), salt).toString("hex");
    if (!u || !safeEq(h, u.hash)) throw new HttpError(401, "Prénom ou mot de passe incorrect.");
    return json({ token: token(slug) });
  }

  /* --- authentifié --- */
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const payload = verify(auth, env.SESSION_SECRET);
  const meSlug = payload?.u;
  const me = meSlug ? await getUser(meSlug) : null;
  if (!me) throw new HttpError(401, "Session expirée.");
  const meta = await getMeta();
  const isOrganizer = meta.organizer === meSlug;
  const requireOrganizer = () => { if (!isOrganizer) throw new HttpError(403, "Réservé à l'organisateur."); };

  async function allMembers() {
    const { blobs } = await store.list({ prefix: "users/" });
    const users = await Promise.all(
      blobs.map(async (b) => ({ slug: b.key.slice(6), ...(await store.get(b.key, { type: "json" })) }))
    );
    return users.filter((u) => u.name).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }

  if (method === "GET" && path === "/me") {
    let target = null;
    if (meta.drawn) {
      const draw = await store.get("draw", { type: "json" });
      const t = draw?.assignments?.[meSlug];
      const tu = t ? await getUser(t) : null;
      if (tu) target = { slug: t, name: tu.name, wishes: tu.wishes };
    }
    return json({ slug: meSlug, name: me.name, foyer: me.foyer, wishes: me.wishes, isOrganizer, drawn: !!meta.drawn, target });
  }

  if (method === "PUT" && path === "/me") {
    me.foyer = String(body.foyer || "").trim().slice(0, 40);
    if (meta.drawn) throw new HttpError(409, "Le tirage a déjà eu lieu.");
    await putUser(meSlug, me);
    return json({ ok: true });
  }

  if (method === "PUT" && path === "/me/wishes") {
    me.wishes = cleanWishes(body.wishes);
    await putUser(meSlug, me);
    return json({ wishes: me.wishes });
  }

  if (method === "GET" && path === "/members") {
    const users = await allMembers();
    return json({
      drawn: !!meta.drawn,
      members: users.map((u) => ({
        slug: u.slug, name: u.name, foyer: u.foyer || "", wishCount: u.wishes.length,
        organizer: u.slug === meta.organizer,
      })),
    });
  }

  const mm = path.match(/^\/members\/([a-z0-9-]+)$/);
  if (method === "GET" && mm) {
    const u = await getUser(mm[1]);
    if (!u) throw new HttpError(404, "Introuvable.");
    return json({ slug: mm[1], name: u.name, wishes: u.wishes });
  }

  /* --- organisateur --- */
  if (method === "POST" && path === "/draw") {
    requireOrganizer();
    if (meta.drawn) throw new HttpError(409, "Le tirage a déjà été fait.");
    const users = await allMembers();
    if (users.length < 3) throw new HttpError(400, "Il faut au moins 3 participants.");
    const assignments = makeDraw(users);
    if (!assignments)
      throw new HttpError(400, "Tirage impossible avec ces familles (une famille est trop grande). Modifie les familles.");
    await store.setJSON("draw", { assignments, at: Date.now() });
    await store.setJSON("meta", { ...meta, drawn: true });
    return json({ ok: true, count: users.length });
  }

  if (method === "POST" && path === "/draw/reset") {
    requireOrganizer();
    await store.delete("draw");
    await store.setJSON("meta", { ...meta, drawn: false });
    return json({ ok: true });
  }

  const pm = path.match(/^\/members\/([a-z0-9-]+)\/password$/);
  if (method === "POST" && pm) {
    requireOrganizer();
    const u = await getUser(pm[1]);
    if (!u) throw new HttpError(404, "Introuvable.");
    const pw = String(body.password || "");
    if (pw.length < 6) throw new HttpError(400, "Mot de passe : 6 caractères minimum.");
    u.salt = randomBytes(16).toString("hex");
    u.hash = hashPw(pw, u.salt).toString("hex");
    await putUser(pm[1], u);
    return json({ ok: true });
  }

  const dm = path.match(/^\/members\/([a-z0-9-]+)$/);
  if (method === "DELETE" && dm) {
    requireOrganizer();
    if (meta.drawn) throw new HttpError(409, "Réinitialise le tirage avant de supprimer quelqu'un.");
    if (dm[1] === meSlug) throw new HttpError(400, "Tu ne peux pas te supprimer toi-même.");
    await store.delete(`users/${dm[1]}`);
    return json({ ok: true });
  }

  throw new HttpError(404, "Route inconnue.");
}
