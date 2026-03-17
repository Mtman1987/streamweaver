const fs = require('fs');
const path = require('path');

// Read the monolithic commands.json
const commandsData = JSON.parse(fs.readFileSync('src/data/commands.json', 'utf8'));

// Create commands directory if it doesn't exist
const commandsDir = 'commands';
if (!fs.existsSync(commandsDir)) {
  fs.mkdirSync(commandsDir);
}

// Split each command into its own file
commandsData.forEach(command => {
  const filename = `${command.name.replace(/[^a-zA-Z0-9]/g, '_')}_${command.id}.json`;
  const filepath = path.join(commandsDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(command, null, 2));
  console.log(`Created: ${filename}`);
});

console.log(`Split ${commandsData.length} commands into individual files`);