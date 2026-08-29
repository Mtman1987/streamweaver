const MONTH_NUMBERS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_PATTERN = Object.keys(MONTH_NUMBERS)
  .sort((left, right) => right.length - left.length)
  .join('|');

export type DiscordAdminCalendarEvent = {
  missionName: string;
  missionDescription?: string;
  missionDate: string;
  missionTime: string;
  missionTimeZone: 'UTC';
};

export type DiscordAdminCalendarCommand = {
  matched: boolean;
  event?: DiscordAdminCalendarEvent;
  error?: string;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function cleanCapturedText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '').trim();
}

function extractQuotedValue(message: string, label: string): string {
  const expression = new RegExp(`\\b${label}\\s*(?:is|:)?\\s*[\u201c"]([^\u201d"]{1,400})[\u201d"]`, 'i');
  return cleanCapturedText(message.match(expression)?.[1] || '');
}

function extractTitle(message: string): string {
  const labeled = extractQuotedValue(message, '(?:title(?:\\s+that\\s+says)?|called|named|titled)');
  if (labeled) return labeled.slice(0, 80);

  const quoted = message.match(/[\u201c"]([^\u201d"]{1,200})[\u201d"]/u)?.[1] || '';
  if (quoted) return cleanCapturedText(quoted).slice(0, 80);

  const unquoted = message.match(
    /\b(?:title(?:\s+that\s+says)?|called|named|titled)\s+(?:is\s+)?(.+?)(?=\s+(?:for|at|on)\s+(?:\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\s+utc\b|$)/i,
  )?.[1] || '';
  return cleanCapturedText(unquoted).slice(0, 80);
}

function extractDescription(message: string): string {
  return extractQuotedValue(message, '(?:description|briefing)(?:\\s+that\\s+says)?');
}

function extractDate(message: string): { year: number; month: number; day: number } | null {
  const monthFirst = message.match(new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(\\d{4})\\b`, 'i'));
  if (monthFirst) {
    return {
      year: Number(monthFirst[3]),
      month: MONTH_NUMBERS[monthFirst[1].toLowerCase()],
      day: Number(monthFirst[2]),
    };
  }

  const dayFirst = message.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})(?:,)?\\s+(\\d{4})\\b`, 'i'));
  if (dayFirst) {
    return {
      year: Number(dayFirst[3]),
      month: MONTH_NUMBERS[dayFirst[2].toLowerCase()],
      day: Number(dayFirst[1]),
    };
  }

  const iso = message.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return iso ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) } : null;
}

function extractTime(message: string): { hours: number; minutes: number } | null {
  const twelveHour = message.match(/\b(?:for|at|on)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (twelveHour) {
    const rawHours = Number(twelveHour[1]);
    const minutes = Number(twelveHour[2] || 0);
    if (rawHours < 1 || rawHours > 12 || minutes < 0 || minutes > 59) return null;
    const isPm = twelveHour[3].toLowerCase().startsWith('p');
    return { hours: (rawHours % 12) + (isPm ? 12 : 0), minutes };
  }

  const twentyFourHour = message.match(/\b(?:for|at|on)\s+([01]?\d|2[0-3]):([0-5]\d)\b/i);
  return twentyFourHour
    ? { hours: Number(twentyFourHour[1]), minutes: Number(twentyFourHour[2]) }
    : null;
}

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function formatSpokenDate(year: number, month: number, day: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function detectDiscordAdminCalendarCommand(message: string): DiscordAdminCalendarCommand {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  const calendarTargeted = /\b(?:admin\s+calendar|(?:discord\s*stream\s*hubs?|discordstreamhub|dsh)(?:'s)?(?:\s+admin)?\s+calendar)\b/i.test(text);
  const writeRequested = /\b(?:add|create|schedule|put|post|record)\b/i.test(text) && /\b(?:event|mission|appointment)\b/i.test(text);
  if (!calendarTargeted || !writeRequested) return { matched: false };

  const missionName = extractTitle(text);
  if (!missionName) {
    return { matched: true, error: 'Tell me the event title in quotation marks so I do not put the wrong wording on the Admin Calendar.' };
  }

  const dateParts = extractDate(text);
  if (!dateParts || !isValidDate(dateParts.year, dateParts.month, dateParts.day)) {
    return { matched: true, error: 'Give me a complete valid date, including the year, for the Admin Calendar event.' };
  }

  const timeParts = extractTime(text);
  if (!timeParts) {
    return { matched: true, error: 'Give me the event time, such as `3:00 AM UTC`, so I do not schedule it at the wrong hour.' };
  }

  const unsupportedTimeZone = text.match(/\b(?:est|edt|cst|cdt|mst|mdt|pst|pdt)\b/i)?.[0];
  if (unsupportedTimeZone) {
    return { matched: true, error: `Use UTC for this command; I did not guess what ${unsupportedTimeZone.toUpperCase()} means on that date.` };
  }

  const statedWeekday = text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)?.[1];
  if (statedWeekday) {
    const actualWeekday = WEEKDAYS[new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day)).getUTCDay()];
    if (actualWeekday.toLowerCase() !== statedWeekday.toLowerCase()) {
      return {
        matched: true,
        error: `${formatSpokenDate(dateParts.year, dateParts.month, dateParts.day)} is ${actualWeekday}, not ${statedWeekday}. I did not add the event because those dates conflict.`,
      };
    }
  }

  return {
    matched: true,
    event: {
      missionName,
      missionDescription: extractDescription(text) || undefined,
      missionDate: `${dateParts.year}-${pad(dateParts.month)}-${pad(dateParts.day)}`,
      missionTime: `${pad(timeParts.hours)}:${pad(timeParts.minutes)}`,
      missionTimeZone: 'UTC',
    },
  };
}

export function formatDiscordAdminCalendarEvent(event: DiscordAdminCalendarEvent): string {
  const [year, month, day] = event.missionDate.split('-').map(Number);
  const [hours, minutes] = event.missionTime.split(':').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(new Date(Date.UTC(year, month - 1, day, hours, minutes)));
}
