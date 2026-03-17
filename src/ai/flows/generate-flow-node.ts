type GenerateFlowNodeInput = {
  description: string;
  context?: {
    availablePlugins?: string[];
    defaultVoice?: string;
  };
};

type GeneratedFlowNode = {
  type: 'action' | 'logic' | 'condition' | 'trigger' | 'output';
  subtype: string;
  label: string;
  data: Record<string, unknown>;
};

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export async function generateFlowNode(input: GenerateFlowNodeInput): Promise<GeneratedFlowNode> {
  const description = input.description.trim();
  const lc = normalize(description);

  if (lc.includes('discord')) {
    return {
      type: 'action',
      subtype: 'send-discord',
      label: 'Send Discord Message',
      data: {
        message: description,
        channelId: '',
      },
    };
  }

  if (lc.includes('tts') || lc.includes('speak') || lc.includes('say out loud')) {
    return {
      type: 'action',
      subtype: 'tts-broadcast',
      label: 'Broadcast TTS',
      data: {
        text: description,
        voice: input.context?.defaultVoice || 'Algieba',
      },
    };
  }

  if (lc.includes('delay') || lc.includes('wait')) {
    return {
      type: 'logic',
      subtype: 'delay',
      label: 'Delay',
      data: {
        seconds: '5',
      },
    };
  }

  if (lc.includes('points')) {
    return {
      type: 'action',
      subtype: 'update-points',
      label: 'Update Points',
      data: {
        user: "{{tags['display-name'] || 'Commander'}}",
        amount: 10,
        operation: 'add',
      },
    };
  }

  if (lc.includes('plugin') && (input.context?.availablePlugins?.length || 0) > 0) {
    return {
      type: 'action',
      subtype: 'plugin-command',
      label: 'Run Plugin Command',
      data: {
        pluginId: input.context?.availablePlugins?.[0] || '',
        command: 'run',
        payload: {},
      },
    };
  }

  return {
    type: 'action',
    subtype: 'send-chat',
    label: 'Send Chat Message',
    data: {
      message: description,
      as: 'broadcaster',
    },
  };
}
