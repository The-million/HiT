# openGym pour notre groupe — Vercel + Neon

Cette version prépare openGym pour un petit groupe d'amis, avec le français par défaut. L'interface et l'API tournent sur Vercel ; PostgreSQL conserve les comptes et les séances. Neon se crée depuis le tableau de bord Vercel : aucun serveur Docker à administrer.

## Ce que contient la V1

- Comptes par mot de passe ou passkey, profils séparés, invitations à usage unique.
- Premier compte administrateur protégé par une invitation initiale.
- Programmes, séances, historique, poids, statistiques et synchronisation entre appareils.
- Catalogue et animations d'exercices inclus dans le déploiement.
- Coach IA, notifications en arrière-plan et envoi de médias personnels désactivés. Le minuteur à l'écran reste utilisable. Les médias personnels ne sont pas sauvegardés dans le cloud par cette V1.

## Instance du groupe

- Site de production : https://opengym-the-million.vercel.app
- Code source : https://github.com/The-million/openGym
- Projet Vercel : `opengym-the-million`, sur le compte `glodinonde-7955s-projects`.
- Base Neon : `opengym-amis-db`, offre gratuite, région Singapour (`sin1`), connectée uniquement à Production.
- Branche de production : `main`. La branche locale de personnalisation est `personnalisation-fr`.
- Le code du premier compte est conservé uniquement sur ce Mac dans `.vercel/invitation-initiale.txt`, fichier exclu de Git. Aucun secret n'est dans ce guide.

## 1. Publier les modifications suivantes

Le fork GitHub et sa connexion Vercel sont configurés. Après modification et vérification :

```sh
git add <fichiers-modifies>
git commit -m "Décrire la modification"
git push origin personnalisation-fr
# Publier en production si main n'a pas divergé :
git push origin personnalisation-fr:main
```

Les mises à jour de `main` déclenchent le déploiement Vercel. Les fichiers `.env`, `.env.local`, `.vercel/` et les données locales sont ignorés. Les étapes suivantes restent utiles pour recréer l'instance.

## 2. Importer dans Vercel

1. **Add New → Project → Import Git Repository**, puis sélectionner ton fork.
2. **Root Directory : `deployment`**, avec **Include source files outside of the Root Directory in the Build Step** activé. Cela évite que Vercel transforme les modules internes du dossier `api` en fonctions indépendantes.
3. **Framework Preset : Other**. Node.js **22.x**. Le fichier `deployment/vercel.json` définit déjà l'installation et la compilation ; ne pas ajouter d'Output Directory manuellement.
4. Utiliser `main` comme branche de production.
5. Choisir le nom du projet et relever son adresse de production stable, par exemple `https://mon-groupe-gym.vercel.app`.

Un premier déploiement sans configuration peut afficher l'interface, mais l'API répondra 503 jusqu'aux étapes suivantes. Ce n'est pas encore une instance prête à utiliser.

## 3. Connecter Neon depuis Vercel

Dans le projet, **Storage / Marketplace → Neon → Create / Connect**. Choisir une région proche de celle de la fonction Vercel. Connecter la base à l'environnement **Production**. L'intégration fournit `DATABASE_URL` ; utiliser la connexion PostgreSQL avec pool et TLS (`sslmode=require`).

La table `opengym_instance` est créée automatiquement au premier appel de l'API. Le rôle de base de données doit pouvoir créer cette table. Aucun SQL à copier pour le premier lancement.

