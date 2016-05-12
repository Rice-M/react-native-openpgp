// OpenPGP.js - An OpenPGP implementation in javascript
// Copyright (C) 2016 Tankred Hase
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
 * @requires message
 * @requires cleartext
 * @requires key
 * @requires config
 * @requires util
 * @module openpgp
 */

/**
 * @fileoverview The openpgp base module should provide all of the functionality
 * to consume the openpgp.js library. All additional classes are documented
 * for extending and developing on top of the base library.
 */

'use strict';

import * as messageLib from './message.js';
import * as cleartext from './cleartext.js';
import * as key from './key.js';
import config from './config/config.js';
import util from './util';
import AsyncProxy from './worker/async_proxy.js';
import random from './crypto/random.js';


//////////////////////////////////
//                              //
//   Random Value Preparation   //
//                              //
//////////////////////////////////

/**
 * Prepare random values (for React-Native)
 */
export function prepareRandomValues() {
  var promise = new Promise(function(success, failed) {
    try {
      random.generateRandomValues().then(() => {
        success();
      });
    } catch(error) {
      failed();
    }
  });

  return promise;
}


//////////////////////////
//                      //
//   Web Worker setup   //
//                      //
//////////////////////////


let asyncProxy; // instance of the asyncproxy

/**
 * Set the path for the web worker script and create an instance of the async proxy
 * @param {String} path     relative path to the worker scripts, default: 'openpgp.worker.js'
 * @param {Object} worker   alternative to path parameter: web worker initialized with 'openpgp.worker.js'
 */
export function initWorker({ path='openpgp.worker.js', worker } = {}) {
  if (worker || typeof window !== 'undefined' && window.Worker) {
    asyncProxy = new AsyncProxy({ path, worker, config });
    return true;
  }
}

/**
 * Returns a reference to the async proxy if the worker was initialized with openpgp.initWorker()
 * @return {module:worker/async_proxy~AsyncProxy|null} the async proxy or null if not initialized
 */
export function getWorker() {
  return asyncProxy;
}

/**
 * Cleanup the current instance of the web worker.
 */
export function destroyWorker() {
  asyncProxy = undefined;
}


//////////////////////
//                  //
//   Key handling   //
//                  //
//////////////////////


/**
 * Reads an armored key
 */
export function readArmoredKey(armoredKey) {
  return key.readArmored(armoredKey);
}


/**
 * Generates a new OpenPGP key pair. Currently only supports RSA keys. Primary and subkey will be of same type.
 * @param  {Array<Object>} userIds   array of user IDs e.g. [{ name:'Phil Zimmermann', email:'phil@openpgp.org' }]
 * @param  {String} passphrase       (optional) The passphrase used to encrypt the resulting private key
 * @param  {Number} numBits          (optional) number of bits for the key creation. (should be 2048 or 4096)
 * @param  {Boolean} unlocked        (optional) If the returned secret part of the generated key is unlocked
 * @return {Promise<Object>}         The generated key object in the form:
 *                                     { key:Key, privateKeyArmored:String, publicKeyArmored:String }
 * @static
 */
export function generateKey({ userIds=[], passphrase, numBits=2048, unlocked=false } = {}) {
  const options = formatUserIds({ userIds, passphrase, numBits, unlocked });

  if (!util.getWebCrypto() && asyncProxy) { // use web worker if web crypto apis are not supported
    return asyncProxy.delegate('generateKey', options);
  }

  return key.generate(options).then(newKey => ({

    key: newKey,
    privateKeyArmored: newKey.armor(),
    publicKeyArmored: newKey.toPublic().armor()

  })).catch(err => {

    // js fallback already tried
    if (config.debug) { console.error(err); }
    if (!util.getWebCrypto()) {
      throw new Error('Error generating keypair using js fallback');
    }

    // fall back to js keygen in a worker
    if (config.debug) { console.log('Error generating keypair using native WebCrypto... falling back back to js'); }
    return asyncProxy.delegate('generateKey', options);

  }).catch(onError.bind(null, 'Error generating keypair'));

}

