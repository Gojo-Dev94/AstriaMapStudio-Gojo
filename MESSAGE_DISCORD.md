**Astria Map Studio — éditeur de maps Dofus Retro / Busta**

Je partage un éditeur de maps moderne basé sur AstriaMapEditor : interface isométrique, trois calques, édition des cellules et des positions de combat, déclencheurs, groupes de monstres, aperçu des assets, historique, import JSON/SWF et sauvegarde dans la BDD.

Il est **compatible avec le schéma de ma BDD Busta/JhonGanzEmu** (`duty_estaticos_hero2`) : l'adaptateur a été vérifié sur les 23 colonnes de `mapas` et les tables `celdas_accion`, `accion_pelea` et `mobs_fix`. L'inventaire des tables et colonnes est inclus pour faciliter l'adaptation à d'autres variantes de Busta. La BDD et l'émulateur ne sont pas dans le ZIP.

Le dépôt GitHub contient **le projet, son code source et ses assets PNG/XML**, avec `INSTALLATION_BUSTA.md` : https://github.com/Gojo-Dev94/AstriaMapStudio-Gojo. Pour l'installer : Node.js 22.12+, une BDD statique Busta existante, configurer `.env` depuis `.env.example`, puis `npm ci --legacy-peer-deps`, `npm run build` et `npm run server`. Ouvrir ensuite `http://127.0.0.1:3001`.

Vous pouvez **l'améliorer et contribuer** : gestion des actions conditionnelles multiples, groupes fixes complexes, rendu/atlas, import `.ame`, ergonomie et tests sur d'autres versions de Busta. Les limites connues sont décrites dans le guide ; vérifiez toujours votre schéma et sauvegardez votre BDD avant de publier des maps. Le code est fourni avec sa licence GPLv3.
