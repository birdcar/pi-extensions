export interface BuiltInChannelDefinition {
  channel: string;
  defaultRegister?: string;
  body: string;
}

export const BUILT_IN_CHANNELS: Record<string, BuiltInChannelDefinition> = {
  slack: {
    channel: "slack",
    defaultRegister: "internal",
    body: "Use concise Slack mrkdwn. Prefer short paragraphs or bullets, preserve factual details, and make the action clear.",
  },
  email: {
    channel: "email",
    defaultRegister: "professional",
    body: "Write as email with an appropriate subject, greeting, body, and closing. Keep the tone professional and specific.",
  },
  bluesky: {
    channel: "bluesky",
    defaultRegister: "social",
    body: "Write a short Bluesky post or compact thread. Keep it conversational, concise, and suitable for public social context.",
  },
  github: {
    channel: "github",
    defaultRegister: "professional",
    body: "Use GitHub-flavored Markdown. Be precise, technical where useful, and structure longer responses with headings or bullets.",
  },
};

export const GENERIC_CHANNEL_BODY = "Use plain text appropriate for the requested channel.";

export function builtInChannel(name: string): BuiltInChannelDefinition | undefined {
  return BUILT_IN_CHANNELS[name];
}
