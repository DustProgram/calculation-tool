# Nucléar Estim

> Logiciel desktop de chiffrage d'opérations BTP et études de prix, pour artisans et bureaux d'études.

## Fonctionnalités

### 📐 Profil Étude de prix
- Base de prix multi-lots (matériaux, matériel, main-d'œuvre)
- Compositions détaillées avec marges
- Génération de devis multi-versions avec coefficient KPV
- Indexation BT01 / ILC
- Export PDF + import/export Excel
- Carnet d'adresses artisans + envoi de devis chiffrés

### 🔨 Profil Artisan
- Paramètres KPV (4 modes : % du PV, BTP cascade, additif, multiplicatif)
- Calcul automatique du KPV depuis vos frais réels (loyer, charges, etc.)
- Gestion du matériel amorti (calcul du coût horaire)
- Carnet de fournisseurs avec historique de prix
- Suivi de chantier (vue Kanban + liste)
- Calcul des coûts de déplacement par chantier (distance, conso, carburant)
- Réception et consultation de devis chiffrés (.ndev)

### 📒 Comptabilité (BTP française)
- Configuration entreprise (auto, EI, EURL, SARL, SAS)
- Saisie recettes / dépenses avec plan comptable BTP
- Situations chantier à l'avancement (gestion BTP sur 2 années fiscales)
- Tableau de bord (CA, charges, marge, TVA)
- Déclarations TVA prêtes à reporter (CA3 / CA12)
- Marge brute par chantier

### 🔐 Sécurité
- Authentification par mot de passe + phrase de récupération BIP-39
- 2FA TOTP (Google Authenticator, Authy, Bitwarden, 1Password…)
- Licences modulaires .nelic (signatures Ed25519)
- Chiffrement bout-en-bout des devis échangés (.ndev — ECIES X25519 + AES-256-GCM)
- 100 % offline, données stockées localement et chiffrées (AES-256-GCM)

## Plateformes supportées

- **Windows** 10 / 11 (x64, ARM64)
- **macOS** 11+ (Big Sur et plus récent, Apple Silicon ou Intel)
- **Linux** (Ubuntu, Debian, Fedora — AppImage ou .deb)

## Installation utilisateur

### Windows
Télécharger le fichier `.exe` depuis la page [Releases](https://github.com/DustProgram/calculation-tool/releases) et lancer l'installeur.

### macOS
Télécharger le fichier `.dmg` correspondant à votre puce :
- **Apple Silicon** (M1, M2, M3, M4) : `Nucléar Estim-x.x.x-arm64.dmg`
- **Intel** : `Nucléar Estim-x.x.x.dmg`

Ouvrir le `.dmg` puis glisser l'app dans le dossier Applications.

> ⚠️ **Note Gatekeeper macOS** : l'application n'étant pas signée Apple Developer pour le moment, lors du premier lancement macOS affichera un message de sécurité. Solution : clic-droit sur l'icône de l'app dans Applications → **Ouvrir** → confirmer. Une fois validée, l'app se lancera normalement.

### Linux
- AppImage : rendre exécutable (`chmod +x Nucléar*.AppImage`) et lancer
- Debian/Ubuntu : `sudo dpkg -i Nucléar*.deb`

## Développement

### Prérequis
- Node.js 18+ (LTS recommandé)
- Git

### Installation
```bash
git clone https://github.com/DustProgram/calculation-tool.git
cd calculation-tool
npm install
npm start
```

### Build

#### Tout en une commande

```bash
npm run build:all
```

Ce script s'adapte automatiquement à ton OS :
- **Sur macOS** → compile Windows + macOS + Linux ✅
- **Sur Windows ou Linux** → compile Windows + Linux uniquement (Apple interdit le build macOS depuis un autre OS)

#### Build par plateforme

```bash
npm run build:win          # Windows uniquement (x64 + ARM64)
npm run build:mac          # macOS (Apple Silicon + Intel)
npm run build:mac-arm      # macOS Apple Silicon uniquement
npm run build:mac-intel    # macOS Intel uniquement
npm run build:linux        # Linux (AppImage + .deb)
```

#### Build automatique multi-plateforme via GitHub Actions

Le projet inclut un workflow GitHub Actions (`.github/workflows/build.yml`) qui builde **les 3 plateformes en parallèle** sur des serveurs GitHub. Pour le déclencher :

```bash
# Méthode 1 : pousser un tag de version
git tag v0.1.0
git push origin v0.1.0

# Méthode 2 : déclencher manuellement
# → onglet Actions sur GitHub → workflow "Build & Release" → Run workflow
```

Au bout de 5-10 minutes, GitHub crée une Release contenant les `.exe`, `.dmg` et `.AppImage` prêts à distribuer. C'est l'approche recommandée si tu n'as pas de Mac.

> **Pour distribution publique sur Mac sans Gatekeeper warning** : il faut signer + notariser avec un Apple Developer ID (99$/an). Une fois obtenu, dé-commenter les lignes `CSC_LINK`, `APPLE_ID`, etc. dans `.github/workflows/build.yml` et ajouter les secrets correspondants dans les paramètres GitHub du repo.

## Architecture

- **Electron 32** + electron-updater
- **sql.js** (SQLite WASM, sans dépendance native) — assure la compatibilité ARM/x64/macOS sans recompilation
- **bip39** pour les phrases de récupération
- **xlsx** (SheetJS) pour Excel
- **qrcode** pour les QR (TOTP, identité)
- Pas de framework UI : JS vanille pour la lisibilité

## Crédits

Conçu et développé par **Nathan RAMEDACE**.
© 2026 — Tous droits réservés.

Code source disponible sur [GitHub — DustProgram/calculation-tool](https://github.com/DustProgram/calculation-tool).
