ALTER TABLE mailboxes ADD COLUMN imap_uid_validity text;
ALTER TABLE mailboxes ADD COLUMN imap_last_uid bigint NOT NULL DEFAULT 0;
ALTER TABLE mailboxes ADD COLUMN create_lead_from_unmatched boolean NOT NULL DEFAULT false;
ALTER TABLE email_messages ADD COLUMN imap_uid_validity text;
ALTER TABLE email_messages ADD COLUMN imap_uid bigint;
CREATE UNIQUE INDEX email_messages_imap_uid_uq ON email_messages (workspace_id, mailbox_id, imap_uid_validity, imap_uid);
