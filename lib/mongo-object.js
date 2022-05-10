const REMOVED_MARKER = '______MONGO_OBJECT_REMOVED______';

export default class MongoObject {
  /*
   * @constructor
   * @param {Object} obj
   * @param {string[]}  blackboxKeys  - A list of the names of keys that shouldn't be traversed
   * @returns {undefined}
   *
   * Creates a new MongoObject instance. The object passed as the first argument
   * will be modified in place by calls to instance methods. Also, immediately
   * upon creation of the instance, the object will have any `undefined` keys
   * removed recursively.
   */
  constructor(obj, blackboxKeys = []) {
    this._obj = obj;
    this._blackboxKeys = blackboxKeys;
    this._reParseObj();
  }

  _reParseObj() {
    const blackboxKeys = this._blackboxKeys;

    this._affectedKeys = {};
    this._affectedPositions = {};
    this._genericAffectedKeys = {};
    this._positionsByGenericKey = {};
    this._positionsThatCreateGenericKey = {};
    this._parentPositions = [];
    this._positionsInsideArrays = [];
    this._objectPositions = [];
    this._arrayItemPositions = [];

    function parseObj(self, val, currentPosition, affectedKey, operator, adjusted, isWithinArray) {
      // Adjust for first-level modifier operators
      if (!operator && affectedKey && affectedKey.substring(0, 1) === '$') {
        operator = affectedKey;
        affectedKey = null;
      }

      let affectedKeyIsBlackBox = false;
      let stop = false;
      if (affectedKey) {
        // Adjust for $push and $addToSet and $pull and $pop
        if (!adjusted) {
          if (operator === '$push' || operator === '$addToSet' || operator === '$pop') {
            // Adjust for $each
            // We can simply jump forward and pretend like the $each array
            // is the array for the field. This has the added benefit of
            // skipping past any $slice, which we also don't care about.
            if (MongoObject.isBasicObject(val) && '$each' in val) {
              val = val.$each;
              currentPosition = `${currentPosition}[$each]`;
            } else {
              affectedKey = `${affectedKey}.0`;
            }

            adjusted = true;
          } else if (operator === '$pull') {
            affectedKey = `${affectedKey}.0`;
            if (MongoObject.isBasicObject(val)) {
              stop = true;
            }

            adjusted = true;
          }
        }

        // Make generic key
        const affectedKeyGeneric = MongoObject.makeKeyGeneric(affectedKey);

        // Determine whether affected key should be treated as a black box
        affectedKeyIsBlackBox = blackboxKeys.indexOf(affectedKeyGeneric) > -1;

        // Mark that this position affects this generic and non-generic key
        if (currentPosition) {
          self._affectedKeys[currentPosition] = affectedKey;
          self._affectedPositions[affectedKey] = currentPosition;
          self._genericAffectedKeys[currentPosition] = affectedKeyGeneric;

          const positionInfo = {
            key: affectedKey,
            operator: operator || null,
            position: currentPosition,
          };

          if (!self._positionsByGenericKey[affectedKeyGeneric]) self._positionsByGenericKey[affectedKeyGeneric] = [];
          self._positionsByGenericKey[affectedKeyGeneric].push(positionInfo);

          // Operators other than $unset will cause ancestor object keys to
          // be auto-created.
          if (operator && operator !== '$unset') {
            MongoObject.objectsThatGenericKeyWillCreate(affectedKeyGeneric).forEach((objGenericKey) => {
              if (!self._positionsThatCreateGenericKey[objGenericKey]) {
                self._positionsThatCreateGenericKey[objGenericKey] = [];
              }
              self._positionsThatCreateGenericKey[objGenericKey].push(positionInfo);
            });
          }

          // If we're within an array, mark this position so we can omit it from flat docs
          if (isWithinArray) self._positionsInsideArrays.push(currentPosition);
        }
      }

      if (stop) return;

      // Loop through arrays
      if (Array.isArray(val) && val.length > 0) {
        if (currentPosition) {
          // Mark positions with arrays that should be ignored when we want endpoints only
          self._parentPositions.push(currentPosition);
        }

        // Loop
        val.forEach((v, i) => {
          if (currentPosition) self._arrayItemPositions.push(`${currentPosition}[${i}]`);
          parseObj(
            self,
            v,
            (currentPosition ? `${currentPosition}[${i}]` : i),
            `${affectedKey}.${i}`,
            operator,
            adjusted,
            true,
          );
        });
      } else if ((MongoObject.isBasicObject(val) && !affectedKeyIsBlackBox) || !currentPosition) {
        // Loop through object keys, only for basic objects,
        // but always for the passed-in object, even if it
        // is a custom object.

        if (currentPosition && !isEmpty(val)) {
          // Mark positions with objects that should be ignored when we want endpoints only
          self._parentPositions.push(currentPosition);

          // Mark positions with objects that should be left out of flat docs.
          self._objectPositions.push(currentPosition);
        }

        // Loop
        Object.keys(val).forEach((k) => {
          const v = val[k];

          if (v === undefined) {
            delete val[k];
          } else if (k !== '$slice') {
            parseObj(
              self,
              v,
              (currentPosition ? `${currentPosition}[${k}]` : k),
              appendAffectedKey(affectedKey, k),
              operator,
              adjusted,
              isWithinArray,
            );
          }
        });
      }
    }

    parseObj(this, this._obj);
  }

