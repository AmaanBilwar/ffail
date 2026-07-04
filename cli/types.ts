export interface EmailEnvelope {
  id: string;
  from: string;
  subject: string;
  date: Date;
  isRead: boolean;
}

export interface Email extends EmailEnvelope {
  body: string;
}

export interface FfailConfig {
  maildir: string;
  defaultAccount: string;
}