/**
 * Unlock a private key with your passphrase.
 * @param  {Key} privateKey      the private key that is to be decrypted
 * @param  {String} passphrase   the user's passphrase chosen during key generation
 * @return {Key}                 the unlocked private key
 */
export function decryptKey({ privateKey, passphrase }) {
  if (asyncProxy) { // use web worker if available
    return asyncProxy.delegate('decryptKey', { privateKey, passphrase });
  }

  try {
    if (!privateKey.decrypt(passphrase)) {
      throw new Error('Invalid passphrase');
    }

    return {
      key: privateKey
    };
  }
  catch (error) {
    return "Error decrypting private key";
  }
}


///////////////////////////////////////////
//                                       //
//   Message encryption and decryption   //
//                                       //
///////////////////////////////////////////


/**
 * Read Message
 */
export function readMessage(encrypted) {
  return messageLib.readArmored(encrypted);
}

export function readBinaryMessage(encrypted) {
  return messageLib.read(encrypted);
}


/**
 * Encrypts message text/data with public keys, passwords or both at once. At least either public keys or passwords
 *   must be specified. If private keys are specified, those will be used to sign the message.
 * @param  {String|Uint8Array} data           text/data to be encrypted as JavaScript binary string or Uint8Array
 * @param  {Key|Array<Key>} publicKeys        (optional) array of keys or single key, used to encrypt the message
 * @param  {Key|Array<Key>} privateKeys       (optional) private keys for signing. If omitted message will not be signed
 * @param  {String|Array<String>} passwords   (optional) array of passwords or a single password to encrypt the message
 * @param  {String} filename                  (optional) a filename for the literal data packet
 * @param  {Boolean} armor                    (optional) if the return value should be ascii armored or the message object
 * @return {Promise<String|Message>}          encrypted ASCII armored message, or the full Message object if 'armor' is false
 * @static
 */
export function encrypt({ data, publicKeys, privateKeys, passwords, filename, armor=true }) {
  checkData(data); publicKeys = toArray(publicKeys); privateKeys = toArray(privateKeys); passwords = toArray(passwords);

  if (asyncProxy) { // use web worker if available
    return asyncProxy.delegate('encrypt', { data, publicKeys, privateKeys, passwords, filename, armor });
  }

  var promise = new Promise(function(resolve, reject) {
    try {
      let message = createMessage(data, filename);
      if (privateKeys) { // sign the message only if private keys are specified
        message = message.sign(privateKeys);
      }
      message = message.encrypt(publicKeys, passwords);

      if(armor) {
        resolve({
          data: message.armor()
        });
      }

      resolve({
        message: message
      });
    } catch (error) {
      reject('Error encrypting message');
    }
  });

  return promise;
}

/**
 * Decrypts a message with the user's private key, a session key or a password. Either a private key,
 *   a session key or a password must be specified.
 * @param  {Message} message             the message object with the encrypted data
 * @param  {Key} privateKey              (optional) private key with decrypted secret key data or session key
 * @param  {Key|Array<Key>} publicKeys   (optional) array of public keys or single key, to verify signatures
 * @param  {Object} sessionKey           (optional) session key in the form: { data:Uint8Array, algorithm:String }
 * @param  {String} password             (optional) single password to decrypt the message
 * @param  {String} format               (optional) return data format either as 'utf8' or 'binary'
 * @return {Promise<Object>}             decrypted and verified message in the form:
 *                                         { data:Uint8Array|String, filename:String, signatures:[{ keyid:String, valid:Boolean }] }
 * @static
 */
export function decrypt({ message, privateKey, publicKeys, sessionKey, password, format='utf8' }) {
  checkMessage(message); publicKeys = toArray(publicKeys);

  if (asyncProxy) { // use web worker if available
    return asyncProxy.delegate('decrypt', { message, privateKey, publicKeys, sessionKey, password, format });
  }

  var promise = new Promise(function(resolve, reject) {
    try {
      message = message.decrypt(privateKey, sessionKey, password);
      const result = parseMessage(message, format);

      if (publicKeys && result.data) { // verify only if publicKeys are specified
        result.signatures = message.verify(publicKeys);
      }

      resolve(result);
    }
    catch (error) {
      reject('Error decrypting message');
    }
  });

  return promise;
}


