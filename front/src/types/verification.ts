export type Verdict = 'true' | 'false' | 'misleading' | 'unverified';

export type VerificationSource = {
  name: string;
  title: string;
  url: string;
};

export type VerificationResult = {
  verdict: Verdict;
  summary: string;
  keyPoints: string[];
  sources: VerificationSource[];
};

export type VerifyInput = {
  input: string;
  type: 'url' | 'text';
};