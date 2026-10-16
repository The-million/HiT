# HiT — cadrage de la refonte

## Décisions confirmées

- Nom : **HiT**, identité noire et vert citron, logos fournis par le propriétaire.
- Application en français, utilisable sur téléphone, hébergée sur Vercel.
- Adresse : `https://hit-the-million.vercel.app`.
- Parcours principal : **programme enregistré**, avec **séance libre en option**.
- Chaque personne suit ses propres séances.
- Les utilisateurs peuvent ajouter des amis, partager et voir leurs progrès.

## Parcours proposé — à discuter avant développement

Quatre onglets : **Séance · Programmes · Progression · Amis**. Le profil et les paramètres sont accessibles depuis l’avatar.

1. **Premier lancement** : créer son compte, choisir ou créer un programme, puis arriver sur la prochaine séance. Pas de questionnaire long obligatoire.
2. **Séance** : un bouton « Commencer » pour la prochaine séance du programme ; « Séance libre » en action secondaire.
3. **Pendant l’entraînement** : exercices dans l’ordre, charges et répétitions de la dernière séance visibles, saisie rapide, validation des séries et minuteur de repos. Possibilité d’ajouter ou de remplacer un exercice.
4. **Fin de séance** : enregistrer, afficher un résumé court et proposer le partage avec ses amis.
5. **Progression** : historique, évolution des charges et records par exercice ; poids corporel facultatif.
6. **Amis** : trouver un ami par pseudo/code, envoyer une demande, accepter ou refuser, puis consulter les éléments partagés. Retirer un ami doit retirer son accès.

## Fonctionnalités proposées pour la première version simplifiée

| Garder | Simplifier | Reporter |
| --- | --- | --- |
| Comptes et sauvegarde automatique | Connexion principale par mot de passe ; passkey en option | Coach IA |
| Programmes réutilisables et séances libres | Une liste claire de programmes | Nutrition et calories |
| Catalogue, recherche et animations | Recherche et filtres essentiels | Analyses avancées de fatigue |
| Séries, répétitions, charges, repos | Un seul écran d’entraînement | Réglages techniques de serveur |
| Dernières performances et historique | Quelques indicateurs de progression | Personnalisation exhaustive |
| Amis, partage des séances et progrès | Résumé partagé plutôt que tout le profil | Messagerie, classements et défis |

Les fonctions sociales sont **à construire**. Le tableau d’administration actuel n’est pas un espace entre amis et ne doit pas être utilisé pour ce partage.

## Visibilité proposée

- Profils et entraînements privés au départ.
- Amitié acceptée des deux côtés.
- Partage réservé aux amis ; choix explicite des informations visibles.
- Poids corporel et notes personnelles privés par défaut.
- Les droits doivent être contrôlés dans l’API, pas seulement par l’interface.

À préciser ensemble : partage automatique des séances ou au cas par cas, indicateurs visibles par les amis et partage de programmes.

## Ce qui change maintenant

Cette première étape applique le nom, les logos, l’icône, les textes de l’interface et les exports HiT. La navigation actuelle reste en place pendant la discussion. Les formats de sauvegarde et identifiants techniques d’openGym sont conservés pour ne pas perdre les données existantes. La provenance et les licences restent visibles.
