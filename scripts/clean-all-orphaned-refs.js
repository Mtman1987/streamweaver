const fs = require('fs');
const path = require('path');

const actionsDir = 'actions';

// Get all valid action IDs
const validActionIds = new Set();
const files = fs.readdirSync(actionsDir);

files.forEach(file => {
  if (file.endsWith('.json') && file !== '_metadata.json') {
    try {
      const content = JSON.parse(fs.readFileSync(path.join(actionsDir, file), 'utf8'));
      if (content.id) {
        validActionIds.add(content.id);
      }
    } catch (e) {
      console.warn(`Failed to read ${file}:`, e.message);
    }
  }
});

console.log(`Found ${validActionIds.size} valid action IDs`);

// Find and remove orphaned references
let totalRemovals = 0;

function removeOrphanedReferences(obj, depth = 0) {
  if (Array.isArray(obj)) {
    const filtered = obj.filter(item => {
      if (item && typeof item === 'object' && item.actionId && !validActionIds.has(item.actionId)) {
        console.log(`${'  '.repeat(depth)}Removing orphaned reference: ${item.actionId}`);
        totalRemovals++;
        return false;
      }
      return true;
    });
    
    return filtered.map(item => removeOrphanedReferences(item, depth + 1));
  } else if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = removeOrphanedReferences(value, depth + 1);
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

let processedCount = 0;

files.forEach(file => {
  if (file.endsWith('.json') && file !== '_metadata.json') {
    const filepath = path.join(actionsDir, file);
    
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const action = JSON.parse(content);
      
      console.log(`Processing: ${file}`);
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

console.log(`Processed ${processedCount} files, removed ${totalRemovals} orphaned references`);