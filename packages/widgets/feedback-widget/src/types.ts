import type { ElementAnchor } from './elementAnchor';

export type FeedbackType = 'bug' | 'feature' | 'feedback';

export interface FeedbackPageContext {
  url: string;
  title: string;
}

export interface FeedbackSubmission {
  type: FeedbackType;
  title: string;
  description: string;
  email?: string;
  name?: string;
  anchor?: ElementAnchor;
  /** The original browser File. Upload or persist it before the callback resolves. */
  screenshot?: File;
  page: FeedbackPageContext;
}

export interface FeedbackWidgetCommonProps {
  userEmail?: string;
  userName?: string;
  requireEmail?: boolean;
  types?: FeedbackType[];
  position?: 'bottom-right' | 'bottom-left';
  theme?: 'light' | 'dark' | 'auto';
  accentColor?: string;
  triggerText?: string;
  /** Allow pointing at a page element to capture selector, text, source, and URL. */
  enablePointing?: boolean;
}

export interface FeedbackCallbackDestination {
  onSubmit: (feedback: FeedbackSubmission) => void | Promise<void>;
  ingestionUrl?: never;
  projectKey?: never;
  apiBaseUrl?: never;
}

export interface FeedbackUrlDestination {
  /** Relative or absolute HTTP(S) endpoint that accepts the documented multipart contract. */
  ingestionUrl: string;
  onSubmit?: never;
  projectKey?: never;
  apiBaseUrl?: never;
}

export interface FeedbackHostedDestination {
  /** Public submission key created in the SaaS Maker feedback inbox. */
  projectKey: string;
  /** Override only for a self-hosted or local SaaS Maker API. */
  apiBaseUrl?: string;
  onSubmit?: never;
  ingestionUrl?: never;
}

export type FeedbackWidgetProps = FeedbackWidgetCommonProps &
  (FeedbackCallbackDestination | FeedbackUrlDestination | FeedbackHostedDestination);
