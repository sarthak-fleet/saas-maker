// A bring-your-own-key settings form. The provider URL is what the user might
// type, never what this project calls.
export function SettingsForm({ config, onChange }) {
  return (
    <SettingsFields
      placeholders={{
        endpointUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-...',
      }}
      value={config}
      onChange={onChange}
    />
  );
}
