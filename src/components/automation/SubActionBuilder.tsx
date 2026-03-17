'use client';

import { useState } from 'react';
import { SubAction, SubActionType } from '@/services/automation';

interface SubActionBuilderProps {
  subAction?: SubAction;
  onSave: (subAction: SubAction) => void;
  onCancel: () => void;
}

const SUB_ACTION_TYPES = [
  { value: SubActionType.SEND_MESSAGE, label: 'Send Chat Message', category: 'Core' },
  { value: SubActionType.PLAY_SOUND, label: 'Play Sound', category: 'Core' },
  { value: SubActionType.WAIT, label: 'Wait/Delay', category: 'Core' },
  { value: SubActionType.RUN_ACTION, label: 'Run Action', category: 'Core' },
  { value: SubActionType.SET_ARGUMENT, label: 'Set Argument', category: 'Variables' },
  { value: SubActionType.SET_GLOBAL_VAR, label: 'Set Global Variable', category: 'Variables' },
  { value: SubActionType.GET_GLOBAL_VAR, label: 'Get Global Variable', category: 'Variables' },
  { value: SubActionType.GET_USER_INFO, label: 'Get User Info', category: 'User Data' },
  { value: SubActionType.HTTP_REQUEST, label: 'HTTP Request', category: 'Network' },
  { value: SubActionType.WRITE_TO_FILE, label: 'Write to File', category: 'File Operations' },
  { value: SubActionType.TWITCH_SET_TITLE, label: 'Set Stream Title', category: 'Twitch' },
  { value: SubActionType.TWITCH_SET_GAME, label: 'Set Game Category', category: 'Twitch' },
  { value: SubActionType.OBS_SET_SCENE, label: 'Set OBS Scene', category: 'OBS' },
  { value: SubActionType.OBS_TOGGLE_SOURCE, label: 'Toggle OBS Source', category: 'OBS' },
  { value: SubActionType.COMMENT, label: 'Comment', category: 'Utility' }
];

export function SubActionBuilder({ subAction, onSave, onCancel }: SubActionBuilderProps) {
  const [formData, setFormData] = useState<Partial<SubAction>>(subAction || {
    type: SubActionType.SEND_MESSAGE,
    enabled: true,
    weight: 0,
    index: 0
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const newSubAction: SubAction = {
      id: subAction?.id || crypto.randomUUID(),
      type: formData.type || SubActionType.SEND_MESSAGE,
      enabled: formData.enabled ?? true,
      weight: formData.weight ?? 0,
      parentId: formData.parentId,
      index: formData.index ?? 0,
      ...formData
    };

    onSave(newSubAction);
  };

  const renderTypeSpecificFields = () => {
    switch (formData.type) {
      case SubActionType.SEND_MESSAGE:
        return (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Message Text</label>
              <textarea
                value={formData.text || ''}
                onChange={(e) => setFormData({ ...formData, text: e.target.value })}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                rows={3}
                placeholder="Message to send (use %variables% for dynamic content)"
              />
            </div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.useBot ?? false}
                onChange={(e) => setFormData({ ...formData, useBot: e.target.checked })}
                className="mr-2"
              />
              Send as Bot
            </label>
          </>
        );

      case SubActionType.PLAY_SOUND:
        return (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Sound File Path</label>
              <input
                type="text"
                value={formData.soundFile || ''}
                onChange={(e) => setFormData({ ...formData, soundFile: e.target.value })}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                placeholder="Path to sound file"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Volume (0.0 - 1.0)</label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.1"
                value={formData.volume || 1.0}
                onChange={(e) => setFormData({ ...formData, volume: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                title="Volume (0.0 to 1.0)"
              />
            </div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.finishBeforeContinuing ?? false}
                onChange={(e) => setFormData({ ...formData, finishBeforeContinuing: e.target.checked })}
                className="mr-2"
              />
              Wait for sound to finish
            </label>
          </>
        );

      case SubActionType.WAIT:
        return (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Wait Time (milliseconds)</label>
              <input
                type="number"
                min="0"
                value={formData.value || 1000}
                onChange={(e) => setFormData({ ...formData, value: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                title="Wait time in milliseconds"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Max Random Time (optional)</label>
              <input
                type="number"
                min="0"
                value={formData.maxValue ?? ''}
                onChange={(e) => setFormData({ ...formData, maxValue: e.target.value })}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                title="Max random wait time"
              />
            </div>
          </>
        );

      case SubActionType.SET_GLOBAL_VAR:
        return (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Variable Name</label>
              <input
                type="text"
                value={formData.variableName || ''}
                onChange={(e) => setFormData({ ...formData, variableName: e.target.value })}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                placeholder="variableName"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Value</label>
              <input
                type="text"
                value={formData.value || ''}
                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                placeholder="Variable value (can use %otherVariables%)"
              />
            </div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.persisted ?? false}
                onChange={(e) => setFormData({ ...formData, persisted: e.target.checked })}
                className="mr-2"
              />
              Persist across sessions
            </label>
          </>
        );

      case SubActionType.HTTP_REQUEST:
        return (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">URL</label>
              <input
                type="text"
                value={formData.url || ''}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                placeholder="https://api.example.com/endpoint"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Store Response In Variable</label>
              <input
                type="text"
                value={formData.variableName || ''}
                onChange={(e) => setFormData({ ...formData, variableName: e.target.value })}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                placeholder="responseVariable"
              />
            </div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.parseAsJson ?? false}
                onChange={(e) => setFormData({ ...formData, parseAsJson: e.target.checked })}
                className="mr-2"
              />
              Parse response as JSON
            </label>
          </>
        );

      default:
        return (
          <div className="text-sm text-gray-500">
            Additional configuration options will appear here based on the selected sub-action type.
          </div>
        );
    }
  };

  const selectedType = SUB_ACTION_TYPES.find(t => t.value === formData.type);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">
          {subAction ? 'Edit Sub-Action' : 'Create Sub-Action'}
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Sub-Action Type</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: parseInt(e.target.value) as SubActionType })}
              className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              title="Sub-action type"
            >
              {SUB_ACTION_TYPES.reduce((acc, type) => {
                const category = type.category;
                if (!acc.find(group => group.category === category)) {
                  acc.push({ category, types: [] });
                }
                acc.find(group => group.category === category)?.types.push(type);
                return acc;
              }, [] as { category: string; types: typeof SUB_ACTION_TYPES }[]).map(group => (
                <optgroup key={group.category} label={group.category}>
                  {group.types.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {selectedType && (
              <p className="text-xs text-gray-500 mt-1">Category: {selectedType.category}</p>
            )}
          </div>

          {renderTypeSpecificFields()}

          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.enabled ?? true}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="mr-2"
              />
              Enabled
            </label>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              {subAction ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}