  /**
   * @method MongoObject.forEachNode
   * @param {Function} func
   * @param {Object} [options]
   * @param {Boolean} [options.endPointsOnly=true] - Only call function for endpoints and not for nodes that contain other nodes
   * @returns {undefined}
   *
   * Runs a function for each endpoint node in the object tree, including all items in every array.
   * The function arguments are
   * (1) the value at this node
   * (2) a string representing the node position
   * (3) the representation of what would be changed in mongo, using mongo dot notation
   * (4) the generic equivalent of argument 3, with '$' instead of numeric pieces
   */
  forEachNode(func, {
    endPointsOnly = true,
  } = {}) {
    if (typeof func !== 'function') throw new Error('filter requires a loop function');

    const updatedValues = {};
    Object.keys(this._affectedKeys).forEach((position) => {
      if (endPointsOnly && this._parentPositions.indexOf(position) > -1) return; // Only endpoints
      func.call({
        value: this.getValueForPosition(position),
        isArrayItem: this._arrayItemPositions.indexOf(position) > -1,
        operator: extractOp(position),
        position,
        key: this._affectedKeys[position],
        genericKey: this._genericAffectedKeys[position],
        updateValue: (newVal) => {
          updatedValues[position] = newVal;
        },
        remove: () => {
          updatedValues[position] = undefined;
        },
      });
    });

    // Actually update/remove values as instructed
    Object.keys(updatedValues).forEach((position) => {
      this.setValueForPosition(position, updatedValues[position]);
    });
  }

  getValueForPosition(position) {
    const subkeys = position.split('[');
    let current = this._obj;
    const ln = subkeys.length;
    for (let i = 0; i < ln; i++) {
      let subkey = subkeys[i];

      // If the subkey ends in ']', remove the ending
      if (subkey.slice(-1) === ']') subkey = subkey.slice(0, -1);
      current = current[subkey];
      if (!Array.isArray(current) && !MongoObject.isBasicObject(current) && i < ln - 1) return;
    }

    if (current === REMOVED_MARKER) return;
    return current;
  }

