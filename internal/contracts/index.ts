/** Internal types shared by the feedback API and its private inbox. */

export type FeedbackType = 'bug' | 'feature' | 'feedback';
export type FeedbackStatus =
  | 'new'
  | 'acknowledged'
  | 'investigating'
  | 'planned'
  | 'in_progress'
  | 'resolved'
  | 'dismissed'
  | 'on_roadmap';
export type LegacyFeedbackStatus = 'done' | 'shipped' | 'cancelled' | 'reviewing' | 'closed';
export type AnyFeedbackStatus = FeedbackStatus | LegacyFeedbackStatus;
export type FeedbackVote = 'up' | 'down' | null;

export interface FeedbackPageContext {
  url: string;
  title: string;
}

export interface FeedbackPinpoint {
  selector: string;
  tag: string | null;
  text: string;
  source: string | null;
  url: string;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  api_key: string;
  owner_id: string;
  readme: string | null;
  source: 'dashboard' | 'linkchat' | string;
  git_url?: string | null;
  created_at: string;
}

export interface FeedbackStatusEvent {
  id: string;
  feedback_id: string;
  from_status: AnyFeedbackStatus | null;
  to_status: AnyFeedbackStatus;
  actor_id: string;
  actor_kind: 'owner' | 'agent';
  created_at: string;
}

export interface FeedbackRecord {
  id: string;
  project_id: string;
  type: FeedbackType;
  status: AnyFeedbackStatus;
  title: string;
  description: string;
  image_url: string | null;
  submitter_email?: string;
  submitter_name: string | null;
  upvote_count: number;
  downvote_count: number;
  viewer_vote?: FeedbackVote;
  page: FeedbackPageContext | null;
  pinpoint: FeedbackPinpoint | null;
  client_version: string | null;
  source: string | null;
  updated_at: string | null;
  updated_by: string | null;
  created_at: string;
  status_events?: FeedbackStatusEvent[];
}

export interface UpvoteRecord {
  id: string;
  feedback_id: string;
  user_id: string;
  vote: 1 | -1;
  created_at: string;
}

export interface SubmitFeedbackRequest {
  type: FeedbackType;
  title: string;
  description: string;
  image_url?: string;
  submitter_email?: string;
  submitter_name?: string;
  page?: FeedbackPageContext;
  anchor?: FeedbackPinpoint;
  client_version?: string;
  source?: string;
}

export interface AgentTokenRecord {
  id: string;
  project_id: string;
  name: string;
  can_write: boolean;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    path?: string;
  };
}
