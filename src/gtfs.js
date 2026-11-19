// -----------------------------------------------------------------------------
// A minimal GTFS-Realtime decoder: the TripUpdates of the watched stops and
// the service Alerts, read straight from the protobuf wire format.
//
// A bus network of exo publishes one TripUpdates feed for all its buses. The
// usual reader (`gtfs-realtime-bindings`, on protobufjs) would build an object
// for every stop time update of the network to keep the few of the watched
// stops; this walks the wire format and only builds an object for an update
// whose stop_id is watched: everything else is skipped by its length. Linear
// in the size of the answer (itself bounded by the client), no recursion
// beyond the fixed depth of the format, no runtime dependency. Written for
// gladys-stm by the same author (Apache-2.0), extended here with the alerts
// and with bounds on what is kept.
//
// Field numbers from the official gtfs-realtime.proto (stable: fields are only
// ever added; unknown fields and extensions are skipped, as protobuf requires):
//
//   FeedMessage     header = 1, entity = 2
//   FeedHeader      timestamp = 3
//   FeedEntity      id = 1, is_deleted = 2, trip_update = 3, alert = 5
//   TripUpdate      trip = 1, stop_time_update = 2
//   TripDescriptor  trip_id = 1, start_date = 3, schedule_relationship = 4,
//                   route_id = 5, direction_id = 6
//   StopTimeUpdate  stop_sequence = 1, arrival = 2, departure = 3, stop_id = 4,
//                   schedule_relationship = 5
//   StopTimeEvent   delay = 1, time = 2
//   Alert           active_period = 1, informed_entity = 5, cause = 6,
//                   effect = 7, header_text = 10, description_text = 11,
//                   severity_level = 14
//   TimeRange       start = 1, end = 2
//   EntitySelector  agency_id = 1, route_id = 2, route_type = 3, trip = 4,
//                   stop_id = 5, direction_id = 6
//   TranslatedString translation = 1; Translation text = 1, language = 2
// -----------------------------------------------------------------------------

import { MAX_ALERT_TEXT, MAX_ALERTS, MAX_ENTITIES, MAX_STOP_TIMES } from './constants.js';

/** TripDescriptor.ScheduleRelationship values the integration acts upon. */
export const TRIP_SCHEDULE_RELATIONSHIP = { SCHEDULED: 0, ADDED: 1, UNSCHEDULED: 2, CANCELED: 3 };

/** StopTimeUpdate.ScheduleRelationship values the integration acts upon. */
export const STOP_SCHEDULE_RELATIONSHIP = { SCHEDULED: 0, SKIPPED: 1, NO_DATA: 2 };

/** Thrown when the payload is not a well-formed protobuf message. */
export class GtfsRealtimeDecodeError extends Error {
  constructor(message) {
    super(`Malformed GTFS-Realtime feed: ${message}`);
    this.name = 'GtfsRealtimeDecodeError';
  }
}

const WIRE = { VARINT: 0, FIXED64: 1, LENGTH_DELIMITED: 2, FIXED32: 5 };

/**
 * A cursor over one protobuf message (a slice of the feed buffer). Reading a
 * nested message only creates a new cursor over the same buffer: no copy.
 */
class Reader {
  /**
   * @param {Uint8Array} buffer
   * @param {number} start
   * @param {number} end
   */
  constructor(buffer, start = 0, end = buffer.length) {
    this.buffer = buffer;
    this.pos = start;
    this.end = end;
  }

  done() {
    return this.pos >= this.end;
  }