  /**
   * @method MongoObject.prototype.setValueForPosition
   * @param {String} position
   * @param {Any} value
   * @returns {undefined}
   */
  setValueForPosition(position, value) {
    const subkeys = position.split('[');
    let current = this._obj;
    const ln = subkeys.length;

    let createdObjectsOrArrays = false;
    let affectedKey = '';

    for (let i = 0; i < ln; i++) {
      let subkey = subkeys[i];

      // If the subkey ends in "]", remove the ending
      if (subkey.slice(-1) === ']') subkey = subkey.slice(0, -1);

      // We don't store modifiers
      if (subkey && subkey.substring(0, 1) !== '$') {
        affectedKey = appendAffectedKey(affectedKey, subkey);
      }

      // If we've reached the key in the object tree that needs setting or
      // deleting, do it.
      if (i === ln - 1) {
        // If value is undefined, delete the property
        if (value === undefined) {
          if (Array.isArray(current)) {
            // We can't just delete it because indexes in the position strings will be off
            // We will mark it uniquely and then parse this elsewhere
            current[subkey] = REMOVED_MARKER;
          } else {
            delete current[subkey];
          }
        } else {
          current[subkey] = value;
        }

        this._affectedKeys[position] = affectedKey;
        this._affectedPositions[affectedKey] = position;
      } else { // Otherwise attempt to keep moving deeper into the object.
        // If we're setting (as opposed to deleting) a key and we hit a place
        // in the ancestor chain where the keys are not yet created, create them.
        if (current[subkey] === undefined && value !== undefined) {
          // See if the next piece is a number
          let nextPiece = subkeys[i + 1];
          nextPiece = parseInt(nextPiece, 10);
          current[subkey] = Number.isNaN(nextPiece) ? {} : [];
          createdObjectsOrArrays = true;
        }
        else if (isEmpty(current[subkey])) {
          createdObjectsOrArrays = true;
        }

        // Move deeper into the object
        current = current[subkey];

        // If we can go no further, then quit
        if (!Array.isArray(current) && !MongoObject.isBasicObject(current) && i < ln - 1) return;
      }
    }

    // If there are now new arrays or objects in the main object, we need to reparse it
    if (createdObjectsOrArrays || Array.isArray(value) || MongoObject.isBasicObject(value)) {
      this._reParseObj();
    }
  }

  /**
   * @method MongoObject.prototype.removeValueForPosition
   * @param {String} position
   * @returns {undefined}
   */
  removeValueForPosition(position) {
    this.setValueForPosition(position, undefined);
  }

  /**
   * @method MongoObject.prototype.getKeyForPosition
   * @param {String} position
   * @returns {undefined}
   */
  getKeyForPosition(position) {
    return this._affectedKeys[position];
  }

  /**
   * @method MongoObject.prototype.getGenericKeyForPosition
   * @param {String} position
   * @returns {undefined}
   */
  getGenericKeyForPosition(position) {
    return this._genericAffectedKeys[position];
  }

  /**
   * @method MongoObject.getInfoForKey
   * @param {String} key - Non-generic key
   * @returns {undefined|Object}
   *
   * Returns the value and operator of the requested non-generic key.
   * Example: {value: 1, operator: "$pull"}
   */
  getInfoForKey(key) {
    // Get the info
    const position = this.getPositionForKey(key);
    if (position) {
      return {
        value: this.getValueForPosition(position),
        operator: extractOp(position),
      };
    }

    // If we haven't returned yet, check to see if there is an array value
    // corresponding to this key
    // We find the first item within the array, strip the last piece off the
    // position string, and then return whatever is at that new position in
    // the original object.
    const positions = this.getPositionsForGenericKey(`${key}.$`);
    for (let index = 0; index < positions.length; index++) {
      const pos = positions[index];
      let value = this.getValueForPosition(pos);
      if (value === undefined) {
        const parentPosition = pos.slice(0, pos.lastIndexOf('['));
        value = this.getValueForPosition(parentPosition);
      }

      if (value !== undefined) {
        return {
          value,
          operator: extractOp(pos),
        };
      }
    }
  }

  /**
   * @method MongoObject.getPositionForKey
   * @param {String} key - Non-generic key
   * @returns {undefined|String} Position string
   *
   * Returns the position string for the place in the object that
   * affects the requested non-generic key.
   * Example: 'foo[bar][0]'
   */
  getPositionForKey(key) {
    return this._affectedPositions[key];
  }