//////////////////////////////////////////
//                                      //
//   Message signing and verification   //
//                                      //
//////////////////////////////////////////


/**
 * Signs a cleartext message.
 * @param  {String} data                        cleartext input to be signed
 * @param  {Key|Array<Key>} privateKeys         array of keys or single key with decrypted secret key data to sign cleartext
 * @param  {Boolean} armor                      (optional) if the return value should be ascii armored or the message object
 * @return {Promise<String|CleartextMessage>}   ASCII armored message or the message of type CleartextMessage
 * @static
 */
export function sign({ data, privateKeys, armor=true }) {
  checkString(data);
  privateKeys = toArray(privateKeys);

  if (asyncProxy) { // use web worker if available
    return asyncProxy.delegate('sign', { data, privateKeys, armor });
  }

  var promise = new Promise(function(resolve, reject) {
    try {
      const cleartextMessage = new cleartext.CleartextMessage(data);
      cleartextMessage.sign(privateKeys);

      if(armor) {
        resolve({
          data: cleartextMessage.armor()
        });
      }
      resolve({
        message: cleartextMessage
      });
    }
    catch (error) {
      reject('Error signing cleartext message');
    }
  });

  return promise;
}

/**
 * Verifies signatures of cleartext signed message
 * @param  {Key|Array<Key>} publicKeys   array of publicKeys or single key, to verify signatures
 * @param  {CleartextMessage} message    cleartext message object with signatures
 * @return {Promise<Object>}             cleartext with status of verified signatures in the form of:
 *                                         { data:String, signatures: [{ keyid:String, valid:Boolean }] }
 * @static
 */
export function verify({ message, publicKeys }) {
  checkCleartextMessage(message);
  publicKeys = toArray(publicKeys);

  if (asyncProxy) { // use web worker if available
    return asyncProxy.delegate('verify', { message, publicKeys });
  }

  try {
    return {
      data: message.getText(),
      signatures: message.verify(publicKeys)
    };
  }
  catch (error) {
    return 'Error verifying cleartext signed message';
  }
}


///////////////////////////////////////////////
//                                           //
//   Session key encryption and decryption   //
//                                           //
///////////////////////////////////////////////


/**
 * Encrypt a symmetric session key with public keys, passwords, or both at once. At least either public keys
 *   or passwords must be specified.
 * @param  {Uint8Array} data                  the session key to be encrypted e.g. 16 random bytes (for aes128)
 * @param  {String} algorithm                 algorithm of the symmetric session key e.g. 'aes128' or 'aes256'
 * @param  {Key|Array<Key>} publicKeys        (optional) array of public keys or single key, used to encrypt the key
 * @param  {String|Array<String>} passwords   (optional) passwords for the message
 * @return {Promise<Message>}                 the encrypted session key packets contained in a message object
 * @static
 */
export function encryptSessionKey({ data, algorithm, publicKeys, passwords }) {
  checkbinary(data); checkString(algorithm, 'algorithm'); publicKeys = toArray(publicKeys); passwords = toArray(passwords);

  if (asyncProxy) { // use web worker if available
    return asyncProxy.delegate('encryptSessionKey', { data, algorithm, publicKeys, passwords });
  }

  try {
    return {
      message: messageLib.encryptSessionKey(data, algorithm, publicKeys, passwords)
    };
  }
  catch (error) {
    return 'Error encrypting session key';
  }
}

/**
 * Decrypt a symmetric session key with a private key or password. Either a private key or
 *   a password must be specified.
 * @param  {Message} message              a message object containing the encrypted session key packets
 * @param  {Key} privateKey               (optional) private key with decrypted secret key data
 * @param  {String} password              (optional) a single password to decrypt the session key
 * @return {Promise<Object|undefined>}    decrypted session key and algorithm in object form:
 *                                          { data:Uint8Array, algorithm:String }
 *                                          or 'undefined' if no key packets found
 * @static
 */
export function decryptSessionKey({ message, privateKey, password }) {
  checkMessage(message);

  if (asyncProxy) { // use web worker if available
    return asyncProxy.delegate('decryptSessionKey', { message, privateKey, password });
  }

  try {
    message.decryptSessionKey(privateKey, password);
  }
  catch (error) {
    return 'Error decrypting session key';
  }
}


