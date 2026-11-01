# Knowledge King V2

This is an Expo React Native application rebuilt from the original HTML5 Knowledge King prototype.

## Architecture Highlights
- **Offline-First:** All vocabulary and single-player game progression is stored and executed locally.
- **Expo Framework:** Bootstrapped via create-expo-app.
- **Navigation:** Bottom Tabs & Native Stack via React Navigation.
- **Theme:** Centralized in `src/theme/`.

## Legacy Files
The original `index.html` and `words.json` have been archived in the `legacy-web/` directory.

## Development
Run `npm start` to launch the Expo dev server.

## EAS Update & Release Workflow

### NO BUILD REQUIRED (EAS Update / OTA):
- Rogue gameplay changes
- Balance values
- Actions
- Relics
- UI & styling
- Localization
- JS bug fixes
- Compatible assets

### BUILD REQUIRED (Native Cloud Build):
- Native dependency changes (adding / removing npm modules with native code)
- Expo SDK upgrade
- Native Android permissions (`AndroidManifest.xml` / `app.json` `android.permissions`)
- Native Firebase / Google Sign-In configuration changes (`google-services.json`, nitro config)
- Other native-runtime changes

### Standard Release Workflow:
```text
code change
  → automated tests (`npm test -- --runInBand`)
  → commit & push
  → preview EAS Update (`npx eas-cli update --channel preview ...`)
  → human QA
  → production update when approved
```