  /**
   * A varint, as a Number. The values of this feed (POSIX times, sequences,
   * enums, small delays) all fit in 2^53; a negative int32 (a train running
   * early) is encoded on ten bytes as a 64-bit two's complement, and is the one
   * case that needs BigInt to come back signed — see `readSignedVarint`.
   */
  readVarint() {
    let result = 0;
    let multiplier = 1;
    for (let i = 0; i < 10; i += 1) {
      if (this.pos >= this.end) {
        throw new GtfsRealtimeDecodeError('truncated varint');
      }
      const byte = this.buffer[this.pos];
      this.pos += 1;
      result += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) {
        return result;
      }
      multiplier *= 128;
    }
    throw new GtfsRealtimeDecodeError('varint longer than 10 bytes');
  }

  /** A varint read as a signed 64-bit integer (protobuf int32 / int64). */
  readSignedVarint() {
    const start = this.pos;
    const unsigned = this.readVarint();
    if (unsigned <= Number.MAX_SAFE_INTEGER) {
      return unsigned;
    }
    // Re-read the bytes exactly: the Number accumulation above has lost the
    // low bits of a value this large.
    let value = 0n;
    let shift = 0n;
    for (let pos = start; pos < this.pos; pos += 1) {
      value |= BigInt(this.buffer[pos] & 0x7f) << shift;
      shift += 7n;
    }
    return Number(BigInt.asIntN(64, value));
  }

  /** The bounds of a length-delimited field, which the cursor then skips. */
  readLengthDelimited() {
    const length = this.readVarint();
    const start = this.pos;
    const end = start + length;
    if (end > this.end) {
      throw new GtfsRealtimeDecodeError('length-delimited field past the end of its message');
    }
    this.pos = end;
    return { start, end };
  }

  readString() {
    const { start, end } = this.readLengthDelimited();
    return textDecoder.decode(this.buffer.subarray(start, end));
  }

  readMessage() {
    const { start, end } = this.readLengthDelimited();
    return new Reader(this.buffer, start, end);
  }

  /** The next field tag: `{ field, wire }`. */
  readTag() {
    const tag = this.readVarint();
    return { field: Math.floor(tag / 8), wire: tag % 8 };
  }

  /** Skip the value of a field the decoder does not read. */
  skip(wire) {
    switch (wire) {
      case WIRE.VARINT:
        this.readVarint();
        return;
      case WIRE.FIXED64:
        this.advance(8);
        return;
      case WIRE.LENGTH_DELIMITED:
        this.readLengthDelimited();
        return;
      case WIRE.FIXED32:
        this.advance(4);
        return;
      default:
        // Groups (3, 4) are long deprecated and absent from gtfs-realtime.proto.
        throw new GtfsRealtimeDecodeError(`unsupported wire type ${wire}`);
    }
  }

  advance(bytes) {
    if (this.pos + bytes > this.end) {
      throw new GtfsRealtimeDecodeError('fixed-size field past the end of its message');
    }
    this.pos += bytes;
  }
}

const textDecoder = new TextDecoder('utf-8');

/**
 * Iterate over the fields of a message, handing each tag to `onField`, which
 * reads the value itself or returns false to have it skipped.
 *
 * @param {Reader} reader
 * @param {(field: number, wire: number) => boolean | void} onField
 */
function forEachField(reader, onField) {
  while (!reader.done()) {
    const { field, wire } = reader.readTag();
    if (onField(field, wire) === false) {
      reader.skip(wire);
    }
  }
}

/** StopTimeEvent -> `{ time, delay }`, either possibly undefined. */
function readStopTimeEvent(reader) {
  const event = {};
  forEachField(reader, (field, wire) => {
    if (field === 1 && wire === WIRE.VARINT) {
      event.delay = reader.readSignedVarint();
    } else if (field === 2 && wire === WIRE.VARINT) {
      event.time = reader.readSignedVarint();
    } else {
      return false;
    }
    return true;
  });
  return event;
}

/** The stop_id of a StopTimeUpdate, read without decoding anything else. */
function peekStopId(reader) {
  const probe = new Reader(reader.buffer, reader.pos, reader.end);
  let stopId;
  forEachField(probe, (field, wire) => {
    if (field === 4 && wire === WIRE.LENGTH_DELIMITED) {
      stopId = probe.readString();
      return true;
    }
    return false;
  });
  return stopId;
}

/** A whole StopTimeUpdate, for a watched stop. */
function readStopTimeUpdate(reader) {
  const update = { scheduleRelationship: STOP_SCHEDULE_RELATIONSHIP.SCHEDULED };
  forEachField(reader, (field, wire) => {
    if (field === 1 && wire === WIRE.VARINT) {
      update.stopSequence = reader.readVarint();
    } else if (field === 2 && wire === WIRE.LENGTH_DELIMITED) {
      update.arrival = readStopTimeEvent(reader.readMessage());
    } else if (field === 3 && wire === WIRE.LENGTH_DELIMITED) {
      update.departure = readStopTimeEvent(reader.readMessage());
    } else if (field === 4 && wire === WIRE.LENGTH_DELIMITED) {
      update.stopId = reader.readString();
    } else if (field === 5 && wire === WIRE.VARINT) {
      update.scheduleRelationship = reader.readVarint();
    } else {
      return false;
    }
    return true;
  });
  return update;
}

