import manifest from '../../../assets/vocabulary/manifest.json';

export const RULESET_VERSION = '1.0.0';

export function getCompatibilityInfo() {
  return {
    rulesetVersion: RULESET_VERSION,
    vocabularyVersion: manifest.vocabularyVersion,
    vocabularySchemaVersion: manifest.schemaVersion,
    supportedModes: ['STANDARD_4_CHOICE']
  };
}
