// Copyright (c) 2019 Uber Technologies, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
/* eslint-disable */
import {XVIZBaseWriter} from './xviz-base-writer';
import {loadProtos} from '@xviz/schema';

// All XVIZ messages
const XVIZ_PB = {
  ENVELOPE: 'xviz.v2.Envelope',
  START: 'xviz.v2.Start',
  TRANSFORM_LOG: 'xviz.v2.TransformLog',
  TRANSFORM_LOG_POINT_IN_TIME: 'xviz.v2.TransformPointInTime',
  TRANSFORM_LOG_DONE: 'xviz.v2.TransformLogDone',
  STATE_UPDATE: 'xviz.v2.StateUpdate',
  RECONFIGURE: 'xviz.v2.Reconfigure',
  METADATA: 'xviz.v2.Metadata',
  ERROR: 'xviz.v2.Error'
};

const pbTypes = loadProtos();
const pbEnvelope = pbTypes.lookupType(XVIZ_PB.ENVELOPE);
const pbMetadata = pbTypes.lookupType(XVIZ_PB.METADATA);
const pbStateUpdate = pbTypes.lookupType(XVIZ_PB.STATE_UPDATE);
// PBE1
const PBEMagic = Uint8Array.from([0x50, 0x42, 0x45, 0x31]);


// 0-frame is an index file for timestamp metadata
// 1-frame is the metadata file for the log
// 2-frame is where the actual XVIZ updates begin
const messageName = index => `${index + 2}-frame`;

export class XVIZProtobufWriter extends XVIZBaseWriter {
  constructor(sink, options = {}) {
    super(sink);

    const {envelope = true} = options;
    this.messageTimings = {
      messages: new Map()
    };
    this.wroteMessageIndex = null;
    this.options = {envelope};
  }

  // xvizMetadata is the object returned
  // from a Builder.
  writeMetadata(xvizMetadata) {
    this._checkValid();
    this._saveTimestamp(xvizMetadata);

    console.log(JSON.stringify(xvizMetadata, null, 2));
    const pbJSON = xvizConvertProtobuf(xvizMetadata);
    let pbType = pbMetadata;
    let pbMsg = pbMetadata.fromObject(pbJSON);

    if (this.options.envelope) {
      const value = pbMetadata.encode(pbMsg).finish();
      pbType = pbEnvelope;
      pbMsg = pbType.fromObject({type: 'xviz/metadata', data: {type_url: 'xviz.v2.Metadata', value}});
    }

    const pbBuffer = pbType.encode(pbMsg).finish();
    const buffer = new Uint8Array(pbBuffer.byteLength + 4);
    buffer.set(PBEMagic, 0);
    buffer.set(pbBuffer, 4);
    this.writeToSink('1-frame.pbe', buffer);
  }

  writeMessage(messageIndex, xvizMessage) {
    this._checkValid();
    this._saveTimestamp(xvizMessage, messageIndex);

    const pbJSON = xvizConvertProtobuf(xvizMessage);
    let pbType = pbStateUpdate;
    let pbMsg = pbType.fromObject(pbJSON);
    
    if (this.options.envelope) {
      const value = pbType.encode(pbMsg).finish();
      pbType = pbEnvelope; 
      pbMsg = pbType.fromObject({type: 'xviz/state_update', data: {type_url: 'xviz.v2.StateUpdate', value}});
    }

    const pbBuffer = pbType.encode(pbMsg).finish();
    const buffer = new Uint8Array(pbBuffer.byteLength + 4);
    buffer.set(PBEMagic, 0);
    buffer.set(pbBuffer, 4);
    this.writeToSink(`${messageName(messageIndex)}.pbe`, buffer);
  }

  _writeMessageIndex() {
    this._checkValid();
    const {startTime, endTime, messages} = this.messageTimings;
    const messageTimings = {};

    if (startTime) {
      messageTimings.startTime = startTime;
    }

    if (endTime) {
      messageTimings.endTime = endTime;
    }

    // Sort messages by index before writing out as an array
    const messageTimes = Array.from(messages.keys()).sort((a, b) => a - b);

    const timing = [];
    messageTimes.forEach((value, index) => {
      // Value is two greater than message index
      const limit = timing.length;
      if (value > limit) {
        // Adding 2 because 1-frame is metadata file, so message data starts at 2
        throw new Error(
          `Error writing time index file. Messages are missing between ${limit + 2} and ${value +
            2}`
        );
      }

      timing.push(messages.get(value));
    });
    messageTimings.timing = timing;

    const msg = JSON.stringify(messageTimings);
    this.writeToSink('0-frame.json', msg);
    this.wroteMessageIndex = timing.length;
  }