//////////////////////////
//                      //
//   Helper functions   //
//                      //
//////////////////////////


/**
 * Input validation
 */
function checkString(data, name) {
  if (!util.isString(data)) {
    throw new Error('Parameter [' + (name || 'data') + '] must be of type String');
  }
}
function checkbinary(data, name) {
  if (!util.isUint8Array(data)) {
    throw new Error('Parameter [' + (name || 'data') + '] must be of type Uint8Array');
  }
}
function checkData(data, name) {
  if (!util.isUint8Array(data) && !util.isString(data)) {
    throw new Error('Parameter [' + (name || 'data') + '] must be of type String or Uint8Array');
  }
}
function checkMessage(message) {
  if (!messageLib.Message.prototype.isPrototypeOf(message)) {
    throw new Error('Parameter [message] needs to be of type Message');
  }
}
function checkCleartextMessage(message) {
  if (!cleartext.CleartextMessage.prototype.isPrototypeOf(message)) {
    throw new Error('Parameter [message] needs to be of type CleartextMessage');
  }
}

/**
 * Format user ids for internal use.
 */
function formatUserIds(options) {
  if (!options.userIds) {
    return options;
  }
  options.userIds = toArray(options.userIds); // normalize to array
  options.userIds = options.userIds.map(id => {
    if (util.isString(id) && !util.isUserId(id)) {
      throw new Error('Invalid user id format');
    }
    if (util.isUserId(id)) {
      return id; // user id is already in correct format... no conversion necessary
    }
    // name and email address can be empty but must be of the correct type
    id.name = id.name || '';
    id.email = id.email || '';
    if (!util.isString(id.name) || (id.email && !util.isEmailAddress(id.email))) {
      throw new Error('Invalid user id format');
    }
    return id.name + ' <' + id.email + '>';
  });
  return options;
}

/**
 * Normalize parameter to an array if it is not undefined.
 * @param  {Object} param              the parameter to be normalized
 * @return {Array<Object>|undefined}   the resulting array or undefined
 */
function toArray(param) {
  if (param && !util.isArray(param)) {
    param = [param];
  }
  return param;
}

/**
 * Creates a message obejct either from a Uint8Array or a string.
 * @param  {String|Uint8Array} data   the payload for the message
 * @param  {String} filename          the literal data packet's filename
 * @return {Message}                  a message object
 */
function createMessage(data, filename) {
  let msg;
  if (util.isUint8Array(data)) {
    msg = messageLib.fromBinary(data, filename);
  } else if (util.isString(data)) {
    msg = messageLib.fromText(data, filename);
  } else {
    throw new Error('Data must be of type String or Uint8Array');
  }
  return msg;
}

/**
 * Parse the message given a certain format.
 * @param  {Message} message   the message object to be parse
 * @param  {String} format     the output format e.g. 'utf8' or 'binary'
 * @return {Object}            the parse data in the respective format
 */
function parseMessage(message, format) {
  if (format === 'binary') {
    return {
      data: message.getLiteralData(),
      filename: message.getFilename()
    };
  } else if (format === 'utf8') {
    return {
      data: message.getText(),
      filename: message.getFilename()
    };
  } else {
    throw new Error('Invalid format');
  }
}

/**
 * Command pattern that wraps synchronous code into a promise.
 * @param  {function} cmd     The synchronous function with a return value
 *                              to be wrapped in a promise
 * @param  {String} message   A human readable error Message
 * @return {Promise}          The promise wrapped around cmd
 */
function execute(cmd, message) {
  // wrap the sync cmd in a promise
  const promise = new Promise(resolve => resolve(cmd()));
  // handler error globally
  return promise.catch(onError.bind(null, message));
}

/**
 * Global error handler that logs the stack trace and rethrows a high lvl error message.
 * @param {String} message   A human readable high level error Message
 * @param {Error} error      The internal error that caused the failure
 */
function onError(message, error) {
  // log the stack trace
  if (config.debug) { console.error(error.stack); }
  // rethrow new high level error for api users
  throw new Error(message + ': ' + error.message);
}
