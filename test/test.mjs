import assert from "node:assert/strict";
import { handle, makeDraw } from "../netlify/functions/lib.mjs";

const mem = new Map();
const store = {
  async get(k) { return mem.has(k) ? JSON.parse(mem.get(k)) : null; },
  async setJSON(k, v) { mem.set(k, JSON.stringify(v)); },
  async delete(k) { mem.delete(k); },
  async list({ prefix }) { return { blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
};
const env = { SESSION_SECRET: "s3cret", FAMILY_CODE: "Noel2026" };
const call = async (method, path, body, token) => {
  const r = await handle(new Request("http://x/api" + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: token ? { authorization: "Bearer " + token } : {},
  }), store, env);
  return { status: r.status, data: await r.json() };
};

// inscription
const names = ["Papa","Maman","Léa","Hugo","Mamie","Papi","Tonton Éric","Tata Sophie","Clara","Noé","Zoé","Lucas"];
const foyers = { Papa:"Grossmann", Maman:"Grossmann", Léa:"Grossmann", Hugo:"Grossmann", "Tonton Éric":"Éric", "Tata Sophie":"Éric", Mamie:"M", Papi:"M" };
const tokens = {};
let r = await call("POST","/signup",{name:"Papa",password:"abcdef",code:"mauvais"});
assert.equal(r.status,403);
for (const n of names) {
  r = await call("POST","/signup",{name:n,password:"motdepasse",code:"noel2026",foyer:foyers[n]||""});
  assert.equal(r.status,200,n); tokens[n]=r.data.token;
}
assert.equal((await call("POST","/signup",{name:"papa",password:"abcdef",code:"noel2026"})).status,409);
assert.equal((await call("POST","/login",{name:"léa",password:"nope12"})).status,401);
r = await call("POST","/login",{name:"LÉA",password:"motdepasse"}); assert.equal(r.status,200);

// sans token
assert.equal((await call("GET","/me")).status,401);

// organisateur = premier inscrit
r = await call("GET","/me",null,tokens.Papa); assert.equal(r.data.isOrganizer,true);
r = await call("GET","/me",null,tokens.Léa); assert.equal(r.data.isOrganizer,false);
assert.equal((await call("POST","/draw",{},tokens.Léa)).status,403);

// listes
r = await call("PUT","/me/wishes",{wishes:[{title:"Livre",url:"amazon.fr/x",note:"poche"}]},tokens.Léa);
assert.equal(r.status,200); assert.equal(r.data.wishes[0].url,"https://amazon.fr/x");
assert.equal((await call("PUT","/me/wishes",{wishes:[{title:""}]},tokens.Léa)).status,400);

// tirage
assert.equal((await call("GET","/me",null,tokens.Papa)).data.target,null);
r = await call("POST","/draw",{},tokens.Papa); assert.equal(r.status,200);
assert.equal((await call("POST","/draw",{},tokens.Papa)).status,409);
assert.equal((await call("POST","/signup",{name:"Retard",password:"abcdef",code:"noel2026"})).status,403);
const targets = {};
for (const n of names) {
  r = await call("GET","/me",null,tokens[n]);
  assert.ok(r.data.target, n);
  targets[n] = r.data.target.name;
  assert.notEqual(targets[n], n);
  if (foyers[n]) assert.notEqual(foyers[targets[n]], foyers[n], `${n} -> ${targets[n]} même famille`);
}
assert.equal(new Set(Object.values(targets)).size, names.length, "chacun tiré exactement une fois");
// la cible de Papa voit la liste de Léa si Léa
for (const n of names) if (targets[n]==="Léa") assert.equal((await call("GET","/me",null,tokens[n])).data.target.wishes.length,1);

// pas de fuite de qui m'a tiré / hash
r = await call("GET","/members",null,tokens.Léa);
assert.ok(!JSON.stringify(r.data).includes("hash")); assert.ok(!JSON.stringify(r.data).includes("assign"));

// reset
assert.equal((await call("POST","/draw/reset",{},tokens.Papa)).status,200);
assert.equal((await call("GET","/me",null,tokens.Léa)).data.target,null);

// algo : famille trop grosse
assert.equal(makeDraw([{slug:"a",foyer:"x"},{slug:"b",foyer:"x"},{slug:"c",foyer:"x"}]),null);
// 30 personnes, 40 foyers de 2 : toujours une solution, un seul cycle non requis
for (let i=0;i<200;i++){
  const ms = Array.from({length:30},(_,k)=>({slug:"p"+k,foyer:"f"+Math.floor(k/2)}));
  const d = makeDraw(ms); assert.ok(d);
  assert.equal(new Set(Object.values(d)).size,30);
  for (const [g,t] of Object.entries(d)) assert.notEqual(Math.floor(g.slice(1)/2),Math.floor(t.slice(1)/2));
}
console.log("✅ tous les tests passent");