/** TripDescriptor -> the fields the board needs. */
function readTripDescriptor(reader) {
  const trip = { scheduleRelationship: TRIP_SCHEDULE_RELATIONSHIP.SCHEDULED };
  forEachField(reader, (field, wire) => {
    if (field === 1 && wire === WIRE.LENGTH_DELIMITED) {
      trip.tripId = reader.readString();
    } else if (field === 3 && wire === WIRE.LENGTH_DELIMITED) {
      trip.startDate = reader.readString();
    } else if (field === 4 && wire === WIRE.VARINT) {
      trip.scheduleRelationship = reader.readVarint();
    } else if (field === 5 && wire === WIRE.LENGTH_DELIMITED) {
      trip.routeId = reader.readString();
    } else if (field === 6 && wire === WIRE.VARINT) {
      trip.directionId = reader.readVarint();
    } else {
      return false;
    }
    return true;
  });
  return trip;
}

/**
 * One TripUpdate: its trip, and the updates of the watched stops only (the
 * trip descriptor may come after them on the wire: paired at the end).
 */
function readTripUpdate(reader, stopIds) {
  let trip;
  const updates = [];
  forEachField(reader, (field, wire) => {
    if (field === 1 && wire === WIRE.LENGTH_DELIMITED) {
      trip = readTripDescriptor(reader.readMessage());
      return true;
    }
    if (field === 2 && wire === WIRE.LENGTH_DELIMITED) {
      const message = reader.readMessage();
      const stopId = peekStopId(message);
      if (stopId !== undefined && stopIds.has(stopId)) {
        updates.push(readStopTimeUpdate(message));
      }
      return true;
    }
    return false;
  });
  return { trip: trip ?? { scheduleRelationship: TRIP_SCHEDULE_RELATIONSHIP.SCHEDULED }, updates };
}

/** FeedHeader -> its timestamp (POSIX seconds), undefined when absent. */
function readHeader(reader) {
  let timestamp;
  forEachField(reader, (field, wire) => {
    if (field === 3 && wire === WIRE.VARINT) {
      timestamp = reader.readVarint();
      return true;
    }
    return false;
  });
  return timestamp;
}

/**
 * Walk the entities of a feed: `onEntity(field, reader)` gets the reader of
 * each entity payload of the wanted field, unless the entity is deleted.
 */