Documentation : [PostgreSQL sur Vercel](https://vercel.com/docs/postgres), [Neon dans Vercel](https://vercel.com/marketplace/neon/neon).

## 4. Configurer les variables

Dans **Settings → Environment Variables**, environnement **Production** :

| Variable | Valeur |
| --- | --- |
| `DATABASE_URL` | Injectée par Neon ; ne pas la préfixer par `VITE_` |
| `ORIGIN` | Adresse HTTPS de production, sans `/` final |
| `RP_ID` | Le même nom de domaine, sans `https://` ni chemin |
| `SESSION_SECRET` | Secret aléatoire de 64 caractères hexadécimaux |
| `BOOTSTRAP_INVITE_CODE` | Code aléatoire de 32 caractères hexadécimaux MAJUSCULES |

Pour générer chaque valeur dans ton terminal (copier les résultats uniquement dans Vercel) :

```sh
openssl rand -hex 32
openssl rand -hex 16 | tr '[:lower:]' '[:upper:]'
```

Le premier résultat est `SESSION_SECRET`, le second `BOOTSTRAP_INVITE_CODE`. Ce code servira à créer **ton** compte : garde-le pour toi. Ne pas remplacer ces variables à chaque déploiement. Changer le secret déconnecte les sessions existantes.

Valeurs déjà appliquées par défaut par l'API Vercel : `DEFAULT_LANG=fr`, `FIRST_USER_ADMIN=1`, `INVITE_ONLY=1`, `ALLOW_GUEST=0`, `PASSWORD_LOGIN=1`. Un modèle complet est disponible dans [`.env.vercel.example`](../.env.vercel.example).

Lancer **Redeploy** après la connexion à Neon et l'ajout des variables. Utiliser le domaine de production défini dans `ORIGIN` pour les comptes et les passkeys. Les URL de preview ne doivent pas partager la base de production ; prévoir une base/branche Neon et une configuration distinctes pour des previews fonctionnelles.

## 5. Créer ton compte et inviter tes amis

1. Ouvrir l'adresse de production ; `/api/health` doit répondre 200 avec `ok: true`.
2. Créer ton profil avec `BOOTSTRAP_INVITE_CODE`. Il devient administrateur.
3. Dans **Paramètres → Administration**, générer un code d'invitation par ami.
4. Chacun crée son propre compte et enregistre ses propres séances.
5. Vérifier une séance sur un second appareil connecté au même compte avant de partager plus largement.

Le code initial est consommé une seule fois. Les invitations utilisées ne sont pas recréées à chaque démarrage. Comme dans openGym d'origine, l'administrateur peut consulter les profils et historiques depuis le tableau de bord.

## Développement et validation

Node.js 22 requis. Depuis la racine :

```sh
npm ci --prefix frontend --ignore-scripts
npm ci --prefix api --omit=optional
node --test api/test/serverless-postgres.test.js
node scripts/build-vercel.mjs
```

Le build produit `.vercel/output` avec une seule fonction API et les fichiers statiques. Les secrets sont lus à l'exécution, jamais intégrés à l'interface. Les tests dédiés utilisent PostgreSQL embarqué (PGlite), sans compte Neon ni données réelles.

## Fonctionnement et limites

Cette adaptation conserve les règles de synchronisation et d'authentification d'openGym. Chaque requête utilise une transaction PostgreSQL verrouillant le document de l'instance. Le client ne reçoit une confirmation qu'après validation de la transaction. Les défis passkey et les limites de tentatives de connexion sont également conservés en base, y compris entre deux instances Vercel.

Ce choix vise un petit groupe : le document complet est lu et réécrit par requête, et les requêtes sont sérialisées. Ce n'est pas une architecture destinée à des centaines d'utilisateurs simultanés. Corps et réponses API limités à 4 Mio ; de très gros historiques/imports devront être adaptés avant d'atteindre cette limite. L'interface garde les changements non synchronisés pour réessayer si la base est indisponible.

Les sauvegardes de l'instance se font côté PostgreSQL/Neon, plus les exports JSON personnels dans l'application. Le dossier Docker `data/` n'est pas utilisé par le déploiement Vercel. Une ancienne instance Docker nécessite une migration explicite ; cette V1 démarre avec une base vide.

Le déploiement réel et les accès à Neon ont été vérifiés le 16 octobre 2026. La première création de compte reste à faire par le propriétaire avec son invitation privée ; les passkeys sur téléphone et la synchronisation d'une vraie séance entre deux appareils restent à valider avec ce compte. Le tableau de bord d'administration conserve pour cette V1 les libellés anglais du projet original.

### Vérifications effectuées sur cette version

- Build Vercel terminé, avec 6 554 images et 6 554 animations.
- Import de la fonction empaquetée vérifié sans écoute de port ni dossier de données accessible en écriture.
- 25 tests API ciblés réussis, dont 9 scénarios PostgreSQL/Vercel ; 14 tests de langue réussis.
- Suite API complète comparée au commit original `e348fc17` : 10 échecs également présents dans l'original, autour du coach IA désactivé pour cette V1. Le test de durabilité affecté par la nouvelle abstraction a été adapté et repasse.
- Déploiement de production Vercel réussi, avec une seule fonction dans l'offre Hobby.
- En production : `/api/health` répond 200 avec `ok: true` et `writable: true` ; `/api/config` confirme le français, les invitations obligatoires, les mots de passe et l'absence de mode invité. Les données sans connexion répondent 401.
- Écran de connexion français vérifié visuellement dans Chrome sur le domaine public.
- Base Neon réelle : connexion, écritures concurrentes et rollback testés dans un schéma temporaire séparé, supprimé après vérification. Aucun compte de test créé dans l'instance de production.
