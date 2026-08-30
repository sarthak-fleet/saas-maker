const PRESETS: { label: string; endpointUrl: string }[] = [
  { label: 'OpenAI', endpointUrl: 'https://api.openai.com/v1' },
  { label: 'Anthropic', endpointUrl: 'https://api.anthropic.com/v1' },
  { label: 'Google Gemini', endpointUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { label: 'OpenRouter', endpointUrl: 'https://openrouter.ai/api/v1' },
  { label: 'Together', endpointUrl: 'https://api.together.xyz/v1' },
];

export function SettingsModal({ onPick }) {
  return PRESETS.map((preset) => <button key={preset.label} onClick={() => onPick(preset)} />);
}