function readFeed(buffer, wanted, onEntity) {
  const reader = new Reader(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
  let timestamp;
  forEachField(reader, (field, wire) => {
    if (field === 1 && wire === WIRE.LENGTH_DELIMITED) {
      timestamp = readHeader(reader.readMessage());
      return true;
    }
    if (field === 2 && wire === WIRE.LENGTH_DELIMITED) {
      const entity = reader.readMessage();
      let deleted = false;
      let payload;
      forEachField(entity, (f, w) => {
        if (f === 2 && w === WIRE.VARINT) {
          deleted = entity.readVarint() === 1;
          return true;
        }
        if (f === wanted && w === WIRE.LENGTH_DELIMITED) {
          payload = entity.readMessage();
          return true;
        }
        return false;
      });
      if (payload && !deleted) onEntity(payload);
      return true;
    }
    return false;
  });
  return timestamp;
}

/**
 * The stop time updates of the watched stops out of a TripUpdates feed.
 * At most MAX_STOP_TIMES are kept (`truncated` says when more were there):
 * the whole answer is still checked for well-formedness.
 *
 * @param {Uint8Array} buffer the raw protobuf payload
 * @param {Iterable<string>} watchedStopIds GTFS stop_id values
 */
export function decodeTripUpdates(buffer, watchedStopIds) {
  const stopIds = new Set(watchedStopIds);
  const stopTimes = [];
  let truncated = false;
  const timestamp = readFeed(buffer, 3, (payload) => {
    const tripUpdate = readTripUpdate(payload, stopIds);
    for (const update of tripUpdate.updates) {
      if (stopTimes.length >= MAX_STOP_TIMES) {
        truncated = true;
        return;
      }
      stopTimes.push({
        stopId: update.stopId,
        routeId: tripUpdate.trip.routeId,
        tripId: tripUpdate.trip.tripId,
        directionId: tripUpdate.trip.directionId,
        tripScheduleRelationship: tripUpdate.trip.scheduleRelationship,
        scheduleRelationship: update.scheduleRelationship,
        stopSequence: update.stopSequence,
        arrival: update.arrival,
        departure: update.departure,
      });
    }
  });
  return { timestamp, stopTimes, truncated };
}

// --- Alerts ------------------------------------------------------------------

/** A text field, at most MAX_ALERT_TEXT characters (the rest never decoded). */
function readBoundedString(reader) {
  const { start, end } = reader.readLengthDelimited();
  const stop = Math.min(end, start + MAX_ALERT_TEXT * 4);
  // A cut in the middle of a character leaves a replacement mark: dropped.
  let text = textDecoder.decode(reader.buffer.subarray(start, stop));
  if (stop < end) text = text.replace(/�+$/, '');
  return text.slice(0, MAX_ALERT_TEXT);
}

/** TranslatedString -> [{ text, language }] (at most 8 translations). */
function readTranslatedString(reader) {
  const out = [];
  forEachField(reader, (field, wire) => {
    if (field === 1 && wire === WIRE.LENGTH_DELIMITED && out.length < 8) {
      const translation = reader.readMessage();
      const entry = { text: '', language: '' };
      forEachField(translation, (f, w) => {
        if (f === 1 && w === WIRE.LENGTH_DELIMITED) {
          entry.text = readBoundedString(translation);
        } else if (f === 2 && w === WIRE.LENGTH_DELIMITED) {
          entry.language = translation.readString().slice(0, 16).toLowerCase();
        } else {
          return false;
        }
        return true;
      });
      out.push(entry);
      return true;
    }
    return false;
  });
  return out;
}

function readTimeRange(reader) {
  const range = {};
  forEachField(reader, (field, wire) => {
    if (field === 1 && wire === WIRE.VARINT) range.start = reader.readVarint();
    else if (field === 2 && wire === WIRE.VARINT) range.end = reader.readVarint();
    else return false;
    return true;
  });
  return range;
}

function readEntitySelector(reader) {
  const selector = {};
  forEachField(reader, (field, wire) => {
    if (field === 1 && wire === WIRE.LENGTH_DELIMITED) selector.agencyId = reader.readString();
    else if (field === 2 && wire === WIRE.LENGTH_DELIMITED) selector.routeId = reader.readString();
    else if (field === 3 && wire === WIRE.VARINT) selector.routeType = reader.readSignedVarint();
    else if (field === 4 && wire === WIRE.LENGTH_DELIMITED)
      selector.tripId = readTripDescriptor(reader.readMessage()).tripId;
    else if (field === 5 && wire === WIRE.LENGTH_DELIMITED) selector.stopId = reader.readString();
    else if (field === 6 && wire === WIRE.VARINT) selector.directionId = reader.readVarint();
    else return false;
    return true;
  });
  return selector;
}

function readAlert(reader) {
  const alert = { periods: [], entities: [], header: [], description: [] };
  forEachField(reader, (field, wire) => {
    if (field === 1 && wire === WIRE.LENGTH_DELIMITED) {
      const range = readTimeRange(reader.readMessage());
      if (alert.periods.length < MAX_ENTITIES) alert.periods.push(range);
    } else if (field === 5 && wire === WIRE.LENGTH_DELIMITED) {
      const selector = readEntitySelector(reader.readMessage());
      if (alert.entities.length < MAX_ENTITIES) alert.entities.push(selector);
      else alert.entitiesTruncated = true;
    } else if (field === 6 && wire === WIRE.VARINT) {
      alert.cause = reader.readVarint();
    } else if (field === 7 && wire === WIRE.VARINT) {
      alert.effect = reader.readVarint();
    } else if (field === 10 && wire === WIRE.LENGTH_DELIMITED) {
      alert.header = readTranslatedString(reader.readMessage());
    } else if (field === 11 && wire === WIRE.LENGTH_DELIMITED) {
      alert.description = readTranslatedString(reader.readMessage());
    } else if (field === 14 && wire === WIRE.VARINT) {
      alert.severity = reader.readVarint();
    } else {
      return false;
    }
    return true;
  });
  return alert;
}

/**
 * The service alerts of a feed (at most MAX_ALERTS kept).
 * @param {Uint8Array} buffer
 */
export function decodeAlerts(buffer) {
  const alerts = [];
  let truncated = false;
  const timestamp = readFeed(buffer, 5, (payload) => {
    if (alerts.length >= MAX_ALERTS) {
      truncated = true;
      return;
    }
    alerts.push(readAlert(payload));
  });
  return { timestamp, alerts, truncated };
}
