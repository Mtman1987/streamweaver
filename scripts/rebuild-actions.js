const fs = require('fs');
const path = require('path');

// Read all individual action files
const actionsDir = 'actions';
const actions = [];

if (fs.existsSync(actionsDir)) {
  const files = fs.readdirSync(actionsDir);
  
  files.forEach(file => {
    if (file.endsWith('.json') && !file.startsWith('_')) {
      const filePath = path.join(actionsDir, file);
      const action = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      actions.push(action);
      console.log(`Loaded: ${action.name}`);
    }
  });
}

// Write monolithic file
fs.writeFileSync('src/data/actions.json', JSON.stringify(actions, null, 2));
console.log(`Rebuilt src/data/actions.json with ${actions.length} actions`);