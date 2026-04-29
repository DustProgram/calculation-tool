# RAMEDACE Devis

Application desktop (Electron) de chiffrage d'opérations et d'études de prix.
Architecture **1 application / 2 modules** (Artisan & Étude de prix), avec authentification locale chiffrée et échange de devis entre profils via fichiers `.ndev`.

> Phase actuelle : **0 — Squelette**
> Auteur : Nathan RAMEDACE

---

## Prérequis

- **Node.js 18+** (recommandé : 20 LTS)
- **Windows 10/11** (cible principale ; macOS/Linux supportés en dev)
- **Visual C++ Build Tools** (Windows uniquement, pour compiler `better-sqlite3`)

Si tu n'as pas les Build Tools sur Windows :
```powershell
npm install --global --production windows-build-tools
```
ou installer "Build Tools for Visual Studio" depuis le site Microsoft.

---

## Installation

```bash
# Dans le dossier du projet
npm install
```

L'installation compile `better-sqlite3` localement (~1-2 min sur Windows).

---

## Lancement en développement

```bash
npm start
```

L'application s'ouvre. Au premier lancement, l'écran propose la création d'un compte.

---

## Build d'un installeur Windows

```bash
npm run build:win
```

L'installeur `.exe` est généré dans `dist/`.

---

## Publication d'une release et auto-update

L'application utilise **electron-updater** + **GitHub Releases** pour les mises à jour automatiques.

**Repo de mise à jour :** `https://github.com/DustProgram/calculation-tool`

### Procédure de release

1. **Bump de la version** dans `package.json` (ex: `0.1.0` → `0.2.0`).

2. **Token GitHub** : génère un Personal Access Token avec le scope `repo` sur https://github.com/settings/tokens, puis :
   ```powershell
   # Windows PowerShell
   $env:GH_TOKEN = "ghp_xxxxxxxxxxxxxxxxxxxxx"
   ```
   ```bash
   # Linux/Mac
   export GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxx
   ```

3. **Build + publish** :
   ```bash
   npm run publish
   ```
   electron-builder compile l'installeur et le publie en **draft release** sur le repo `DustProgram/calculation-tool`. Il génère aussi `latest.yml` (indispensable à l'auto-update).

4. **Sur GitHub** : ouvre la draft release créée, vérifie que l'installeur `.exe` ET `latest.yml` sont bien attachés, puis **publie** la release (passe de "draft" à "published").

5. **Côté utilisateur** : au prochain démarrage de l'app, electron-updater détecte la nouvelle version, télécharge l'installeur, et propose un redémarrage pour l'appliquer.

### Comportement de l'auto-update

- Vérification 5 secondes après le démarrage de l'app (mode `app.isPackaged` uniquement, pas en dev).
- Téléchargement automatique en arrière-plan.
- Une fois téléchargée, dialogue qui propose "Redémarrer maintenant" ou "Plus tard".
- Si "Plus tard", la MAJ s'applique automatiquement à la prochaine fermeture de l'app (`autoInstallOnAppQuit`).

---

## Structure du projet

```
ramedace-devis/
├── package.json           # Métadonnées et dépendances
├── main.js                # Process Electron principal (IPC, DB, crypto)
├── preload.js             # Pont sécurisé renderer ↔ main
├── src/
│   ├── crypto.js          # Primitives crypto (scrypt, AES-GCM, X25519, BIP-39)
│   ├── db.js              # SQLite (system DB + user DB par compte)
│   └── ndev.js            # Format d'échange .ndev (stub Phase 0)
└── ui/
    ├── index.html         # Tous les écrans en sections cachées
    ├── style.css          # Thème sombre
    └── app.js             # Logique renderer (auth, navigation, pages)
```

---

## Modèle de sécurité

### Authentification

- Mot de passe utilisateur dérivé via **scrypt** (N=32768, r=8, p=1) avec un sel aléatoire de 32 octets.
- Chaque utilisateur a une **clé de chiffrement de données (DEK)** aléatoire de 256 bits.
- La DEK est stockée *deux fois*, chiffrée par AES-256-GCM :
  - Une fois avec la clé dérivée du **mot de passe**
  - Une fois avec la clé dérivée d'une **phrase de récupération BIP-39 de 12 mots**
- → Connexion possible avec MDP ou avec phrase.

### Récupération

Si le mot de passe est perdu :
1. L'utilisateur saisit son login + sa phrase de 12 mots
2. La phrase déchiffre la DEK
3. La DEK est rechiffrée avec un nouveau MDP

⚠️ **Sans MDP ni phrase, les données sont définitivement irrécupérables.** Aucun backdoor, aucun tiers de confiance.

### Stockage

- DB système (catalogue des comptes) : `%APPDATA%\RAMEDACE Devis\data\system.db`
- DB par utilisateur : `%APPDATA%\RAMEDACE Devis\data\user-<id>.db`
- Boîte de réception `.ndev` : `%APPDATA%\RAMEDACE Devis\inbox\`

### Échange de devis (Phase 3)

Format `.ndev` : devis chiffré avec une clé symétrique dérivée d'un échange ECDH **X25519** entre les clés publiques de l'expéditeur et du destinataire. Signature Ed25519 pour authenticité (à finaliser en Phase 3).

---

## Roadmap

| Phase | Contenu | Statut |
|---|---|---|
| 0 | Squelette : Electron + SQLite + auth + navigation 2 profils | ✅ Livré |
| 1 | Module Étude : base de prix, compositions, devis avec versions, indexation | ⏳ À venir |
| 2 | Module Artisan : KPV par lot, déplacements, fournisseurs, suivi chantier | ⏳ À venir |
| 3 | Échange `.ndev` : génération, chiffrement X25519, dossier surveillé | ⏳ À venir |

---

## Test rapide

1. `npm install` puis `npm start`
2. Créer un compte (ex: login = `nathan`, MDP = `testtest123`)
3. **Noter la phrase de 12 mots affichée** (sinon perte de données possible)
4. Cocher "j'ai mis la phrase en sécurité" → Continuer
5. Choisir un profil (Artisan ou Étude)
6. Naviguer dans le menu — les pages affichent le périmètre prévu pour chaque phase
7. Tester la déconnexion / reconnexion
8. Tester la récupération : depuis l'écran login, onglet "Mot de passe oublié", saisir la phrase de 12 mots et un nouveau MDP
