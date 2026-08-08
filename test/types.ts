import type { AIChatFooterProps } from '../src';

const minimal: AIChatFooterProps = {
  companyName: 'Acme',
  companyUrl: 'https://acme.com',
};

const full: AIChatFooterProps = {
  companyName: 'Acme',
  companyUrl: 'https://acme.com',
  prompt: 'What does {companyName} do?',
  providers: ['claude', 'chatgpt'],
  label: 'Ask AI',
  theme: 'dark',
  className: 'my-footer',
};

const promptFunction: AIChatFooterProps = {
  companyName: 'Acme',
  companyUrl: 'https://acme.com',
  prompt: ({ companyName, companyUrl }, provider) =>
    `Ask ${provider} about ${companyName} at ${companyUrl}`,
};

// @ts-expect-error companyName is required.
const missingCompany: AIChatFooterProps = {
  companyUrl: 'https://acme.com',
};

// @ts-expect-error companyUrl is required.
const missingUrl: AIChatFooterProps = {
  companyName: 'Acme',
};

void minimal;
void full;
void promptFunction;
void missingCompany;
void missingUrl;