  /**
   * @method MongoObject.getPositionsForGenericKey
   * @param {String} genericKey - Generic key
   * @returns {String[]} Array of position strings
   *
   * Returns an array of position strings for the places in the object that
   * affect the requested generic key.
   * Example: ['foo[bar][0]']
   */
  getPositionsForGenericKey(genericKey) {
    return this.getPositionsInfoForGenericKey(genericKey).map((p) => p.position);
  }

  /**
   * @method MongoObject.getPositionsInfoForGenericKey
   * @param {String} genericKey - Generic key
   * @returns {Object[]} Array of position info objects
   *
   * Returns an array of position info for the places in the object that
   * affect the requested generic key.
   */
  getPositionsInfoForGenericKey(genericKey) {
    let positions = this._positionsByGenericKey[genericKey];
    if (!positions || positions.length === 0) positions = this._positionsByGenericKey[`${genericKey}.$`];
    if (!positions || positions.length === 0) positions = [];
    return positions.map((info) => ({
      value: this.getValueForPosition(info.position),
      ...info,
    }));
  }

  getPositionsThatCreateGenericKey(genericKey) {
    return this._positionsThatCreateGenericKey[genericKey] || [];
  }

  /**
   * @deprecated Use getInfoForKey
   * @method MongoObject.getValueForKey
   * @param {String} key - Non-generic key
   * @returns {undefined|Any}
   *
   * Returns the value of the requested non-generic key
   */
  getValueForKey(key) {
    const position = this.getPositionForKey(key);
    if (position) return this.getValueForPosition(position);
  }

  /**
   * @method MongoObject.prototype.addKey
   * @param {String} key - Key to set
   * @param {Any} val - Value to give this key
   * @param {String} op - Operator under which to set it, or `null` for a non-modifier object
   * @returns {undefined}
   *
   * Adds `key` with value `val` under operator `op` to the source object.
   */
  addKey(key, val, op) {
    const position = op ? `${op}[${key}]` : MongoObject._keyToPosition(key);
    this.setValueForPosition(position, val);
  }

  /**
   * @method MongoObject.prototype.removeGenericKeys
   * @param {String[]} keys
   * @returns {undefined}
   *
   * Removes anything that affects any of the generic keys in the list
   */
  removeGenericKeys(keys) {
    Object.getOwnPropertyNames(this._genericAffectedKeys).forEach((position) => {
      if (keys.indexOf(this._genericAffectedKeys[position]) > -1) {
        this.removeValueForPosition(position);
      }
    });
  }

  /**
   * @method MongoObject.removeGenericKey
   * @param {String} key
   * @returns {undefined}
   *
   * Removes anything that affects the requested generic key
   */
  removeGenericKey(key) {
    Object.getOwnPropertyNames(this._genericAffectedKeys).forEach((position) => {
      if (this._genericAffectedKeys[position] === key) {
        this.removeValueForPosition(position);
      }
    });
  }

  /**
   * @method MongoObject.removeKey
   * @param {String} key
   * @returns {undefined}
   *
   * Removes anything that affects the requested non-generic key
   */
  removeKey(key) {
    // We don't use getPositionForKey here because we want to be sure to
    // remove for all positions if there are multiple.
    Object.getOwnPropertyNames(this._affectedKeys).forEach((position) => {
      if (this._affectedKeys[position] === key) {
        this.removeValueForPosition(position);
      }
    });
  }

  /**
   * @method MongoObject.removeKeys
   * @param {String[]} keys
   * @returns {undefined}
   *
   * Removes anything that affects any of the non-generic keys in the list
   */
  removeKeys(keys) {
    keys.forEach((key) => this.removeKey(key));
  }

  /**
   * @method MongoObject.filterGenericKeys
   * @param {Function} test - Test function
   * @returns {undefined}
   *
   * Passes all affected keys to a test function, which
   * should return false to remove whatever is affecting that key
   */
  filterGenericKeys(test) {
    const checkedKeys = [];
    const keysToRemove = [];
    Object.getOwnPropertyNames(this._genericAffectedKeys).forEach((position) => {
      const genericKey = this._genericAffectedKeys[position];
      if (checkedKeys.indexOf(genericKey) === -1) {
        checkedKeys.push(genericKey);
        if (genericKey && !test(genericKey)) {
          keysToRemove.push(genericKey);
        }
      }
    });

    keysToRemove.forEach((key) => this.removeGenericKey(key));
  }