  close() {
    if (this.sink) {
      if (!this.wroteMessageIndex) {
        this._writeMessageIndex();
      }

      super.close();
    }
  }

  /* eslint-disable camelcase */
  _saveTimestamp(xviz_data, index) {
    const {log_info, updates} = xviz_data;

    if (index === undefined) {
      // Metadata case
      if (log_info) {
        const {start_time, end_time} = log_info || {};
        if (start_time) {
          this.messageTimings.startTime = start_time;
        }

        if (end_time) {
          this.messageTimings.endTime = end_time;
        }
      }
    } else if (updates) {
      if (updates.length === 0 || !updates.every(update => typeof update.timestamp === 'number')) {
        throw new Error('XVIZ updates did not contain a valid timestamp');
      }

      const min = Math.min(updates.map(update => update.timestamp));
      const max = Math.max(updates.map(update => update.timestamp));

      this.messageTimings.messages.set(index, [min, max, index, messageName(index)]);
    } else {
      // Missing updates & index is invalid call
      throw new Error('Cannot find timestamp');
    }
  }
  /* eslint-enable camelcase */

  writeToSink(name, msg) {
    this.sink.writeSync(name, msg);
  }
}

const COLOR_KEYS = ['stroke_color', 'fill_color'];
function toColorArray(object) {
  const clrs = object.substring(1);
  const len = clrs.length;
  if (!(len === 3 || len === 4 || len === 6 || len === 8)) {
    return null;
  }

  const color = [];
  const step = clrs.length === 3 || clrs.length === 4 ? 1 : 2;
  for(let i = 0; i < clrs.length; i+=step) {
    color.push(parseInt(clrs.substr(i, step), 16));
  }

  return color;
}

// Recursively walk object performing the following conversions
// - primitives with typed array fields are turned into arrays
// - primtives of type image have the data turned into a base64 string
/* eslint-disable complexity, no-else-return, max-statements */
export function xvizConvertProtobuf(object, keyName) {
  if (Array.isArray(object)) {
    if (!(keyName === 'vertices' || keyName === 'points' || keyName === 'colors')) {
      return object.map(element => xvizConvertProtobuf(element, keyName));
    }

    // Handle the following cases
    // [ [x, y, z], [x, y, z], ...]
    // [ TypedArray{x, y, z}, TypedArray{x, y ,z} ]
    // [ x, y, z, x, y, z, ... ]
    // [ {}, {}, ... ]
    if (Array.isArray(object[0])) {
      const flat = [];
      object.forEach(el => flat.push(...el));
      return flat;
    } else if (ArrayBuffer.isView(object[0])) {
      const flat = [];
      object.forEach(el => flat.push(...Array.from(el)));
      return flat;
    } else if (Number.isFinite(object[0])) {
      return object;
    } else if (typeof object[0] === 'object') {
      return object.map(element => xvizConvertProtobuf(element, keyName));
    }
  }

  // Typed arrays become normal arrays
  if (ArrayBuffer.isView(object)) {
    return Array.from(object);
  }

  if (COLOR_KEYS.includes(keyName)) {
    if (typeof object === 'string' && object.match(/^#([0-9a-f]{3,4})|([0-9a-f]{6,8})$/i)) {
      return toColorArray(object); 
    }
  }

  if (object !== null && typeof object === 'object') {
    // Handle XVIZ Image Primitive
    const properties = Object.keys(object);
    if (properties.includes('data') && keyName === 'images') {
      // TODO: should verify it is a typed array and if not convert it to one
      return object;
    }

    // Handle all other objects
    const newObject = {};
    const objectKeys = Object.keys(object);
    for (const key of objectKeys) {
      // console.log(key)
      newObject[key] = xvizConvertProtobuf(object[key], key);
    }
    return newObject;
  }

  return object;
}
/* eslint-enable complexity */
