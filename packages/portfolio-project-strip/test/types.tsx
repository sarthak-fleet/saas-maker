import { PortfolioProjectStrip } from '../src';

export const Example = () => (
  <PortfolioProjectStrip
    projects={[{ id: 'one', name: 'One', url: 'https://example.com' }]}
    currentProjectId="one"
    theme="dark"
    speed={60}
  />
);
