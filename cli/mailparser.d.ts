declare module "mailparser" {
  interface EmailAddress {
    text?: string
    name?: string
    address?: string
  }

  interface Attachment {
    filename?: string
    contentType?: string
    content: Buffer
    size: number
  }

  interface ParsedMail {
    from?: EmailAddress
    to?: EmailAddress
    cc?: EmailAddress
    subject?: string
    date?: Date
    text?: string
    html?: string
    attachments?: Attachment[]
  }

  function simpleParser(
    input: string | Buffer | Uint8Array,
    options?: Record<string, unknown>,
  ): Promise<ParsedMail>
}
