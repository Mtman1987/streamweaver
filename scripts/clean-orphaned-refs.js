const fs = require('fs');
const path = require('path');

const actionsDir = 'actions';
const orphanedActionId = 'da8dc848-c59d-48ab-b931-9d635a6ee9f5';

function removeOrphanedReferences(obj) {
  if (Array.isArray(obj)) {
    return obj.filter(item => {
      if (item && typeof item === 'object' && item.actionId === orphanedActionId) {
        console.log(`Removing orphaned reference to ${orphanedActionId}`);
        return false;
      }
      return true;
    }).map(item => removeOrphanedReferences(item));
  } else if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = removeOrphanedReferences(value);
    }
    return result;
  }
  return obj;
}

function fixIndices(subActions) {
  if (Array.isArray(subActions)) {
    subActions.forEach((action, index) => {
      if (action && typeof action === 'object') {
        action.index = index;
        if (action.subActions) {
          fixIndices(action.subActions);
        }
      }
    });
  }
}

if (!fs.existsSync(actionsDir)) {
  console.log('Actions directory not found');
  process.exit(1);
}

const files = fs.readdirSync(actionsDir);
let processedCount = 0;

files.forEach(file => {
  if (file.endsWith('.json') && file !== '_metadata.json') {
    const filepath = path.join(actionsDir, file);
    
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const action = JSON.parse(content);
      
      const cleaned = removeOrphanedReferences(action);
      
      if (cleaned.subActions) {
        fixIndices(cleaned.subActions);
      }
      
      fs.writeFileSync(filepath, JSON.stringify(cleaned, null, 2));
      processedCount++;
    } catch (e) {
      console.warn(`Failed to process ${file}:`, e.message);
    }
  }
});

console.log(`Processed ${processedCount} action files`);