  /**
   * @method MongoObject.setValueForKey
   * @param {String} key
   * @param {Any} val
   * @returns {undefined}
   *
   * Sets the value for every place in the object that affects
   * the requested non-generic key
   */
  setValueForKey(key, val) {
    // We don't use getPositionForKey here because we want to be sure to
    // set the value for all positions if there are multiple.
    Object.getOwnPropertyNames(this._affectedKeys).forEach((position) => {
      if (this._affectedKeys[position] === key) {
        this.setValueForPosition(position, val);
      }
    });
  }

  /**
   * @method MongoObject.setValueForGenericKey
   * @param {String} key
   * @param {Any} val
   * @returns {undefined}
   *
   * Sets the value for every place in the object that affects
   * the requested generic key
   */
  setValueForGenericKey(key, val) {
    // We don't use getPositionForKey here because we want to be sure to
    // set the value for all positions if there are multiple.
    Object.getOwnPropertyNames(this._genericAffectedKeys).forEach((position) => {
      if (this._genericAffectedKeys[position] === key) {
        this.setValueForPosition(position, val);
      }
    });
  }

  removeArrayItems() {
    // Traverse and pull out removed array items at this point
    function traverse(obj) {
      each(obj, (val, indexOrProp) => {
        // Move deeper into the object
        const next = obj[indexOrProp];

        // If we can go no further, then quit
        if (MongoObject.isBasicObject(next)) {
          traverse(next);
        } else if (Array.isArray(next)) {
          obj[indexOrProp] = next.filter((item) => item !== REMOVED_MARKER);
          traverse(obj[indexOrProp]);
        }
      });
    }

    traverse(this._obj);
  }

  /**
   * @method MongoObject.getObject
   * @returns {Object}
   *
   * Get the source object, potentially modified by other method calls on this
   * MongoObject instance.
   */
  getObject() {
    return this._obj;
  }

  /**
   * @method MongoObject.getFlatObject
   * @returns {Object}
   *
   * Gets a flat object based on the MongoObject instance.
   * In a flat object, the key is the name of the non-generic affectedKey,
   * with mongo dot notation if necessary, and the value is the value for
   * that key.
   *
   * With `keepArrays: true`, we don't flatten within arrays. Currently
   * MongoDB does not see a key such as `a.0.b` and automatically assume
   * an array. Instead it would create an object with key '0' if there
   * wasn't already an array saved as the value of `a`, which is rarely
   * if ever what we actually want. To avoid this confusion, we
   * set entire arrays.
   */
  getFlatObject({
    keepArrays = false,
  } = {}) {
    const newObj = {};
    Object.keys(this._affectedKeys).forEach((position) => {
      const affectedKey = this._affectedKeys[position];
      if (typeof affectedKey === 'string'
        && (
          (keepArrays === true && this._positionsInsideArrays.indexOf(position) === -1 && this._objectPositions.indexOf(position) === -1)
          || (keepArrays !== true && this._parentPositions.indexOf(position) === -1)
        )
      ) {
        newObj[affectedKey] = this.getValueForPosition(position);
      }
    });
    return newObj;
  }

  /**
   * @method MongoObject.affectsKey
   * @param {String} key
   * @returns {Object}
   *
   * Returns true if the non-generic key is affected by this object
   */
  affectsKey(key) {
    return !!this.getPositionForKey(key);
  }

  /**
   * @method MongoObject.affectsGenericKey
   * @param {String} key
   * @returns {Object}
   *
   * Returns true if the generic key is affected by this object
   */
  affectsGenericKey(key) {
    const positions = Object.getOwnPropertyNames(this._genericAffectedKeys);
    for (let index = 0; index < positions.length; index++) {
      const position = positions[index];
      if (this._genericAffectedKeys[position] === key) return true;
    }

    return false;
  }

