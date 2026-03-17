type GenerateActionCodeInput = {
  description: string;
  language: string;
};

type GenerateActionCodeOutput = {
  code: string;
};

function buildTemplate(description: string, language: string): string {
  const normalizedLanguage = language.toLowerCase();

  if (normalizedLanguage.includes('json')) {
    return JSON.stringify(
      {
        name: 'Generated Action',
        description,
        steps: [
          {
            type: 'send-chat',
            message: description,
          },
        ],
      },
      null,
      2,
    );
  }

  return [
    `// Generated from: ${description}`,
    'export async function run(context) {',
    `  return { success: true, message: ${JSON.stringify(description)} };`,
    '}',
  ].join('\n');
}

export async function generateActionCode(input: GenerateActionCodeInput): Promise<GenerateActionCodeOutput> {
  return {
    code: buildTemplate(input.description, input.language),
  };
}