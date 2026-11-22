export type ProtectedMedia = {
  id: string;
  fileName: string;
  uri: string;
  sha256: string;
  publicKey: string;
  signature: string;
  createdAt: number;
  sourceAssetId?: string;
  syncStatus?: 'pending' | 'synced';
};

export type ProvenanceCheck = {
  digestMatches: boolean;
  signatureValid: boolean;
};

export type DigitalProfile = {
  displayName: string;
  bio: string;
  isPublic: boolean;
  showMedia: boolean;
};
