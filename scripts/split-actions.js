const fs = require('fs');
const path = require('path');

// Read the monolithic actions.json
const actionsData = JSON.parse(fs.readFileSync('src/data/actions.json', 'utf8'));

// Create actions directory if it doesn't exist
const actionsDir = 'actions';
if (!fs.existsSync(actionsDir)) {
  fs.mkdirSync(actionsDir);
}

// Split each action into its own file
actionsData.forEach(action => {
  const filename = `${action.name.replace(/[^a-zA-Z0-9]/g, '_')}_${action.id}.json`;
  const filepath = path.join(actionsDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(action, null, 2));
  console.log(`Created: ${filename}`);
});

console.log(`Split ${actionsData.length} actions into individual files`);