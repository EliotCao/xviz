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
require('@babel/register');
require('babel-polyfill');

import {BagDump, Config, Convert} from './cmds';

const StartEndOptions = {
  start: {
    alias: 's',
    describe: 'Starting timestamp to begin conversion'
  },
  end: {
    alias: 'e',
    describe: 'Ending timestamp to stop conversion'
  }
};

const yargs = require('yargs')
  .alias('h', 'help')
  .command(
    'convert [-d output] <bag>',
    'Convert a rosbag to xviz',
    {
      ...StartEndOptions,
      dir: {
        alias: 'd',
        describe: 'Directory to save XVIZ data',
        demandOption: true
      },
      rosConfig: {
        describe: 'Path to ROS Bag configuration',
        type: 'string'
      },
      format: {
        describe: 'Output data format',
        default: 'BINARY_GLB',
        choices: ['JSON_STRING', 'BINARY_GLB'],
        nargs: 1
      }
    },
    Convert
  )
  .command(
    'bagdump <bag>',
    'Display information about a ROS bag',
    {
      ...StartEndOptions,
      topic: {
        alias: 't',
        description: 'The topic to inspect'
      },
      dumpTime: {
        type: 'boolean',
        description: 'Show start and end time of the bag'
      },
      dumpTopics: {
        type: 'boolean',
        description: 'Show start and end time of the bag'
      },
      dumpMessages: {
        type: 'boolean',
        description: 'Will dump messages, if a topic is provided only those will be dumped'
      },
      dumpDefs: {
        type: 'boolean',
        description: 'Will dump message definitions'
      }
    },
    BagDump
  )
  .command(
    'config <bag>',
    'Extracts basic information and outputs a configuration for the XVIZROSProvider',
    {},
    Config
  );

export function main() {
  yargs.parse();
}
