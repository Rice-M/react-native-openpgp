// GPG4Browsers - An OpenPGP implementation in javascript
// Copyright (C) 2011 Recurity Labs GmbH
//
// This library is free software; you can redistribute it and/or
// modify it under the terms of the GNU Lesser General Public
// License as published by the Free Software Foundation; either
// version 3.0 of the License, or (at your option) any later version.
//
// This library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
// Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public
// License along with this library; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA

/**
 * This object contains configuration values.
 * @requires enums
 * @property {Integer} prefer_hash_algorithm
 * @property {Integer} encryption_cipher
 * @property {Integer} compression
 * @property {Boolean} show_version
 * @property {Boolean} show_comment
 * @property {Boolean} integrity_protect
 * @property {String} keyserver
 * @property {Boolean} debug If enabled, debug messages will be printed
 * @module config/config
 */

'use strict';

import enums from '../enums.js';

export default {
  prefer_hash_algorithm: enums.hash.sha256,
  encryption_cipher: enums.symmetric.aes256,
  compression: enums.compression.zip,
  integrity_protect: true, // use integrity protection for symmetric encryption
  ignore_mdc_error: false, // fail on decrypt if message is not integrity protected
  rsa_blinding: true,
  useNative: true, // use native node.js crypto and Web Crypto apis (if available)
  zeroCopy: false, // use transferable objects between the Web Worker and main thread
  debug: false,
  show_version: true,
  show_comment: true,
  versionstring: "React-Native-OpenPGP.js 0.1",
  commentstring: "http://openpgpjs.org",
  keyserver: "https://keyserver.ubuntu.com",
  node_store: './openpgp.store'
};
