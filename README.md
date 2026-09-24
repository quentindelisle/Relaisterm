# RelaisZ – Évaluation du relais (EPS)

PWA hors-ligne pour iPad : chronométrage et notation du relais (distance 60 à 100 m, zone de transmission 20 à 30 m, réglables).
N'EPS · by Quentin Delisle

## Déploiement (GitHub Pages)
1. Pousser le dossier à la racine du dépôt `RelaisZ`.
2. Settings → Pages → Branch `main` / `root`.
3. Sur l'iPad : ouvrir l'URL dans Safari → Partager → **Sur l'écran d'accueil**.
   Après la première ouverture, l'appli fonctionne sans réseau.

## Utilisation
1. **Classes** : importer un XLSX/CSV (« NOM Prénom » en A, ou Nom en A + Prénom en B ; colonne Genre F/G reconnue). Le genre se règle aussi élève par élève dans l'aperçu, et se modifie ensuite dans Résultats (colonne G).
2. **Réglages** : distance (60–100 m) et zone de transmission (20–30 m).
3. **Passage** : toucher le démarreur puis le relayeur → chrono : Début → Entrée Zt → Fin Zt → Fin de course.
4. **Évaluation** : critères /10 + performance /10 → note de la course /20 pour chaque élève.
5. **Résultats** : note /20 = somme des N meilleures courses ÷ N (N = 3, 4 ou 5 ; course manquante = 0). Export XLSX/CSV.

## Notation d'une course (/20)
- **Critères /10** (communs aux 2 élèves) : main 3 + ne se retourne pas 3 + écart de vitesse Zt / hors Zt (4/3/2/1/0).
- **Barème fixe /5** : barème relais 100 m du lycée (filles / garçons, 0,1 à 3 pts ramenés sur 5), seuils × distance/100, interpolation linéaire ; plus lent que le 1er palier = 0. Chaque élève est noté avec le barème de son genre.
- **Autoréférencé /5** : toutes les courses de la classe ramenées à 100 m ; meilleure = 5, moins bonne = 1 (réglable), linéaire.

Mise à jour : incrémenter `CACHE` dans `sw.js` pour forcer le rafraîchissement sur l'iPad.