  /**
   * @method MongoObject.affectsGenericKeyImplicit
   * @param {String} key
   * @returns {Object}
   *
   * Like affectsGenericKey, but will return true if a child key is affected
   */
  affectsGenericKeyImplicit(key) {
    const positions = Object.getOwnPropertyNames(this._genericAffectedKeys);
    for (let index = 0; index < positions.length; index++) {
      const position = positions[index];
      const affectedKey = this._genericAffectedKeys[position];
      if (genericKeyAffectsOtherGenericKey(key, affectedKey)) return true;
    }

    return false;
  }

  /* STATIC */

  /* Takes a specific string that uses any mongo-style positional update
   * dot notation and returns a generic string equivalent. Replaces all numeric
   * positional "pieces" (e.g. '.1') or any other positional operator
   * (e.g. '$[<identifier>]')  with a dollar sign ($).
   *
   * @param {type} name
   * @returns {String} Generic name.
   */
  static makeKeyGeneric(key) {
    if (typeof key !== 'string') return null;
    return key.replace(/\.([0-9]+|\$\[[^\]]*\])(?=\.|$)/g, '.$');
  }

  /** Takes a string representation of an object key and its value
   *  and updates "obj" to contain that key with that value.
   *
   *  Example keys and results if val is 1:
   *    "a" -> {a: 1}
   *    "a[b]" -> {a: {b: 1}}
   *    "a[b][0]" -> {a: {b: [1]}}
   *    'a[b.0.c]' -> {a: {'b.0.c': 1}}
   *
   * @param {any} val
   * @param {String} key
   * @param {Object} obj
   * @returns {undefined}
   */
  static expandKey(val, key, obj) {
    const subkeys = key.split('[');
    let current = obj;
    for (let i = 0, ln = subkeys.length; i < ln; i++) {
      let subkey = subkeys[i];
      if (subkey.slice(-1) === ']') {
        subkey = subkey.slice(0, -1);
      }

      if (i === ln - 1) {
        // Last iteration; time to set the value; always overwrite
        current[subkey] = val;

        // If val is undefined, delete the property
        if (val === undefined) delete current[subkey];
      } else {
        // See if the next piece is a number
        let nextPiece = subkeys[i + 1];
        nextPiece = parseInt(nextPiece, 10);
        if (!current[subkey]) {
          current[subkey] = Number.isNaN(nextPiece) ? {} : [];
        }
      }

      current = current[subkey];
    }
  }

  static _keyToPosition(key, wrapAll) {
    let position = '';
    key.split('.').forEach((piece, i) => {
      if (i === 0 && !wrapAll) {
        position += piece;
      } else {
        position += `[${piece}]`;
      }
    });
    return position;
  }

  /**
   * @method MongoObject._positionToKey
   * @param {String} position
   * @returns {String} The key that this position in an object would affect.
   *
   * This is different from MongoObject.prototype.getKeyForPosition in that
   * this method does not depend on the requested position actually being
   * present in any particular MongoObject.
   */
  static _positionToKey(position) {
    // XXX Probably a better way to do this, but this is
    // foolproof for now.
    const mDoc = new MongoObject({});
    mDoc.setValueForPosition(position, 1); // Value doesn't matter
    return mDoc.getKeyForPosition(position);
  }

  /**
   * @method MongoObject.cleanNulls
   * @public
   * @param {Object} doc - Source object
   * @returns {Object}
   *
   * Returns an object in which all properties with null, undefined, or empty
   * string values have been removed, recursively.
   */
  static cleanNulls(doc, isArray, keepEmptyStrings) {
    const newDoc = isArray ? [] : {};
    Object.keys(doc).forEach((key) => {
      let val = doc[key];
      if (!Array.isArray(val) && MongoObject.isBasicObject(val)) {
        val = MongoObject.cleanNulls(val, false, keepEmptyStrings); // Recurse into plain objects
        if (!isEmpty(val)) newDoc[key] = val;
      } else if (Array.isArray(val)) {
        val = MongoObject.cleanNulls(val, true, keepEmptyStrings); // Recurse into non-typed arrays
        if (!isEmpty(val)) newDoc[key] = val;
      } else if (!isNullUndefinedOrEmptyString(val)) {
        newDoc[key] = val;
      } else if (keepEmptyStrings && typeof val === 'string' && val.length === 0) {
        newDoc[key] = val;
      }
    });
    return newDoc;
  }

  /**
   * @method MongoObject.reportNulls
   * @public
   * @param {Object} flatDoc - An object with no properties that are also objects.
   * @returns {Object} An object in which the keys represent the keys in the
   * original object that were null, undefined, or empty strings, and the value
   * of each key is "".
   */
  static reportNulls(flatDoc, keepEmptyStrings) {
    const nulls = {};

    // Loop through the flat doc
    Object.keys(flatDoc).forEach((key) => {
      const val = flatDoc[key];
      if (
        val === null
        || val === undefined
        || (!keepEmptyStrings && typeof val === 'string' && val.length === 0)

        // If value is an array in which all the values recursively are undefined, null,
        // or an empty string
        || (Array.isArray(val) && MongoObject.cleanNulls(val, true, keepEmptyStrings).length === 0)
      ) {
        nulls[key] = '';
      }
    });
    return nulls;
  }

  /**
   * @method MongoObject.docToModifier
   * @public
   * @param {Object} doc - An object to be converted into a MongoDB modifier
   * @param {Object} [options] - Options
   * @param {Boolean} [options.keepEmptyStrings] - Pass `true` to keep empty strings in the $set. Otherwise $unset them.
   * @param {Boolean} [options.keepArrays] - Pass `true` to $set entire arrays. Otherwise the modifier will $set individual array items.
   * @returns {Object} A MongoDB modifier.
   *
   * Converts an object into a modifier by flattening it, putting keys with
   * null, undefined, and empty string values into `modifier.$unset`, and
   * putting the rest of the keys into `modifier.$set`.
   */
  static docToModifier(doc, {
    keepArrays = false,
    keepEmptyStrings = false,
  } = {}) {
    // Flatten doc
    const mDoc = new MongoObject(doc);
    let flatDoc = mDoc.getFlatObject({ keepArrays });

    // Get a list of null, undefined, and empty string values so we can unset them instead
    const nulls = MongoObject.reportNulls(flatDoc, keepEmptyStrings);
    flatDoc = MongoObject.cleanNulls(flatDoc, false, keepEmptyStrings);

    const modifier = {};
    if (!isEmpty(flatDoc)) modifier.$set = flatDoc;
    if (!isEmpty(nulls)) modifier.$unset = nulls;
    return modifier;
  }

  /* Tests whether "obj" is an Object as opposed to
   * something that inherits from Object
   *
   * @param {any} obj
   * @returns {Boolean}
   */
  static isBasicObject(obj) {
    return obj === Object(obj) && Object.getPrototypeOf(obj) === Object.prototype;
  }

  /**
   * @method MongoObject.objAffectsKey
   * @public
   * @param  {Object} obj
   * @param  {String} key
   * @return {Boolean}
   */
  static objAffectsKey(obj, key) {
    const mDoc = new MongoObject(obj);
    return mDoc.affectsKey(key);
  }

  /**
   * @method MongoObject.objectsThatGenericKeyWillCreate
   * @public
   * @param  {String} genericKey
   * @return {String[]} Array of other generic keys that would be created
   *                    by this generic key
   */
  static objectsThatGenericKeyWillCreate(genericKey) {
    const objs = [];

    do {
      const lastDotPosition = genericKey.lastIndexOf('.');
      genericKey = lastDotPosition === -1 ? '' : genericKey.slice(0, lastDotPosition);
      if (genericKey.length && !genericKey.endsWith('.$')) objs.push(genericKey);
    } while (genericKey.length);

    return objs;
  }

  /**
   * @method MongoObject.expandObj
   * @public
   * @param  {Object} doc
   * @return {Object}
   *
   * Takes a flat object and returns an expanded version of it.
   */
  static expandObj(doc) {
    const newDoc = {};
    Object.keys(doc).forEach((key) => {
      const val = doc[key];
      const subkeys = key.split('.');
      const subkeylen = subkeys.length;
      let current = newDoc;
      for (let i = 0; i < subkeylen; i++) {
        const subkey = subkeys[i];
        if (typeof current[subkey] !== 'undefined' && !isObject(current[subkey])) {
          break; // Already set for some reason; leave it alone
        }

        if (i === subkeylen - 1) {
          // Last iteration; time to set the value
          current[subkey] = val;
        } else {
          // See if the next piece is a number
          let nextPiece = subkeys[i + 1];
          nextPiece = parseInt(nextPiece, 10);
          if (Number.isNaN(nextPiece) && !isObject(current[subkey])) {
            current[subkey] = {};
          } else if (!Number.isNaN(nextPiece) && !Array.isArray(current[subkey])) {
            current[subkey] = [];
          }
        }

        current = current[subkey];
      }
    });
    return newDoc;
  }
}

