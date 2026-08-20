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
export type AnyFeedbackStatus = FeedbackStatus;
export type FeedbackVote = 'up' | 'down' | null;

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
  created_at: string;
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
  submitter_email: string;
  submitter_name?: string;
}
