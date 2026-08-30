export function AiSettings({ config, onChange, placeholders }) {
  return (
    <input
      type="text"
      value={config.endpointUrl}
      onChange={(event) => onChange({ ...config, endpointUrl: event.target.value })}
      placeholder={placeholders.endpointUrl ?? 'https://api.anthropic.com/v1'}
    />
  );
}
