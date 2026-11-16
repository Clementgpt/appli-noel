# 🎄 Noël en famille

Tirage au sort secret + listes de cadeaux, pour toute la famille. Hébergé sur Netlify (gratuit).

## Mise en ligne (≈10 min)

1. Crée un dépôt GitHub et pousse ce dossier dedans (ou utilise `netlify deploy --prod` avec la CLI).
2. Sur netlify.com : **Add new site → Import an existing project** → choisis le dépôt. Rien à changer dans les réglages de build.
3. **Site configuration → Environment variables**, ajoute :
   - `SESSION_SECRET` : une longue phrase au hasard (ex. 40 caractères) — sert à sécuriser les connexions.
   - `FAMILY_CODE` : le code que tu donneras à la famille pour s'inscrire (ex. `Noel2026`).
4. Redéploie le site (Deploys → Trigger deploy).
5. **Le premier compte créé devient l'organisateur** : inscris-toi en premier, puis envoie le lien + le code à la famille.

## Utilisation

- Chacun crée son compte (prénom, mot de passe, code famille, nom de sa famille).
- Le champ « famille » évite que les membres d'une même famille se tirent entre eux : écrire exactement le même nom.
- Chacun remplit sa liste de cadeaux (idées + liens).
- Quand tout le monde est inscrit, l'organisateur clique sur **Lancer le tirage**. Chacun voit uniquement la personne qu'il a tirée, et sa liste.
- L'organisateur ne voit pas non plus qui a tiré qui (l'API ne le permet pas).
- Mot de passe oublié : l'organisateur peut le réinitialiser dans l'onglet Organisation.

## Tests

`npm install && npm test` (le tirage, les familles, la confidentialité).
