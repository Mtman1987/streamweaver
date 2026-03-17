const fs = require('fs');
const path = require('path');

class ActionManager {
  constructor(actionsDir = 'actions') {
    this.actionsDir = actionsDir;
  }

  // Load all actions from individual files
  loadActions() {
    if (!fs.existsSync(this.actionsDir)) {
      return { actions: [], metadata: {} };
    }

    const files = fs.readdirSync(this.actionsDir);
    const actions = [];
    let metadata = {};

    files.forEach(file => {
      if (file === '_metadata.json') {
        metadata = JSON.parse(fs.readFileSync(path.join(this.actionsDir, file), 'utf8'));
      } else if (file.endsWith('.json')) {
        const action = JSON.parse(fs.readFileSync(path.join(this.actionsDir, file), 'utf8'));
        actions.push(action);
      }
    });

    return { actions, metadata };
  }

  // Save action to individual file
  saveAction(action) {
    const filename = `${action.name.replace(/[^a-zA-Z0-9]/g, '_')}_${action.id}.json`;
    const filepath = path.join(this.actionsDir, filename);
    
    if (!fs.existsSync(this.actionsDir)) {
      fs.mkdirSync(this.actionsDir, { recursive: true });
    }
    
    fs.writeFileSync(filepath, JSON.stringify(action, null, 2));
    return filename;
  }

  // Delete action file
  deleteAction(actionId) {
    const files = fs.readdirSync(this.actionsDir);
    const file = files.find(f => f.includes(actionId));
    if (file) {
      fs.unlinkSync(path.join(this.actionsDir, file));
      return true;
    }
    return false;
  }

  // Export action for sharing
  exportAction(actionId) {
    const files = fs.readdirSync(this.actionsDir);
    const file = files.find(f => f.includes(actionId));
    if (file) {
      return fs.readFileSync(path.join(this.actionsDir, file), 'utf8');
    }
    return null;
  }

  // Import action from JSON string
  importAction(actionJson) {
    const action = JSON.parse(actionJson);
    return this.saveAction(action);
  }

  // Rebuild monolithic format (for compatibility)
  buildMonolithic() {
    const { actions, metadata } = this.loadActions();
    return {
      ...metadata,
      actions,
      t: new Date().toISOString()
    };
  }
}

module.exports = ActionManager;