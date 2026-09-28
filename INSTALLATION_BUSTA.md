# Installer Astria Map Studio avec la BDD Busta

Ce dépôt et son ZIP contiennent l'éditeur moderne, son code source, ses images PNG, ses métadonnées XML et sa documentation. Ils ne contiennent ni la BDD, ni l'émulateur, ni des comptes, ni des mots de passe, ni `node_modules`.

## Prérequis

- Node.js 22.12 ou plus récent, avec npm.
- Une base **statique** Busta déjà importée dans MariaDB/MySQL. Le schéma vérifié s'appelle `duty_estaticos_hero2`, mais le nom peut être différent chez vous.
- Un compte SQL ayant `SELECT`, `INSERT`, `UPDATE`, `DELETE` et `CREATE` sur cette base. L'éditeur crée seulement ses tables `editor_*` et vérifie la présence des tables de l'émulateur avant de démarrer.

## Démarrage

1. Clonez `https://github.com/Gojo-Dev94/AstriaMapStudio-Gojo.git` ou extrayez le ZIP dans un dossier de votre choix. Conservez les dossiers `assets/Images` et `assets/XML` à l'intérieur du dossier de l'éditeur.
2. Ouvrez un terminal dans ce dossier et exécutez `npm ci --legacy-peer-deps`.
3. Copiez `.env.example` en `.env`. Dans `.env`, remplacez `DATABASE_URL` par l'URL de **votre base statique** et choisissez un `JWT_SECRET` aléatoire d'au moins 32 caractères ainsi qu'un `ADMIN_PASSWORD` unique. Si votre mot de passe SQL contient `@`, `:`, `/` ou d'autres caractères spéciaux, encodez-le dans l'URL.
4. Gardez `ASSET_ROOT=assets/Images`, `METADATA_ROOT=assets/XML`, `ASSET_BASE_URL=/tile-assets` et `HOST=127.0.0.1`. Exécutez `npm run build`, puis `npm run server`.
5. Ouvrez <http://127.0.0.1:3001> et connectez-vous avec `ADMIN_USERNAME` et `ADMIN_PASSWORD` définis dans `.env`. Le premier démarrage crée l'administrateur local de l'éditeur.

Sous PowerShell, la copie du fichier se fait avec `Copy-Item .env.example .env`. Sous Linux/macOS, utilisez `cp .env.example .env`. `npm test` vérifie le codec, les assets et les imports SWF. Le mode développement est `npm run dev`, puis <http://127.0.0.1:5173>.

## Compatibilité Busta

L'adaptateur a été testé sur la BDD de JhonGanzEmu/Busta fournie pour ce projet. Il utilise `mapas` et ses 23 colonnes, ainsi que `celdas_accion`, `accion_pelea`, `mobs_fix`, `areas`, `subareas` et `mobs_modelo`. Il refuse de démarrer si les colonnes requises manquent. Le fichier `docs/emulator-schema.json` inventorie toutes les tables et colonnes des trois bases de l'installation testée ; il ne contient **aucune ligne de données**. Les détails du mapping sont dans `docs/ATLANTA_ADAPTER.md`.

Importer une map dans l'éditeur ne modifie pas sa ligne `mapas`. L'enregistrement publie ses changements dans la BDD. L'émulateur charge normalement ses maps au démarrage : redémarrez ou rechargez le serveur de jeu selon votre configuration pour voir les changements. Gardez une sauvegarde normale de la BDD avant une publication importante. Les tables d'actions et `mapas` de la version testée sont en MyISAM, donc leurs mises à jour ne sont pas atomiques avec l'historique de l'éditeur. Une copie de l'état précédent est enregistrée dans `editor_map_backups` avant chaque sauvegarde.

Les actions conditionnelles multiples et les formats de groupes fixes multiples sont préservés en base, mais l'interface simplifiée ne permet pas encore de les éditer. Deux maps de la BDD testée (7787 et 10986) ont un `mapData` incohérent avec leurs dimensions et sont rejetées à l'import. Ces exceptions ne signifient pas que toutes les bases Busta possèdent les mêmes lignes.

## Contenu du dépôt et du ZIP

- `src/`, `server/`, `scripts/` : code source et outils.
- `assets/Images/` : fonds, sols et objets PNG utilisés par l'éditeur.
- `assets/XML/` : positions d'origine des sprites et métadonnées d'origine.
- `dist/` : interface déjà compilée ; `npm run build` permet de la reconstruire.
- `package.json`, `package-lock.json`, `.env.example` : dépendances et configuration.
- `README.md`, `TECHNICAL_SPEC.md`, `DECISIONS.md`, `openapi.yaml`, `docs/`, `LICENSE.md` : documentation technique et licence.

Le fichier `.env` local et ses secrets ne doivent pas être ajoutés au dépôt, au ZIP ou partagés sur Discord.
