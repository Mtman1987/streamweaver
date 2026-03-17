const fs = require('fs');
const path = require('path');

// Read all individual command files
const commandsDir = 'commands';
const commands = [];

if (fs.existsSync(commandsDir)) {
  const files = fs.readdirSync(commandsDir);
  
  files.forEach(file => {
    if (file.endsWith('.json') && !file.startsWith('_')) {
      const filePath = path.join(commandsDir, file);
      const command = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      commands.push(command);
      console.log(`Loaded: ${command.name}`);
    }
  });
}

// Write monolithic file
fs.writeFileSync('src/data/commands.json', JSON.stringify(commands, null, 2));
console.log(`Rebuilt src/data/commands.json with ${commands.length} commands`);