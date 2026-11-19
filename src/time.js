// -----------------------------------------------------------------------------
// Local time of Montréal (America/Toronto, the zone of exo's GTFS) for the
// texts: the times of the feeds are POSIX seconds, so nothing else here
// depends on a time zone. Converted with the time zone database of Node
// (Intl): the changes of time are the zone's own.
// -----------------------------------------------------------------------------

export const TIME_ZONE = 'America/Toronto';

const format = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

/** "14:05", local time of Montréal. */
export function clock(ms) {
  return format.format(new Date(ms));
}
