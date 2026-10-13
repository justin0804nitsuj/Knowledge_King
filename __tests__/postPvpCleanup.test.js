const fs = require('fs');
const path = require('path');

describe('Post-PvP Cleanup - Navigation', () => {
  it('PvpResultScreen uses valid reset navigation to Arena', () => {
    const sourceCode = fs.readFileSync(path.join(__dirname, '../src/screens/PvpResultScreen.js'), 'utf8');
    
    expect(sourceCode).not.toMatch(/navigation\.replace\(['"`]Arena['"`]\)/);
    expect(sourceCode).not.toMatch(/navigation\.navigate\(['"`]Arena['"`]\)/);
    
    expect(sourceCode).toMatch(/navigation\.reset\(\{[\s\S]*name:\s*['"`]MainTabs['"`][\s\S]*screen:\s*['"`]Arena['"`]/);
  });

  it('No Root Stack PvP screen directly attempts replace(Arena) or navigate(Arena)', () => {
    const screensPath = path.join(__dirname, '../src/screens');
    const files = fs.readdirSync(screensPath).filter(f => f.endsWith('Screen.js'));
    
    for (const file of files) {
      const content = fs.readFileSync(path.join(screensPath, file), 'utf8');
      
      // We expect navigation to Arena to go through MainTabs
      // e.g. navigation.navigate('MainTabs', { screen: 'Arena' })
      // or navigation.reset({ routes: [{ name: 'MainTabs', params: { screen: 'Arena' } }] })
      
      const hasDirectReplace = /navigation\.replace\(['"`]Arena['"`]\)/.test(content);
      const hasDirectNavigate = /navigation\.navigate\(['"`]Arena['"`]\)/.test(content);
      
      expect(hasDirectReplace).toBe(false);
      expect(hasDirectNavigate).toBe(false);
    }
  });
});

describe('Post-PvP Cleanup - Vocabulary', () => {
  const level1 = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/vocabulary/level-1.json'), 'utf8'));

  it('queen learner-facing display does NOT contain 王後', () => {
    const queen = level1.find(w => w.word === 'queen');
    expect(queen).toBeDefined();
    expect(queen.fallbackMeaning).not.toContain('王後');
    
    for (const def of queen.primaryDefinitions) {
      expect(def.meaningZhTW).not.toContain('王後');
    }
  });

  it('queen learner-facing display contains an appropriate correct form', () => {
    const queen = level1.find(w => w.word === 'queen');
    expect(queen.fallbackMeaning).toMatch(/女王|王后/);
  });

  it('hide does not regress to 獸皮', () => {
    const hide = level1.find(w => w.word === 'hide');
    expect(hide).toBeDefined();
    expect(hide.fallbackMeaning).not.toContain('獸皮');
    expect(hide.fallbackMeaning).toContain('躲藏');
  });
});
