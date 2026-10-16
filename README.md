# HiT

<img src="frontend/public/brand/hit-logo.png" alt="HiT" width="360">

HiT est notre application de musculation en français, basée sur [openGym](https://github.com/DuarteSantos8/openGym). Elle conserve les comptes, les programmes, les séances et les animations du projet d’origine. Une refonte du parcours est en préparation pour rendre l’entraînement plus simple.

- **Application :** https://hit-the-million.vercel.app
- **Hébergement :** Vercel ; données PostgreSQL chez Neon.
- **Accès :** comptes personnels sur invitation.
- **Déploiement et administration :** [guide de l’instance](docs/VERCEL_FR.md).
- **Parcours et fonctionnalités de HiT :** [cadrage produit](docs/HIT_PRODUCT.md).

## Développement

Node.js 22. Installer les dépendances avec `npm ci --prefix frontend --ignore-scripts` et `npm ci --prefix api --omit=optional`. Compiler pour Vercel avec `node scripts/build-vercel.mjs`. La branche `main` est déployée automatiquement.

## Origine et licences

HiT est une adaptation d’openGym, sous AGPL-3.0-or-later. Les licences et attributions du projet d’origine sont conservées dans [LICENSE](LICENSE) et [NOTICE.md](NOTICE.md). Les médias d’exercices gardent leurs conditions d’utilisation propres.

Les logos HiT ont été fournis par le propriétaire du projet. La documentation originale, qui décrit aussi des fonctionnalités hors du périmètre Vercel, est conservée dans [README.upstream.md](README.upstream.md).