/* PRIVATE */

function appendAffectedKey(affectedKey, key) {
  if (key === '$each') return affectedKey;
  return affectedKey ? `${affectedKey}.${key}` : key;
}

// Extracts operator piece, if present, from position string
function extractOp(position) {
  const firstPositionPiece = position.slice(0, position.indexOf('['));
  return (firstPositionPiece.substring(0, 1) === '$') ? firstPositionPiece : null;
}

function genericKeyAffectsOtherGenericKey(key, affectedKey) {
  // If the affected key is the test key
  if (affectedKey === key) return true;

  // If the affected key implies the test key because the affected key
  // starts with the test key followed by a period
  if (affectedKey.substring(0, key.length + 1) === `${key}.`) return true;

  // If the affected key implies the test key because the affected key
  // starts with the test key and the test key ends with ".$"
  const lastTwo = key.slice(-2);
  if (lastTwo === '.$' && key.slice(0, -2) === affectedKey) return true;

  return false;
}

function isNullUndefinedOrEmptyString(val) {
  return (val === undefined || val === null || (typeof val === 'string' && val.length === 0));
}

/** Used as references for various `Number` constants. */
const MAX_SAFE_INTEGER = 9007199254740991;

function isLength(value) {
  return typeof value === 'number'
    && value > -1 && value % 1 === 0 && value <= MAX_SAFE_INTEGER;
}

function isArrayLike(value) {
  return value != null && typeof value !== 'function' && isLength(value.length);
}

function each(collection, iteratee) {
  if (collection == null) {
    return;
  }

  if (Array.isArray(collection)) {
    collection.forEach(iteratee);
    return;
  }

  const iterable = Object(collection);

  if (!isArrayLike(collection)) {
    Object.keys(iterable).forEach((key) => iteratee(iterable[key], key, iterable));
    return;
  }

  let index = -1;
  while (++index < collection.length) {
    if (iteratee(iterable[index], index, iterable) === false) {
      break;
    }
  }
}

function isPrototype(value) {
  const Ctor = value && value.constructor;
  const proto = (typeof Ctor === 'function' && Ctor.prototype) || Object.prototype;

  return value === proto;
}

function isEmpty(value) {
  if (value === null || value === undefined) {
    return true;
  }

  if (Array.isArray(value) || typeof value === 'string') {
    return !value.length;
  }

  const tag = Object.prototype.toString.call(value);
  if (tag === '[object Map]' || tag === '[object Set]') {
    return !value.size;
  }

  if (isPrototype(value)) {
    return !Object.keys(value).length;
  }

  /* eslint-disable no-restricted-syntax */
  for (const key in value) {
    if (hasOwnProperty.call(value, key)) {
      return false;
    }
  }
  /* eslint-enable no-restricted-syntax */

  return true;
}

function isObject(value) {
  const type = typeof value;
  return value != null && (type === 'object' || type === 'function');
}
